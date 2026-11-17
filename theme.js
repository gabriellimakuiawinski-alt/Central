// Temas da Central: estilo (paleta + cena de fundo), modo claro/escuro e intensidade das animações.
// Carregado no <head> (antes do CSS) para a página já abrir com o tema certo, sem piscar.
// Preferências ficam só neste aparelho (localStorage); nada vai para o servidor.
(function () {
  'use strict';
  const STYLES = [
    ['mistico', 'Místico', 'Noite azul, nuvens em camadas e detalhes dourados'],
    ['floresta', 'Floresta', 'Verde profundo, musgo e vaga-lumes'],
    ['crepusculo', 'Crepúsculo', 'Roxo, rosa e laranja do fim de tarde'],
    ['carmesim', 'Carmesim', 'O visual original, preto e vermelho'],
  ];
  const MODES = [['auto', 'Automático'], ['escuro', 'Escuro'], ['claro', 'Claro']];
  const MOTIONS = [['full', 'Completas'], ['calm', 'Calmas']];
  const DEF = { style: 'mistico', mode: 'escuro', motion: 'full' };
  const root = document.documentElement;
  const mq = matchMedia('(prefers-color-scheme: light)');
  const read = (k) => { try { return localStorage.getItem('central.' + k) || DEF[k]; } catch { return DEF[k]; } };
  const write = (k, v) => { try { localStorage.setItem('central.' + k, v); } catch { /* modo privado: vale só nesta sessão */ } };
  const valid = { style: STYLES.map((s) => s[0]), mode: MODES.map((s) => s[0]), motion: MOTIONS.map((s) => s[0]) };
  const mem = {};

  function get() {
    const o = {};
    for (const k of Object.keys(DEF)) { const v = mem[k] || read(k); o[k] = valid[k].includes(v) ? v : DEF[k]; }
    o.resolved = o.mode === 'auto' ? (mq.matches ? 'light' : 'dark') : o.mode === 'claro' ? 'light' : 'dark';
    return o;
  }
  function apply() {
    const t = get();
    root.dataset.style = t.style;
    root.dataset.mode = t.resolved;
    root.dataset.motion = t.motion;
    root.style.colorScheme = t.resolved;
    requestAnimationFrame(() => {
      const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
      const m = document.querySelector('meta[name="theme-color"]');
      if (m && bg) m.setAttribute('content', bg);
    });
  }
  // Troca com um círculo que se expande a partir do toque (View Transitions), quando o navegador suporta.
  function set(k, v, pt) {
    if (!valid[k] || !valid[k].includes(v)) return;
    mem[k] = v; write(k, v);
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (document.startViewTransition && !calm && pt) {
      root.style.setProperty('--vx', pt.x + 'px');
      root.style.setProperty('--vy', pt.y + 'px');
      document.startViewTransition(apply);
    } else {
      root.classList.add('theming');
      apply();
      setTimeout(() => root.classList.remove('theming'), 700);
    }
  }
  mq.addEventListener?.('change', () => { if (get().mode === 'auto') apply(); });
  apply();

  /* ---------- cena de fundo: céu, lua, estrelas, nuvens e colinas em camadas, ramos dourados ---------- */
  const NS = 'http://www.w3.org/2000/svg';
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const f = (n) => n.toFixed(1);
  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const [a, v] of Object.entries(attrs)) e.setAttribute(a, v);
    if (parent) parent.appendChild(e);
    return e;
  };
  function waveFn(base, amp) {
    const w = [0, 1, 2].map((i) => ({ a: amp / (i + 1.2), k: (0.0028 + rnd() * 0.002) * (i + 1), p: rnd() * 6.28 }));
    return (x) => base + w.reduce((s, q) => s + q.a * Math.sin(x * q.k + q.p), 0);
  }
  const line = (fn, x0, x1, dy) => { let d = ''; for (let x = x0; x <= x1; x += 16) d += (d ? 'L' : 'M') + f(x) + ',' + f(fn(x) + dy); return d; };

  // Camada inferior (colina/nuvem): preenchimento em degradê + linhas de contorno finas, como gravura.
  function hill(i, gid) {
    const W = 1600, H = 600;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    const g = el('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 }, el('defs', {}, svg));
    el('stop', { offset: 0, style: `stop-color:var(--l${i}a)` }, g);
    el('stop', { offset: 1, style: `stop-color:var(--l${i}b)` }, g);
    const fn = waveFn(110 + i * 92, 34 + rnd() * 26);
    el('path', { d: line(fn, -20, W + 20, 0) + `L${W + 20},${H}L-20,${H}Z`, fill: `url(#${gid})` }, svg);
    for (let k = 1; k <= 9; k++) {
      el('path', { d: line((x) => fn(x) + Math.sin(x * 0.006 + k) * 3, -20, W + 20, k * 11), fill: 'none', 'vector-effect': 'non-scaling-stroke',
        style: `stroke:var(--contour);stroke-width:1;opacity:${f(1 - k / 10.5)}` }, svg);
    }
    el('path', { d: line(fn, -20, W + 20, 0), fill: 'none', 'vector-effect': 'non-scaling-stroke', style: 'stroke:var(--rim);stroke-width:1.4' }, svg);
    for (let s = 0; s < 14; s++) {
      const x = rnd() * W;
      el('circle', { cx: f(x), cy: f(fn(x) + 14 + rnd() * 60), r: f(0.8 + rnd() * 1.6), style: `fill:var(--gold);opacity:${f(0.25 + rnd() * 0.45)}` }, svg);
    }
    return svg;
  }
  // Nuvens do alto: mais fundas nos cantos, abrindo o céu no meio (moldura da referência).
  function cloud(i, gid) {
    const W = 1600, H = 420;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    const g = el('linearGradient', { id: gid, x1: 0, y1: 1, x2: 0, y2: 0 }, el('defs', {}, svg));
    el('stop', { offset: 0, style: `stop-color:var(--t${i}a)` }, g);
    el('stop', { offset: 1, style: `stop-color:var(--t${i}b)` }, g);
    const wv = waveFn(0, 26);
    const fn = (x) => { const u = (x - 800) / 800; return (i === 1 ? 70 : 30) + (i === 1 ? 300 : 230) * Math.pow(Math.abs(u), 1.6) + wv(x); };
    el('path', { d: line(fn, -20, W + 20, 0) + `L${W + 20},0L-20,0Z`, fill: `url(#${gid})` }, svg);
    for (let k = 1; k <= 8; k++) {
      el('path', { d: line(fn, -20, W + 20, -k * 12), fill: 'none', 'vector-effect': 'non-scaling-stroke', style: `stroke:var(--contour);stroke-width:1;opacity:${f(1 - k / 9.5)}` }, svg);
    }
    el('path', { d: line(fn, -20, W + 20, 0), fill: 'none', 'vector-effect': 'non-scaling-stroke', style: 'stroke:var(--rim);stroke-width:1.4' }, svg);
    return svg;
  }
  // Ramo dourado: haste curva com folhas alternadas e pequenas flores.
  function sprig(flip) {
    const svg = el('svg', { viewBox: '0 0 220 340', 'aria-hidden': 'true' });
    const gr = el('g', { style: 'stroke:var(--gold);fill:var(--gold);fill-opacity:.18;stroke-width:1.3;stroke-linecap:round', transform: flip ? 'translate(220,0) scale(-1,1)' : '' }, svg);
    const branches = [[110, 340, 40, 190, 70, 40], [110, 300, 170, 230, 175, 110], [100, 250, 30, 230, 20, 160]];
    branches.forEach(([x0, y0, cx, cy, x1, y1], b) => {
      el('path', { d: `M${x0},${y0}Q${cx},${cy} ${x1},${y1}`, fill: 'none' }, gr);
      const n = b ? 6 : 10;
      for (let j = 1; j < n; j++) {
        const t = j / n, it = 1 - t;
        const px = it * it * x0 + 2 * it * t * cx + t * t * x1, py = it * it * y0 + 2 * it * t * cy + t * t * y1;
        const tx = 2 * it * (cx - x0) + 2 * t * (x1 - cx), ty = 2 * it * (cy - y0) + 2 * t * (y1 - cy);
        const ang = (Math.atan2(ty, tx) * 180) / Math.PI + (j % 2 ? 55 : -55) + 90;
        const s = 1.1 - t * 0.5;
        el('path', { d: 'M0,0Q7,-9 0,-20Q-7,-9 0,0Z', transform: `translate(${f(px)},${f(py)}) rotate(${f(ang)}) scale(${f(s)})` }, gr);
      }
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * 6.28;
        el('circle', { cx: f(x1 + Math.cos(a) * 4.5), cy: f(y1 + Math.sin(a) * 4.5), r: 2.6, style: 'fill-opacity:.55' }, gr);
      }
      el('circle', { cx: x1, cy: y1, r: 1.6, style: 'fill-opacity:1' }, gr);
    });
    return svg;
  }
  function div(cls, style, parent) { const d = document.createElement('div'); d.className = cls; if (style) d.setAttribute('style', style); parent.appendChild(d); return d; }

  function buildScene() {
    const host = document.querySelector('.aurora');
    if (!host || host.dataset.built) return;
    host.dataset.built = '1';
    host.textContent = '';
    seed = 7;
    div('fog a', '', host); div('fog b', '', host);
    const stars = div('stars', '', host);
    for (let i = 0; i < 70; i++) div('st', `left:${f(rnd() * 100)}%;top:${f(rnd() * 62)}%;--z:${f(1 + rnd() * 1.8)}px;--d:${f(2.5 + rnd() * 5)}s;--w:${f(-rnd() * 6)}s`, stars);
    for (let i = 0; i < 12; i++) div('sp', `left:${f(4 + rnd() * 92)}%;top:${f(4 + rnd() * 50)}%;--z:${f(9 + rnd() * 12)}px;--d:${f(3 + rnd() * 4)}s;--w:${f(-rnd() * 6)}s`, stars).appendChild(document.createElement('i'));
    [2, 1].forEach((i) => { const d = div(`ly top t${i}`, `--d:${48 + i * 9}s;--s:${i === 1 ? 1 : -1}`, host); d.appendChild(cloud(i, 'gT' + i)); });
    div('moon', '', host);
    div('shoot', '', host);
    for (let i = 1; i <= 5; i++) { const d = div(`ly bot b${i}`, `--d:${34 + i * 7}s;--s:${i % 2 ? 1 : -1}`, host); d.appendChild(hill(i, 'gB' + i)); }
    div('sprig l', '', host).appendChild(sprig(false));
    div('sprig r', '', host).appendChild(sprig(true));
    for (let i = 0; i < 16; i++) div('ff', `left:${f(rnd() * 100)}%;top:${f(45 + rnd() * 50)}%;--d:${f(7 + rnd() * 9)}s;--w:${f(-rnd() * 12)}s;--dx:${f(-40 + rnd() * 80)}px;--dy:${f(-30 - rnd() * 70)}px`, host);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildScene); else buildScene();

  window.CentralTheme = { STYLES, MODES, MOTIONS, get, set, apply };
})();
