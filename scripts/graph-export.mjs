// 공개 블로그 첫 화면의 "사내 위키 지도" 데이터.
// vault 전체의 [[링크]] 구조를 좌표로 펼치되, 비공개 문서는 좌표·연결 수만 남긴다 — 제목·경로·slug 는 내보내지 않는다.
// 공개된 글만 k(slug) 를 가진다. 결과는 sync 가 content/graph.json 으로 쓰고, site/build.mjs 가 읽는다.
import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set(['.obsidian', '.claude', '_templates', '_specs', '.trash', 'node_modules']);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

// ForceAtlas2 방식: 차수 비례 반발 + 허브 억제 인력 + 중력. 난수는 고정 시드라 같은 vault 면 같은 그림.
function layout(n, edges, deg) {
  let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const P = Array.from({ length: n }, () => [rnd() * 2 - 1, rnd() * 2 - 1]);
  const kr = 0.012, kg = 0.06, AX = 1.6;
  const iters = Math.max(200, Math.min(1500, Math.floor(4e7 / Math.max(1, n * n))));
  for (let it = 0; it < iters; it++) {
    const step = 0.03 * Math.pow(0.997, it * (1500 / iters)) + 0.0008;
    const F = P.map(() => [0, 0]);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const dx = (P[i][0] - P[j][0]) / AX, dy = P[i][1] - P[j][1];
      const d2 = Math.max(1e-4, dx * dx + dy * dy);
      const f = (kr * (deg[i] + 1) * (deg[j] + 1)) / d2;
      F[i][0] += dx * f; F[i][1] += dy * f; F[j][0] -= dx * f; F[j][1] -= dy * f;
    }
    for (const [a, b] of edges) {
      const dx = P[a][0] - P[b][0], dy = P[a][1] - P[b][1];
      const fa = 1 / (deg[a] + 1), fb = 1 / (deg[b] + 1);
      F[a][0] -= dx * fa; F[a][1] -= dy * fa; F[b][0] += dx * fb; F[b][1] += dy * fb;
    }
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(P[i][0] / AX, P[i][1]) || 1e-4;
      F[i][0] -= (P[i][0] / d) * kg * (deg[i] + 1) * 0.05 + P[i][0] * kg * 0.6;
      F[i][1] -= (P[i][1] / d) * kg * (deg[i] + 1) * 0.05 + P[i][1] * kg * 0.6;
      const m = Math.hypot(F[i][0], F[i][1]) || 1e-9;
      const s = Math.min(m, step * (1 + 3 / (deg[i] + 1))) / m;
      P[i][0] += F[i][0] * s; P[i][1] += F[i][1] * s;
    }
  }
  // 백분위 정규화 — 바깥 몇 개가 전체를 줄이지 않게. 넘친 점은 가장자리에 붙인다
  const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))]; };
  const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
  const [x0, x1, y0, y1] = [q(xs, 0.02), q(xs, 0.98), q(ys, 0.02), q(ys, 0.98)];
  const cl = (v) => Math.max(0.03, Math.min(0.97, v));
  return P.map(([x, y]) => [+cl(0.06 + 0.88 * (x - x0) / ((x1 - x0) || 1)).toFixed(4), +cl(0.08 + 0.84 * (y - y0) / ((y1 - y0) || 1)).toFixed(4)]);
}

/** @returns {{n: {x:number,y:number,d:number,k?:string}[], e: [number,number][], total:number, links:number}} */
export function buildGraph(vault, pubSlugs) {
  const files = walk(vault);
  const byBase = new Map();
  files.forEach((f, i) => { const b = path.basename(f, '.md').toLowerCase(); if (!byBase.has(b)) byBase.set(b, i); });
  const edges = new Set();
  files.forEach((f, i) => {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
      const b = path.posix.basename(m[1].trim().replace(/\\/g, '/')).replace(/\.md$/i, '').toLowerCase();
      const j = byBase.get(b);
      if (j != null && j !== i) edges.add(i < j ? `${i}-${j}` : `${j}-${i}`);
    }
  });
  const E = [...edges].map((s) => s.split('-').map(Number));
  const deg = new Array(files.length).fill(0); E.forEach(([a, b]) => { deg[a]++; deg[b]++; });
  const pos = layout(files.length, E, deg);
  const n = files.map((f, i) => {
    const slug = path.basename(f, '.md');
    const o = { x: pos[i][0], y: pos[i][1], d: deg[i] };
    if (pubSlugs.has(slug)) o.k = slug;   // 공개된 글만 이름을 가진다
    return o;
  });
  return { n, e: E, total: files.length, links: E.length };
}
