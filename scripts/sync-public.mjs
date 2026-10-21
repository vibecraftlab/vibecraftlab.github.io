#!/usr/bin/env node
// vault → content/ 공개 sync (③겹 필터). fail-closed: 하나라도 차단이면 아무것도 쓰지 않는다.
//   node scripts/sync-public.mjs [--check]      VAULT_PATH, PATTERNS_PATH 로 위치 지정
// 규칙(spec §5.6 · CLAUDE.md §7 §11):
//   허용 폴더 + published: true + pubDate · draft 제외 · password 키 있으면 차단(encrypted-pages 함정)
//   비밀 패턴(patterns.js, 훅과 공용)을 **파일 전체**(frontmatter+본문+주석)에 검사 · WARN 은 warnings 로
//   코드 스팬·펜스 안은 손대지 않음 · 미공개 링크(wikilink·markdown·앵커·확장자 없음) → 텍스트
//   첨부는 {domain}/assets/public/ 만 복사, 그 외 embed·markdown 이미지는 [첨부 생략]
//   Obsidian %% %% · <!-- --> 주석은 검사 후 제거 · 공개 frontmatter 는 화이트리스트 키만 (yaml 로 직렬화)
//   content/ 는 이 스크립트가 전적으로 소유 (이번에 안 나온 파일은 삭제)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { buildGraph } from './graph-export.mjs';

const ALLOWED = ['study/wiki', 'vibecraft/wiki', 'tooling/wiki', 'research/wiki'];
const toPosix = (p) => p.split(path.sep).join('/');
const isTrue = (v) => v === true || String(v).trim().toLowerCase() === 'true';
const list = (v) => (v == null ? [] : Array.isArray(v) ? v.map(String) : String(v).replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean));
const dateStr = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));

function splitFm(text) {
  const m = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { fm: {}, fmLines: 0, body: text };
  let fm = {};
  try { fm = YAML.parse(m[1]) || {}; } catch (e) { return { fm: null, error: e.message, fmLines: m[0].split('\n').length - 1, body: text.slice(m[0].length) }; }
  return { fm, fmLines: m[0].split('\n').length - 1, body: text.slice(m[0].length) };
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['.obsidian', '.claude', 'node_modules', '.trash'].includes(e.name)) walk(p, out); }
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}
function walkAll(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkAll(p, out); else out.push(p);
  }
  return out;
}

