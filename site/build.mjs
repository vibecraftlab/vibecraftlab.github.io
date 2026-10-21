#!/usr/bin/env node
// vibecraft tech — 공개 블로그 생성기 (디자인: design/mockups/e-techblog 시안 E)
//   node site/build.mjs                 content/ → dist/
//   node site/build.mjs --serve [port]  만든 뒤 http://127.0.0.1:8090 에서 미리보기 (이 PC 에서만)
//   --content <dir>  --out <dir>        입력·출력 폴더 바꾸기 (GitHub Actions 는 --out public)
// 입력은 sync-public.mjs 가 걸러 낸 content/ 뿐이다. 비밀 검사는 sync 에서 끝났고, 여기서는 모양만 만든다.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { visit } from 'unist-util-visit';
import { toString } from 'mdast-util-to-string';
import GithubSlugger from 'github-slugger';
import { createHighlighter } from 'shiki';
import { LOGO_VIEWBOX, LOGO_BODY, LOGO_MOON, LOGO_DEFS } from './brand.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def; };
const CONTENT = path.resolve(arg('--content', path.join(ROOT, 'content')));
const OUT = path.resolve(arg('--out', path.join(ROOT, 'dist')));
const SERVE = process.argv.includes('--serve');
const PORT = Number(arg('--serve', 8090)) || 8090;

const SITE = {
  name: 'vibecraft tech',
  url: 'https://vibecraftlab.github.io',
  description: 'vibecraft 가 Rust 서비스와 앱, LLM 도구를 만들며 남긴 엔지니어링 노트',
  mail: 'vibecraft.lab.official@gmail.com',
  github: 'https://github.com/vibecraftlab',
};

// ───────────────────────── 도우미 ─────────────────────────
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dateStr = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? ''));
const dot = (d) => d.replace(/-/g, '.');
const korDate = (d) => { const [y, m, dd] = d.split('-').map(Number); return `${y}년 ${m}월 ${dd}일`; };
const enc = (t) => encodeURIComponent(t);

