#!/usr/bin/env node
// 내부 위키: vault 전체를 Quartz 로 빌드해 **이 PC 에서만**(127.0.0.1) 서빙한다. 결과물은 커밋하지 않는다.
//   npm run internal            빌드 + watch + http://127.0.0.1:8080
//   npm run internal -- --once  빌드만
// 왜 Quartz 의 --serve 를 안 쓰나: Quartz 는 모든 인터페이스(0.0.0.0)에 열어서 같은 네트워크의 누구나
// mpole/ 을 포함한 vault 전체를 볼 수 있다 (2026-10-15 리뷰 C1). 여기서는 loopback 에만 묶는다.
// 셸을 거치지 않고 Quartz CLI 를 node 로 직접 실행한다 — 한글·공백 경로가 셸에서 쪼개지는 문제 회피.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const cli = path.join(root, 'quartz', 'bootstrap-cli.mjs');
const vault = process.env.VAULT_PATH || 'G:\\내 드라이브\\llm-wiki';
const port = Number(process.env.PORT || 8080);
const publicDir = path.join(root, 'public');
const once = process.argv.includes('--once');

if (!fs.existsSync(vault)) { console.error(`vault not found: ${vault}  (VAULT_PATH 로 지정)`); process.exit(1); }

const args = [cli, 'build', '-d', vault, ...(once ? [] : ['--watch'])];
console.log(`▶ node ${path.basename(cli)} ${args.slice(1).join(' ')}`);
const child = spawn(process.execPath, args, { stdio: 'inherit', cwd: root });
child.on('exit', (code) => { if (once || code) process.exit(code ?? 0); });
if (once) { /* 빌드 종료 시 위에서 exit */ } else serve();

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.xml': 'application/xml',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };

function resolveFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const safe = path.normalize(decoded).replace(/^(\.\.[\\/])+/, '');
  const base = path.join(publicDir, safe);
  if (!base.startsWith(publicDir)) return null;
  // Quartz v5: slug.html. 폴더면 index.html.
  for (const cand of [base, base + '.html', path.join(base, 'index.html')]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

function serve() {
  const server = http.createServer((req, res) => {
    const file = resolveFile(req.url || '/');
    if (!file) { const nf = path.join(publicDir, '404.html'); res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }); res.end(fs.existsSync(nf) ? fs.readFileSync(nf) : 'Not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  server.listen(port, '127.0.0.1', () => console.log(`\n내부 위키: http://127.0.0.1:${port}  (이 PC 에서만 접근 가능. Ctrl+C 로 종료)\n`));
  const stop = () => { try { child.kill(); } catch {} server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 500); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
