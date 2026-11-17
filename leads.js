// Lead Finder — módulo de prospecção da Central (pessoal).
// Usa os mesmos componentes, modais e padrões do app.js. Dados sempre reais, vindos do banco.
import { PROVIDERS, normalizeItem, normName, normPhone, normSite, fmtPhone } from './lead-providers.js';
import { computeScore, priorityOf, FINDINGS, CRITERIA, DEFAULT_WEIGHTS } from './lead-score.js';
import { buildMessage, factsFor, defaultService, TONES, SERVICES } from './lead-messages.js';

let C = null; // contexto recebido do app.js (sb, esc, toast, modais, rotas…)

export const STATUS = [
  ['novo', 'Novo'], ['em_analise', 'Em análise'], ['pronto_contato', 'Pronto para contato'], ['contatado', 'Contatado'],
  ['respondeu', 'Respondeu'], ['negociacao', 'Negociação'], ['proposta_enviada', 'Proposta enviada'],
  ['venda_concluida', 'Venda concluída'], ['perdido', 'Perdido'], ['nao_contatar', 'Não contatar'],
];
const STATUS_NAME = Object.fromEntries(STATUS);
const STATUS_CLASS = { venda_concluida: 'ok', respondeu: 'ok', negociacao: 'mid', proposta_enviada: 'mid', perdido: 'bad', nao_contatar: 'bad' };
const CLOSED = ['venda_concluida', 'perdido', 'nao_contatar'];
const CONTACTED = ['contatado', 'respondeu', 'negociacao', 'proposta_enviada', 'venda_concluida'];
const REPLIED = ['respondeu', 'negociacao', 'proposta_enviada', 'venda_concluida'];
const SEGMENTS = [
  ['oficinas', 'Oficinas mecânicas'], ['barbearias', 'Barbearias e salões'], ['restaurantes', 'Restaurantes e alimentação'],
  ['clinicas', 'Clínicas e consultórios'], ['academias', 'Academias'], ['lojas', 'Lojas'],
  ['servicos', 'Prestadores de serviços'], ['outro', 'Outro (termo personalizado)'],
];
const SEG_SHORT = SEGMENTS.slice(0, 7).concat([['outro', 'Outro']]);
const SEG_NAME = Object.fromEntries(SEGMENTS);
const SITE = { nao_encontrado_na_fonte: 'Site não encontrado na fonte', rede_social: 'Só rede social na fonte', informado: 'Site informado' };
const ORIGIN = { osm: 'OpenStreetMap', manual: 'Cadastro manual', google: 'Google Places', pagespeed: 'PageSpeed (análise de sites)' };
const EVENT_KIND = { nota: 'Anotação', contato: 'Contato feito', resposta: 'Resposta recebida', status: 'Status', alteracao: 'Alteração', sistema: 'Sistema' };
const FIELD = { estimated_value: 'Valor estimado', next_action: 'Próxima ação', phone: 'Telefone', website: 'Site' };
const ANALYSIS_STATUS = { ok: 'Site no ar', fora_do_ar: 'Site fora do ar', bloqueado: 'Verificação bloqueada pelo site', inconclusivo: 'Sem resposta à verificação' };
const EVERY = [['1', 'Todo dia'], ['7', 'Toda semana'], ['15', 'A cada 15 dias'], ['30', 'Todo mês']];
const PERIODS = [['7', '7 dias'], ['30', '30 dias'], ['90', '90 dias'], ['0', 'Tudo']];
const PAGE = 25;

const L = {
  loaded: false, loading: false, error: null,
  companies: [], searches: [], tasks: [], settings: null, usage: [], errors: [],
  events: {}, sources: {}, analysis: {}, detailLoading: null, analyzing: new Set(), auto: null,
  tab: null, q: '', fStatus: '', fSeg: '', fSite: '', fPrio: '', fSearch: null, sort: 'recentes', page: 1, period: '30',
  searching: false, step: '', abort: null, lastResult: null, searchError: null, form: null,
  msgTone: 'profissional', msgService: {},
};

export function init(ctx) { C = ctx; }
export function reset() {
  L.abort?.abort(); if (L.auto) L.auto.stop = true;
  Object.assign(L, { loaded: false, loading: false, error: null, companies: [], searches: [], tasks: [], settings: null, usage: [], errors: [], events: {}, sources: {}, analysis: {}, lastResult: null, searchError: null, tab: null });
}

// Celular brasileiro: DDD + 9 + 8 dígitos. Só nesses casos o botão de WhatsApp aparece.
const isMobile = (pn) => /^[1-9]\d9\d{8}$/.test(String(pn || ''));
const today10 = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const scoreOf = (c) => computeScore(c, L.settings?.score_weights);
const senderName = () => L.settings?.sender_name ?? C.settings()?.business_name ?? '';
const hasOwnSite = (c) => c.site_status === 'informado' && !!c.website;
// Não redesenha a tela se a pessoa está digitando no histórico (evita apagar o texto). A tela se atualiza na próxima ação.
function rerender() {
  const a = document.activeElement;
  if (a && a.closest?.('#view') && a.tagName === 'TEXTAREA' && a.name === 'body' && a.value) return;
  C.route();
}

/* ============ dados ============ */
async function fetchAll(table, order) {
  const out = [];
  for (let from = 0; from < 5000; from += 1000) {
    const r = await C.sb.from(table).select('*').order(order, { ascending: false }).range(from, from + 999);
    if (r.error) throw r.error;
    out.push(...r.data);
    if (r.data.length < 1000) break;
  }
  return out;
}
async function load() {
  if (L.loading) return;
  L.loading = true; L.error = null;
  try {
    const month = today10().slice(0, 8) + '01';
    const [companies, s, t, cfg, usage, errs] = await Promise.all([
      fetchAll('lf_companies', 'created_at'),
      C.sb.from('lf_searches').select('*').order('created_at', { ascending: false }).limit(30),
      C.sb.from('lf_tasks').select('*').order('created_at', { ascending: false }).limit(100),
      C.sb.from('lf_settings').select('*').maybeSingle(),
      C.sb.from('lf_api_usage').select('*').gte('day', month).order('day', { ascending: false }).limit(200),
      C.sb.from('lf_errors').select('*').order('created_at', { ascending: false }).limit(20),
    ]);
    for (const r of [s, t, cfg, usage, errs]) if (r.error) throw r.error;
    Object.assign(L, { companies, searches: s.data || [], tasks: t.data || [], settings: cfg.data || null, usage: usage.data || [], errors: errs.data || [], loaded: true });
    if (!L.tab) L.tab = companies.length ? 'painel' : 'buscar';
  } catch (e) { console.error(e); L.error = C.friendly(e); }
  L.loading = false;
  C.route();
}
async function loadDetail(id) {
  if (L.detailLoading === id) return;
  L.detailLoading = id;
  try {
    const [ev, src, an] = await Promise.all([
      C.sb.from('lf_events').select('*').eq('company_id', id).order('happened_at', { ascending: false }).limit(200),
      C.sb.from('lf_company_sources').select('*').eq('company_id', id).order('fetched_at', { ascending: false }),
      C.sb.from('lf_site_analyses').select('*').eq('company_id', id).order('checked_at', { ascending: false }).limit(1),
    ]);
    for (const r of [ev, src, an]) if (r.error) throw r.error;
    L.events[id] = ev.data || []; L.sources[id] = src.data || []; L.analysis[id] = an.data?.[0] || null;
  } catch (e) { console.error(e); L.events[id] ||= []; L.sources[id] ||= []; C.toast(C.friendly(e), true); }
  L.detailLoading = null;
  rerender();
}
const leadOf = (id) => L.companies.find((c) => c.id === id);
const putLead = (row) => { const i = L.companies.findIndex((c) => c.id === row.id); if (i >= 0) L.companies[i] = row; };
async function patchLead(id, patch) {
  const r = await C.sb.from('lf_companies').update(patch).eq('id', id).select().single();
  if (r.error) throw r.error;
  putLead(r.data);
  delete L.events[id];
  return r.data;
}
// Grava a pontuação no banco quando ela muda (depois de análise, confirmação ou edição).
async function syncScore(id) {
  const c = leadOf(id);
  if (!c) return;
  const s = scoreOf(c);
  if (c.score === s.score && c.score_detail?.confidence === s.confidence) return;
  const detail = { confidence: s.confidence, parts: s.parts.map(({ key, pts, max, conf }) => ({ key, pts, max, conf })) };
  const r = await C.sb.from('lf_companies').update({ score: s.score, score_detail: detail }).eq('id', id).select().single();
  if (r.error) throw r.error;
  putLead(r.data);
  await C.sb.from('lf_scores').insert({ company_id: id, score: s.score, confidence: s.confidence, detail });
}
async function addEvent(company_id, kind, body, happened_at) {
  const r = await C.sb.from('lf_events').insert({ company_id, kind, body: body || null, happened_at: happened_at || new Date().toISOString() });
  if (r.error) throw r.error;
  delete L.events[company_id];
}
async function saveSettings(patch) {
  const r = await C.sb.from('lf_settings').upsert({ user_id: C.userId(), ...patch }).select().single();
  if (r.error) throw r.error;
  L.settings = r.data;
}
async function fnError(error, fallback) {
  let msg = error?.message || fallback;
  try { const j = await error.context.json(); if (j?.error) msg = j.error; } catch { /* sem corpo JSON */ }
  if (/failed to (send|fetch)|networkerror|load failed/i.test(msg)) msg = 'Sem conexão com o servidor. Confira a internet e tente de novo.';
  return msg;
}