function splitFm(text) {
  const m = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { fm: {}, body: text };
  return { fm: YAML.parse(m[1]) || {}, body: text.slice(m[0].length) };
}
// 코드 펜스·인라인 코드를 빼 두고 링크만 바꾼 뒤 되돌린다
function maskCode(text) {
  const slots = []; const put = (s) => { slots.push(s); return `\u0000${slots.length - 1}\u0000`; };
  let out = text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, put);
  out = out.replace(/`[^`\n]+`/g, put);
  return { out, restore: (t) => t.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)]) };
}

// ───────────────────────── 마크다운 → HTML ─────────────────────────
const LANGS = ['javascript', 'typescript', 'tsx', 'jsx', 'json', 'yaml', 'toml', 'bash', 'shellscript', 'powershell', 'rust', 'python', 'html', 'css', 'markdown', 'diff', 'sql', 'ini', 'dockerfile', 'go', 'kotlin', 'swift', 'java', 'c', 'cpp'];
const ALIAS = { js: 'javascript', ts: 'typescript', sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', ps1: 'powershell', ps: 'powershell', pwsh: 'powershell', yml: 'yaml', md: 'markdown', rs: 'rust', py: 'python', docker: 'dockerfile' };
let highlighter;

function remarkVibecraft(post) {
  return (tree) => {
    const slugger = new GithubSlugger();
    // 1) 본문 첫 # 제목은 글 머리와 겹치므로 뺀다
    const firstH1 = tree.children.findIndex((n) => n.type === 'heading' && n.depth === 1);
    if (firstH1 === 0 || (firstH1 > 0 && tree.children.slice(0, firstH1).every((n) => n.type === 'html'))) tree.children.splice(firstH1, 1);
    // 글 머리에 description 을 부제로 보여 줄 때, 본문 첫 문단이 같은 문장이면 한 번만 보이게 뺀다
    const norm = (t) => String(t).replace(/[\s*_`]+/g, '');
    if (!post.sub && post.description) {
      const i = tree.children.findIndex((n) => n.type !== 'html');
      if (i >= 0 && tree.children[i].type === 'paragraph' && norm(toString(tree.children[i])) === norm(post.description)) tree.children.splice(i, 1);
    }
    visit(tree, (node, index, parent) => {
      // 2) 제목 id + 목차
      if (node.type === 'heading') {
        const text = toString(node); const id = slugger.slug(text);
        node.data = { ...(node.data || {}), hProperties: { id } };
        if (node.depth === 2 || node.depth === 3) post.toc.push({ depth: node.depth, id, text });
      }
      // 3) Obsidian 콜아웃 > [!note] 제목
      if (node.type === 'blockquote') {
        const p = node.children[0]; const t = p && p.type === 'paragraph' && p.children[0];
        const m = t && t.type === 'text' && /^\[!(\w+)\][+-]?[ \t]*([^\n]*)\n?/.exec(t.value);
        if (m) {
          t.value = t.value.slice(m[0].length);
          if (!t.value) { p.children.shift(); if (p.children[0] && p.children[0].type === 'break') p.children.shift(); }
          const title = m[2].trim() || m[1].charAt(0).toUpperCase() + m[1].slice(1);
          node.children.unshift({ type: 'html', value: `<b>${esc(title)}</b>` });
          if (!p.children.length) node.children.splice(node.children.indexOf(p), 1);
          node.data = { hName: 'div', hProperties: { className: ['callout', `callout-${m[1].toLowerCase()}`] } };
        }
      }
      // 4) 코드 블록 → 하이라이트 (첫 블록은 대표 이미지용으로 기억)
      if (node.type === 'code' && parent) {
        const raw = (node.lang || '').toLowerCase(); const lang = ALIAS[raw] || raw;
        // 표지 터미널에는 실제 코드만 쓴다. 언어 없는 블록·text·markdown 은 대개 ASCII 도표라 좁은 창에서 깨진다
        if (!post.firstCode && node.value.trim() && LANGS.includes(lang) && lang !== 'markdown') post.firstCode = { lang: raw, value: node.value };
        let html;
        try { html = highlighter.codeToHtml(node.value, { lang: LANGS.includes(lang) ? lang : 'text', theme: 'github-dark' }); }
        catch { html = `<pre class="shiki"><code>${esc(node.value)}</code></pre>`; }
        parent.children[index] = { type: 'html', value: raw ? html.replace('<pre class="shiki', `<pre data-lang="${esc(raw)}" class="shiki`) : html };
      }
    });
  };
}

async function render(md, post) {
  const file = await unified().use(remarkParse).use(remarkGfm).use(remarkBreaks).use(remarkVibecraft, post)
    .use(remarkRehype, { allowDangerousHtml: true }).use(rehypeStringify, { allowDangerousHtml: true }).process(md);
  return String(file);
}

// 위키 링크·첨부를 일반 마크다운으로 (코드 안은 그대로)
function preprocess(body) {
  const { out, restore } = maskCode(body);
  let s = out.replace(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, (_, t) => `![](/${t.trim().replace(/^\/+/, '')})`);
  s = s.replace(/!\[([^\]]*)\]\((assets\/[^)\s]+)\)/g, (_, alt, t) => `![${alt}](/${t})`);
  s = s.replace(/(?<!!)\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, target, hash = '', alias) => {
    const slug = target.trim(); const anchor = hash ? '#' + new GithubSlugger().slug(hash.slice(1)) : '';
    return `[${alias ?? slug}](/${slug}${anchor})`;
  });
  return restore(s);
}

// ───────────────────────── 글 읽기 ─────────────────────────
async function loadPosts() {
  const posts = [];
  for (const f of fs.readdirSync(CONTENT).filter((f) => f.endsWith('.md') && f !== 'index.md')) {
    const { fm, body } = splitFm(fs.readFileSync(path.join(CONTENT, f), 'utf8'));
    if (fm.publish === false || fm.draft === true) continue;
    const slug = path.basename(f, '.md');
    const title = String(fm.title || slug);
    const [main, ...rest] = title.split(/\s+—\s+/);
    const post = { slug, title, main, sub: rest.join(' — ') || '', description: String(fm.description || ''), date: dateStr(fm.date), modified: fm.modified ? dateStr(fm.modified) : '', tags: (fm.tags || []).map(String), toc: [], firstCode: null };
    post.minutes = Math.max(2, Math.round(body.replace(/```[\s\S]*?```/g, '').replace(/\s+/g, '').length / 600));
    post.html = await render(preprocess(body), post);
    posts.push(post);
  }
  return posts.sort((a, b) => (a.date === b.date ? a.slug.localeCompare(b.slug) : a.date < b.date ? 1 : -1));
}
function loadGraph() {
  const f = path.join(CONTENT, 'graph.json');
  try { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; } catch { return null; }
}

