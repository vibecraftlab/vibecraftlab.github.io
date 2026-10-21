#!/usr/bin/env node
// 공개 발행: sync(③겹 필터) → 차단이면 중단 → content/ 커밋 → push → GitHub Actions 가 빌드·배포.
//   npm run publish            자동 메시지 "publish: YYYY-MM-DD (N files)"
//   npm run publish -- "메시지"
// 사람이 명시적으로 실행해야 나간다 (훅·크론 자동화 금지 — 실수로 사적 페이지가 나가는 걸 막기 위해).
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sync } from './sync-public.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const vault = process.env.VAULT_PATH || 'G:\\내 드라이브\\llm-wiki';
const run = (cmd) => { console.log(`▶ ${cmd}`); execSync(cmd, { stdio: 'inherit', cwd: root }); };
const quiet = (cmd) => { try { return execSync(cmd, { stdio: 'pipe', cwd: root }).toString().trim(); } catch { return ''; } };

const r = await sync({ vault, outDir: path.join(root, 'content'), patternsPath: process.env.PATTERNS_PATH, graph: true });
console.log(`published ${r.published.length} · blocked ${r.blocked.length} · downgraded links ${r.downgraded.length} · warnings ${r.warnings.length}`);
for (const b of r.blocked) console.log(`  ✗ ${b.src}: ${b.reason}`);
for (const w of r.warnings) console.log(`  ⚠ ${w}`);
if (r.downgraded.length) console.log(`  미공개 링크 → 텍스트: ${[...new Set(r.downgraded.map((d) => d.target))].join(', ')}`);
if (r.blocked.length) { console.log('\n발행 불가 — 차단 항목을 고친 뒤 다시 실행.'); process.exit(1); }

// 공개 블로그는 CI 가 site/build.mjs 로 만든다. 생성기·워크플로·의존성이 커밋 안 된 채로
// content 만 나가면 CI 가 옛 코드로 빌드하거나 깨지므로, 그런 변경이 남아 있으면 멈춘다.
const BUILD_PATHS = ['site', '.github', 'package.json', 'package-lock.json', 'scripts'];
const dirty = quiet(`git status --porcelain -- ${BUILD_PATHS.join(' ')}`);
if (dirty) {
  console.log(`\n발행 중단 — 블로그를 만드는 코드에 커밋되지 않은 변경이 있다:\n${dirty}`);
  console.log('\n내용을 확인한 뒤 직접 커밋하고 다시 실행:\n  git add site .github package.json package-lock.json scripts\n  git commit -m "site: 공개 블로그 생성기"\n');
  process.exit(1);
}

run('git add content');
const staged = quiet('git diff --cached --name-only');
if (!staged) { console.log('\n✓ 바뀐 공개 페이지 없음 — 커밋하지 않는다.'); process.exit(0); }
console.log(`\n✎ 커밋 대상:\n${staged}\n`);
const custom = process.argv.slice(2).join(' ').trim();
const n = staged.split('\n').length;
const msg = custom || `publish: ${new Date().toISOString().slice(0, 10)} (${n} file${n > 1 ? 's' : ''})`;
run(`git commit -m ${JSON.stringify(msg)} -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`);
run('git push');
console.log('\n✓ push 완료. Actions: https://github.com/vibecraftlab/vibecraftlab.github.io/actions');