/* ============ análise de sites ============ */
async function analyze(id, quiet = false) {
  if (L.analyzing.has(id)) return false;
  L.analyzing.add(id); rerender();
  let ok = false;
  try {
    const { error } = await C.sb.functions.invoke('lf-analyze', { body: { company_id: id } });
    if (error) throw new Error(await fnError(error, 'Falha na análise.'));
    const r = await C.sb.from('lf_companies').select('*').eq('id', id).single();
    if (r.error) throw r.error;
    putLead(r.data);
    delete L.analysis[id]; delete L.events[id];
    await syncScore(id);
    ok = true;
    if (!quiet) C.toast('Análise concluída');
  } catch (e) { console.error(e); if (!quiet) C.toast(C.friendly(e), true); }
  L.analyzing.delete(id);
  rerender();
  return ok;
}
// Depois de uma pesquisa: analisa, um por vez e com teto, os novos leads que têm site.
async function autoAnalyze(searchId) {
  if (L.settings && L.settings.auto_analyze === false) return;
  const todo = L.companies.filter((c) => c.first_search_id === searchId && hasOwnSite(c) && !c.site_analysis).slice(0, 5);
  if (!todo.length) return;
  L.auto = { done: 0, total: todo.length, stop: false };
  rerender();
  for (const c of todo) {
    if (L.auto.stop) break;
    const ok = await analyze(c.id, true);
    if (!ok) break; // limite por hora ou falha: para em vez de insistir
    L.auto.done++;
    rerender();
  }
  L.auto = null;
  rerender();
}

/* ============ pesquisa ============ */
function readParams(d) {
  const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
  const p = {
    country: clean(d.country, 60) || 'Brasil', state: clean(d.state, 60), city: clean(d.city, 80), neighborhood: clean(d.neighborhood, 80),
    radius_km: Math.min(Math.max(Number(d.radius_km) || 0, 0), 15), segment: d.segment, term: clean(d.term, 40),
    presence: ['sem_site', 'com_site', 'todas'].includes(d.presence) ? d.presence : 'todas',
    limit: Math.min(Math.max(Math.round(Number(d.limit) || 25), 1), 100),
  };
  if (p.city.length < 2) throw new Error('Informe a cidade.');
  if (!SEG_NAME[p.segment]) throw new Error('Segmento inválido.');
  if (p.segment === 'outro' && p.term.length < 3) throw new Error('Para “Outro”, escreva um termo com pelo menos 3 letras.');
  return p;
}
async function runSearch(p, task = null) {
  if (L.searching) { C.toast('Já existe uma pesquisa em andamento.', true); return; }
  const provider = PROVIDERS.osm;
  Object.assign(L, { searching: true, step: 'Conferindo limites…', searchError: null, lastResult: null, abort: new AbortController(), tab: 'buscar' });
  C.route();
  let searchId = null, okId = null;
  const finish = async (patch) => { if (searchId) await C.sb.from('lf_searches').update({ ...patch, finished_at: new Date().toISOString() }).eq('id', searchId); };
  try {
    // O servidor confere o limite de pesquisas por hora antes de qualquer consulta à fonte.
    const b = await C.sb.rpc('lf_begin_search', { p_provider: provider.key, p_params: p });
    if (b.error) throw b.error;
    searchId = b.data;
    const found = await provider.search(p, { signal: L.abort.signal, onStep: (t) => { L.step = t; const el = document.getElementById('lf-step'); if (el) el.textContent = t; } });
    const seen = new Set();
    const items = found.places.map((r) => normalizeItem(r, p.segment))
      .filter((it) => it && !seen.has(it.external_id) && seen.add(it.external_id))
      .filter((it) => (p.presence === 'sem_site' ? it.site_status !== 'informado' : p.presence === 'com_site' ? it.site_status === 'informado' : true))
      .slice(0, p.limit);
    let ing = { novos: 0, duplicados: 0, ignorados: 0 };
    if (items.length) {
      const r = await C.sb.rpc('lf_ingest', { p_search: searchId, p_provider: provider.key, p_items: items });
      if (r.error) throw r.error;
      ing = r.data;
    }
    const summary = { found: items.length, new_count: ing.novos, dup_count: ing.duplicados, skipped: ing.ignorados };
    await finish({ status: 'ok', ...summary, area_label: found.areaLabel });
    L.lastResult = { search_id: searchId, ...summary, area: found.areaLabel, scanned: found.places.length };
    okId = searchId;
    if (task) {
      const next = new Date(Date.now() + (Number(task.payload?.every_days) || 7) * 86400000).toISOString();
      await C.sb.from('lf_tasks').update({ due_at: next, payload: { ...task.payload, last_run: new Date().toISOString(), last_new: ing.novos } }).eq('id', task.id);
    }
  } catch (e) {
    const cancelled = e?.name === 'AbortError';
    const msg = cancelled ? 'Pesquisa cancelada.' : C.friendly(e);
    L.searchError = msg;
    try {
      await finish({ status: cancelled ? 'cancelada' : 'erro', error: msg.slice(0, 300) });
      if (!cancelled) await C.sb.from('lf_errors').insert({ scope: 'busca', message: msg.slice(0, 500), meta: { search_id: searchId, provider: provider.key } });
    } catch (e2) { console.error(e2); }
  }
  Object.assign(L, { searching: false, abort: null, step: '' });
  // Recarrega leads e histórico com os dados reais do banco, depois dispara a análise automática.
  L.loaded = false;
  await load();
  if (okId) autoAnalyze(okId);
}

/* ============ telas ============ */
const head = (extra = '') => `<div class="page-h"><div><div class="eyebrow">Prospecção</div><h1>Lead Finder</h1></div>${extra}</div>`;
const dueTasks = () => L.tasks.filter((t) => t.kind === 'pesquisa_agendada' && t.status === 'pendente' && t.due_at && t.due_at <= new Date().toISOString());
const tabsHTML = () => `<div class="tabs">${[['painel', 'Painel'], ['buscar', 'Buscar'], ['leads', `Leads (${L.companies.length})`], ['ajustes', 'Ajustes']]
  .map(([k, n]) => `<button class="tab ${L.tab === k ? 'on' : ''}" data-action="lf-tab" data-tab="${k}">${n}</button>`).join('')}</div>`;