// ───────────────────────── 조각 (HTML) ─────────────────────────
const LOGO_SYMBOL = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${LOGO_DEFS}</defs>
<symbol id="logo" viewBox="${LOGO_VIEWBOX}"><path style="fill:var(--logo-fill)" d="${LOGO_BODY}"/><circle style="fill:var(--logo-fill)" ${LOGO_MOON}/><path style="fill:var(--logo-glow)" d="${LOGO_BODY}"/><circle style="fill:var(--logo-glow)" ${LOGO_MOON}/></symbol>
<symbol id="arrow" viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></symbol></svg>`;

function head({ title, description, url, type = 'website' }) {
  const t = title ? `${title} — ${SITE.name}` : SITE.name;
  return `<!doctype html>
<html lang="ko" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t)}</title>
<meta name="description" content="${esc(description || SITE.description)}">
<link rel="canonical" href="${SITE.url}${url}">
<meta property="og:type" content="${type}"><meta property="og:site_name" content="${SITE.name}"><meta property="og:title" content="${esc(title || SITE.name)}"><meta property="og:description" content="${esc(description || SITE.description)}"><meta property="og:url" content="${SITE.url}${url}"><meta property="og:image" content="${SITE.url}/icon-512.png">
<link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="alternate" type="application/rss+xml" title="${SITE.name}" href="/index.xml">
<link rel="preconnect" href="https://api.fontshare.com"><link rel="preconnect" href="https://cdn.fontshare.com" crossorigin>
<link href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600,700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<link rel="stylesheet" href="/assets/site.css">
</head>
<body>
${LOGO_SYMBOL}`;
}
const bar = (current) => `<div class="wrap">
  <header class="bar">
    <a class="brand" href="/" aria-label="vibecraft tech 홈"><svg><use href="#logo"/></svg>vibecraft <span>tech</span></a>
    <nav class="nav" aria-label="주요 메뉴"><a href="/#posts"${current === 'posts' ? ' aria-current="page"' : ''}>글</a><a href="/tags"${current === 'tags' ? ' aria-current="page"' : ''}>주제</a><a href="/#about">소개</a><a href="/index.xml">RSS</a></nav>
    <div class="end">
      <button class="icon-btn" id="theme" type="button" aria-label="다크 모드로 바꾸기"><svg viewBox="0 0 24 24"><path id="theme-ico" d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" fill="currentColor"/></svg></button>
      <a class="btn" href="mailto:${SITE.mail}?subject=${enc('[vibecraft tech] 문의')}">문의하기</a>
    </div>
  </header>
</div>`;
const contactAndFooter = () => `<section class="contact" id="contact" aria-labelledby="contact-h">
  <div class="box">
    <h2 class="q" id="contact-h" data-rise><span>글에 대해 묻고 싶은 것이 있다면</span>여기에 적어 보내 주세요</h2>
    <form class="field" id="ask" data-rise style="--i:1" data-mail="${SITE.mail}" action="mailto:${SITE.mail}" method="get">
      <label class="sr" for="ask-in">보낼 내용</label>
      <input id="ask-in" name="body" type="text" autocomplete="off" placeholder="예: 이 글의 배포 설정 부분이 궁금합니다">
      <input type="hidden" name="subject" value="[vibecraft tech] 글 문의">
      <button type="submit" aria-label="메일로 보내기"><svg><use href="#arrow"/></svg></button>
    </form>
    <p class="note" data-rise style="--i:2">보내기를 누르면 메일 앱이 열리고, 적은 내용이 본문에 들어갑니다.</p>
    <dl class="kv" data-rise style="--i:3">
      <dt>메일</dt><dd><a href="mailto:${SITE.mail}">${SITE.mail}</a></dd>
      <dt>GitHub</dt><dd><a href="${SITE.github}">github.com/vibecraftlab</a></dd>
      <dt>RSS</dt><dd><a href="/index.xml">vibecraftlab.github.io/index.xml</a></dd>
    </dl>
  </div>
