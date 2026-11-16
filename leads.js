// Lead Finder — módulo de prospecção da Central (pessoal).
// Usa os mesmos componentes, modais e padrões do app.js. Dados sempre reais, vindos do banco.
import { PROVIDERS, normalizeItem, normName, normPhone, normSite, fmtPhone } from './lead-providers.js';

let C = null; // contexto recebido do app.js (sb, esc, toast, modais, rotas…)

export const STATUS = [
  ['novo', 'Novo'], ['em_analise', 'Em análise'], ['pronto_contato', 'Pronto para contato'], ['contatado', 'Contatado'],
  ['respondeu', 'Respondeu'], ['negociacao', 'Negociação'], ['proposta_enviada', 'Proposta enviada'],
  ['venda_concluida', 'Venda concluída'], ['perdido', 'Perdido'], ['nao_contatar', 'Não contatar'],
];
const STATUS_NAME = Object.fromEntries(STATUS);
const STATUS_CLASS = { venda_concluida: 'ok', respondeu: 'ok', negociacao: 'mid', proposta_enviada: 'mid', perdido: 'bad', nao_contatar: 'bad' };
const SEGMENTS = [
  ['oficinas', 'Oficinas mecânicas'], ['barbearias', 'Barbearias e salões'], ['restaurantes', 'Restaurantes e alimentação'],
  ['clinicas', 'Clínicas e consultórios'], ['academias', 'Academias'], ['lojas', 'Lojas'],
  ['servicos', 'Prestadores de serviços'], ['outro', 'Outro (termo personalizado)'],
];
const SEG_NAME = Object.fromEntries(SEGMENTS);
const SITE = { nao_encontrado_na_fonte: 'Site não encontrado na fonte', rede_social: 'Só rede social na fonte', informado: 'Site informado' };
const ORIGIN = { osm: 'OpenStreetMap', manual: 'Cadastro manual', google: 'Google Places' };
const EVENT_KIND = { nota: 'Anotação', contato: 'Contato feito', resposta: 'Resposta recebida', status: 'Status', alteracao: 'Alteração', sistema: 'Sistema' };
const FIELD = { estimated_value: 'Valor estimado', next_action: 'Próxima ação', phone: 'Telefone', website: 'Site' };
const PAGE = 25;

const L = {
  loaded: false, loading: false, error: null,
  companies: [], searches: [],
  events: {}, sources: {}, detailLoading: null,
  tab: 'buscar', q: '', fStatus: '', fSeg: '', fSite: '', sort: 'recentes', page: 1,
  searching: false, step: '', abort: null, lastResult: null, searchError: null, form: null, fSearch: null,
};

export function init(ctx) { C = ctx; }
export function reset() { Object.assign(L, { loaded: false, loading: false, error: null, companies: [], searches: [], events: {}, sources: {}, lastResult: null, searchError: null }); }

// Celular brasileiro: DDD + 9 + 8 dígitos. Só nesses casos o botão de WhatsApp aparece.
const isMobile = (pn) => /^[1-9]\d9\d{8}$/.test(String(pn || ''));

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
    const [companies, s] = await Promise.all([
      fetchAll('lf_companies', 'created_at'),
      C.sb.from('lf_searches').select('*').order('created_at', { ascending: false }).limit(30),
    ]);
    if (s.error) throw s.error;
    L.companies = companies; L.searches = s.data || []; L.loaded = true;
  } catch (e) { console.error(e); L.error = C.friendly(e); }
  L.loading = false;
  C.route();
}
async function loadDetail(id) {
  if (L.detailLoading === id) return;
  L.detailLoading = id;
  try {
    const [ev, src] = await Promise.all([
      C.sb.from('lf_events').select('*').eq('company_id', id).order('happened_at', { ascending: false }).limit(200),
      C.sb.from('lf_company_sources').select('*').eq('company_id', id).order('fetched_at', { ascending: false }),
    ]);
    if (ev.error) throw ev.error;
    if (src.error) throw src.error;
    L.events[id] = ev.data || []; L.sources[id] = src.data || [];
  } catch (e) { console.error(e); L.events[id] = L.events[id] || []; L.sources[id] = L.sources[id] || []; C.toast(C.friendly(e), true); }
  L.detailLoading = null;
  C.route();
}
const leadOf = (id) => L.companies.find((c) => c.id === id);
async function patchLead(id, patch) {
  const r = await C.sb.from('lf_companies').update(patch).eq('id', id).select().single();
  if (r.error) throw r.error;
  const i = L.companies.findIndex((c) => c.id === id);
  if (i >= 0) L.companies[i] = r.data;
  delete L.events[id];
  return r.data;
}
async function addEvent(company_id, kind, body, happened_at) {
  const r = await C.sb.from('lf_events').insert({ company_id, kind, body: body || null, happened_at: happened_at || new Date().toISOString() });
  if (r.error) throw r.error;
  delete L.events[company_id];
}