const opt = (list, cur, first = '') => (first ? `<option value="">${first}</option>` : '') + list.map(([k, n]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${C.esc(n)}</option>`).join('');
const statusBadge = (s) => `<span class="badge ${STATUS_CLASS[s] || ''}">${STATUS_NAME[s] || C.esc(s)}</span>`;
const place = (c) => [c.neighborhood, c.city, c.state].filter(Boolean).join(', ');
const prioBadge = (score) => { const [n, cls] = priorityOf(score); return `<span class="badge ${cls}">${n}</span>`; };

export function view(id) {
  if (!L.loaded) {
    if (L.error) return `${head()}<div class="empty"><p>Não foi possível carregar os leads: ${C.esc(L.error)}</p><button class="btn" data-action="lf-reload">Tentar de novo</button></div>`;
    load();
    return `${head()}<div class="empty lf-loading">Carregando leads…</div>`;
  }
  if (id) return vLead(id);
  const due = dueTasks().length;
  const banner = `${due && L.tab !== 'buscar' ? `<div class="card alert"><div class="item"><div><div class="t">${due} pesquisa${due === 1 ? '' : 's'} agendada${due === 1 ? '' : 's'} para hoje</div><div class="muted small">Elas rodam quando você toca em Executar.</div></div><button class="btn sm" data-action="lf-tab" data-tab="buscar">Ver</button></div></div>` : ''}
    ${L.auto ? `<div class="card"><div class="item"><div class="lf-loading">Analisando os sites dos novos leads (${L.auto.done}/${L.auto.total})…</div><button class="btn sm" data-action="lf-auto-stop">Parar</button></div></div>` : ''}`;
  const body = L.tab === 'leads' ? vList() : L.tab === 'ajustes' ? vSettings() : L.tab === 'buscar' ? vSearch() : vDash();
  return head(`<button class="btn" data-action="lf-new">+ Lead manual</button>`) + tabsHTML() + `<div class="stack lf-banner">${banner}</div>` + body;
}

/* ---------- painel ---------- */
function barsSVG(buckets) {
  const W = 640, H = 200, padB = 26, padT = 16;
  const max = Math.max(1, ...buckets.map((b) => Math.max(b.a, b.b)));
  const bw = W / buckets.length;
  const h = (v) => ((H - padB - padT) * v) / max;
  const every = Math.ceil(buckets.length / 7);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Leads encontrados e contatados por período" style="width:100%;height:auto;display:block">
    <line x1="0" y1="${H - padB}" x2="${W}" y2="${H - padB}" stroke="rgba(255,255,255,.14)"/>
    ${buckets.map((b, i) => {
      const x = i * bw, w = Math.max(2, bw * 0.34);
      return `<g><title>${C.esc(b.label)}: ${b.a} encontrados, ${b.b} contatados</title>
        <rect x="${(x + bw * 0.14).toFixed(1)}" y="${(H - padB - h(b.a)).toFixed(1)}" width="${w.toFixed(1)}" height="${h(b.a).toFixed(1)}" rx="3" style="fill:var(--accent)"/>
        <rect x="${(x + bw * 0.52).toFixed(1)}" y="${(H - padB - h(b.b)).toFixed(1)}" width="${w.toFixed(1)}" height="${h(b.b).toFixed(1)}" rx="3" style="fill:var(--gold)"/>
        ${i % every === 0 ? `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="11" style="fill:var(--muted)">${C.esc(b.short)}</text>` : ''}</g>`;
    }).join('')}
    <text x="4" y="12" font-size="11" style="fill:var(--muted)">máx. ${max}</text></svg>`;
}
function buildBuckets(days) {
  const out = [], now = new Date(); now.setHours(0, 0, 0, 0);
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (days && days <= 30) {
    for (let i = days - 1; i >= 0; i--) { const d = new Date(now); d.setDate(d.getDate() - i); out.push({ from: key(d), to: key(d), label: d.toLocaleDateString('pt-BR'), short: `${d.getDate()}/${d.getMonth() + 1}` }); }
  } else if (days) {
    for (let i = 12; i >= 0; i--) { const e = new Date(now); e.setDate(e.getDate() - i * 7); const s = new Date(e); s.setDate(s.getDate() - 6); out.push({ from: key(s), to: key(e), label: `${s.toLocaleDateString('pt-BR')} a ${e.toLocaleDateString('pt-BR')}`, short: `${e.getDate()}/${e.getMonth() + 1}` }); }
  } else {
    for (let i = 11; i >= 0; i--) { const s = new Date(now.getFullYear(), now.getMonth() - i, 1), e = new Date(now.getFullYear(), now.getMonth() - i + 1, 0); out.push({ from: key(s), to: key(e), label: s.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }), short: s.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '') }); }
  }
  const local = (ts) => (ts ? key(new Date(ts)) : null);
  for (const b of out) { b.a = 0; b.b = 0; }
  for (const c of L.companies) {
    const a = local(c.created_at), k = local(c.last_contact_at);
    for (const b of out) { if (a >= b.from && a <= b.to) b.a++; if (k && k >= b.from && k <= b.to) b.b++; }
  }
  return out;
}
function vDash() {
  const days = Number(L.period);
  const since = days ? new Date(Date.now() - days * 86400000).toISOString() : '';
  const rows = L.companies.filter((c) => !since || c.created_at >= since);
  const n = (f) => rows.filter(f).length;
  const contacted = n((c) => !!c.last_contact_at || CONTACTED.includes(c.status));
  const sales = n((c) => c.status === 'venda_concluida');
  const stats = [
    ['Encontrados', rows.length], ['Novos', n((c) => c.status === 'novo')],
    ['Qualificados', n((c) => !CLOSED.includes(c.status) && (c.status === 'pronto_contato' || scoreOf(c).score >= 60))],
    ['Contatados', contacted], ['Responderam', n((c) => REPLIED.includes(c.status))],
    ['Em negociação', n((c) => ['negociacao', 'proposta_enviada'].includes(c.status))], ['Vendas', sales],
  ];
  const conv = contacted ? `${((sales / contacted) * 100).toFixed(1).replace('.', ',')}%` : '—';
  const pipeline = rows.filter((c) => ['negociacao', 'proposta_enviada'].includes(c.status)).reduce((s, c) => s + Number(c.estimated_value || 0), 0);
  const t = today10();
  const follow = L.companies.filter((c) => c.next_action_at && c.next_action_at <= t && !CLOSED.includes(c.status)).sort((a, b) => a.next_action_at.localeCompare(b.next_action_at));
  const maxS = Math.max(1, ...STATUS.map(([k]) => n((c) => c.status === k)));
  if (!L.companies.length) return '<div class="empty">Ainda não há leads. Comece em “Buscar” ou cadastre um lead manual. Os indicadores aparecem aqui com os dados reais.</div>';
  return `<div class="row between"><span class="muted small">Leads encontrados no período, com o status atual de cada um.</span>
    <div class="tabs" style="margin:0">${PERIODS.map(([k, name]) => `<button class="tab ${L.period === k ? 'on' : ''}" data-action="lf-period" data-p="${k}">${name}</button>`).join('')}</div></div>
  <div class="grid g4" style="margin-top:12px">${stats.map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v" data-count="${v}">${v}</div></div>`).join('')}
    <div class="stat"><div class="k">Taxa de conversão</div><div class="v">${conv}</div><div class="muted small">vendas ÷ contatados</div></div></div>
  <p class="muted small">Qualificados: Lead Score de 60 ou mais, ou status “Pronto para contato”.${pipeline ? ` Valor estimado em negociação: <b>${C.brl(pipeline)}</b>.` : ''}</p>
  ${follow.length ? `<div class="section"><h2>Acompanhamentos pendentes</h2></div><div class="stack">${follow.slice(0, 8).map((c) => `<a class="card" href="#/leads/${c.id}"><div class="item"><div><div class="t">${C.esc(c.name)}</div><div class="muted small">${C.esc(c.next_action || 'Próxima ação')} · ${C.fmtDate(c.next_action_at)}</div></div><span class="badge ${c.next_action_at < t ? 'bad' : 'mid'}">${c.next_action_at < t ? 'Atrasado' : 'Hoje'}</span></div></a>`).join('')}${follow.length > 8 ? `<p class="muted small">e mais ${follow.length - 8}. Ordene a lista por “Próxima ação”.</p>` : ''}</div>` : ''}
  <div class="lf-cols" style="margin-top:14px">
    <div class="card"><div class="eyebrow">Evolução</div>${barsSVG(buildBuckets(days))}<div class="legend"><span><i></i>Encontrados</span><span><i class="e"></i>Contatados (data do último contato)</span></div></div>
    <div class="card"><div class="eyebrow">Funil por status</div><div class="lf-funnel">${STATUS.map(([k, name]) => { const v = n((c) => c.status === k); return `<div><span>${name}</span><div class="lf-bar"><i style="width:${(v / maxS) * 100}%"></i></div><b>${v}</b></div>`; }).join('')}</div></div>
  </div>`;
}

/* ---------- buscar ---------- */
function vSearch() {
  const f = L.form || { country: 'Brasil', state: 'SP', city: '', neighborhood: '', radius_km: '2', segment: 'restaurantes', term: '', presence: 'sem_site', limit: '25' };
  const res = L.lastResult;
  const sched = L.tasks.filter((t) => t.kind === 'pesquisa_agendada' && t.status !== 'cancelada');
  return `<div class="lf-cols">
  <form class="panel stack" data-form="lf-search">
    <h2 style="margin:0">Nova pesquisa</h2>
    <div class="two"><label>País<input name="country" value="${C.esc(f.country)}" maxlength="60"></label><label>Estado<input name="state" value="${C.esc(f.state)}" maxlength="60" placeholder="SP"></label></div>
    <div class="two"><label>Cidade*<input name="city" required minlength="2" maxlength="80" value="${C.esc(f.city)}" placeholder="São Paulo"></label><label>Bairro<input name="neighborhood" maxlength="80" value="${C.esc(f.neighborhood)}" placeholder="Recomendado"></label></div>
    <div class="two"><label>Raio<select name="radius_km">${opt([['1', '1 km do centro do local'], ['2', '2 km'], ['5', '5 km'], ['10', '10 km'], ['0', 'Área inteira (lento em cidade grande)']], String(f.radius_km))}</select></label>
      <label>Quantidade<select name="limit">${opt([['10', '10'], ['25', '25'], ['50', '50'], ['100', '100']], String(f.limit))}</select></label></div>
    <label>Segmento<select name="segment">${opt(SEGMENTS, f.segment)}</select></label>
    <label>Termo personalizado <span class="muted">(usado em “Outro”: ex. doceria, pet shop)</span><input name="term" maxlength="40" value="${C.esc(f.term)}"></label>
    <label>Presença digital<select name="presence">${opt([['sem_site', 'Sem site cadastrado na fonte'], ['com_site', 'Com site informado'], ['todas', 'Todas as empresas']], f.presence)}</select></label>
    <button class="btn primary block" ${L.searching ? 'disabled' : ''}>${L.searching ? 'Pesquisando…' : 'Pesquisar empresas'}</button>
    <button type="button" class="btn block" data-action="lf-schedule">Agendar esta pesquisa</button>
    <p class="muted small" style="margin:0">Fonte gratuita: OpenStreetMap. Dados © colaboradores do OpenStreetMap (ODbL). Nem toda empresa tem telefone ou site cadastrados lá; “sem site” significa que a fonte não informa um, não que ele não exista. Com bairro + raio a busca é bem mais rápida.</p>
  </form>
  <div class="stack">
    ${L.searching ? `<div class="card"><div class="lf-loading" id="lf-step">${C.esc(L.step || 'Pesquisando…')}</div><div class="muted small">Pode levar até 2 minutos quando a fonte gratuita está cheia.</div><div class="row" style="margin-top:10px"><button type="button" class="btn sm" data-action="lf-cancel">Cancelar pesquisa</button></div></div>` : ''}
    ${L.searchError ? `<div class="card alert bad"><div class="t">A pesquisa não foi concluída</div><div class="muted small">${C.esc(L.searchError)}</div></div>` : ''}
    ${res ? `<div class="card"><div class="t">${res.found ? `${res.found} empresa${res.found === 1 ? '' : 's'} encontrada${res.found === 1 ? '' : 's'}` : 'Nenhuma empresa encontrada com esses filtros'}</div>
      <div class="muted small">${C.esc(res.area || '')}</div>
      ${res.found ? `<div class="row" style="margin-top:10px"><span class="badge ok">${res.new_count} nova${res.new_count === 1 ? '' : 's'}</span><span class="badge">${res.dup_count} já na sua lista</span></div>
      <div class="row" style="margin-top:12px"><button class="btn sm primary" data-action="lf-see-search" data-id="${res.search_id}">Ver leads</button></div>` : '<p class="muted small">Tente outro segmento, aumente o raio ou escolha “Todas as empresas”.</p>'}</div>` : ''}
    ${sched.length ? `<div class="section" style="margin-top:6px"><h2>Pesquisas agendadas</h2></div><p class="muted small">Rodam quando você abre a Central e toca em Executar: a fonte gratuita só aceita consultas feitas pelo seu navegador.</p>${sched.map(taskCard).join('')}` : ''}
    <div class="section" style="margin-top:6px"><h2>Histórico de pesquisas</h2></div>
    ${L.searches.length ? L.searches.map(searchCard).join('') : '<div class="empty">Nenhuma pesquisa ainda.</div>'}
  </div></div>`;
}
const paramsLabel = (p = {}) => `${p.segment === 'outro' ? `“${p.term || ''}”` : SEG_NAME[p.segment] || p.segment || ''} · ${[p.neighborhood, p.city, p.state].filter(Boolean).join(', ')}${p.radius_km ? ` · ${p.radius_km} km` : ''}`;
function taskCard(t) {
  const due = t.status === 'pendente' && t.due_at <= new Date().toISOString();
  const every = Object.fromEntries(EVERY)[String(t.payload?.every_days)] || `A cada ${t.payload?.every_days} dias`;
  return `<div class="card ${due ? 'alert' : ''}"><div class="item"><div><div class="t">${C.esc(paramsLabel(t.payload?.params))}</div>
    <div class="muted small">${every} · ${t.status === 'pausada' ? 'pausada' : due ? 'pronta para executar' : `próxima em ${C.fmtDate(t.due_at)}`}${t.payload?.last_run ? ` · última: ${C.fmtTs(t.payload.last_run)} (${t.payload.last_new ?? 0} novas)` : ''}</div></div>
    <span class="badge ${t.status === 'pausada' ? '' : due ? 'mid' : 'ok'}">${t.status === 'pausada' ? 'Pausada' : due ? 'Hoje' : 'Agendada'}</span></div>
    <div class="row" style="margin-top:10px">${t.status === 'pendente' ? `<button class="btn sm primary" data-action="lf-task-run" data-id="${t.id}" ${L.searching ? 'disabled' : ''}>Executar agora</button><button class="btn sm" data-action="lf-task-toggle" data-id="${t.id}">Pausar</button>` : `<button class="btn sm" data-action="lf-task-toggle" data-id="${t.id}">Retomar</button>`}
    <button class="btn sm danger" data-action="lf-task-del" data-id="${t.id}">Cancelar agendamento</button></div></div>`;
}
function searchCard(s) {
  const stale = s.status === 'executando' && Date.now() - new Date(s.created_at).getTime() > 300000;
  const st = s.status === 'ok' ? `<span class="badge ok">${s.found} encontradas · ${s.new_count} novas</span>` : s.status === 'erro' ? '<span class="badge bad">Erro</span>'
    : `<span class="badge mid">${s.status === 'cancelada' ? 'Cancelada' : stale ? 'Interrompida' : 'Em andamento'}</span>`;
  return `<div class="card"><div class="item"><div><div class="t">${C.esc(paramsLabel(s.params))}</div><div class="muted small">${C.fmtTs(s.created_at)} · ${ORIGIN[s.provider] || C.esc(s.provider)}</div>${s.error ? `<div class="small neg">${C.esc(s.error)}</div>` : ''}</div>${st}</div>
    <div class="row" style="margin-top:10px"><button class="btn sm" data-action="lf-repeat" data-id="${s.id}">Usar estes filtros</button>${s.status === 'ok' && s.new_count ? `<button class="btn sm" data-action="lf-see-search" data-id="${s.id}">Ver leads novos</button>` : ''}</div></div>`;
}

/* ---------- lista ---------- */
function filtered() {
  const q = normName(L.q), qd = L.q.replace(/\D/g, '');
  const rows = L.companies.map((c) => ({ c, s: scoreOf(c).score })).filter(({ c, s }) =>
    (!L.fStatus || c.status === L.fStatus) && (!L.fSeg || c.segment === L.fSeg) && (!L.fSite || c.site_status === L.fSite) &&
    (!L.fSearch || c.first_search_id === L.fSearch) && (!L.fPrio || priorityOf(s)[0] === L.fPrio) &&
    (!q || c.name_norm.includes(q) || normName(place(c)).includes(q) || (qd.length >= 4 && String(c.phone_norm || '').includes(qd))));
  const by = {
    recentes: (a, b) => (a.c.created_at < b.c.created_at ? 1 : -1),
    atualizados: (a, b) => (a.c.updated_at < b.c.updated_at ? 1 : -1),
    nome: (a, b) => a.c.name.localeCompare(b.c.name, 'pt-BR'),
    pontuacao: (a, b) => b.s - a.s,
    proxima: (a, b) => String(a.c.next_action_at || '9999').localeCompare(String(b.c.next_action_at || '9999')),
  };
  return rows.sort(by[L.sort] || by.recentes);
}
function vList() {
  const all = L.companies;
  const rows = filtered();
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  if (L.page > pages) L.page = pages;
  if (L.page < 1) L.page = 1;
  const slice = rows.slice((L.page - 1) * PAGE, L.page * PAGE);
  const today = today10();
  const anyFilter = L.q || L.fStatus || L.fSeg || L.fSite || L.fPrio || L.fSearch;
  return `<form class="card lf-filters" data-form="lf-filter">
    <label>Buscar<input name="q" type="search" value="${C.esc(L.q)}" placeholder="Nome, bairro ou telefone"></label>
    <label>Status<select name="fStatus" data-action-change="lf-filter">${opt(STATUS, L.fStatus, 'Todos')}</select></label>
    <label>Prioridade<select name="fPrio" data-action-change="lf-filter">${opt([['Muito alta', 'Muito alta (80+)'], ['Alta', 'Alta (60–79)'], ['Média', 'Média (40–59)'], ['Baixa', 'Baixa (0–39)']], L.fPrio, 'Todas')}</select></label>
    <label>Segmento<select name="fSeg" data-action-change="lf-filter">${opt(SEG_SHORT, L.fSeg, 'Todos')}</select></label>
    <label>Site<select name="fSite" data-action-change="lf-filter">${opt(Object.entries(SITE), L.fSite, 'Todos')}</select></label>
    <label>Ordenar<select name="sort" data-action-change="lf-filter">${opt([['recentes', 'Mais recentes'], ['pontuacao', 'Maior pontuação'], ['proxima', 'Próxima ação'], ['atualizados', 'Última atualização'], ['nome', 'Nome']], L.sort)}</select></label>
    <div class="row"><button class="btn sm primary">Aplicar</button>${anyFilter ? '<button type="button" class="btn sm" data-action="lf-clear">Limpar filtros</button>' : ''}${rows.length ? '<button type="button" class="btn sm" data-action="lf-csv">Exportar CSV</button>' : ''}</div>
  </form>
  ${L.fSearch ? '<p class="muted small">Mostrando só as empresas novas da pesquisa selecionada.</p>' : ''}
  ${!all.length ? '<div class="empty" style="margin-top:12px">Nenhum lead ainda. Faça uma pesquisa em “Buscar” ou cadastre um lead manual.</div>'
    : !rows.length ? '<div class="empty" style="margin-top:12px">Nenhum lead com esses filtros.</div>'
    : `<div class="lf-tablewrap"><table class="lf-table"><thead><tr><th>Empresa</th><th>Local</th><th>Telefone</th><th>Site</th><th>Origem</th><th>Prioridade</th><th>Status</th><th>Atualizado</th><th></th></tr></thead><tbody>
    ${slice.map(({ c, s }) => {
      const late = c.next_action_at && c.next_action_at <= today && !CLOSED.includes(c.status);
      return `<tr>
      <td data-l="Empresa"><a class="t" href="#/leads/${c.id}">${C.esc(c.name)}</a><div class="muted small">${C.esc(SEG_NAME[c.segment] || c.segment)}${late ? ' · <span class="warn">ação pendente</span>' : ''}</div></td>
      <td data-l="Local">${C.esc(place(c)) || '—'}</td>
      <td data-l="Telefone">${c.phone_norm ? C.esc(fmtPhone(c.phone_norm)) : '—'}</td>
      <td data-l="Site">${c.website ? `<a href="${C.esc(C.safeUrl(c.website))}" target="_blank" rel="noopener noreferrer nofollow">${C.esc(c.domain_norm || 'abrir')}</a>` : `<span class="muted small">${c.site_confirmed === 'sem_site' ? 'Sem site (confirmado por você)' : SITE[c.site_status]}</span>`}</td>
      <td data-l="Origem">${ORIGIN[c.origin] || C.esc(c.origin)}</td>
      <td data-l="Prioridade"><b>${s}</b> ${prioBadge(s)}</td>
      <td data-l="Status">${statusBadge(c.status)}</td>
      <td data-l="Atualizado">${C.fmtTs(c.updated_at)}</td>
      <td class="right"><a class="btn sm" href="#/leads/${c.id}">Abrir</a></td></tr>`;
    }).join('')}</tbody></table></div>
    <div class="row between" style="margin-top:12px"><span class="muted small">${rows.length} lead${rows.length === 1 ? '' : 's'} · página ${L.page} de ${pages}</span>
      <div class="row"><button class="btn sm" data-action="lf-page" data-d="-1" ${L.page <= 1 ? 'disabled' : ''}>← Anterior</button><button class="btn sm" data-action="lf-page" data-d="1" ${L.page >= pages ? 'disabled' : ''}>Próxima →</button></div></div>`}`;
}

/* ---------- ficha ---------- */
function eventCard(e) {
  let text = C.esc(e.body || '');
  if (e.kind === 'status') text = `${STATUS_NAME[e.meta?.de] || '—'} → <b>${STATUS_NAME[e.meta?.para] || '—'}</b>${e.meta?.motivo && e.meta?.para === 'perdido' ? `<div class="muted small">Motivo: ${C.esc(e.meta.motivo)}</div>` : ''}`;
  if (e.kind === 'alteracao') {
    const f = e.meta?.campo;
    if (f === 'next_action') text = `Próxima ação: ${C.esc(e.meta?.para || '—')}${e.meta?.data ? ` (${C.fmtDate(e.meta.data)})` : ''}`;
    else if (f === 'estimated_value') text = `Valor estimado: ${e.meta?.para == null ? '—' : C.brl(e.meta.para)}`;
    else text = `${FIELD[f] || C.esc(f)}: ${C.esc(e.meta?.de ?? '—')} → ${C.esc(e.meta?.para ?? '—')}`;
  }
  const manual = ['nota', 'contato', 'resposta'].includes(e.kind);
  return `<div class="card"><div class="item"><div><div class="eyebrow">${EVENT_KIND[e.kind] || ''}</div><div style="white-space:pre-wrap">${text}</div><div class="muted small">${C.fmtTs(e.happened_at)}</div></div>
    ${manual ? `<button class="btn sm danger" data-action="lf-del-event" data-id="${e.id}" data-company="${e.company_id}">Remover</button>` : ''}</div></div>`;
}
const findList = (title, ids, cls) => (ids?.length ? `<div class="lf-find ${cls}"><div class="eyebrow">${title}</div><ul>${ids.map((id) => `<li>${C.esc(FINDINGS[id]?.t || id)}</li>`).join('')}</ul></div>` : '');
function siteCard(c) {
  const id = c.id, a = c.site_analysis, busy = L.analyzing.has(id);
  if (!hasOwnSite(c)) {
    return `<div class="card"><div class="eyebrow">Site</div>
      ${c.site_confirmed === 'sem_site' ? '<p style="margin:4px 0">Você confirmou que esta empresa <b>não tem site próprio</b>.</p>' : `<p style="margin:4px 0">${SITE[c.site_status]}. Isso não garante que a empresa não tenha site: procure no Google ou no Instagram dela e confirme.</p>`}
      <div class="row" style="margin-top:10px">${c.site_confirmed === 'sem_site' ? `<button class="btn sm" data-action="lf-confirm" data-id="${id}" data-v="">Desfazer confirmação</button>` : `<button class="btn sm primary" data-action="lf-confirm" data-id="${id}" data-v="sem_site">Confirmei: não tem site</button>`}
      <button class="btn sm" data-action="lf-edit" data-id="${id}">Tem site: informar</button>
      <a class="btn sm" href="https://www.google.com/search?q=${encodeURIComponent(`${c.name} ${c.city || ''}`)}" target="_blank" rel="noopener noreferrer">Procurar no Google</a></div></div>`;
  }
  const full = L.analysis[id]?.result?.checks;
  const broken = full?.links_quebrados || [];
  return `<div class="card"><div class="eyebrow">Análise do site</div>
    ${!a ? '<p class="muted" style="margin:4px 0">Ainda não analisado.</p>' : `<div class="row" style="margin:4px 0 8px"><span class="badge ${a.status === 'ok' ? 'ok' : a.status === 'fora_do_ar' ? 'bad' : 'mid'}">${ANALYSIS_STATUS[a.status] || C.esc(a.status)}</span><span class="muted small">verificado em ${C.fmtTs(a.checked_at)}</span></div>
      ${a.status === 'ok' ? `<div class="muted small">${a.tempo_ms != null ? `Resposta em ${a.tempo_ms} ms` : ''}${a.perf != null ? ` · desempenho no celular ${a.perf}/100` : ''}${a.seo != null ? ` · SEO ${a.seo}/100` : ''}${a.lcp ? ` · LCP ${C.esc(a.lcp)}` : ''}</div>` : ''}
      ${findList('Problemas comprovados', a.problems, 'bad')}
      ${broken.length ? `<div class="muted small">Links com erro: ${broken.slice(0, 4).map((b) => `${C.esc(b.url)} (${C.esc(b.status)})`).join('; ')}</div>` : ''}
      ${a.status === 'ok' && !a.problems?.length ? '<p class="small" style="margin:8px 0 0">Nenhum problema comprovado nos itens verificados.</p>' : ''}
      ${findList('Sugestões (não são defeitos comprovados)', a.suggestions, 'mid')}
      ${findList('Não foi possível verificar', a.unknown, '')}`}
    <div class="row" style="margin-top:12px"><button class="btn sm primary" data-action="lf-analyze" data-id="${id}" ${busy ? 'disabled' : ''}>${busy ? 'Analisando… (até 1 minuto)' : a ? 'Analisar de novo' : 'Analisar site'}</button></div>
    <p class="muted small" style="margin:10px 0 0">Verifica só a página inicial e até 8 links internos: disponibilidade, HTTPS, adaptação ao celular, título e descrição, links quebrados e desempenho (PageSpeed).</p></div>`;
}
function scoreCard(c) {
  const s = scoreOf(c), label = Object.fromEntries(CRITERIA);
  return `<div class="card"><div class="item"><div><div class="eyebrow">Lead Score</div><div class="lf-score">${s.score}<small>/100</small></div></div>
    <div class="right">${prioBadge(s.score)}<div class="muted small" style="margin-top:6px">confiança ${s.confidence}</div></div></div>
    <div class="lf-parts">${s.parts.map((p) => `<div><div class="row between"><span>${label[p.key]}</span><b>${p.pts}/${p.max}</b></div><div class="lf-bar"><i style="width:${p.max ? (p.pts / p.max) * 100 : 0}%"></i></div><div class="muted small">${C.esc(p.why)}${p.conf === 'baixa' || p.conf === 'nenhuma' ? ` <span class="warn">(${p.conf === 'baixa' ? 'confiança baixa' : 'não verificado'})</span>` : ''}</div></div>`).join('')}</div></div>`;
}
function messageCard(c, blocked) {
  const service = L.msgService[c.id] || defaultService(c);
  const f = factsFor(c);
  const text = buildMessage(c, { tone: L.msgTone, service, sender: senderName() });
  const facts = f.problems.length ? `Cita problemas comprovados pela análise: ${f.problems.slice(0, 2).map((id) => FINDINGS[id].m).join('; ')}.`
    : f.noSiteConfirmed ? 'Cita que você não encontrou site (confirmado por você).'
    : !f.hasSite ? 'A fonte não informa site, então a mensagem pergunta em vez de afirmar.'
    : c.site_analysis ? 'A análise não comprovou problemas: a mensagem não cita nenhum.' : 'Site ainda não analisado: a mensagem não cita problemas.';
  const wa = !blocked && isMobile(c.phone_norm);
  return `<div class="card stack"><div class="eyebrow">Mensagem</div>
    <div class="tabs" style="margin:0">${TONES.map(([k, n]) => `<button class="tab ${L.msgTone === k ? 'on' : ''}" data-action="lf-tone" data-t="${k}">${n}</button>`).join('')}</div>
    <div class="two"><label>Serviço oferecido<select data-action-change="lf-service" data-id="${c.id}">${opt(SERVICES, service)}</select></label>
    <label>Seu nome na mensagem<input data-action-change="lf-sender" maxlength="80" value="${C.esc(senderName())}" placeholder="Opcional"></label></div>
    <textarea id="lf-msg" rows="7" maxlength="1500" aria-label="Mensagem">${C.esc(text)}</textarea>
    <div class="muted small">${C.esc(facts)} Você pode editar o texto antes de enviar.</div>
    <div class="row"><button class="btn sm" data-action="lf-copy-msg">Copiar</button>
      ${wa ? `<button class="btn sm primary" data-action="lf-wa" data-id="${c.id}">Abrir WhatsApp com o texto</button>` : ''}
      ${blocked ? '' : `<button class="btn sm" data-action="lf-sent" data-id="${c.id}">Registrar envio</button>`}</div>
    ${blocked ? '<div class="small neg">Empresa marcada como “Não contatar”.</div>' : !wa ? `<div class="muted small">${c.phone_norm ? 'O número público é fixo: o atalho do WhatsApp só aparece para celular.' : 'Sem telefone público: copie a mensagem e envie por outro canal.'}</div>` : '<div class="muted small">Nada é enviado sozinho: o WhatsApp abre com o texto e você decide enviar.</div>'}</div>`;
}
function vLead(id) {
  const c = leadOf(id);
  if (!c) return `<div class="empty">Lead não encontrado. <a href="#/leads">Voltar</a></div>`;
  if (!L.events[id]) loadDetail(id);
  const ev = L.events[id], src = L.sources[id] || [];
  const blocked = c.status === 'nao_contatar';
  const map = c.lat != null ? `https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lon}#map=18/${c.lat}/${c.lon}` : '';
  return `<div class="page-h"><div><a class="small" href="#/leads">← Leads</a><h1>${C.esc(c.name)}</h1><div class="muted">${C.esc(SEG_NAME[c.segment] || c.segment)}${c.category ? ' · ' + C.esc(c.category) : ''}</div></div>
    <div class="row"><button class="btn sm" data-action="lf-edit" data-id="${id}">Editar</button></div></div>
  ${blocked ? '<div class="card alert bad"><div class="t">Marcada como “Não contatar”</div><div class="muted small">Os atalhos de contato ficam desativados para esta empresa.</div></div>' : ''}
  <div class="lf-cols" style="margin-top:12px">
  <div class="stack">
    <div class="card"><dl class="kv" style="margin:0">
      <dt>Status</dt><dd><select data-action-change="lf-status" data-id="${id}" aria-label="Status comercial" style="margin:0">${opt(STATUS, c.status)}</select></dd>
      <dt>Telefone</dt><dd>${c.phone_norm ? `${C.esc(fmtPhone(c.phone_norm))} <span class="muted small">(público)</span>` : '<span class="muted">não informado na fonte</span>'}</dd>
      <dt>Site</dt><dd>${c.website ? `<a href="${C.esc(C.safeUrl(c.website))}" target="_blank" rel="noopener noreferrer nofollow">${C.esc(c.website)}</a>` : `<span class="muted">${c.site_confirmed === 'sem_site' ? 'Sem site (confirmado por você)' : SITE[c.site_status]}</span>`}</dd>
      ${c.instagram ? `<dt>Instagram</dt><dd>${C.esc(c.instagram)}</dd>` : ''}${c.facebook ? `<dt>Facebook</dt><dd>${C.esc(c.facebook)}</dd>` : ''}
      <dt>Endereço</dt><dd>${C.esc([c.address, c.city, c.state, c.postcode].filter(Boolean).join(', ')) || '<span class="muted">não informado</span>'}</dd>
      <dt>Valor estimado</dt><dd>${c.estimated_value == null ? '—' : C.brl(c.estimated_value)}</dd>
      <dt>Próxima ação</dt><dd>${c.next_action ? C.esc(c.next_action) : '—'}${c.next_action_at ? ` · ${C.fmtDate(c.next_action_at)}` : ''}</dd>
      ${c.status === 'perdido' && c.lost_reason ? `<dt>Motivo da perda</dt><dd>${C.esc(c.lost_reason)}</dd>` : ''}
      <dt>Último contato</dt><dd>${c.last_contact_at ? C.fmtTs(c.last_contact_at) : '—'}</dd>
      <dt>Atualizado</dt><dd>${C.fmtTs(c.updated_at)}</dd></dl>
      <div class="row" style="margin-top:14px">
        ${!blocked && c.phone_norm ? `<a class="btn sm" href="tel:+55${C.esc(c.phone_norm)}">Ligar</a>` : ''}
        ${map ? `<a class="btn sm" href="${C.esc(map)}" target="_blank" rel="noopener noreferrer">Ver no mapa</a>` : ''}
        <button class="btn sm" data-action="lf-next" data-id="${id}">Próxima ação / lembrete</button>
      </div></div>
    ${scoreCard(c)}
    ${siteCard(c)}
    <div class="card"><div class="eyebrow">Origem dos dados</div>
      ${src.length ? src.map((s) => `<div class="small">${ORIGIN[s.provider] || C.esc(s.provider)}${s.source_url ? ` · <a href="${C.esc(C.safeUrl(s.source_url))}" target="_blank" rel="noopener noreferrer">registro na fonte</a>` : ''} · consultado em ${C.fmtTs(s.fetched_at)}</div>`).join('') : `<div class="small">${ORIGIN[c.origin] || C.esc(c.origin)}</div>`}
      ${c.origin === 'osm' ? '<div class="muted small" style="margin-top:6px">© colaboradores do OpenStreetMap (ODbL). Dados públicos de estabelecimentos comerciais.</div>' : ''}
      <div class="row" style="margin-top:12px">
        ${blocked ? '' : `<button class="btn sm" data-action="lf-block" data-id="${id}">Não contatar</button>`}
        <button class="btn sm danger" data-action="lf-del" data-id="${id}">Excluir lead</button></div></div>
  </div>
  <div class="stack">
    ${messageCard(c, blocked)}
    <form class="card stack" data-form="lf-event"><input type="hidden" name="company_id" value="${id}">
      <div class="eyebrow">Registrar no histórico</div>
      <div class="two"><label>Tipo<select name="kind">${opt([['nota', 'Anotação'], ['contato', 'Contato feito'], ['resposta', 'Resposta recebida']], 'nota')}</select></label>
      <label>Data<input name="date" type="date" value="${today10()}" max="${today10()}"></label></div>
      <label>Texto<textarea name="body" maxlength="4000" required placeholder="O que aconteceu?"></textarea></label>
      <button class="btn primary">Registrar</button></form>
    <div class="section" style="margin-top:6px"><h2>Histórico de prospecção</h2></div>
    ${!ev ? '<div class="empty lf-loading">Carregando histórico…</div>' : ev.length ? ev.map(eventCard).join('') : '<div class="empty">Sem registros ainda.</div>'}
    <div class="card"><div class="muted small">Lead criado em ${C.fmtTs(c.created_at)}</div></div>
  </div></div>`;
}