</section>
<footer class="tiles" aria-label="사이트 정보">
  <div class="tile t-say" data-rise><p>만들면서 배운 것을 그대로 적습니다.</p><small>© ${new Date().getFullYear()} vibecraft. 글의 이력은 GitHub 에 공개되어 있습니다.<br>사진: Art Institute of Chicago, 퍼블릭 도메인.</small></div>
  <div class="tile t-nav" data-rise style="--i:1"><ul><li><a href="/#posts">글</a></li><li><a href="/tags">주제</a></li><li><a href="/#about">소개</a></li><li><a href="/index.xml">RSS</a></li><li><a href="${SITE.github}">GitHub</a></li></ul></div>
  <div class="tile t-time" data-rise style="--i:2"><b>한국 표준시</b><span id="clock">지금 한국 시각</span></div>
  <div class="tile t-mail" data-rise style="--i:3"><small>메일</small><a href="mailto:${SITE.mail}">${SITE.mail}</a></div>
  <div class="tile t-word" aria-hidden="true"><svg viewBox="0 0 1000 200"><text x="500" y="152" text-anchor="middle" font-family="General Sans, Pretendard, sans-serif" font-weight="700" font-size="196" letter-spacing="-8" fill="currentColor">vibecraft</text></svg></div>
  <a class="tile t-go" href="/index.xml"><b>새 글을<br>받아보기</b><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M14 50 L50 14 M22 14 H50 V42" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg></a>
