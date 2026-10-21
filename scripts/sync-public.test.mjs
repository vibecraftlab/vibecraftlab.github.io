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

test('(h) Quartz 시절의 content/index.md 는 만들지 않고, 남아 있으면 지운다', async () => {
  const f = fixture();
  page(f.vault, 'study/wiki/concepts/pub-page.md', PUB);
  fs.mkdirSync(f.out, { recursive: true });
  fs.writeFileSync(path.join(f.out, 'index.md'), '# 옛 첫 화면');
  await run(f);
  assert.ok(!fs.existsSync(path.join(f.out, 'index.md')));
  assert.ok(fs.existsSync(path.join(f.out, 'pub-page.md')));
});

test('(i) --check 모드는 쓰지 않는다', async () => {
  const f = fixture();
  page(f.vault, 'study/wiki/concepts/pub-page.md', PUB);
  const r = await run(f, { check: true });
  assert.equal(r.published.length, 1);
  assert.equal(fs.readdirSync(f.out).length, 0);
});

// ---------- 리뷰 후 추가 (2026-10-15) ----------

test('(k) frontmatter 안의 비밀도 차단', async () => {
  const f = fixture();
  page(f.vault, 'study/wiki/concepts/leak-fm.md', { ...PUB, api_key: 'sk-ant-api03-abcdefghijklmnop' });
  const r = await run(f);
  assert.equal(r.blocked.length, 1);
  assert.match(r.blocked[0].reason, /비밀/);
});

test('(l) password 키가 있는 페이지는 차단 (encrypted-pages 함정)', async () => {
  const f = fixture();
  page(f.vault, 'study/wiki/concepts/enc.md', { ...PUB, password: 'opensesame' });
  const r = await run(f);
  assert.equal(r.blocked.length, 1);
  assert.match(r.blocked[0].reason, /password/);
});

test('(m) 코드 스팬·펜스 안의 [[링크]] 는 그대로', async () => {
  const f = fixture();
  page(f.vault, 'study/wiki/concepts/pub-page.md', PUB, '문법은 `[[페이지]]` 이다.\n\n```md\n[[unpub-x|보기]]\n```\n\n진짜 링크 [[unpub-y]]');
  const r = await run(f);
  const t = read(f, 'pub-page.md');
  assert.match(t, /`\[\[페이지\]\]`/);
  assert.match(t, /\[\[unpub-x\|보기\]\]/);
  assert.doesNotMatch(t, /\[\[unpub-y\]\]/);
  assert.equal(r.downgraded.length, 1);
});

