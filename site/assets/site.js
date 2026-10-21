// vibecraft tech — 공개 블로그 상호작용. 페이지마다 없는 요소는 건너뛴다.
document.documentElement.classList.replace('no-js', 'js');
if (/[?&]motion\b/.test(location.search)) document.documentElement.classList.add('force-motion');
(function () {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const root = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches && !root.classList.contains('force-motion');
  const json = (id) => { const el = document.getElementById(id); try { return el ? JSON.parse(el.textContent) : null; } catch (e) { return null; } };

  /* ── 테마 ── */
  const tb = $('#theme');
  const cur = () => root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const paint = () => {
    if (!tb) return; const d = cur() === 'dark'; const ico = $('#theme-ico');
    tb.setAttribute('aria-label', d ? '라이트 모드로 바꾸기' : '다크 모드로 바꾸기');
    ico.setAttribute('d', d ? 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0-5v2m0 16v2M4.2 4.2l1.4 1.4m12.8 12.8 1.4 1.4M2 12h2m16 0h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4' : 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z');
    ico.setAttribute('stroke', d ? 'currentColor' : 'none'); ico.setAttribute('stroke-width', '2'); ico.setAttribute('fill', d ? 'none' : 'currentColor');
  };
  try { const s = localStorage.getItem('vc-theme'); if (s) root.dataset.theme = s; } catch (e) {}
  paint();
  if (tb) tb.addEventListener('click', () => { root.dataset.theme = cur() === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('vc-theme', root.dataset.theme); } catch (e) {} paint(); });

  /* ── 등장 ── */
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
  $$('[data-rise], .statement').forEach((el) => io.observe(el));

  /* ── 위키 지도 (홈) ── */
  const G = json('graph-data'), TITLES = json('graph-titles') || {};
  const gEl = $('#graph');
  const NS = 'http://www.w3.org/2000/svg';
  if (G && gEl) {
    const N = G.n, E = G.e, X = (n) => n.x * 1600, Y = (n) => n.y * 1000;
    const nb = N.map(() => []); E.forEach(([a, b]) => { nb[a].push(b); nb[b].push(a); });
    const lit = new Set(N.map((n, i) => (n.k ? i : -1)).filter((i) => i >= 0));
    let dAll = '', dLit = '';
    E.forEach(([a, b]) => { const s = `M${X(N[a]).toFixed(0)} ${Y(N[a]).toFixed(0)}L${X(N[b]).toFixed(0)} ${Y(N[b]).toFixed(0)}`; if (lit.has(a) || lit.has(b)) dLit += s; else dAll += s; });
    $('#g-e').setAttribute('d', dAll); $('#g-el').setAttribute('d', dLit);
    const gn = $('#g-n'), gl = $('#g-l'), labels = $('#g-labels'), circ = [];
    N.forEach((n, i) => {
      if (lit.has(i)) return; const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', X(n)); c.setAttribute('cy', Y(n)); c.setAttribute('r', (4.5 + Math.sqrt(n.d) * 1.7).toFixed(1)); c.setAttribute('class', 'n');
      c.style.setProperty('--d', Math.round(Math.hypot(n.x - 0.5, n.y - 0.5) * 700)); gn.appendChild(c); circ[i] = c;
    });
    const order = [...lit].sort((a, b) => (TITLES[N[a].k]?.date < TITLES[N[b].k]?.date ? 1 : -1));
    order.forEach((i, j) => {
      const n = N[i], k = n.k;
      if (j === 0) { const p = document.createElementNS(NS, 'circle'); p.setAttribute('cx', X(n)); p.setAttribute('cy', Y(n)); p.setAttribute('r', 14); p.setAttribute('class', 'pulse'); gl.appendChild(p); }
      const c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', X(n)); c.setAttribute('cy', Y(n)); c.setAttribute('r', (11 + Math.sqrt(n.d) * 1.4).toFixed(1));
      c.setAttribute('class', 'l'); c.style.setProperty('--i', j); c.dataset.k = k; c.dataset.idx = i; gl.appendChild(c); circ[i] = c;
      const a = document.createElement('a'); a.href = `/${k}`; a.textContent = TITLES[k]?.short || k; a.dataset.k = k; a.dataset.idx = i; a.style.setProperty('--i', j);
      a.style.left = (n.x * 100) + '%'; a.style.top = (n.y * 100) + '%'; labels.appendChild(a);
    });
    const untangle = () => {
      const ls = [...labels.children], box = labels.getBoundingClientRect();
      const inside = (a) => { const r = a.getBoundingClientRect(); return r.left >= box.left - 1 && r.right <= box.right + 1; };
      ls.forEach((a) => { a.classList.toggle('left', N[+a.dataset.idx].x > 0.72); if (!inside(a)) a.classList.toggle('left'); });
      for (let pass = 0; pass < 2; pass++) for (let i = 0; i < ls.length; i++) for (let j = 0; j < i; j++) {
        const A = ls[i].getBoundingClientRect(), B = ls[j].getBoundingClientRect();
        if (A.width && A.left < B.right && B.left < A.right && A.top < B.bottom && B.top < A.bottom) { ls[i].classList.toggle('left'); if (!inside(ls[i])) ls[i].classList.toggle('left'); }
      }
    };
    requestAnimationFrame(untangle); addEventListener('resize', untangle);
    const hot = (i, on) => {
      const k = N[i].k; gEl.toggleAttribute('data-hover', on);
      $$(`[data-k="${k}"]`, gEl).forEach((el) => el.classList.toggle('hot', on));
      nb[i].forEach((j) => circ[j] && !lit.has(j) && circ[j].classList.toggle('nb', on));
      $('#g-eh').setAttribute('d', on ? nb[i].map((j) => `M${X(N[i])} ${Y(N[i])}L${X(N[j])} ${Y(N[j])}`).join('') : '');
    };
    [...gl.querySelectorAll('.l'), ...labels.children].forEach((el) => {
      const i = +el.dataset.idx;
      el.addEventListener('pointerenter', () => hot(i, true)); el.addEventListener('pointerleave', () => hot(i, false));
      el.addEventListener('focus', () => hot(i, true)); el.addEventListener('blur', () => hot(i, false));
      if (el.tagName === 'circle') el.addEventListener('click', () => { location.href = `/${N[i].k}`; });
    });
    $$('.seg button').forEach((b) => b.addEventListener('click', () => { gEl.dataset.mode = b.dataset.mode; $$('.seg button').forEach((x) => x.setAttribute('aria-pressed', x === b)); }));
    new IntersectionObserver((es, o) => es.forEach((e) => { if (e.isIntersecting) { gEl.classList.add('lit'); o.disconnect(); } }), { threshold: 0.3 }).observe(gEl);
    // 소개 문장 속 작은 지도: 가장 연결이 많은 공개 글 주변
    const mm = $('#mini-map');
    if (mm && order.length) {
      const c = N[order.reduce((b, i) => (N[i].d > N[b].d ? i : b), order[0])];
      mm.innerHTML = N.map((n, i) => ({ n, i })).filter(({ n }) => Math.abs(n.x - c.x) < 0.16 && Math.abs(n.y - c.y) < 0.2)
        .map(({ n, i }) => `<circle cx="${(32 + (n.x - c.x) * 180).toFixed(1)}" cy="${(20 + (n.y - c.y) * 90).toFixed(1)}" r="${lit.has(i) ? 3.4 : 2}" fill="var(${lit.has(i) ? '--lit' : '--dim'})"/>`).join('');
    }
  }

  /* ── 최근 글: 고정 대표 이미지 + 활성 목록 (홈) ── */
  const rows = $$('#rows .row'), covers = $$('#covers .cover'), stage = $('#covers'), pinBox = $('.posts .pin');
  if (rows.length && stage) {
    const narrow = matchMedia('(max-width:900px)');
    const place = () => {
      const on = rows.find((r) => r.classList.contains('on') && !r.hidden);
      if (narrow.matches && on) { const more = on.querySelector('.more'); more.insertBefore(stage, more.querySelector('.link')); }
      else if (!narrow.matches && stage.parentElement !== pinBox) pinBox.appendChild(stage);
    };
    narrow.addEventListener('change', place);
    const pick = (k) => { rows.forEach((r) => r.classList.toggle('on', r.dataset.k === k)); covers.forEach((c) => c.classList.toggle('on', c.dataset.k === k)); place(); };
    rows.forEach((r) => {
      r.addEventListener('pointerenter', () => pick(r.dataset.k)); r.addEventListener('focus', () => pick(r.dataset.k));
      r.addEventListener('click', (e) => { if (!e.target.closest('a')) pick(r.dataset.k); });
      r.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.target.closest('a')) location.href = `/${r.dataset.k}`; });
    });
    const mid = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting && !matchMedia('(hover: hover)').matches && !narrow.matches) pick(e.target.dataset.k); }), { rootMargin: '-48% 0px -48% 0px' });
    rows.forEach((r) => mid.observe(r));
    place();
    $$('.chips button').forEach((b) => b.addEventListener('click', () => {
      const t = b.dataset.t; $$('.chips button').forEach((x) => x.setAttribute('aria-pressed', x === b));
      rows.forEach((r) => { r.hidden = !(t === 'all' || (' ' + r.dataset.t + ' ').includes(' ' + t + ' ')); });
      const first = rows.find((r) => !r.hidden); if (first) pick(first.dataset.k);
    }));
  }

  /* ── 글 화면: 목차 ── */
  const tl = $$('#toc a[href^="#"]');
  if (tl.length) {
    const heads = tl.map((a) => document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1))));
    const onScroll = () => { let on = 0; heads.forEach((h, i) => { if (h && h.getBoundingClientRect().top < 160) on = i; }); tl.forEach((a, i) => a.classList.toggle('on', i === on)); };
    addEventListener('scroll', onScroll, { passive: true }); onScroll();
  }
  const copy = $('#copy');
  if (copy) copy.addEventListener('click', () => { try { navigator.clipboard.writeText(location.href); copy.textContent = '복사했습니다'; } catch (_) {} });

  /* ── 문의: mailto 로 이어 붙이기 ── */
  const ask = $('#ask');
  if (ask) ask.addEventListener('submit', (e) => {
    e.preventDefault(); const v = $('#ask-in').value.trim(); const to = ask.dataset.mail;
    location.href = `mailto:${to}?subject=${encodeURIComponent('[vibecraft tech] 글 문의')}&body=${encodeURIComponent(v)}`;
  });

  /* ── 한국 시각 ── */
  const clk = $('#clock');
  if (clk) { const tick = () => { clk.textContent = '지금 ' + new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: 'numeric', minute: '2-digit' }).format(new Date()); }; tick(); setInterval(tick, 30000); }
  if (reduce) $$('[data-rise]').forEach((el) => el.classList.add('in'));
})();
