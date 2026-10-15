#!/usr/bin/env node
// vault → content/ 공개 sync (③겹 필터). fail-closed: 하나라도 차단이면 아무것도 쓰지 않는다.
//   node scripts/sync-public.mjs [--check]      VAULT_PATH, PATTERNS_PATH 로 위치 지정
// 규칙: 허용 폴더 + published: true + pubDate · 비밀 패턴(patterns.js, 훅과 공용) · 미공개 링크 → 텍스트 ·
//       첨부는 assets/public/ 만 · 공개 frontmatter 로 변환 · content/ 는 이 스크립트가 전적으로 소유.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ALLOWED = ['study/wiki', 'vibecraft/wiki', 'tooling/wiki', 'research/wiki'];
const DROP_KEYS = new Set(['domain', 'project', 'status', 'sources', 'published', 'pubDate', 'blogTags', 'summary', 'reviewed', 'aliases', 'created', 'updated', 'description', 'tags', 'title', 'draft', 'slug']);

// ---------- frontmatter (의존성 없는 단순 파서: `key: value` / 인라인 배열) ----------
function splitFm(text) {
  const m = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { fm: {}, order: [], body: text };
  const fm = {}, order = [];
  for (const line of m[1].split(/\r?\n/)) {
    const km = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!km) continue;
    let v = km[2].trim();
    if (/^".*"$/.test(v)) v = JSON.parse(v);
    else if (/^'.*'$/.test(v)) v = v.slice(1, -1);
    fm[km[1]] = v; order.push(km[1]);
  }
  return { fm, order, body: text.slice(m[0].length) };
}
const list = (v) => (v == null ? [] : Array.isArray(v) ? v : String(v).replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean));
const isTrue = (v) => v === true || String(v).toLowerCase() === 'true';
const yamlStr = (s) => (/^[\w가-힣][^:#"'\n]*$/.test(s) ? s : JSON.stringify(s));

// ---------- 파일 수집 ----------
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['.obsidian', '.claude', 'node_modules'].includes(e.name)) walk(p, out); }
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}
const toPosix = (p) => p.split(path.sep).join('/');