// 코드 펜스·인라인 코드를 자리표시자로 빼두고, 변환이 끝난 뒤 되돌린다.
function maskCode(text) {
  const slots = [];
  const put = (s) => { slots.push(s); return `\u0000${slots.length - 1}\u0000`; };
  let out = text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, put);
  out = out.replace(/`[^`\n]+`/g, put);
  return { out, restore: (t) => t.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)]) };
}
const stripComments = (t) => t.replace(/%%[\s\S]*?%%/g, '').replace(/<!--[\s\S]*?-->/g, '');
const isExternal = (t) => /^(?:[a-z]+:)?\/\//i.test(t) || /^(?:mailto|tel):/i.test(t);
const slugOf = (target) => path.posix.basename(target.trim().replace(/\\/g, '/')).replace(/\.md$/i, '');

export async function sync({ vault, outDir, check = false, patternsPath, graph = false }) {
  const require = createRequire(import.meta.url);
  const { BLOCK, WARN, firstHit } = require(patternsPath || path.join(vault, '.claude', 'hooks', 'patterns.js'));
  const result = { published: [], blocked: [], warnings: [], downgraded: [] };

  // 1. 후보 (폴더 불문 — 폴더 불가는 차단 사유로 보고)
  const candidates = [];
  for (const abs of walk(vault)) {
    const rel = toPosix(path.relative(vault, abs));
    if (rel.startsWith('_templates/') || rel.startsWith('_specs/')) continue;
    const raw = fs.readFileSync(abs, 'utf8');
    const parsed = splitFm(raw);
    if (parsed.fm === null) { if (/^published:\s*true/m.test(raw)) result.blocked.push({ src: rel, reason: `frontmatter YAML 오류 — ${parsed.error}` }); continue; }
    const { fm, fmLines, body } = parsed;
    if (!isTrue(fm.published)) continue;
    if (isTrue(fm.draft)) continue;
    candidates.push({ abs, rel, raw, fm, fmLines, body, slug: path.basename(rel, '.md'), domain: rel.split('/')[0] });
  }

  // 2. 게이트 — 파일 전체(frontmatter 포함, 주석 포함)를 검사
  for (const c of candidates) {
    if (!ALLOWED.some((d) => c.rel.startsWith(d + '/'))) { result.blocked.push({ src: c.rel, reason: `폴더 불가 — 공개 허용 폴더는 ${ALLOWED.join(' ')}` }); continue; }
    if (!c.fm.pubDate) { result.blocked.push({ src: c.rel, reason: 'pubDate 없음 — 발행 의사 확인 필드' }); continue; }
    if ('password' in c.fm) { result.blocked.push({ src: c.rel, reason: 'frontmatter 에 password 키 — 공개 repo 에 평문이 남으므로 발행 불가' }); continue; }
    const reasons = [];
    for (const rule of BLOCK) { const line = firstHit(c.raw, rule); if (line) reasons.push(`비밀 패턴: ${rule.name} (줄 ${line})`); }
    if (reasons.length) result.blocked.push({ src: c.rel, reason: reasons.join(' · ') });
    for (const rule of WARN) { const line = firstHit(c.raw, rule); if (line) result.warnings.push(`${c.rel}:${line}: ${rule.name} — 공개 전 확인`); }
  }
  const blockedSrc = new Set(result.blocked.map((b) => b.src));
  const pages = candidates.filter((c) => !blockedSrc.has(c.rel));
  const pubSlugs = new Set(pages.map((p) => p.slug));
  const seen = new Map();
  for (const p of pages) { if (seen.has(p.slug)) result.blocked.push({ src: p.rel, reason: `slug 충돌 — ${seen.get(p.slug)} 와 같은 파일명` }); else seen.set(p.slug, p.rel); }
  if (result.blocked.length) return result;

  // 3. 변환
  const outputs = new Map();
  for (const p of pages) {
    const { out: masked, restore } = maskCode(stripComments(p.body));
    let body = masked;
    // 첨부(wikilink embed)
    body = body.replace(/!\[\[([^\]|]+)(\|[^\]]*)?\]\]/g, (m, target) => {
      const name = path.basename(target.trim());
      const src = path.join(vault, p.domain, 'assets', 'public', name);
      if (fs.existsSync(src)) { const relOut = `assets/${p.domain}/${name}`; outputs.set(relOut, fs.readFileSync(src)); return `![[${relOut}]]`; }
      result.warnings.push(`${p.rel}: 첨부 ${name} 은 assets/public/ 밖 — [첨부 생략]`);
      return '[첨부 생략]';
    });
    // markdown 이미지 ![alt](path)
    body = body.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, target) => {
      if (isExternal(target)) return m;
      const name = path.basename(target);
      const src = path.join(vault, p.domain, 'assets', 'public', name);
      if (fs.existsSync(src)) { const relOut = `assets/${p.domain}/${name}`; outputs.set(relOut, fs.readFileSync(src)); return `![${alt}](${relOut})`; }
      result.warnings.push(`${p.rel}: 이미지 ${name} 은 assets/public/ 밖 — [첨부 생략]`);
      return '[첨부 생략]';
    });
    // wikilink: 미공개 → 텍스트
    body = body.replace(/(?<!!)\[\[([^\]|#]+)(#[^\]|]*)?(\|([^\]]*))?\]\]/g, (m, target, hash = '', _a, alias) => {
      const slug = slugOf(target);
      if (pubSlugs.has(slug)) return `[[${slug}${hash}${alias != null ? '|' + alias : ''}]]`;
      result.downgraded.push({ src: p.rel, target: slug });
      return alias != null ? alias : slug;
    });
    // markdown 링크 [text](상대경로[.md][#앵커]): 공개 → wikilink, 미공개 → 텍스트
    body = body.replace(/(?<!!)\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, target) => {
      if (isExternal(target) || target.startsWith('#')) return m;
      const [pathPart, anchor] = target.split('#');
      const slug = slugOf(pathPart);
      if (pubSlugs.has(slug)) return `[[${slug}${anchor ? '#' + anchor : ''}|${text}]]`;
      result.downgraded.push({ src: p.rel, target: slug });
      return text;
    });
    body = restore(body);

    // 공개 frontmatter — 화이트리스트만
    const tags = list(p.fm.blogTags).length ? list(p.fm.blogTags)
               : list(p.fm.tags).filter((t) => !t.startsWith('type/')).map((t) => t.split('/').pop());
    const fmOut = {
      title: String(p.fm.title || p.slug),
      description: String(p.fm.description || p.fm.summary || ''),
      date: dateStr(p.fm.pubDate),
      ...(p.fm.updated ? { modified: dateStr(p.fm.updated) } : {}),
      tags: [...new Set(tags)],
      publish: true,
    };
    const doc = new YAML.Document(fmOut);
    doc.get('tags', true).flow = true;   // tags: [a, b] — Obsidian 인라인 표기와 같게
    outputs.set(`${p.slug}.md`, `---\n${doc.toString({ flowCollectionPadding: false }).trimEnd()}\n---\n${body.replace(/^\r?\n/, '')}`);
    result.published.push({ slug: p.slug, src: p.rel, title: fmOut.title, date: fmOut.date, domain: p.domain, description: fmOut.description });
  }

  // 4. index.md
  const byDomain = {};
  for (const p of result.published) (byDomain[p.domain] ||= []).push(p);
  const idx = ['---', YAML.stringify({ title: 'vibecraft wiki', description: 'LLM 이 유지하는 개인 위키 중 공개한 페이지', publish: true }).trimEnd(), '---', '', '# vibecraft wiki', '',
    'Obsidian + Claude Code 로 유지하는 LLM 위키에서 `published: true` 로 표시한 페이지만 여기에 나온다.', ''];
  for (const d of Object.keys(byDomain).sort()) {
    idx.push(`## ${d}`, '');
    for (const p of byDomain[d].sort((a, b) => (a.date < b.date ? 1 : -1))) idx.push(`- [[${p.slug}|${p.title}]] — ${p.description} (${p.date})`);
    idx.push('');
  }
  outputs.set('index.md', idx.join('\n'));

  // 4b. 위키 지도 (공개 블로그 첫 화면) — 비공개 문서는 좌표·연결 수만, 공개 글만 slug
  if (graph) outputs.set('graph.json', JSON.stringify(buildGraph(vault, pubSlugs)));

  // 5. 쓰기 (check 면 생략) — content/ 소유
  if (check) return result;
  fs.mkdirSync(outDir, { recursive: true });
  const keep = new Set(outputs.keys());
  for (const abs of walkAll(outDir)) { const rel = toPosix(path.relative(outDir, abs)); if (!keep.has(rel)) fs.rmSync(abs); }
  for (const [rel, data] of outputs) { const abs = path.join(outDir, rel); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, data); }
  return result;
}

// ---------- CLI ----------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const vault = process.env.VAULT_PATH || 'G:\\내 드라이브\\llm-wiki';
  const here = path.dirname(fileURLToPath(import.meta.url));
  const outDir = path.join(here, '..', 'content');
  const check = process.argv.includes('--check');
  const r = await sync({ vault, outDir, check, patternsPath: process.env.PATTERNS_PATH, graph: true });
  console.log(`${check ? '[check] ' : ''}published ${r.published.length} · blocked ${r.blocked.length} · downgraded links ${r.downgraded.length} · warnings ${r.warnings.length}`);
  for (const p of r.published) console.log(`  ✓ ${p.src} → content/${p.slug}.md`);
  for (const b of r.blocked) console.log(`  ✗ ${b.src}: ${b.reason}`);
  for (const w of r.warnings) console.log(`  ⚠ ${w}`);
  if (r.downgraded.length) console.log(`  미공개 링크 → 텍스트 강등 (그것도 공개할까?): ${[...new Set(r.downgraded.map((d) => d.target))].join(', ')}`);
  if (r.blocked.length) { console.log('\n발행 불가 — 위 항목을 고치기 전까지 content/ 를 건드리지 않았다.'); process.exit(1); }
}