/* ============ telas ============ */
const head = (extra = '') => `<div class="page-h"><div><div class="eyebrow">Prospecção</div><h1>Lead Finder</h1></div>${extra}</div>`;
const tabsHTML = () => `<div class="tabs">${[['buscar', 'Buscar empresas'], ['leads', `Leads (${L.companies.length})`]]
  .map(([k, n]) => `<button class="tab ${L.tab === k ? 'on' : ''}" data-action="lf-tab" data-tab="${k}">${n}</button>`).join('')}</div>`;
const opt = (list, cur, first = '') => (first ? `<option value="">${first}</option>` : '') + list.map(([k, n]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${C.esc(n)}</option>`).join('');
const statusBadge = (s) => `<span class="badge ${STATUS_CLASS[s] || ''}">${STATUS_NAME[s] || C.esc(s)}</span>`;
const siteBadge = (c) => `<span class="badge ${c.site_status === 'informado' ? '' : 'mid'}">${SITE[c.site_status] || ''}</span>`;
const place = (c) => [c.neighborhood, c.city, c.state].filter(Boolean).join(', ');

export function view(id) {
  if (!L.loaded) {
    if (L.error) return `${head()}<div class="empty"><p>Não foi possível carregar os leads: ${C.esc(L.error)}</p><button class="btn" data-action="lf-reload">Tentar de novo</button></div>`;
    load();
    return `${head()}<div class="empty lf-loading">Carregando leads…</div>`;
  }
  if (id) return vLead(id);
  return head(`<button class="btn" data-action="lf-new">+ Lead manual</button>`) + tabsHTML() + (L.tab === 'leads' ? vList() : vSearch());
}

function vSearch() {
  const f = L.form || { country: 'Brasil', state: 'SP', city: '', neighborhood: '', radius_km: '0', segment: 'restaurantes', term: '', presence: 'sem_site', limit: '25' };
  const res = L.lastResult;
  return `<div class="lf-cols">
  <form class="panel stack" data-form="lf-search">
    <h2 style="margin:0">Nova pesquisa</h2>
    <div class="two"><label>País<input name="country" value="${C.esc(f.country)}" maxlength="60"></label><label>Estado<input name="state" value="${C.esc(f.state)}" maxlength="60" placeholder="SP"></label></div>
    <div class="two"><label>Cidade*<input name="city" required minlength="2" maxlength="80" value="${C.esc(f.city)}" placeholder="São Paulo"></label><label>Bairro<input name="neighborhood" maxlength="80" value="${C.esc(f.neighborhood)}" placeholder="Opcional"></label></div>
    <div class="two"><label>Raio<select name="radius_km">${opt([['0', 'Área inteira do local'], ['1', '1 km do centro'], ['2', '2 km'], ['5', '5 km'], ['10', '10 km']], String(f.radius_km))}</select></label>
      <label>Quantidade<select name="limit">${opt([['10', '10'], ['25', '25'], ['50', '50'], ['100', '100']], String(f.limit))}</select></label></div>
    <label>Segmento<select name="segment">${opt(SEGMENTS, f.segment)}</select></label>
    <label>Termo personalizado <span class="muted">(usado em “Outro”: ex. doceria, pet shop)</span><input name="term" maxlength="40" value="${C.esc(f.term)}"></label>
    <label>Presença digital<select name="presence">${opt([['sem_site', 'Sem site cadastrado na fonte'], ['com_site', 'Com site informado'], ['todas', 'Todas as empresas']], f.presence)}</select></label>
    <button class="btn primary block" ${L.searching ? 'disabled' : ''}>${L.searching ? 'Pesquisando… (pode levar até 1 minuto)' : 'Pesquisar empresas'}</button>
    <p class="muted small" style="margin:0">Fonte gratuita: OpenStreetMap. Dados © colaboradores do OpenStreetMap (ODbL). Nem toda empresa tem telefone ou site cadastrados lá; “sem site” significa que a fonte não informa um, não que ele não exista.</p>
  </form>
  <div class="stack">
    ${L.searching ? `<div class="card"><div class="lf-loading" id="lf-step">${C.esc(L.step || 'Pesquisando…')}</div><div class="row" style="margin-top:10px"><button type="button" class="btn sm" data-action="lf-cancel">Cancelar pesquisa</button></div></div>` : ''}
    ${L.searchError ? `<div class="card alert bad"><div class="t">A pesquisa não foi concluída</div><div class="muted small">${C.esc(L.searchError)}</div></div>` : ''}
    ${res ? `<div class="card"><div class="t">${res.found ? `${res.found} empresa${res.found === 1 ? '' : 's'} encontrada${res.found === 1 ? '' : 's'}` : 'Nenhuma empresa encontrada com esses filtros'}</div>
      <div class="muted small">${C.esc(res.area || '')}</div>
      ${res.found ? `<div class="row" style="margin-top:10px"><span class="badge ok">${res.new_count} nova${res.new_count === 1 ? '' : 's'}</span><span class="badge">${res.dup_count} já na sua lista</span></div>
      <div class="row" style="margin-top:12px"><button class="btn sm primary" data-action="lf-see-search" data-id="${res.search_id}">Ver leads</button></div>` : '<p class="muted small">Tente outro segmento, tire o bairro ou escolha “Todas as empresas”.</p>'}</div>` : ''}
    <div class="section" style="margin-top:6px"><h2>Histórico de pesquisas</h2></div>
    ${L.searches.length ? L.searches.map(searchCard).join('') : '<div class="empty">Nenhuma pesquisa ainda.</div>'}
  </div></div>`;
}
function searchCard(s) {
  const p = s.params || {};
  const where = [p.neighborhood, p.city, p.state].filter(Boolean).join(', ');
  const seg = p.segment === 'outro' ? `“${p.term || ''}”` : SEG_NAME[p.segment] || p.segment || '';
  const st = s.status === 'ok' ? `<span class="badge ok">${s.found} encontradas · ${s.new_count} novas</span>` : s.status === 'erro' ? '<span class="badge bad">Erro</span>' : `<span class="badge mid">${s.status === 'cancelada' ? 'Cancelada' : 'Em andamento'}</span>`;
  return `<div class="card"><div class="item"><div><div class="t">${C.esc(seg)}</div><div class="muted small">${C.esc(where)} · ${C.fmtTs(s.created_at)} · ${ORIGIN[s.provider] || C.esc(s.provider)}</div>${s.error ? `<div class="small neg">${C.esc(s.error)}</div>` : ''}</div>${st}</div>
    <div class="row" style="margin-top:10px"><button class="btn sm" data-action="lf-repeat" data-id="${s.id}">Usar estes filtros</button></div></div>`;
}

function filtered() {
  const q = normName(L.q);
  let rows = L.companies.filter((c) =>
    (!L.fStatus || c.status === L.fStatus) && (!L.fSeg || c.segment === L.fSeg) && (!L.fSite || c.site_status === L.fSite) &&
    (!L.fSearch || c.first_search_id === L.fSearch) &&
    (!q || c.name_norm.includes(q) || normName(place(c)).includes(q) || String(c.phone_norm || '').includes(q.replace(/\D/g, '') || '\u0000')));
  const by = {
    recentes: (a, b) => (a.created_at < b.created_at ? 1 : -1),
    atualizados: (a, b) => (a.updated_at < b.updated_at ? 1 : -1),
    nome: (a, b) => a.name.localeCompare(b.name, 'pt-BR'),
    pontuacao: (a, b) => (b.score ?? -1) - (a.score ?? -1),
    proxima: (a, b) => String(a.next_action_at || '9999').localeCompare(String(b.next_action_at || '9999')),
  };
  return rows.sort(by[L.sort] || by.recentes);
}
function vList() {
  const all = L.companies;
  const n = (f) => all.filter(f).length;
  const stats = [
    ['Total', all.length], ['Novos', n((c) => c.status === 'novo')],
    ['Contatados', n((c) => !!c.last_contact_at || ['contatado', 'respondeu', 'negociacao', 'proposta_enviada', 'venda_concluida'].includes(c.status))],
    ['Vendas', n((c) => c.status === 'venda_concluida')],
  ];
  const rows = filtered();
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  if (L.page > pages) L.page = pages;
  const slice = rows.slice((L.page - 1) * PAGE, L.page * PAGE);
  const today = today10();
  return `<div class="grid g4">${stats.map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v" data-count="${v}">${v}</div></div>`).join('')}</div>
  <form class="card lf-filters" data-form="lf-filter" style="margin-top:12px">
    <label>Buscar<input name="q" type="search" value="${C.esc(L.q)}" placeholder="Nome, bairro ou telefone"></label>
    <label>Status<select name="fStatus" data-action-change="lf-filter">${opt(STATUS, L.fStatus, 'Todos')}</select></label>
    <label>Segmento<select name="fSeg" data-action-change="lf-filter">${opt(SEGMENTS.slice(0, 7).concat([['outro', 'Outro']]), L.fSeg, 'Todos')}</select></label>
    <label>Site<select name="fSite" data-action-change="lf-filter">${opt(Object.entries(SITE), L.fSite, 'Todos')}</select></label>
    <label>Ordenar<select name="sort" data-action-change="lf-filter">${opt([['recentes', 'Mais recentes'], ['atualizados', 'Última atualização'], ['nome', 'Nome'], ['pontuacao', 'Pontuação'], ['proxima', 'Próxima ação']], L.sort)}</select></label>
    <div class="row"><button class="btn sm primary">Aplicar</button>${L.q || L.fStatus || L.fSeg || L.fSite || L.fSearch ? '<button type="button" class="btn sm" data-action="lf-clear">Limpar filtros</button>' : ''}</div>
  </form>
  ${L.fSearch ? '<p class="muted small">Mostrando só as empresas novas da pesquisa selecionada.</p>' : ''}
  ${!all.length ? '<div class="empty" style="margin-top:12px">Nenhum lead ainda. Faça uma pesquisa em “Buscar empresas” ou cadastre um lead manual.</div>'
    : !rows.length ? '<div class="empty" style="margin-top:12px">Nenhum lead com esses filtros.</div>'
    : `<div class="lf-tablewrap"><table class="lf-table"><thead><tr><th>Empresa</th><th>Local</th><th>Telefone</th><th>Site</th><th>Origem</th><th>Pontos</th><th>Status</th><th>Atualizado</th><th></th></tr></thead><tbody>
    ${slice.map((c) => {
      const late = c.next_action_at && c.next_action_at <= today && !['venda_concluida', 'perdido', 'nao_contatar'].includes(c.status);
      return `<tr>
      <td data-l="Empresa"><a class="t" href="#/leads/${c.id}">${C.esc(c.name)}</a><div class="muted small">${C.esc(SEG_NAME[c.segment] || c.segment)}${late ? ' · <span class="warn">ação pendente</span>' : ''}</div></td>
      <td data-l="Local">${C.esc(place(c)) || '—'}</td>
      <td data-l="Telefone">${c.phone_norm ? C.esc(fmtPhone(c.phone_norm)) : '—'}</td>
      <td data-l="Site">${c.website ? `<a href="${C.esc(C.safeUrl(c.website))}" target="_blank" rel="noopener noreferrer nofollow">${C.esc(c.domain_norm || 'abrir')}</a>` : `<span class="muted small">${SITE[c.site_status]}</span>`}</td>
      <td data-l="Origem">${ORIGIN[c.origin] || C.esc(c.origin)}</td>
      <td data-l="Pontos">${c.score == null ? '<span class="muted small" title="A análise e a pontuação chegam na etapa 3">—</span>' : c.score}</td>
      <td data-l="Status">${statusBadge(c.status)}</td>
      <td data-l="Atualizado">${C.fmtTs(c.updated_at)}</td>
      <td class="right"><a class="btn sm" href="#/leads/${c.id}">Abrir</a></td></tr>`;
    }).join('')}</tbody></table></div>
    <div class="row between" style="margin-top:12px"><span class="muted small">${rows.length} lead${rows.length === 1 ? '' : 's'} · página ${L.page} de ${pages}</span>
      <div class="row"><button class="btn sm" data-action="lf-page" data-d="-1" ${L.page <= 1 ? 'disabled' : ''}>← Anterior</button><button class="btn sm" data-action="lf-page" data-d="1" ${L.page >= pages ? 'disabled' : ''}>Próxima →</button></div></div>`}`;
}

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
function vLead(id) {
  const c = leadOf(id);
  if (!c) return `<div class="empty">Lead não encontrado. <a href="#/leads">Voltar</a></div>`;
  if (!L.events[id]) loadDetail(id);
  const ev = L.events[id], src = L.sources[id] || [];
  const blocked = c.status === 'nao_contatar';
  const wa = !blocked && isMobile(c.phone_norm) ? C.waLink(c.phone_norm, '') : '';
  const map = c.lat != null ? `https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lon}#map=18/${c.lat}/${c.lon}` : '';
  return `<div class="page-h"><div><a class="small" href="#/leads">← Leads</a><h1>${C.esc(c.name)}</h1><div class="muted">${C.esc(SEG_NAME[c.segment] || c.segment)}${c.category ? ' · ' + C.esc(c.category) : ''}</div></div>
    <div class="row"><button class="btn sm" data-action="lf-edit" data-id="${id}">Editar</button></div></div>
  ${blocked ? '<div class="card alert bad"><div class="t">Marcada como “Não contatar”</div><div class="muted small">Os atalhos de contato ficam desativados para esta empresa.</div></div>' : ''}
  <div class="lf-cols" style="margin-top:12px">
  <div class="stack">
    <div class="card"><dl class="kv" style="margin:0">
      <dt>Status</dt><dd><select data-action-change="lf-status" data-id="${id}" aria-label="Status comercial" style="margin:0">${opt(STATUS, c.status)}</select></dd>
      <dt>Telefone</dt><dd>${c.phone_norm ? `${C.esc(fmtPhone(c.phone_norm))} <span class="muted small">(público, da fonte)</span>` : '<span class="muted">não informado na fonte</span>'}</dd>
      <dt>Site</dt><dd>${c.website ? `<a href="${C.esc(C.safeUrl(c.website))}" target="_blank" rel="noopener noreferrer nofollow">${C.esc(c.website)}</a>` : `<span class="muted">${SITE[c.site_status]}</span>`}</dd>
      ${c.instagram ? `<dt>Instagram</dt><dd>${C.esc(c.instagram)}</dd>` : ''}${c.facebook ? `<dt>Facebook</dt><dd>${C.esc(c.facebook)}</dd>` : ''}
      <dt>Endereço</dt><dd>${C.esc([c.address, c.city, c.state, c.postcode].filter(Boolean).join(', ')) || '<span class="muted">não informado</span>'}</dd>
      <dt>Pontuação</dt><dd>${c.score == null ? '<span class="muted">ainda não calculada (etapa 3: análise do site e Lead Score)</span>' : c.score}</dd>
      <dt>Valor estimado</dt><dd>${c.estimated_value == null ? '—' : C.brl(c.estimated_value)}</dd>
      <dt>Próxima ação</dt><dd>${c.next_action ? C.esc(c.next_action) : '—'}${c.next_action_at ? ` · ${C.fmtDate(c.next_action_at)}` : ''}</dd>
      ${c.status === 'perdido' && c.lost_reason ? `<dt>Motivo da perda</dt><dd>${C.esc(c.lost_reason)}</dd>` : ''}
      <dt>Último contato</dt><dd>${c.last_contact_at ? C.fmtTs(c.last_contact_at) : '—'}</dd>
      <dt>Atualizado</dt><dd>${C.fmtTs(c.updated_at)}</dd></dl>
      <div class="row" style="margin-top:14px">
        ${wa ? `<a class="btn sm primary" href="${C.esc(wa)}" target="_blank" rel="noopener noreferrer">Abrir WhatsApp</a>` : ''}
        ${!blocked && c.phone_norm ? `<a class="btn sm" href="tel:+55${C.esc(c.phone_norm)}">Ligar</a>` : ''}
        ${map ? `<a class="btn sm" href="${C.esc(map)}" target="_blank" rel="noopener noreferrer">Ver no mapa</a>` : ''}
        <button class="btn sm" data-action="lf-next" data-id="${id}">Próxima ação</button>
      </div></div>
    <div class="card"><div class="eyebrow">Origem dos dados</div>
      ${src.length ? src.map((s) => `<div class="small">${ORIGIN[s.provider] || C.esc(s.provider)}${s.source_url ? ` · <a href="${C.esc(C.safeUrl(s.source_url))}" target="_blank" rel="noopener noreferrer">registro na fonte</a>` : ''} · consultado em ${C.fmtTs(s.fetched_at)}</div>`).join('') : `<div class="small">${ORIGIN[c.origin] || C.esc(c.origin)}</div>`}
      ${c.origin === 'osm' ? '<div class="muted small" style="margin-top:6px">© colaboradores do OpenStreetMap (ODbL). Dados públicos de estabelecimentos comerciais.</div>' : ''}
      <div class="row" style="margin-top:12px">
        ${blocked ? '' : `<button class="btn sm" data-action="lf-block" data-id="${id}">Não contatar</button>`}
        <button class="btn sm danger" data-action="lf-del" data-id="${id}">Excluir lead</button></div></div>
  </div>
  <div class="stack">
    <form class="card stack" data-form="lf-event"><input type="hidden" name="company_id" value="${id}">
      <div class="eyebrow">Registrar no histórico</div>
      <div class="two"><label>Tipo<select name="kind">${opt([['nota', 'Anotação'], ['contato', 'Contato feito'], ['resposta', 'Resposta recebida']], 'nota')}</select></label>
      <label>Data<input name="date" type="date" value="${today10()}" max="${today10()}"></label></div>
      <label>Texto<textarea name="body" maxlength="4000" required placeholder="O que aconteceu?"></textarea></label>
      <button class="btn primary">Registrar</button></form>
    <div class="section" style="margin-top:6px"><h2>Histórico</h2></div>
    ${!ev ? '<div class="empty lf-loading">Carregando histórico…</div>' : ev.length ? ev.map(eventCard).join('') : '<div class="empty">Sem registros ainda.</div>'}
    <div class="card"><div class="muted small">Lead criado em ${C.fmtTs(c.created_at)}</div></div>
  </div></div>`;
}
const today10 = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function formLead(c = {}) {
  return `<form data-form="lf-lead" class="stack"><input type="hidden" name="id" value="${C.esc(c.id || '')}">
    <label>Nome da empresa*<input name="name" required maxlength="160" value="${C.esc(c.name || '')}"></label>
    <label>Segmento<select name="segment">${opt(SEGMENTS.slice(0, 7).concat([['outro', 'Outro']]), c.segment || 'outro')}</select></label>
    <div class="two"><label>Telefone comercial<input name="phone" inputmode="tel" maxlength="40" value="${C.esc(c.phone_norm ? fmtPhone(c.phone_norm) : '')}"></label>
    <label>Site<input name="website" maxlength="300" value="${C.esc(c.website || '')}" placeholder="exemplo.com.br"></label></div>
    <label>Instagram<input name="instagram" maxlength="200" value="${C.esc(c.instagram || '')}"></label>
    <label>Endereço<input name="address" maxlength="240" value="${C.esc(c.address || '')}"></label>
    <div class="two"><label>Bairro<input name="neighborhood" maxlength="100" value="${C.esc(c.neighborhood || '')}"></label><label>Cidade<input name="city" maxlength="100" value="${C.esc(c.city || '')}"></label></div>
    ${c.id ? `<label>Valor estimado da proposta (R$)<input name="estimated_value" inputmode="decimal" value="${c.estimated_value ?? ''}"></label>` : ''}
    <button class="btn primary block">${c.id ? 'Salvar' : 'Adicionar lead'}</button></form>`;
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

export const actions = {
  'lf-tab': (el) => { L.tab = el.dataset.tab; C.route(); },
  'lf-cancel': () => { L.abort?.abort(); },
  'lf-reload': () => { L.error = null; C.route(); },
  'lf-page': (el) => { L.page += Number(el.dataset.d); C.route(); },
  'lf-clear': () => { Object.assign(L, { q: '', fStatus: '', fSeg: '', fSite: '', fSearch: null, page: 1 }); C.route(); },
  'lf-see-search': (el) => { Object.assign(L, { tab: 'leads', q: '', fStatus: '', fSeg: '', fSite: '', fSearch: el.dataset.id, page: 1, sort: 'recentes' }); C.route(); },
  'lf-repeat': (el) => {
    const s = L.searches.find((x) => x.id === el.dataset.id);
    if (!s) return;
    L.form = { country: 'Brasil', state: '', city: '', neighborhood: '', term: '', ...s.params, radius_km: String(s.params?.radius_km || 0), limit: String(s.params?.limit || 25) };
    L.lastResult = null; L.searchError = null; C.route(); window.scrollTo(0, 0);
  },
  'lf-new': () => C.openModal('Lead manual', formLead()),
  'lf-edit': (el) => C.openModal('Editar lead', formLead(leadOf(el.dataset.id))),
  'lf-next': async (el) => {
    const c = leadOf(el.dataset.id);
    const d = await C.askModal('Próxima ação', `<form data-form="ask" class="stack"><label>O que fazer<input name="next_action" maxlength="200" value="${C.esc(c.next_action || '')}" placeholder="Ex.: mandar prévia do site"></label><label>Quando<input name="next_action_at" type="date" value="${C.esc(c.next_action_at || '')}"></label><button class="btn primary block">Salvar</button></form>`);
    if (!d) return;
    await patchLead(c.id, { next_action: C.nn(d.next_action), next_action_at: C.nn(d.next_action_at) });
    C.toast('Próxima ação salva'); C.route();
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
};

export function onChange(el) {
  const a = el.dataset.actionChange;
  if (a === 'lf-filter') { L[el.name] = el.value; L.page = 1; C.route(); return true; }
  if (a === 'lf-status') { C.guard(() => setStatus(el.dataset.id, el.value)); return true; }
  return false;
}

export const forms = {
  'lf-filter': (f, d) => { Object.assign(L, { q: d.q.trim(), fStatus: d.fStatus, fSeg: d.fSeg, fSite: d.fSite, sort: d.sort, page: 1 }); C.route(); },
  'lf-search': async (f, d) => {
    if (L.searching) return;
    L.form = d;
    const provider = PROVIDERS.osm;
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
    Object.assign(L, { searching: true, step: 'Conferindo limites…', searchError: null, lastResult: null, abort: new AbortController() });
    C.route();
    let searchId = null;
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
    L.loaded = false; // recarrega leads e histórico com os dados reais do banco
    C.route();
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
      const ev = String(d.estimated_value ?? '').trim();
      await patchLead(d.id, { ...base, estimated_value: ev === '' ? null : Math.max(0, Number(ev.replace(/\./g, '').replace(',', '.')) || 0) });
      C.closeModal(); C.toast('Lead atualizado'); C.route();
      return;
    }
    const r = await C.sb.rpc('lf_ingest', { p_search: null, p_provider: 'manual', p_items: [{ ...base, external_id: crypto.randomUUID(), source_url: null }] });
    if (r.error) throw r.error;
    C.closeModal();
    C.toast(r.data?.duplicados ? 'Esta empresa já estava na lista: os dados foram completados.' : 'Lead adicionado');
    Object.assign(L, { loaded: false, tab: 'leads', q: '', fStatus: '', fSeg: '', fSite: '', fSearch: null, sort: 'recentes', page: 1 }); C.route();
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
    C.toast('Registrado'); C.route();
  },
};