export async function sync({ vault, outDir, check = false, patternsPath }) {
  const require = createRequire(import.meta.url);
  const { BLOCK, firstHit } = require(patternsPath || path.join(vault, '.claude', 'hooks', 'patterns.js'));
  const result = { published: [], blocked: [], warnings: [], downgraded: [] };

  // 1. 후보: published: true 전부 (폴더 불문 — 폴더 불가는 차단 사유로 보고해야 하므로)
  const candidates = [];
  for (const abs of walk(vault)) {
    const rel = toPosix(path.relative(vault, abs));
    if (rel.startsWith('_templates/') || rel.startsWith('_specs/')) continue;
    const text = fs.readFileSync(abs, 'utf8');
    const { fm, body } = splitFm(text);
    if (!isTrue(fm.published)) continue;
    if (isTrue(fm.draft)) continue;
    candidates.push({ abs, rel, fm, body, slug: path.basename(rel, '.md'), domain: rel.split('/')[0] });
  }

  // 2. 게이트
  for (const c of candidates) {
    if (!ALLOWED.some((d) => c.rel.startsWith(d + '/'))) { result.blocked.push({ src: c.rel, reason: `폴더 불가 — 공개 허용 폴더는 ${ALLOWED.join(' ')}` }); continue; }
    if (!c.fm.pubDate) { result.blocked.push({ src: c.rel, reason: 'pubDate 없음 — 발행 의사 확인 필드' }); continue; }
    for (const rule of BLOCK) {
      const line = firstHit(c.body, rule);
      if (line) result.blocked.push({ src: c.rel, reason: `비밀 패턴: ${rule.name} (줄 ${line})` });
    }
  }
  const blockedSrc = new Set(result.blocked.map((b) => b.src));
  const pages = candidates.filter((c) => !blockedSrc.has(c.rel));
  const pubSlugs = new Set(pages.map((p) => p.slug));

  // 3. 변환
  const outputs = new Map(); // relOut -> content|Buffer
  for (const p of pages) {
    let body = p.body;
    // 첨부
    body = body.replace(/!\[\[([^\]|]+)(\|[^\]]*)?\]\]/g, (m, target) => {
      const name = path.basename(target.trim());
      const src = path.join(vault, p.domain, 'assets', 'public', name);
      if (fs.existsSync(src)) {
        const relOut = `assets/${p.domain}/${name}`;
        outputs.set(relOut, fs.readFileSync(src));
        return `![[${relOut}]]`;
      }
      result.warnings.push(`${p.rel}: 첨부 ${name} 은 assets/public/ 밖 — [첨부 생략] 으로 치환`);
      return '[첨부 생략]';
    });
    // wikilink: 미공개 → 텍스트 (앞에 ! 가 붙은 첨부 embed 는 위에서 처리했으므로 제외)
    body = body.replace(/(?<!!)\[\[([^\]|#]+)(#[^\]|]*)?(\|([^\]]*))?\]\]/g, (m, target, hash = '', _a, alias) => {
      const slug = path.basename(target.trim());
      if (pubSlugs.has(slug)) return m;
      result.downgraded.push({ src: p.rel, target: slug });
      return alias != null ? alias : slug;
    });
    // markdown .md 링크: 미공개 → 텍스트
    body = body.replace(/\[([^\]]+)\]\(([^)\s]+\.md)\)/g, (m, text, target) => {
      if (/^https?:/.test(target)) return m;
      const slug = path.basename(target, '.md');
      if (pubSlugs.has(slug)) return `[[${slug}|${text}]]`;
      result.downgraded.push({ src: p.rel, target: slug });
      return text;
    });
    // frontmatter
    const tags = list(p.fm.blogTags).length ? list(p.fm.blogTags)
               : list(p.fm.tags).filter((t) => !t.startsWith('type/')).map((t) => t.split('/').pop());
    const out = [
      `title: ${yamlStr(String(p.fm.title || p.slug))}`,
      `description: ${yamlStr(String(p.fm.description || p.fm.summary || ''))}`,
      `date: ${p.fm.pubDate}`,
      ...(p.fm.updated ? [`modified: ${p.fm.updated}`] : []),
      `tags: [${[...new Set(tags)].join(', ')}]`,
      'publish: true',
    ];
    // 그 외 사용자 키(예: aliases 제외한 커스텀)는 버린다 — DROP_KEYS 밖의 키만 보존
    for (const [k, v] of Object.entries(p.fm)) if (!DROP_KEYS.has(k)) out.push(`${k}: ${v}`);
    outputs.set(`${p.slug}.md`, `---\n${out.join('\n')}\n---\n${body.replace(/^\r?\n/, '')}`);
    result.published.push({ slug: p.slug, src: p.rel, title: String(p.fm.title || p.slug), date: String(p.fm.pubDate), domain: p.domain, description: String(p.fm.description || p.fm.summary || '') });
  }

  // 4. index.md
  const byDomain = {};
  for (const p of result.published) (byDomain[p.domain] ||= []).push(p);
  const idx = ['---', 'title: vibecraft wiki', 'description: LLM 이 유지하는 개인 위키 중 공개한 페이지', 'publish: true', '---', '', '# vibecraft wiki', '', 'Obsidian + Claude Code 로 유지하는 LLM 위키에서 `published: true` 로 표시한 페이지만 여기에 나온다.', ''];
  for (const d of Object.keys(byDomain).sort()) {
    idx.push(`## ${d}`, '');
    for (const p of byDomain[d].sort((a, b) => (a.date < b.date ? 1 : -1))) idx.push(`- [[${p.slug}|${p.title}]] — ${p.description} (${p.date})`);
    idx.push('');
  }
  outputs.set('index.md', idx.join('\n'));

  // 5. 쓰기 (check 면 생략) — content/ 소유: 이번에 안 나온 파일은 삭제
  if (result.blocked.length || check) return result;
  fs.mkdirSync(outDir, { recursive: true });
  const keep = new Set(outputs.keys());
  for (const abs of walkAll(outDir)) {
    const rel = toPosix(path.relative(outDir, abs));
    if (!keep.has(rel)) fs.rmSync(abs);
  }
  for (const [rel, data] of outputs) {
    const abs = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, data);
  }
  return result;
}
function walkAll(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkAll(p, out); else out.push(p);
  }
  return out;
}

// ---------- CLI ----------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const vault = process.env.VAULT_PATH || 'G:\\내 드라이브\\llm-wiki';
  const here = path.dirname(fileURLToPath(import.meta.url));
  const outDir = path.join(here, '..', 'content');
  const check = process.argv.includes('--check');
  const r = await sync({ vault, outDir, check, patternsPath: process.env.PATTERNS_PATH });
  console.log(`${check ? '[check] ' : ''}published ${r.published.length} · blocked ${r.blocked.length} · downgraded links ${r.downgraded.length} · warnings ${r.warnings.length}`);
  for (const p of r.published) console.log(`  ✓ ${p.src} → content/${p.slug}.md`);
  for (const b of r.blocked) console.log(`  ✗ ${b.src}: ${b.reason}`);
  for (const w of r.warnings) console.log(`  ⚠ ${w}`);
  if (r.downgraded.length) {
    const uniq = [...new Set(r.downgraded.map((d) => d.target))];
    console.log(`  미공개 링크 → 텍스트 강등 (그것도 공개할까?): ${uniq.join(', ')}`);
  }
  if (r.blocked.length) { console.log('\n발행 불가 — 위 항목을 고치기 전까지 content/ 를 건드리지 않았다.'); process.exit(1); }
}