test('(n) 앵커·확장자 없는 markdown 링크와 markdown 이미지도 처리', async () => {
  const f = fixture();
  page(f.vault, 'study/wiki/concepts/pub-page.md', PUB, '[참고](../../mpole/wiki/x.md#설계) [또](unpub-page) [공개](other-pub.md#절) ![사진](../assets/private/p.png) [외부](https://example.com/a.md)');
  page(f.vault, 'study/wiki/concepts/other-pub.md', { ...PUB, title: '다른 공개' });
  const r = await run(f);
  const t = read(f, 'pub-page.md');
  assert.doesNotMatch(t, /mpole/);
  assert.doesNotMatch(t, /unpub-page/);
  assert.match(t, /\[\[other-pub#절\|공개\]\]/);
  assert.match(t, /\[첨부 생략\]/);
  assert.doesNotMatch(t, /assets\/private/);
  assert.match(t, /\[외부\]\(https:\/\/example\.com\/a\.md\)/);
});

test('(o) Obsidian %% %% 주석과 <!-- --> 주석은 출력에서 제거', async () => {
  const f = fixture();
  page(f.vault, 'study/wiki/concepts/pub-page.md', PUB, '보이는 글 %% 숨긴 메모 %% 계속\n<!-- 비공개 메모 -->\n끝');
  await run(f);
  const t = read(f, 'pub-page.md');
  assert.doesNotMatch(t, /숨긴 메모|비공개 메모/);
  assert.match(t, /보이는 글\s+계속/);
});

test('(o2) 주석 안의 비밀도 쓰기 전 검사에 걸린다', async () => {
  const f = fixture();
  page(f.vault, 'study/wiki/concepts/pub-page.md', PUB, '%% DB_PASSWORD=hunter2 %%');
  const r = await run(f);
  assert.equal(r.blocked.length, 1);
});

test('(p) WARN 규칙(로컬 절대경로)은 warnings 로 보고', async () => {
  const f = fixture();
  page(f.vault, 'study/wiki/concepts/pub-page.md', PUB, '경로는 C:\\Users\\me\\x 에 있다');
  const r = await run(f);
  assert.equal(r.blocked.length, 0);
  assert.ok(r.warnings.some((w) => w.includes('로컬 절대경로')));
});

test('(q) 블록 스타일 YAML 목록(tags:\\n  - a)도 파싱', async () => {
  const f = fixture();
  const p = path.join(f.vault, 'study/wiki/concepts/pub-page.md');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `---\ntitle: 블록\nsummary: 요약\ntype: concept\ndomain: study\ntags:\n  - type/concept\n  - 도구/obsidian\ncreated: 2026-10-01\nupdated: 2026-10-02\nstatus: active\npublished: true\npubDate: 2026-10-03\n---\n\n본문\n`);
  await run(f);
  assert.match(read(f, 'pub-page.md'), /^tags:\s*\n?\s*(\[obsidian\]|- obsidian)/m);
});

test('(r) 허용 키만 내보내고 특수문자 값은 올바르게 인용', async () => {
  const f = fixture();
  const p = path.join(f.vault, 'study/wiki/concepts/pub-page.md');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `---\ntitle: "a: b 제목"\nsummary: 요약\ntype: concept\ndomain: study\ntags: [type/concept]\ncustom: x\ndate: 2020-01-01\ncreated: 2026-10-01\nupdated: 2026-10-02\nstatus: active\npublished: true\npubDate: 2026-10-03\n---\n\n본문\n`);
  const r = await run(f);
  assert.deepEqual(r.blocked, []);
  const t = read(f, 'pub-page.md');
  assert.doesNotMatch(t, /^(type|custom|domain):/m);
  assert.equal((t.match(/^date:/gm) || []).length, 1);
  assert.match(t, /^date: 2026-10-03$/m);
  assert.match(t, /^title: .*a: b.*$/m);
});

test('(j) draft: true 는 조용히 제외', async () => {
  const f = fixture();
  page(f.vault, 'study/wiki/concepts/draft-page.md', { ...PUB, draft: 'true' });
  const r = await run(f);
  assert.equal(r.published.length, 0);
  assert.equal(r.blocked.length, 0);
});

test('(s) graph: true 면 graph.json — 비공개 문서는 좌표·연결 수만, 제목·경로·slug 없음', async () => {
  const f = fixture();
  page(f.vault, 'study/wiki/concepts/pub-page.md', PUB, '[[secret-plan]] 과 [[other-note]] 를 본다.');
  page(f.vault, 'mpole/wiki/secret-plan.md', { title: '고객사 비밀 계획', type: 'concept' }, '[[pub-page]]');
  page(f.vault, 'study/wiki/concepts/other-note.md', { title: '아직 안 쓴 글', type: 'concept' });
  const r = await run(f, { graph: true });
  assert.deepEqual(r.blocked, []);
  const raw = read(f, 'graph.json');
  const g = JSON.parse(raw);
  assert.equal(g.total, 3);
  assert.equal(g.links, 2);
  assert.deepEqual(g.n.filter((x) => x.k).map((x) => x.k), ['pub-page']);
  for (const leak of ['secret-plan', '고객사', 'mpole', 'other-note', '아직 안 쓴']) assert.ok(!raw.includes(leak), leak);
  for (const nd of g.n) for (const key of Object.keys(nd)) assert.ok(['x', 'y', 'd', 'k'].includes(key), key);
});

test('(t) graph 옵션이 없으면 graph.json 을 쓰지 않는다', async () => {
  const f = fixture();
  page(f.vault, 'study/wiki/concepts/pub-page.md', PUB);
  await run(f);
  assert.ok(!fs.existsSync(path.join(f.out, 'graph.json')));
});