</footer>`;
const foot = (extra = '') => `${extra}<script src="/assets/site.js" defer></script>\n</body>\n</html>\n`;

// 대표 이미지: 그 글의 첫 코드 블록(터미널 조각) + 목차(패널 조각) — 모두 글에서 온 실제 내용
function coverFragments(p, { termClass = 'term nudge-r', panelClass = 'panel nudge-l', maxLines = 11 } = {}) {
  const parts = [];
  if (p.firstCode) {
    const lines = p.firstCode.value.replace(/\s+$/, '').split('\n');
    // 표지는 장식이라 줄 끝 주석은 걷어 내고(좁은 화면에서 줄이 엉키지 않게), 너무 긴 줄은 자른다
    const shown = lines.slice(0, maxLines).map((l) => l.replace(/(\S)\s{2,}(\/\/|#).*$/, '$1').replace(/\s+$/, '')).map((l) => (l.length > 52 ? l.slice(0, 51) + '…' : l));
    if (lines.length > maxLines) shown.push('…');
    parts.push(`<pre class="${termClass}"><span class="bar3"><i></i><i></i><i></i></span>${esc(shown.join('\n'))}</pre>`);
  }
  const outline = p.toc.filter((t) => t.depth === 2).slice(0, 6);
  if (outline.length) {
    parts.push(`<div class="${panelClass}"><div class="ph"><span class="lb">이 글의 순서</span><small>${p.minutes}분</small></div>${outline.map((t, i) => `<div class="pr${i === 0 ? ' sel' : ''}"><span class="dot${i === 0 ? ' g' : ''}"></span><span class="lb">${esc(t.text)}</span></div>`).join('')}</div>`);
  }
  if (!parts.length) parts.push(`<div class="${panelClass}"><div class="ph"><span class="lb">${esc(p.main)}</span><small>${p.minutes}분</small></div><div class="pr sub">${esc(p.description || p.sub)}</div></div>`);
  return parts.join('\n');
}
const shortTitle = (p) => (p.main.length > 20 ? p.main.slice(0, 19) + '…' : p.main);

// ───────────────────────── 페이지 ─────────────────────────
function homePage(posts, graph) {
  const tagCount = new Map(); posts.forEach((p) => p.tags.forEach((t) => tagCount.set(t, (tagCount.get(t) || 0) + 1)));
  const topTags = [...tagCount].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5);
  const pubCount = graph ? graph.n.filter((n) => n.k).length : posts.length;
  const titles = Object.fromEntries(posts.map((p) => [p.slug, { short: shortTitle(p), date: p.date }]));
  const latest = posts[0];
  const hero = `<section class="hero" aria-labelledby="hero-h">
    <h1 id="hero-h" data-rise>만들면서 배운 것을<br>그대로 적습니다</h1>
    <div class="copy">
      <p data-rise style="--i:1">vibecraft 가 Rust 서비스와 앱, LLM 도구를 만들며 남긴 엔지니어링 노트입니다.${graph ? ` 사내 위키 ${graph.total}장 가운데 공개해도 되는 글만 이곳에 올라옵니다.` : ''}</p>
      <div class="acts" data-rise style="--i:2"><a class="btn" href="#posts">최근 글 보기</a><a class="link" href="/index.xml">RSS 로 구독하기</a></div>
    </div>
    ${graph ? `<div class="stage" data-rise style="--i:2">
      <div class="graph" id="graph" data-ui data-mode="all">
        <div class="tools"><div><b>사내 위키 지도</b><small>문서 ${graph.total}장 · 링크 ${graph.links}개</small></div>
          <div class="seg" role="group" aria-label="보기"><button type="button" data-mode="all" aria-pressed="true">전체</button><button type="button" data-mode="pub" aria-pressed="false">공개된 글 ${pubCount}</button></div></div>
        <div class="plot"><svg viewBox="0 0 1600 1000" preserveAspectRatio="none" role="img" aria-label="사내 위키 문서와 링크의 지도. 공개된 글 ${pubCount}편이 밝게 표시된다"><path class="e" id="g-e"/><path class="e-lit" id="g-el"/><path class="e-hi" id="g-eh"/><g id="g-n"></g><g id="g-l"></g></svg><div class="labels" id="g-labels"></div></div>
        <div class="foot"><span><i style="background:var(--lit)"></i>공개된 글 — 누르면 그 글로 이동</span><span><i style="background:var(--dim)"></i>사내 전용 문서 — 제목은 밖에 나가지 않습니다</span></div>
      </div>
    </div>` : ''}
  </section>`;
  const list = posts.length ? `<section class="posts" id="posts" aria-labelledby="posts-h">
    <div class="pin"><div class="coverstage" id="covers">
      ${posts.map((p, i) => `<div class="cover${i === 0 ? ' on' : ''}" data-k="${p.slug}" data-ui>${coverFragments(p)}</div>`).join('\n      ')}
    </div></div>
    <div class="side">
      <h2 id="posts-h" data-rise>최근 글</h2>
      ${topTags.length > 1 ? `<div class="chips" role="group" aria-label="주제로 거르기" data-rise style="--i:1"><button type="button" data-t="all" aria-pressed="true">전체<span>${posts.length}</span></button>${topTags.map(([t, c]) => `<button type="button" data-t="${esc(t)}" aria-pressed="false">${esc(t)}<span>${c}</span></button>`).join('')}</div>` : ''}
      <ol class="rows" id="rows">
        ${posts.map((p, i) => `<li class="row${i === 0 ? ' on' : ''}" data-k="${p.slug}" data-t="${esc(p.tags.join(' '))}" tabindex="0">
          <div class="top"><h3>${esc(p.main)}</h3><span class="meta">${dot(p.date)} · ${p.minutes}분</span></div>
          <div class="more"><p>${esc(p.description || p.sub)}</p><div class="tags">${p.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div><a class="link" href="/${p.slug}">글 읽기</a></div>
        </li>`).join('\n        ')}
      </ol>
    </div>
  </section>` : `<section class="posts" id="posts"><div class="side"><h2>최근 글</h2><p>아직 공개된 글이 없습니다.</p></div></section>`;
  const statement = `<section class="statement" aria-label="글이 이곳에 오기까지"><div class="wrap">
    <p data-rise>모든 글은 사내 위키<span class="th map" data-ui aria-hidden="true"><svg viewBox="0 0 64 40" id="mini-map"></svg></span>에서 시작해, 비밀 검사<span class="th chk2" data-ui aria-hidden="true"><span class="chk"></span>0</span>를 통과하고, 사람이 직접 발행<span class="th sw" data-ui aria-hidden="true"><i></i></span>해야 이곳에 도착합니다.</p>
  </div></section>`;
  const about = `<div class="wrap"><section class="about" id="about" aria-label="vibecraft 소개">
    <div class="letter">
      <svg class="mark" data-rise><use href="#logo"/></svg>
      <p data-rise style="--i:1">vibecraft 는 작은 소프트웨어 스튜디오입니다. 채팅 앱과 대화 분석 서비스, 달리기 게임을 만들고, 그 사이사이 Rust 와 앱 빌드, LLM 도구와 씨름합니다.</p>
      <p data-rise style="--i:2">일하다 알게 된 것은 먼저 사내 위키에 적습니다. 에러 메시지 하나, 배포 실패 한 번도 다음 사람이 같은 자리에서 넘어지지 않도록 남겨 둡니다.</p>
      <p data-rise style="--i:3">그중 회사 밖에서도 쓸모 있을 글을 골라 여기에 옮깁니다. <mark>고객사 이름이나 내부 주소처럼 나가면 안 되는 것은 검사에서 걸리고</mark>, 마지막 발행은 사람이 직접 합니다.</p>
      <p data-rise style="--i:4">잘 다듬은 정답보다 실제로 겪은 순서를 적으려 합니다. 틀린 곳을 찾으면 메일로 알려 주세요. 고쳐서 다시 올리겠습니다.</p>
      <div class="sign" data-rise style="--i:5">vibecraft 팀<small>엔지니어링 노트를 쓰는 사람들</small></div>
    </div>
    <figure data-rise style="--i:2">
      <div class="ph"><img src="/static/workshop-1864.jpg" width="880" height="1100" alt="1864년, 연장이 걸린 벽 앞 작업대에서 대패질을 하는 목수. 바닥에 대팻밥이 흩어져 있다." loading="lazy" decoding="async"></div>
      <figcaption>작업대 앞의 목수, 1864년. 작자 미상 틴타입, <a href="https://www.artic.edu/artworks/250184">Art Institute of Chicago</a> 소장, 퍼블릭 도메인(CC0).</figcaption>
    </figure>
  </section></div>`;
  const data = graph ? `<script id="graph-data" type="application/json">${JSON.stringify({ n: graph.n, e: graph.e })}</script><script id="graph-titles" type="application/json">${JSON.stringify(titles).replace(/</g, '\\u003c')}</script>\n` : '';
  return head({ title: '', description: SITE.description, url: '/' }) + bar('posts')
    + `\n<main><div class="wrap">${hero}${list}</div>${statement}${about}</main>\n` + contactAndFooter() + '\n' + foot(data);
}

function postPage(p, i, posts, graph) {
  const newer = posts[i - 1], older = posts[i + 1];
  // 이 글과 이어진 문서 (위키 지도에서)
  let near = '';
  if (graph) {
    const idx = graph.n.findIndex((n) => n.k === p.slug);
    if (idx >= 0) {
      const ns = graph.e.filter(([a, b]) => a === idx || b === idx).map(([a, b]) => (a === idx ? b : a));
      const pub = ns.filter((j) => graph.n[j].k && posts.some((q) => q.slug === graph.n[j].k));
      const c = graph.n[idx];
      const pt = (j) => [(100 + (graph.n[j].x - c.x) * 420).toFixed(1), (70 + (graph.n[j].y - c.y) * 300).toFixed(1)];
      const svg = ns.map((j) => { const [x, y] = pt(j); return `<line x1="100" y1="70" x2="${x}" y2="${y}" stroke="var(--edge)" stroke-width="2"/>`; }).join('')
        + ns.map((j) => { const [x, y] = pt(j); const l = !!graph.n[j].k; return `<circle cx="${x}" cy="${y}" r="${l ? 7 : 5}" fill="var(${l ? '--lit' : '--dim'})"/>`; }).join('')
        + '<circle cx="100" cy="70" r="11" fill="var(--ink)"/>';
      if (ns.length) near = `<section class="near" aria-labelledby="near-h"><svg viewBox="0 0 200 140" aria-hidden="true">${svg}</svg><div>
        <h2 id="near-h">이 글과 이어진 문서</h2>
        <p>사내 위키에서 이 글은 문서 ${ns.length}장과 링크로 이어져 있습니다.${pub.length ? ` 그중 ${pub.length}편은 공개된 글이고, ` : ' '}${ns.length - pub.length}장은 사내 전용이라 제목을 보여 드리지 않습니다.</p>
        <ul>${pub.length ? pub.map((j) => { const q = posts.find((x) => x.slug === graph.n[j].k); return `<li><a href="/${q.slug}">${esc(shortTitle(q))}</a></li>`; }).join('') : '<li><a href="/#posts">공개된 다른 글 보기</a></li>'}</ul>
      </div></section>`;
    }
  }
  const tocHtml = p.toc.length ? `<nav class="toc" id="toc" aria-label="목차"><b>이 글의 순서</b>${p.toc.map((t) => `<a${t.depth === 3 ? ' class="sub"' : ''} href="#${esc(t.id)}">${esc(t.text)}</a>`).join('')}<div class="share"><button class="btn quiet" type="button" id="copy">링크 복사</button></div></nav>` : '<div></div>';
  const tag = p.tags[0];
  const body = `<main><div class="wrap">
  <header class="art-head">
    <h1 data-rise>${esc(p.main)}</h1>
    ${p.sub || p.description ? `<p class="sub" data-rise style="--i:1">${esc(p.sub || p.description)}</p>` : ''}
    <div class="byline" data-rise style="--i:2"><span class="who"><svg><use href="#logo"/></svg>vibecraft 팀</span><span>${korDate(p.date)}</span>${p.modified && p.modified !== p.date ? `<span>${korDate(p.modified)} 고침</span>` : ''}<span>${p.minutes}분 분량</span>${tag ? `<a href="/tags/${enc(tag)}">${esc(tag)}</a>` : ''}</div>
  </header>
  <div class="art-cover" data-rise style="--i:3" data-ui>${coverFragments(p, { termClass: 'term', panelClass: 'panel', maxLines: 9 })}</div>
  <div class="art-body">
    <article class="prose">${p.html}${p.tags.length ? `<p class="tagline">${p.tags.map((t) => `<a href="/tags/${enc(t)}">#${esc(t)}</a>`).join(' ')}</p>` : ''}${near}</article>
    ${tocHtml}
  </div>
  <nav class="pn" aria-label="다른 글">
    ${older ? `<a href="/${older.slug}"><small>이전 글</small><b>${esc(older.main)}</b></a>` : '<span></span>'}
    ${newer ? `<a class="nx" href="/${newer.slug}"><small>다음 글</small><b>${esc(newer.main)}</b></a>` : '<span></span>'}
  </nav>
</div></main>`;
  return head({ title: p.title, description: p.description, url: `/${p.slug}`, type: 'article' }) + bar('posts') + '\n' + body + '\n' + contactAndFooter() + '\n' + foot();
}

function listPage({ title, lead, url, items, current }) {
  const body = `<main><div class="wrap"><section class="listpage">
    <h1 data-rise>${esc(title)}</h1>${lead ? `<p class="lead" data-rise style="--i:1">${lead}</p>` : ''}
    <ol class="rows plain" data-rise style="--i:2">${items.join('\n')}</ol>
  </section></div></main>`;
  return head({ title, description: lead ? lead.replace(/<[^>]+>/g, '') : '', url }) + bar(current) + '\n' + body + '\n' + contactAndFooter() + '\n' + foot();
}
const postRow = (p) => `<li class="row on"><a href="/${p.slug}"><div class="top"><h3>${esc(p.main)}</h3><span class="meta">${dot(p.date)} · ${p.minutes}분</span></div><div class="more"><p>${esc(p.description || p.sub)}</p></div></a></li>`;

function notFound() {
  return head({ title: '페이지를 찾을 수 없습니다', url: '/404' }) + bar('') + `
<main><div class="wrap"><section class="listpage nf"><h1>여기에는 글이 없습니다</h1><p class="lead">주소가 바뀌었거나, 아직 공개하지 않은 글일 수 있습니다. 사내 위키의 글은 공개 표시가 붙은 것만 이곳에 나옵니다.</p><a class="btn" href="/">처음으로</a></section></div></main>\n` + contactAndFooter() + '\n' + foot();
}

function rss(posts) {
  const items = posts.slice(0, 30).map((p) => `<item><title>${esc(p.title)}</title><link>${SITE.url}/${p.slug}</link><guid>${SITE.url}/${p.slug}</guid><pubDate>${new Date(p.date + 'T09:00:00+09:00').toUTCString()}</pubDate><description>${esc(p.description)}</description>${p.tags.map((t) => `<category>${esc(t)}</category>`).join('')}</item>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${SITE.name}</title><link>${SITE.url}</link><description>${esc(SITE.description)}</description><language>ko</language>${items}</channel></rss>\n`;
}
function sitemap(posts, tags) {
  const urls = ['/', '/tags', ...posts.map((p) => `/${p.slug}`), ...tags.map((t) => `/tags/${enc(t)}`)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${SITE.url}${u}</loc></url>`).join('')}</urlset>\n`;
}

// ───────────────────────── 빌드 ─────────────────────────
async function build() {
  const t0 = Date.now();
  highlighter = await createHighlighter({ themes: ['github-dark'], langs: LANGS });
  const posts = await loadPosts();
  const graph = loadGraph();
  fs.rmSync(OUT, { recursive: true, force: true });
  const write = (rel, data) => { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };

  write('index.html', homePage(posts, graph));
  posts.forEach((p, i) => write(`${p.slug}.html`, postPage(p, i, posts, graph)));
  const tagMap = new Map(); posts.forEach((p) => p.tags.forEach((t) => (tagMap.get(t) || tagMap.set(t, []).get(t)).push(p)));
  const tags = [...tagMap.keys()].sort((a, b) => tagMap.get(b).length - tagMap.get(a).length || a.localeCompare(b));
  write('tags.html', listPage({ title: '주제', lead: `공개된 글 ${posts.length}편을 주제로 묶었습니다.`, url: '/tags', current: 'tags',
    items: tags.map((t) => `<li class="row on"><a href="/tags/${enc(t)}"><div class="top"><h3>#${esc(t)}</h3><span class="meta">${tagMap.get(t).length}편</span></div></a></li>`) }));
  for (const t of tags) write(`tags/${t}.html`, listPage({ title: `#${t}`, lead: `<a class="link" href="/tags">모든 주제</a>`, url: `/tags/${enc(t)}`, current: 'tags', items: tagMap.get(t).map(postRow) }));
  write('404.html', notFound());
  write('index.xml', rss(posts));
  write('sitemap.xml', sitemap(posts, tags));
  write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${SITE.url}/sitemap.xml\n`);
  write('.nojekyll', '');

  // 정적 파일
  for (const f of ['site.css', 'site.js']) write(`assets/${f}`, fs.readFileSync(path.join(HERE, 'assets', f)));
  for (const f of fs.readdirSync(path.join(HERE, 'static'))) {
    const data = fs.readFileSync(path.join(HERE, 'static', f));
    if (/^(favicon\.|apple-touch-icon|icon-)/.test(f)) write(f, data); else write(`static/${f}`, data);
  }
  const assets = path.join(CONTENT, 'assets');
  if (fs.existsSync(assets)) fs.cpSync(assets, path.join(OUT, 'assets'), { recursive: true });

  console.log(`✓ ${posts.length}편 · 주제 ${tags.length}개 · 위키 지도 ${graph ? `${graph.total}장/${graph.links}링크` : '없음(content/graph.json 없음)'} → ${path.relative(ROOT, OUT) || OUT} (${Date.now() - t0}ms)`);
}

// ───────────────────────── 미리보기 서버 (이 PC 에서만) ─────────────────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.xml': 'application/xml; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
function serve() {
  http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || '/').split('?')[0].split('#')[0]);
    const safe = path.normalize(p).replace(/^(\.\.[\\/])+/, '');
    const base = path.join(OUT, safe);
    const cands = [base, base + '.html', path.join(base, 'index.html')];
    const file = base.startsWith(OUT) && cands.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
    if (!file) { res.writeHead(404, { 'content-type': MIME['.html'] }); return res.end(fs.readFileSync(path.join(OUT, '404.html'))); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  }).listen(PORT, '127.0.0.1', () => console.log(`\n공개 블로그 미리보기: http://127.0.0.1:${PORT}  (이 PC 에서만. Ctrl+C 로 종료)\n`));
}

await build();
if (SERVE) serve();