function formLead(c = {}) {
  return `<form data-form="lf-lead" class="stack"><input type="hidden" name="id" value="${C.esc(c.id || '')}">
    <label>Nome da empresa*<input name="name" required maxlength="160" value="${C.esc(c.name || '')}"></label>
    <label>Segmento<select name="segment">${opt(SEG_SHORT, c.segment || 'outro')}</select></label>
    <div class="two"><label>Telefone comercial<input name="phone" inputmode="tel" maxlength="40" value="${C.esc(c.phone_norm ? fmtPhone(c.phone_norm) : '')}"></label>
    <label>Site<input name="website" maxlength="300" value="${C.esc(c.website || '')}" placeholder="exemplo.com.br"></label></div>
    <label>Instagram<input name="instagram" maxlength="200" value="${C.esc(c.instagram || '')}"></label>
    <label>Endereço<input name="address" maxlength="240" value="${C.esc(c.address || '')}"></label>
    <div class="two"><label>Bairro<input name="neighborhood" maxlength="100" value="${C.esc(c.neighborhood || '')}"></label><label>Cidade<input name="city" maxlength="100" value="${C.esc(c.city || '')}"></label></div>
    ${c.id ? `<label>Valor estimado da proposta (R$)<input name="estimated_value" inputmode="decimal" value="${c.estimated_value ?? ''}"></label>` : ''}
    <button class="btn primary block">${c.id ? 'Salvar' : 'Adicionar lead'}</button></form>`;
}

