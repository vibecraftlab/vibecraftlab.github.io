// node --test scripts/sync-public.test.mjs — vault → content/ 공개 sync 검증. 임시 vault 픽스처 사용.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sync } from './sync-public.mjs';

const PATTERNS = 'G:\\내 드라이브\\llm-wiki\\.claude\\hooks\\patterns.js';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-'));
  const vault = path.join(root, 'vault');
  const out = path.join(root, 'content');
  fs.mkdirSync(out, { recursive: true });
  return { vault, out };
}
function page(vault, rel, fm, body = '본문입니다.') {
  const p = path.join(vault, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const y = Object.entries(fm).map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : v}`).join('\n');
  fs.writeFileSync(p, `---\n${y}\n---\n\n# ${fm.title || rel}\n\n${body}\n`, 'utf8');
}
const PUB = { title: '공개 글', summary: '요약 한 줄', type: 'concept', domain: 'study', tags: ['type/concept', '도구/obsidian'], created: '2026-10-01', updated: '2026-10-02', status: 'active', published: 'true', pubDate: '2026-10-03' };
const run = (f, extra = {}) => sync({ vault: f.vault, outDir: f.out, patternsPath: PATTERNS, ...extra });
const read = (f, name) => fs.readFileSync(path.join(f.out, name), 'utf8');

test('(a) published+pubDate → content/<slug>.md, frontmatter 변환', async () => {
  const f = fixture();
  page(f.vault, 'study/wiki/concepts/pub-page.md', { ...PUB, blogTags: ['obsidian', 'wiki'] });
  const r = await run(f);
  assert.deepEqual(r.blocked, []);
  assert.equal(r.published.length, 1);
  const t = read(f, 'pub-page.md');
  assert.match(t, /^publish: true$/m);
  assert.match(t, /^date: 2026-10-03$/m);
  assert.match(t, /^modified: 2026-10-02$/m);
  assert.match(t, /^description: 요약 한 줄$/m);
  assert.match(t, /^tags: \[obsidian, wiki\]$/m);
  for (const k of ['domain', 'project', 'status', 'sources', 'published', 'pubDate', 'blogTags', 'summary', 'reviewed']) assert.doesNotMatch(t, new RegExp(`^${k}:`, 'm'), k);
});

test('(a2) blogTags 없으면 tags 마지막 세그먼트, type/ 제외', async () => {
  const f = fixture();
  page(f.vault, 'study/wiki/concepts/pub-page.md', PUB);
  await run(f);
  assert.match(read(f, 'pub-page.md'), /^tags: \[obsidian\]$/m);
});

test('(b) published 인데 pubDate 없음 → blocked, 아무것도 안 씀', async () => {
  const f = fixture();
  const { pubDate, ...noDate } = PUB;
  page(f.vault, 'study/wiki/concepts/no-date.md', noDate);
  const r = await run(f);
  assert.equal(r.blocked.length, 1);
  assert.match(r.blocked[0].reason, /pubDate/);
  assert.equal(fs.readdirSync(f.out).length, 0);
});

test('(c) mpole/wiki 는 published 여도 blocked (폴더 불가)', async () => {
  const f = fixture();
  page(f.vault, 'mpole/wiki/concepts/secret-ish.md', PUB);
  const r = await run(f);
  assert.equal(r.blocked.length, 1);
  assert.match(r.blocked[0].reason, /폴더/);
});

test('(c2) raw/ 는 published 여도 blocked', async () => {
  const f = fixture();
  page(f.vault, 'study/raw/docs/2026-10-01-x.md', PUB);
  const r = await run(f);
  assert.equal(r.blocked.length, 1);
});

test('(d) 본문에 비밀 할당 → blocked', async () => {
  const f = fixture();
  page(f.vault, 'study/wiki/concepts/leak.md', PUB, '설정: DB_PASSWORD=hunter2');
  const r = await run(f);
  assert.equal(r.blocked.length, 1);
  assert.match(r.blocked[0].reason, /비밀/);
  assert.equal(fs.readdirSync(f.out).length, 0);
});

test('(e) 미공개 링크는 텍스트로 강등, 공개 링크는 유지', async () => {
  const f = fixture();
  page(f.vault, 'study/wiki/concepts/pub-page.md', PUB, '참고 [[other-pub]] 와 [[unpub-page|보이는 글]] 와 [[unpub2]] 그리고 [md](unpub-page.md)');
  page(f.vault, 'study/wiki/concepts/other-pub.md', { ...PUB, title: '다른 공개' });
  page(f.vault, 'study/wiki/concepts/unpub-page.md', { ...PUB, published: 'false' });
  const r = await run(f);
  const t = read(f, 'pub-page.md');
  assert.match(t, /\[\[other-pub\]\]/);
  assert.doesNotMatch(t, /\[\[unpub/);
  assert.match(t, /보이는 글/);
  assert.match(t, /unpub2/);
  assert.doesNotMatch(t, /\]\(unpub-page\.md\)/);
  assert.equal(r.downgraded.length, 3);
});

test('(f) 첨부: assets/public 만 복사, 그 외는 [첨부 생략]', async () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.vault, 'study/assets/public'), { recursive: true });
  fs.writeFileSync(path.join(f.vault, 'study/assets/public/y.png'), 'PNG');
  page(f.vault, 'study/wiki/concepts/pub-page.md', PUB, '![[x.png]] 그리고 ![[y.png]]');
  const r = await run(f);
  const t = read(f, 'pub-page.md');
  assert.match(t, /\[첨부 생략\]/);
  assert.match(t, /!\[\[assets\/study\/y\.png\]\]/);
  assert.ok(fs.existsSync(path.join(f.out, 'assets/study/y.png')));
  assert.ok(r.warnings.some((w) => w.includes('x.png')));
});

test('(g) content/ 의 stale 파일은 삭제된다', async () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.out, 'stale.md'), '---\npublish: true\n---\n옛날');
  page(f.vault, 'study/wiki/concepts/pub-page.md', PUB);
  await run(f);
  assert.ok(!fs.existsSync(path.join(f.out, 'stale.md')));
  assert.ok(fs.existsSync(path.join(f.out, 'pub-page.md')));
});

test('(h) content/index.md 가 생성되고 공개 페이지 제목을 담는다', async () => {
  const f = fixture();
  page(f.vault, 'study/wiki/concepts/pub-page.md', PUB);
  await run(f);
  const idx = read(f, 'index.md');
  assert.match(idx, /\[\[pub-page(\|[^\]]*)?\]\]/);
  assert.match(idx, /공개 글/);
  assert.match(idx, /^publish: true$/m);
});

test('(i) --check 모드는 쓰지 않는다', async () => {
  const f = fixture();
  page(f.vault, 'study/wiki/concepts/pub-page.md', PUB);
  const r = await run(f, { check: true });
  assert.equal(r.published.length, 1);
  assert.equal(fs.readdirSync(f.out).length, 0);
});

test('(j) draft: true 는 조용히 제외', async () => {
  const f = fixture();
  page(f.vault, 'study/wiki/concepts/draft-page.md', { ...PUB, draft: 'true' });
  const r = await run(f);
  assert.equal(r.published.length, 0);
  assert.equal(r.blocked.length, 0);
});
