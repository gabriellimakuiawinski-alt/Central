// Temas da Central: paleta de cores, modo claro/escuro, fonte e animações do fundo.
// Carregado no <head> (antes do CSS) para a página já abrir com o tema certo, sem piscar.
// Preferências ficam só neste aparelho (localStorage); nada vai para o servidor.
(function () {
  'use strict';
  const STYLES = [
    ['mistico', 'Petróleo e ouro'], ['oceano', 'Oceano'], ['floresta', 'Floresta'], ['terracota', 'Terracota'],
    ['cafe', 'Café com leite'], ['bauhaus', 'Mostarda e anil'], ['crepusculo', 'Crepúsculo'], ['lavanda', 'Lavanda e sálvia'],
    ['rosa', 'Rosa chá e vinho'], ['menta', 'Menta e cereja'], ['grafite', 'Grafite e limão'], ['carmesim', 'Carmesim'],
  ];
  const FONTS = [['editorial', 'Editorial', 'Fraunces + Instrument Sans'], ['grotesca', 'Grotesca', 'Bricolage Grotesque'], ['tecnica', 'Técnica', 'IBM Plex Sans + Mono']];
  const MODES = [['auto', 'Automático'], ['escuro', 'Escuro'], ['claro', 'Claro']];
  const MOTIONS = [['full', 'Ligadas'], ['calm', 'Paradas']];
  const DEF = { style: 'mistico', mode: 'escuro', motion: 'full', font: 'editorial' };
  const root = document.documentElement;
  const mq = matchMedia('(prefers-color-scheme: light)');
  const read = (k) => { try { return localStorage.getItem('central.' + k) || DEF[k]; } catch { return DEF[k]; } };
  const write = (k, v) => { try { localStorage.setItem('central.' + k, v); } catch { /* modo privado: vale só nesta sessão */ } };
  const valid = { style: STYLES.map((s) => s[0]), mode: MODES.map((s) => s[0]), motion: MOTIONS.map((s) => s[0]), font: FONTS.map((s) => s[0]) };
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
    root.dataset.font = t.font;
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

  /* ---------- fundo: três manchas de cor da paleta, desfocadas atrás do vidro ---------- */
  function buildBackdrop() {
    const host = document.querySelector('.aurora');
    if (!host || host.dataset.built) return;
    host.dataset.built = '1';
    host.textContent = '';
    for (const c of ['b1', 'b2', 'b3']) { const i = document.createElement('i'); i.className = c; host.appendChild(i); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildBackdrop); else buildBackdrop();

  window.CentralTheme = { STYLES, FONTS, MODES, MOTIONS, get, set, apply };
})();