/* ---------- ajustes ---------- */
function vSettings() {
  const s = L.settings || {};
  const W = { ...DEFAULT_WEIGHTS, ...(s.score_weights || {}) };
  const total = Object.values(W).reduce((a, b) => a + Number(b || 0), 0);
  const byProv = {};
  for (const u of L.usage) { byProv[u.provider] ||= { month: 0, today: 0 }; byProv[u.provider].month += u.calls; if (u.day === today10()) byProv[u.provider].today += u.calls; }
  return `<div class="lf-cols">
  <form class="panel stack" data-form="lf-settings">
    <h2 style="margin:0">Ajustes do Lead Finder</h2>
    <label>Seu nome nas mensagens<input name="sender_name" maxlength="80" value="${C.esc(senderName())}"></label>
    <div class="two"><label>Pesquisas por hora (máx.)<input name="max_searches_per_hour" type="number" min="1" max="30" required value="${s.max_searches_per_hour ?? 10}"></label>
    <label>Análises de site por hora (máx.)<input name="max_analyses_per_hour" type="number" min="1" max="60" required value="${s.max_analyses_per_hour ?? 30}"></label></div>
    <label class="check"><input type="checkbox" name="auto_analyze" ${s.auto_analyze === false ? '' : 'checked'}> Analisar automaticamente o site dos novos leads (até 5 por pesquisa)</label>
    <div class="eyebrow" style="margin-top:8px">Pesos do Lead Score</div>
    ${CRITERIA.map(([k, n]) => `<label>${n}<input name="w_${k}" type="number" min="0" max="100" required value="${W[k]}"></label>`).join('')}
    <p class="muted small" style="margin:0">Soma atual: ${total}. Se a soma não for 100, a pontuação é ajustada proporcionalmente para a escala 0–100.</p>
    <div class="row"><button class="btn primary">Salvar</button><button type="button" class="btn" data-action="lf-weights-reset">Restaurar pesos padrão</button></div>
  </form>
  <div class="stack">
    <div class="card"><div class="eyebrow">Consumo das fontes neste mês</div>
      ${Object.keys(byProv).length ? Object.entries(byProv).map(([p, v]) => `<div class="row between small" style="margin-top:6px"><span>${ORIGIN[p] || C.esc(p)}</span><span>${v.today} hoje · ${v.month} no mês</span></div>`).join('') : '<p class="muted small">Nenhuma consulta registrada neste mês.</p>'}
      <p class="muted small" style="margin:10px 0 0">OpenStreetMap e PageSpeed são gratuitos. Os limites por hora acima valem para você não sobrecarregar as fontes.</p></div>
    <div class="card"><div class="eyebrow">Google Places (opcional)</div><p class="small" style="margin:6px 0 0">Desativado. Exige uma conta de faturamento no Google Cloud (com cartão), mesmo para usar só a franquia gratuita. Nenhuma consulta ao Google Places é feita por este sistema hoje.</p></div>
    <div class="card"><div class="item"><div class="eyebrow">Registro de erros</div>${L.errors.length ? '<button class="btn sm" data-action="lf-errors-clear">Limpar</button>' : ''}</div>
      ${L.errors.length ? L.errors.map((e) => `<div class="small" style="margin-top:8px">${C.esc(e.message)}<div class="muted small">${C.esc(e.scope)} · ${C.fmtTs(e.created_at)}</div></div>`).join('') : '<p class="muted small">Nenhum erro registrado.</p>'}</div>
  </div></div>`;
}

