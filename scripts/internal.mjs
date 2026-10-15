#!/usr/bin/env node
// 내부 위키: vault 전체를 Quartz 로 빌드해 로컬에서 서빙한다. 결과물은 커밋하지 않는다.
// VAULT_PATH 환경변수로 vault 위치를 바꿀 수 있다 (새 PC). --once 면 빌드만 하고 끝낸다.
// 셸을 거치지 않고 Quartz CLI 를 node 로 직접 실행한다 — 한글·공백 경로가 셸에서 쪼개지는 문제 회피.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'quartz', 'bootstrap-cli.mjs');
const vault = process.env.VAULT_PATH || 'G:\\내 드라이브\\llm-wiki';
const port = process.env.PORT || '8080';
if (!existsSync(vault)) {
  console.error(`vault not found: ${vault}  (VAULT_PATH 로 지정)`);
  process.exit(1);
}
const once = process.argv.includes('--once');
const args = [cli, 'build', '-d', vault, ...(once ? [] : ['--serve', '--port', port])];
console.log(`▶ node ${path.basename(cli)} ${args.slice(1).join(' ')}`);
const child = spawn(process.execPath, args, { stdio: 'inherit', cwd: path.join(here, '..') });
child.on('exit', (code) => process.exit(code ?? 0));