/* ============ ações ============ */
async function setStatus(id, status) {
  const c = leadOf(id);
  if (!c || c.status === status) return;
  const patch = { status };
  if (status === 'perdido') {
    const d = await C.askModal('Motivo da perda', `<form data-form="ask" class="stack"><label>Por que esta venda foi perdida?<textarea name="reason" maxlength="500" required></textarea></label><button class="btn primary block">Salvar</button></form>`);
    if (!d) return C.route();
    patch.lost_reason = String(d.reason || '').trim() || null;
  }
  if (status === 'nao_contatar' && !(await C.confirmModal('Marcar como “Não contatar”? Os atalhos de contato ficam desativados para esta empresa.', 'Marcar'))) return C.route();
  await patchLead(id, patch);
  C.toast('Status atualizado');
  C.route();
}
function download(name, text, type) {
  const file = new File([text], name, { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function exportCsv() {
  // Aspas duplicadas e apóstrofo antes de = + - @ evitam que planilhas executem fórmulas vindas de dados externos.
  const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
  const cols = ['Empresa', 'Segmento', 'Bairro', 'Cidade', 'Estado', 'Telefone', 'Site', 'Situação do site', 'Instagram', 'Origem', 'Pontuação', 'Prioridade', 'Status', 'Valor estimado', 'Próxima ação', 'Data da próxima ação', 'Último contato', 'Criado em', 'Atualizado em'];
  const lines = filtered().map(({ c, s }) => [c.name, SEG_NAME[c.segment] || c.segment, c.neighborhood, c.city, c.state, c.phone_norm ? fmtPhone(c.phone_norm) : '', c.website, c.site_confirmed === 'sem_site' ? 'Sem site (confirmado)' : SITE[c.site_status], c.instagram, ORIGIN[c.origin] || c.origin, s, priorityOf(s)[0], STATUS_NAME[c.status], c.estimated_value ?? '', c.next_action, c.next_action_at, c.last_contact_at ? C.fmtTs(c.last_contact_at) : '', C.fmtTs(c.created_at), C.fmtTs(c.updated_at)].map(cell).join(';'));
  download(`leads-${today10()}.csv`, '﻿' + [cols.map(cell).join(';'), ...lines].join('\r\n'), 'text/csv;charset=utf-8');
  C.toast(`${lines.length} lead(s) exportado(s)`);
}

export const actions = {
  'lf-tab': (el) => { L.tab = el.dataset.tab; C.route(); },
  'lf-period': (el) => { L.period = el.dataset.p; C.route(); },
  'lf-cancel': () => { L.abort?.abort(); },
  'lf-auto-stop': () => { if (L.auto) L.auto.stop = true; C.toast('A análise automática para depois do site atual.'); },
  'lf-reload': () => { L.error = null; C.route(); },
  'lf-page': (el) => { L.page += Number(el.dataset.d); C.route(); },
  'lf-csv': exportCsv,
  'lf-clear': () => { Object.assign(L, { q: '', fStatus: '', fSeg: '', fSite: '', fPrio: '', fSearch: null, page: 1 }); C.route(); },
  'lf-see-search': (el) => { Object.assign(L, { tab: 'leads', q: '', fStatus: '', fSeg: '', fSite: '', fPrio: '', fSearch: el.dataset.id, page: 1, sort: 'recentes' }); C.route(); },
  'lf-repeat': (el) => {
    const s = L.searches.find((x) => x.id === el.dataset.id);
    if (!s) return;
    L.form = { country: 'Brasil', state: '', city: '', neighborhood: '', term: '', ...s.params, radius_km: String(s.params?.radius_km || 0), limit: String(s.params?.limit || 25) };
    L.lastResult = null; L.searchError = null; C.route(); window.scrollTo(0, 0);
  },
  'lf-schedule': async (el) => {
    const p = readParams(Object.fromEntries(new FormData(el.closest('form'))));
    if (L.tasks.filter((t) => t.kind === 'pesquisa_agendada' && t.status !== 'cancelada').length >= 10) throw new Error('Limite de 10 pesquisas agendadas. Cancele alguma antes.');
    const d = await C.askModal('Agendar pesquisa', `<form data-form="ask" class="stack"><p class="muted small">${C.esc(paramsLabel(p))}</p><label>Repetir<select name="every">${opt(EVERY, '7')}</select></label><p class="muted small">Quando chegar o dia, o Lead Finder avisa e você toca em Executar. Ela não roda sozinha com o app fechado.</p><button class="btn primary block">Agendar</button></form>`);
    if (!d) return;
    const every = Number(d.every) || 7;
    const r = await C.sb.from('lf_tasks').insert({ kind: 'pesquisa_agendada', title: paramsLabel(p).slice(0, 200), due_at: new Date(Date.now() + every * 86400000).toISOString(), payload: { params: p, every_days: every } }).select().single();
    if (r.error) throw r.error;
    L.tasks.unshift(r.data); C.toast('Pesquisa agendada'); C.route();
  },
  'lf-task-run': (el) => { const t = L.tasks.find((x) => x.id === el.dataset.id); if (t) return runSearch(readParams(t.payload.params), t); },
  'lf-task-toggle': async (el) => {
    const t = L.tasks.find((x) => x.id === el.dataset.id);
    const r = await C.sb.from('lf_tasks').update({ status: t.status === 'pausada' ? 'pendente' : 'pausada' }).eq('id', t.id).select().single();
    if (r.error) throw r.error;
    Object.assign(t, r.data); C.route();
  },
  'lf-task-del': async (el) => {
    if (!(await C.confirmModal('Cancelar este agendamento? Os leads já encontrados continuam na lista.', 'Cancelar agendamento'))) return;
    const r = await C.sb.from('lf_tasks').delete().eq('id', el.dataset.id);
    if (r.error) throw r.error;
    L.tasks = L.tasks.filter((t) => t.id !== el.dataset.id); C.route();
  },
  'lf-new': () => C.openModal('Lead manual', formLead()),
  'lf-edit': (el) => C.openModal('Editar lead', formLead(leadOf(el.dataset.id))),
  'lf-next': async (el) => {
    const c = leadOf(el.dataset.id);
    const d = await C.askModal('Próxima ação', `<form data-form="ask" class="stack"><label>O que fazer<input name="next_action" maxlength="200" value="${C.esc(c.next_action || '')}" placeholder="Ex.: mandar prévia do site"></label><label>Quando<input name="next_action_at" type="date" value="${C.esc(c.next_action_at || '')}"></label><p class="muted small">Na data, o lead aparece em “Acompanhamentos pendentes” no painel.</p><button class="btn primary block">Salvar</button></form>`);
    if (!d) return;
    await patchLead(c.id, { next_action: C.nn(d.next_action), next_action_at: C.nn(d.next_action_at) });
    C.toast('Próxima ação salva'); C.route();
  },
  'lf-confirm': async (el) => { await patchLead(el.dataset.id, { site_confirmed: el.dataset.v || null }); await syncScore(el.dataset.id); C.route(); },
  'lf-analyze': (el) => analyze(el.dataset.id),
  'lf-tone': (el) => { L.msgTone = el.dataset.t; C.route(); },
  'lf-copy-msg': async () => { await navigator.clipboard.writeText(document.getElementById('lf-msg')?.value || ''); C.toast('Mensagem copiada'); },
  'lf-wa': (el) => {
    const c = leadOf(el.dataset.id);
    if (!c || c.status === 'nao_contatar' || !isMobile(c.phone_norm)) return;
    window.open(C.waLink(c.phone_norm, document.getElementById('lf-msg')?.value || ''), '_blank', 'noopener,noreferrer');
    C.toast('Depois de enviar, toque em “Registrar envio”.');
  },
  'lf-sent': async (el) => {
    const c = leadOf(el.dataset.id);
    const text = (document.getElementById('lf-msg')?.value || '').trim();
    const when = new Date().toISOString();
    await addEvent(c.id, 'contato', `Mensagem enviada:\n${text.slice(0, 1500)}`, when);
    const patch = { last_contact_at: when };
    if (['novo', 'em_analise', 'pronto_contato'].includes(c.status)) patch.status = 'contatado';
    await patchLead(c.id, patch);
    C.toast('Envio registrado'); C.route();
  },
  'lf-block': (el) => setStatus(el.dataset.id, 'nao_contatar'),
  'lf-del': async (el) => {
    if (!(await C.confirmModal('Excluir este lead e todo o histórico dele? Se a empresa pediu para não ser procurada, prefira “Não contatar”: assim ela não volta em novas pesquisas como lead novo.'))) return;
    const r = await C.sb.from('lf_companies').delete().eq('id', el.dataset.id);
    if (r.error) throw r.error;
    L.companies = L.companies.filter((c) => c.id !== el.dataset.id);
    C.toast('Lead excluído'); location.hash = '#/leads';
  },
  'lf-del-event': async (el) => {
    if (!(await C.confirmModal('Remover este registro do histórico?', 'Remover'))) return;
    const r = await C.sb.from('lf_events').delete().eq('id', el.dataset.id);
    if (r.error) throw r.error;
    delete L.events[el.dataset.company]; C.route();
  },
  'lf-weights-reset': async () => { await saveSettings({ score_weights: DEFAULT_WEIGHTS }); C.toast('Pesos restaurados'); C.route(); },
  'lf-errors-clear': async () => {
    const r = await C.sb.from('lf_errors').delete().eq('user_id', C.userId());
    if (r.error) throw r.error;
    L.errors = []; C.route();
  },
};

export function onChange(el) {
  const a = el.dataset.actionChange;
  if (a === 'lf-filter') { L[el.name] = el.value; L.page = 1; C.route(); return true; }
  if (a === 'lf-status') { C.guard(() => setStatus(el.dataset.id, el.value)); return true; }
  if (a === 'lf-service') { L.msgService[el.dataset.id] = el.value; C.route(); return true; }
  if (a === 'lf-sender') { C.guard(async () => { await saveSettings({ sender_name: el.value.trim().slice(0, 80) }); C.route(); }); return true; }
  return false;
}

export const forms = {
  'lf-filter': (f, d) => { Object.assign(L, { q: d.q.trim(), fStatus: d.fStatus, fSeg: d.fSeg, fSite: d.fSite, fPrio: d.fPrio, sort: d.sort, page: 1 }); C.route(); },
  'lf-search': async (f, d) => { L.form = d; await runSearch(readParams(d)); },
  'lf-settings': async (f, d) => {
    const int = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || lo)));
    const w = {};
    for (const [k] of CRITERIA) w[k] = int(d['w_' + k], 0, 100);
    if (!Object.values(w).some((v) => v > 0)) throw new Error('Pelo menos um peso precisa ser maior que zero.');
    await saveSettings({ sender_name: d.sender_name.trim().slice(0, 80), max_searches_per_hour: int(d.max_searches_per_hour, 1, 30), max_analyses_per_hour: int(d.max_analyses_per_hour, 1, 60), auto_analyze: d.auto_analyze === 'on', score_weights: w });
    C.toast('Ajustes salvos'); C.route();
  },
  'lf-lead': async (f, d) => {
    const name = d.name.trim();
    const pn = normPhone(d.phone);
    if (d.phone.trim() && !pn) throw new Error('Telefone inválido. Use DDD + número.');
    const site = normSite(d.website);
    if (d.website.trim() && !site.url) throw new Error('Endereço de site inválido.');
    const insta = C.nn(d.instagram) || (site.social ? site.url : null);
    const base = {
      name, name_norm: normName(name), segment: d.segment, phone: pn ? fmtPhone(pn) : null, phone_norm: pn,
      website: site.social ? null : site.url, domain_norm: site.domain, instagram: insta,
      address: C.nn(d.address), neighborhood: C.nn(d.neighborhood), city: C.nn(d.city),
      site_status: site.domain ? 'informado' : insta ? 'rede_social' : 'nao_encontrado_na_fonte',
    };
    if (!base.name_norm) throw new Error('Informe um nome válido.');
    if (d.id) {
      const prev = leadOf(d.id);
      const ev = String(d.estimated_value ?? '').trim();
      const patch = { ...base, estimated_value: ev === '' ? null : Math.max(0, Number(ev.replace(/\./g, '').replace(',', '.')) || 0) };
      // Site trocado ou informado agora: a confirmação "sem site" e a análise antiga deixam de valer.
      if (site.domain) patch.site_confirmed = null;
      if (prev && prev.domain_norm !== site.domain) patch.site_analysis = null;
      await patchLead(d.id, patch);
      delete L.analysis[d.id];
      await syncScore(d.id);
      C.closeModal(); C.toast('Lead atualizado'); C.route();
      return;
    }
    const r = await C.sb.rpc('lf_ingest', { p_search: null, p_provider: 'manual', p_items: [{ ...base, external_id: crypto.randomUUID(), source_url: null }] });
    if (r.error) throw r.error;
    C.closeModal();
    C.toast(r.data?.duplicados ? 'Esta empresa já estava na lista: os dados foram completados.' : 'Lead adicionado');
    Object.assign(L, { loaded: false, tab: 'leads', q: '', fStatus: '', fSeg: '', fSite: '', fPrio: '', fSearch: null, sort: 'recentes', page: 1 }); C.route();
  },
  'lf-event': async (f, d) => {
    const body = d.body.trim();
    if (!body) return;
    const when = d.date && d.date !== today10() ? new Date(d.date + 'T12:00:00').toISOString() : new Date().toISOString();
    await addEvent(d.company_id, d.kind, body, when);
    const c = leadOf(d.company_id);
    // Avanço automático e conservador do funil: nunca volta etapas nem mexe em vendas, perdas ou "não contatar".
    if (d.kind === 'contato') {
      const patch = { last_contact_at: when };
      if (['novo', 'em_analise', 'pronto_contato'].includes(c.status)) patch.status = 'contatado';
      await patchLead(c.id, patch);
    } else if (d.kind === 'resposta' && ['novo', 'em_analise', 'pronto_contato', 'contatado'].includes(c.status)) {
      await patchLead(c.id, { status: 'respondeu' });
    }
    f.reset();
    C.toast('Registrado'); C.route();
  },
};
