import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import * as V from './crypto.js';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

/* ============ utilidades ============ */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => ymd(new Date());
const fmtDate = (d) => (d ? new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('pt-BR') : '—');
const fmtTs = (t) => new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const sum = (arr, f) => arr.reduce((a, x) => a + Number(f(x) || 0), 0);
const nn = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());
const num = (v) => Number(String(v || '0').replace(',', '.')) || 0;
const safeUrl = (u) => {
  u = String(u || '').trim();
  if (!u) return '#';
  if (/^https?:\/\//i.test(u)) return u;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return '#';
  return 'https://' + u;
};
const friendly = (e) => {
  const m = String(e?.message || e || 'Erro inesperado');
  if (/invalid login/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/not confirmed/i.test(m)) return 'Confirme o e-mail antes de entrar.';
  if (/database error saving new user|signups? not allowed/i.test(m)) return 'Cadastro bloqueado: este app aceita apenas um usuário.';
  if (/already registered/i.test(m)) return 'Este e-mail já tem conta. Use "Entrar".';
  if (/invalid.*(totp|code)|invalid claim/i.test(m)) return 'Código inválido ou expirado.';
  return m;
};

const STAGES = [
  ['demo', 'Demo'], ['demo_mostrada', 'Demo mostrada'], ['pagamento_inicial', 'Pagamento inicial'],
  ['producao', 'Produção'], ['confirmacao', 'Confirmação'], ['pagamento_final', 'Pagamento final'], ['publicacao', 'Publicação'],
];
const STAGE_NAME = Object.fromEntries(STAGES);
const SERVICE_KINDS = { dominio: 'Domínio', hospedagem: 'Hospedagem', github: 'GitHub', banco: 'Banco de dados', email: 'E-mail', demo: 'Demo', site_no_ar: 'Site no ar', outro: 'Outro' };
const PAY_KINDS = { entrada: 'Entrada', saldo: 'Saldo', extra: 'Extra' };

/* ============ estado ============ */
const S = {
  user: null, vaultRow: null, dk: null, loginPassword: null, lastAuthAt: 0,
  clients: [], projects: [], services: [], payments: [], expenses: [], links: [], log: [], settings: null,
  period: 'mes', ptab: 'resumo', ctab: 'projetos', doctype: 'orcamento', pfilter: '', booted: false,
};
const clientOf = (id) => S.clients.find((c) => c.id === id);
const projectOf = (id) => S.projects.find((p) => p.id === id);
const paidOf = (pid) => sum(S.payments.filter((p) => p.project_id === pid && p.paid_at), (p) => p.amount);
const balanceOf = (pr) => Math.max(0, Number(pr.price) - paidOf(pr.id));
const isDone = (pr) => pr.stage === 'publicacao' && balanceOf(pr) <= 0;

/* ============ UI base ============ */
const root = $('#app');
const setScreen = (html) => { root.innerHTML = html; };
function toast(msg, err = false) {
  const t = $('#toast');
  const d = document.createElement('div');
  if (err) d.className = 'err';
  d.textContent = msg;
  t.appendChild(d);
  setTimeout(() => d.remove(), err ? 5000 : 2800);
}
let modalResolver = null;
function openModal(title, body) {
  const m = $('#modal');
  m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><header><h3>${esc(title)}</h3><button class="icon" data-action="close-modal" aria-label="Fechar">✕</button></header><div>${body}</div></div>`;
  m.hidden = false;
  document.body.classList.add('noscroll');
  m.querySelector('input:not([type=hidden]),select,textarea')?.focus();
}
function closeModal(val = null) {
  $('#modal').hidden = true;
  $('#modal').innerHTML = '';
  document.body.classList.remove('noscroll');
  const r = modalResolver;
  modalResolver = null;
  r?.(val);
}
function askModal(title, body) {
  if (modalResolver) closeModal(null);
  return new Promise((res) => { openModal(title, body); modalResolver = res; });
}
const confirmModal = async (text, label = 'Excluir') =>
  !!(await askModal('Confirmar', `<p>${esc(text)}</p><div class="row"><button class="btn danger" data-action="ask-yes">${esc(label)}</button><button class="btn" data-action="close-modal">Cancelar</button></div>`));
const formObj = (f) => Object.fromEntries(new FormData(f));
async function guard(fn) {
  try { return await fn(); } catch (e) { console.error(e); toast(friendly(e), true); }
}

/* ============ autenticação ============ */
function showLogin(msg = '') {
  setScreen(`<div class="center"><form class="panel auth stack" data-form="login">
    <div><div class="brand-big">Central</div><p class="muted">Clientes, projetos e acessos dos seus sites em um só lugar.</p></div>
    ${msg ? `<p class="notice">${esc(msg)}</p>` : ''}
    <label>E-mail<input name="email" type="email" autocomplete="username" required></label>
    <label>Senha<input name="password" type="password" autocomplete="current-password" required minlength="8"></label>
    <button class="btn primary block">Entrar</button>
    <button type="button" class="link" data-action="show-signup">Primeiro acesso? Criar conta</button>
  </form></div>`);
}
function showSignup() {
  setScreen(`<div class="center"><form class="panel auth stack" data-form="signup">
    <div><div class="brand-big">Criar conta</div><p class="muted">Só um usuário pode existir. Use uma senha longa (12+ caracteres) e exclusiva.</p></div>
    <label>E-mail<input name="email" type="email" autocomplete="username" required></label>
    <label>Senha<input name="password" type="password" autocomplete="new-password" required minlength="12"></label>
    <label>Repita a senha<input name="password2" type="password" autocomplete="new-password" required minlength="12"></label>
    <button class="btn primary block">Criar conta</button>
    <button type="button" class="link" data-action="show-login">Já tenho conta</button>
  </form></div>`);
}
async function afterSignIn() {
  const { data: aal, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;
  if (aal.currentLevel === 'aal2') return afterAal2();
  return showMfa();
}
async function showMfa() {
  const { data: f, error } = await sb.auth.mfa.listFactors();
  if (error) throw error;
  const verified = (f?.totp || []).find((x) => x.status === 'verified');
  if (verified) {
    setScreen(`<div class="center"><form class="panel auth stack" data-form="mfa" data-factor="${esc(verified.id)}">
      <div><div class="brand-big">Verificação</div><p class="muted">Digite o código de 6 dígitos do seu app autenticador.</p></div>
      <label>Código<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label>
      <button class="btn primary block">Confirmar</button>
      <button type="button" class="link" data-action="logout">Cancelar</button>
    </form></div>`);
    return;
  }
  for (const x of (f?.all || []).filter((x) => x.status === 'unverified')) await sb.auth.mfa.unenroll({ factorId: x.id });
  const { data, error: e2 } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Central ' + Date.now() });
  if (e2) throw e2;
  setScreen(`<div class="center"><form class="panel auth stack" data-form="mfa" data-factor="${esc(data.id)}">
    <div><div class="brand-big">Ativar 2FA</div><p class="muted">Escaneie o QR code no Google Authenticator, Authy ou Bitwarden. Depois digite o código.</p></div>
    <div class="qr"><img alt="QR code do 2FA" src="${esc(data.totp.qr_code)}"></div>
    <p class="small muted">Sem câmera? Chave manual: <span class="mono">${esc(data.totp.secret)}</span></p>
    <label>Código de 6 dígitos<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label>
    <button class="btn primary block">Ativar e entrar</button>
    <button type="button" class="link" data-action="logout">Cancelar</button>
  </form></div>`);
}
async function afterAal2() {
  const { data: row, error } = await sb.from('vault_keys').select('*').maybeSingle();
  if (error) throw error;
  S.vaultRow = row;
  if (!row) {
    if (S.loginPassword) return createVaultFlow(S.loginPassword);
    return showVaultPassword();
  }
  if (S.loginPassword) {
    const pw = S.loginPassword;
    S.loginPassword = null;
    try { S.dk = await V.openWithPassword(row, pw); } catch { return showRecover(pw); }
    S.lastAuthAt = Date.now();
    return enterApp();
  }
  return showLock(true);
}
function showVaultPassword() {
  setScreen(`<div class="center"><form class="panel auth stack" data-form="vaultpw">
    <div><div class="brand-big">Criar cofre</div><p class="muted">Digite sua senha da conta para criar o cofre de senhas. Ela protege a chave de criptografia.</p></div>
    <label>Senha da conta<input name="password" type="password" autocomplete="current-password" required></label>
    <button class="btn primary block">Criar cofre</button>
  </form></div>`);
}
async function createVaultFlow(password) {
  const { row, dk, recovery } = await V.createVault(password);
  S.loginPassword = null;
  const { data, error } = await sb.from('vault_keys').insert(row).select().single();
  if (error) throw error;
  S.vaultRow = data;
  S.dk = dk;
  S.lastAuthAt = Date.now();
  setScreen(`<div class="center"><form class="panel auth stack" data-form="recovery-done">
    <div><div class="brand-big">Chave de recuperação</div>
    <p class="muted">Se você esquecer a senha, esta chave é a única forma de abrir as senhas guardadas. Anote em papel ou guarde offline. <b>Ela não será mostrada de novo.</b></p></div>
    <div class="recovery mono">${esc(recovery)}</div>
    <div class="row"><button type="button" class="btn sm" data-action="copy" data-text="${esc(recovery)}">Copiar</button></div>
    <label class="check"><input type="checkbox" name="ok" required> Guardei a chave em local seguro</label>
    <button class="btn primary block">Continuar</button>
  </form></div>`);
}
function showRecover(pw) {
  setScreen(`<div class="center"><form class="panel auth stack" data-form="recover" data-pw="${pw ? '1' : ''}">
    <div><div class="brand-big">Recuperar cofre</div>
    <p class="muted">${pw ? 'Sua senha atual não abre o cofre (provavelmente foi redefinida).' : 'Use a chave de recuperação para voltar a abrir o cofre.'} Digite a chave de recuperação${pw ? '' : ' e a senha atual da conta'}.</p></div>
    <label>Chave de recuperação<textarea name="key" required placeholder="XXXX-XXXX-XXXX-…" autocapitalize="characters" spellcheck="false"></textarea></label>
    ${pw ? `<input type="hidden" name="password" value="${esc(pw)}">` : `<label>Senha atual da conta<input name="password" type="password" autocomplete="current-password" required></label>`}
    <button class="btn primary block">Recuperar</button>
    <button type="button" class="link" data-action="logout">Sair</button>
  </form></div>`);
}
function showLock(auto = false) {
  const bio = !!V.deviceInfo();
  setScreen(`<div class="center"><form class="panel auth stack" data-form="unlock">
    <div><div class="brand-big">Bloqueado</div><p class="muted">${esc(S.user?.email || '')}</p></div>
    ${bio ? `<button type="button" class="btn primary block" data-action="unlock-bio">Desbloquear com biometria</button>` : ''}
    <label>${bio ? 'Ou digite a senha' : 'Senha'}<input name="password" type="password" autocomplete="current-password" ${bio ? '' : 'required'}></label>
    <button class="btn ${bio ? '' : 'primary'} block">Desbloquear com senha</button>
    <div class="row between"><button type="button" class="link" data-action="show-recover">Usar chave de recuperação</button><button type="button" class="link" data-action="logout">Sair</button></div>
  </form></div>`);
  if (auto && bio) setTimeout(() => unlockBio(true), 250);
}
async function unlockBio(silent = false) {
  try {
    S.dk = await V.unlockBiometric();
    S.lastAuthAt = Date.now();
    await enterApp();
  } catch (e) {
    if (!silent) toast('Biometria não funcionou. Use a senha.', true);
  }
}
function lock() {
  if (!S.dk) return;
  S.dk = null;
  Object.assign(S, { clients: [], projects: [], services: [], payments: [], expenses: [], links: [], log: [], settings: null });
  closeModal();
  showLock(false);
}
async function logout() {
  try { await sb.auth.signOut(); } catch {}
  await V.disableBiometric();
  Object.assign(S, { user: null, vaultRow: null, dk: null, loginPassword: null, clients: [], projects: [], services: [], payments: [], expenses: [], links: [], log: [], settings: null });
  closeModal();
  showLogin();
}
async function freshAuth() {
  if (S.dk && Date.now() - S.lastAuthAt < 45000) return true;
  if (V.deviceInfo()) {
    try { await V.confirmBiometric(); S.lastAuthAt = Date.now(); return true; } catch { /* cai para senha */ }
  }
  const r = await askModal('Confirme sua senha', `<form data-form="ask" class="stack"><label>Senha<input name="pw" type="password" autocomplete="current-password" required></label><button class="btn primary block">Confirmar</button></form>`);
  if (!r) return false;
  try { await V.openWithPassword(S.vaultRow, r.pw); S.lastAuthAt = Date.now(); return true; } catch { toast('Senha incorreta', true); return false; }
}

/* auto-bloqueio */
let idleTimer, hiddenAt = 0;
const bump = () => { clearTimeout(idleTimer); if (S.dk) idleTimer = setTimeout(lock, 5 * 60 * 1000); };
['click', 'keydown', 'touchstart'].forEach((ev) => addEventListener(ev, bump, { passive: true }));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (S.dk && hiddenAt && Date.now() - hiddenAt > 60000) lock();
});

/* ============ dados ============ */
async function loadAll() {
  const q = (t, col = 'created_at') => sb.from(t).select('*').order(col, { ascending: false });
  const res = await Promise.all([
    q('clients'), q('projects'), q('project_services'), q('payments'), q('expenses', 'spent_at'), q('project_links'),
    q('activity_log').limit(500), sb.from('app_settings').select('*').maybeSingle(),
  ]);
  for (const r of res) if (r.error) throw r.error;
  [S.clients, S.projects, S.services, S.payments, S.expenses, S.links, S.log] = res.slice(0, 7).map((r) => r.data || []);
  S.settings = res[7].data;
}
async function save(table, id, obj) {
  const r = id ? await sb.from(table).update(obj).eq('id', id).select().single() : await sb.from(table).insert(obj).select().single();
  if (r.error) throw r.error;
  return r.data;
}
async function remove(table, id) {
  const r = await sb.from(table).delete().eq('id', id);
  if (r.error) throw r.error;
}
async function logEvent(client_id, project_id, event) {
  await sb.from('activity_log').insert({ client_id, project_id, event });
}
async function refresh() { await loadAll(); route(); }

/* ============ shell e rotas ============ */
const ICON = {
  painel: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  clientes: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  projetos: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  despesas: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5c0-1 1-1.5 2.5-1.5s2.5.6 2.5 1.8c0 2.4-5 1.4-5 3.8 0 1.2 1 1.9 2.5 1.9s2.5-.6 2.5-1.5"/>',
  ajustes: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
};
async function enterApp() {
  await loadAll();
  const items = [['painel', 'Painel'], ['clientes', 'Clientes'], ['projetos', 'Projetos'], ['despesas', 'Despesas'], ['ajustes', 'Ajustes']];
  setScreen(`<div class="shell"><nav class="nav" aria-label="Principal"><div class="brand">Central</div>${items
    .map(([k, n]) => `<a href="#/${k === 'ajustes' ? 'config' : k}" data-nav="${k}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>${n}</a>`).join('')}</nav><main id="view"></main></div>`);
  S.booted = true;
  if (!location.hash || location.hash === '#') location.hash = '#/painel';
  route();
  bump();
}
function route() {
  const view = $('#view');
  if (!view || !S.dk) return;
  const [, a, id] = (location.hash || '#/painel').split('/');
  const map = { painel: 'painel', clientes: 'clientes', projetos: 'projetos', despesas: 'despesas', config: 'ajustes', doc: 'projetos' };
  document.querySelectorAll('[data-nav]').forEach((n) => n.classList.toggle('on', n.dataset.nav === (map[a] || 'painel')));
  if (a === 'projetos' && id && id !== S.lastProj) S.ptab = 'resumo';
  if (a === 'clientes' && id && id !== S.lastCli) S.ctab = 'projetos';
  if (a === 'projetos') S.lastProj = id || null;
  if (a === 'clientes') S.lastCli = id || null;
  let html;
  try {
    if (a === 'clientes') html = id ? vClient(id) : vClients();
    else if (a === 'projetos') html = id ? vProject(id) : vProjects();
    else if (a === 'despesas') html = vExpenses();
    else if (a === 'config') html = vSettings();
    else if (a === 'doc') html = vDoc(id);
    else html = vDashboard();
  } catch (e) { console.error(e); html = `<div class="empty">Algo deu errado ao montar esta tela.</div>`; }
  view.innerHTML = html;
  window.scrollTo(0, 0);
}
addEventListener('hashchange', route);

/* ============ painel ============ */
function periodStart(p) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (p === 'semana') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  else if (p === 'mes') d.setDate(1);
  else if (p === 'ano') d.setMonth(0, 1);
  else return '0000-00-00';
  return ymd(d);
}
function buildAlerts() {
  const t = today(), in7 = ymd(new Date(Date.now() + 7 * 864e5)), in30 = ymd(new Date(Date.now() + 30 * 864e5));
  const label = (pid) => { const p = projectOf(pid); const c = p && clientOf(p.client_id); return p ? `${p.name}${c ? ' · ' + c.name : ''}` : ''; };
  const out = [];
  for (const p of S.payments) {
    if (p.paid_at || !p.due_date) continue;
    if (p.due_date < t) out.push({ lvl: 'bad', href: `#/projetos/${p.project_id}`, txt: `Pagamento atrasado: ${brl(p.amount)} — ${label(p.project_id)} (venceu ${fmtDate(p.due_date)})` });
    else if (p.due_date <= in7) out.push({ lvl: 'warn', href: `#/projetos/${p.project_id}`, txt: `Pagamento vence ${fmtDate(p.due_date)}: ${brl(p.amount)} — ${label(p.project_id)}` });
  }
  for (const pr of S.projects) {
    if (isDone(pr) || !pr.due_date) continue;
    if (pr.due_date < t) out.push({ lvl: 'bad', href: `#/projetos/${pr.id}`, txt: `Prazo vencido (${fmtDate(pr.due_date)}): ${label(pr.id)}` });
    else if (pr.due_date <= in7) out.push({ lvl: 'warn', href: `#/projetos/${pr.id}`, txt: `Prazo chegando (${fmtDate(pr.due_date)}): ${label(pr.id)}` });
  }
  for (const s of S.services) {
    if (!s.expires_at) continue;
    if (s.expires_at < t) out.push({ lvl: 'bad', href: `#/projetos/${s.project_id}`, txt: `Vencido: ${s.label || SERVICE_KINDS[s.kind]} (${fmtDate(s.expires_at)}) — ${label(s.project_id)}` });
    else if (s.expires_at <= in30) out.push({ lvl: 'warn', href: `#/projetos/${s.project_id}`, txt: `Vence em breve: ${s.label || SERVICE_KINDS[s.kind]} (${fmtDate(s.expires_at)}) — ${label(s.project_id)}` });
  }
  return out;
}
function vDashboard() {
  const start = periodStart(S.period);
  const inP = (d) => d && String(d).slice(0, 10) >= start;
  const rev = sum(S.payments.filter((p) => p.paid_at && inP(p.paid_at)), (p) => p.amount);
  const exp = sum(S.expenses.filter((e) => inP(e.spent_at)), (e) => e.amount);
  const receivable = sum(S.projects, balanceOf);
  const newProj = S.projects.filter((p) => inP(ymd(new Date(p.created_at)))).length;
  const delivered = S.projects.filter((p) => p.published_at && inP(p.published_at)).length;
  const newCli = S.clients.filter((c) => inP(ymd(new Date(c.created_at)))).length;
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
    const k = ymd(d).slice(0, 7);
    months.push({ k, n: d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''),
      r: sum(S.payments.filter((p) => p.paid_at && p.paid_at.slice(0, 7) === k), (p) => p.amount),
      e: sum(S.expenses.filter((x) => x.spent_at.slice(0, 7) === k), (x) => x.amount) });
  }
  const max = Math.max(1, ...months.flatMap((m) => [m.r, m.e]));
  const active = S.projects.filter((p) => !isDone(p));
  const al = buildAlerts();
  const per = [['semana', 'Semana'], ['mes', 'Mês'], ['ano', 'Ano'], ['total', 'Total']];
  return `<div class="page-h"><h1>Painel</h1></div>
  <div class="tabs">${per.map(([k, n]) => `<button class="tab ${S.period === k ? 'on' : ''}" data-action="period" data-p="${k}">${n}</button>`).join('')}</div>
  <div class="grid g4">
    <div class="stat"><div class="k">Faturamento</div><div class="v pos">${brl(rev)}</div></div>
    <div class="stat"><div class="k">Despesas</div><div class="v">${brl(exp)}</div></div>
    <div class="stat"><div class="k">Lucro</div><div class="v ${rev - exp < 0 ? 'neg' : ''}">${brl(rev - exp)}</div></div>
    <div class="stat"><div class="k">A receber (total)</div><div class="v warn">${brl(receivable)}</div></div>
    <div class="stat"><div class="k">Projetos novos</div><div class="v">${newProj}</div></div>
    <div class="stat"><div class="k">Entregues</div><div class="v">${delivered}</div></div>
    <div class="stat"><div class="k">Clientes novos</div><div class="v">${newCli}</div></div>
    <div class="stat"><div class="k">Em andamento</div><div class="v">${active.length}</div></div>
  </div>
  <div class="section"><h2>Alertas</h2></div>
  ${al.length ? `<div class="stack">${al.map((a) => `<a class="card alert ${a.lvl === 'bad' ? 'bad' : ''}" href="${esc(a.href)}">${esc(a.txt)}</a>`).join('')}</div>` : '<div class="empty">Nada pendente. 🎉</div>'}
  <div class="section"><h2>Últimos 6 meses</h2></div>
  <div class="card"><div class="bars">${months.map((m) => `<div class="m"><div class="pair"><div class="b" style="height:${Math.round((m.r / max) * 100)}%" title="${brl(m.r)}"></div><div class="b e" style="height:${Math.round((m.e / max) * 100)}%" title="${brl(m.e)}"></div></div><span>${esc(m.n)}</span></div>`).join('')}</div>
  <div class="legend"><span><i></i>Recebido</span><span><i class="e"></i>Despesas</span></div></div>
  <div class="section"><h2>Projetos por etapa</h2></div>
  <div class="card stack">${STAGES.map(([k, n]) => { const c = active.filter((p) => p.stage === k).length; return `<a class="item" href="#/projetos" data-action="filter-stage" data-stage="${k}"><span>${n}</span><span class="badge">${c}</span></a>`; }).join('')}</div>`;
}

/* ============ clientes ============ */
function vClients() {
  return `<div class="page-h"><h1>Clientes</h1><button class="btn primary" data-action="new-client">+ Novo</button></div>
  ${S.clients.length ? `<div class="stack">${S.clients.map((c) => {
    const ps = S.projects.filter((p) => p.client_id === c.id);
    return `<a class="card" href="#/clientes/${c.id}"><div class="item"><div><div class="t">${esc(c.name)}</div><div class="muted small">${esc(c.company || '')}</div></div><span class="badge">${ps.length} projeto${ps.length === 1 ? '' : 's'}</span></div></a>`;
  }).join('')}</div>` : '<div class="empty">Nenhum cliente ainda. Toque em “+ Novo”.</div>'}`;
}
function waLink(phone, text) {
  let n = String(phone || '').replace(/\D/g, '');
  if (!n) return '';
  if (n.length <= 11) n = '55' + n;
  return `https://wa.me/${n}?text=${encodeURIComponent(text || '')}`;
}
function vClient(id) {
  const c = clientOf(id);
  if (!c) return '<div class="empty">Cliente não encontrado.</div>';
  const ps = S.projects.filter((p) => p.client_id === id);
  const ids = new Set(ps.map((p) => p.id));
  const tabs = [['projetos', 'Projetos'], ['pagamentos', 'Pagamentos'], ['arquivos', 'Arquivos'], ['historico', 'Histórico']];
  let body = '';
  if (S.ctab === 'projetos') {
    body = `<div class="row between"><span class="muted small">${ps.length} projeto(s)</span><button class="btn sm primary" data-action="new-project" data-client="${id}">+ Projeto</button></div>
    <div class="stack" style="margin-top:10px">${ps.map(projectCard).join('') || '<div class="empty">Sem projetos para este cliente.</div>'}</div>`;
  } else if (S.ctab === 'pagamentos') {
    const pays = S.payments.filter((p) => ids.has(p.project_id));
    body = `<div class="grid g3"><div class="stat"><div class="k">Contratado</div><div class="v">${brl(sum(ps, (p) => p.price))}</div></div><div class="stat"><div class="k">Recebido</div><div class="v pos">${brl(sum(pays.filter((p) => p.paid_at), (p) => p.amount))}</div></div><div class="stat"><div class="k">Saldo</div><div class="v warn">${brl(sum(ps, balanceOf))}</div></div></div>
    <div class="stack" style="margin-top:12px">${pays.map(paymentCard).join('') || '<div class="empty">Nenhum pagamento registrado.</div>'}</div>`;
  } else if (S.ctab === 'arquivos') {
    const ls = S.links.filter((l) => ids.has(l.project_id));
    body = `<div class="stack">${ls.map(linkCard).join('') || '<div class="empty">Nenhum arquivo. Adicione links dentro de cada projeto.</div>'}</div>`;
  } else {
    const lg = S.log.filter((l) => l.client_id === id);
    body = `<div class="stack">${lg.map(logCard).join('') || '<div class="empty">Sem histórico ainda.</div>'}</div>`;
  }
  const wa = waLink(c.whatsapp, `Olá, ${c.name}!`);
  return `<div class="page-h"><div><a class="small" href="#/clientes">← Clientes</a><h1>${esc(c.name)}</h1><div class="muted">${esc(c.company || '')}</div></div>
    <div class="row"><button class="btn sm" data-action="edit-client" data-id="${id}">Editar</button></div></div>
  <div class="card"><dl class="kv" style="margin:0">
    ${c.whatsapp ? `<dt>WhatsApp</dt><dd>${esc(c.whatsapp)} ${wa ? `<a href="${esc(wa)}" target="_blank" rel="noopener noreferrer">abrir</a>` : ''}</dd>` : ''}
    ${c.email ? `<dt>E-mail</dt><dd><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></dd>` : ''}
    ${c.instagram ? `<dt>Instagram</dt><dd>${esc(c.instagram)}</dd>` : ''}
    ${c.notes ? `<dt>Notas</dt><dd>${esc(c.notes)}</dd>` : ''}
    <dt>Desde</dt><dd>${fmtDate(c.created_at)}</dd></dl></div>
  <div class="tabs">${tabs.map(([k, n]) => `<button class="tab ${S.ctab === k ? 'on' : ''}" data-action="ctab" data-tab="${k}">${n}</button>`).join('')}</div>${body}`;
}
function formClient(c = {}) {
  return `<form data-form="client" class="stack"><input type="hidden" name="id" value="${esc(c.id || '')}">
    <label>Nome*<input name="name" required value="${esc(c.name || '')}"></label>
    <label>Empresa<input name="company" value="${esc(c.company || '')}"></label>
    <div class="two"><label>WhatsApp<input name="whatsapp" inputmode="tel" value="${esc(c.whatsapp || '')}"></label><label>E-mail<input name="email" type="email" value="${esc(c.email || '')}"></label></div>
    <label>Instagram<input name="instagram" value="${esc(c.instagram || '')}"></label>
    <label>Observações<textarea name="notes">${esc(c.notes || '')}</textarea></label>
    <div class="row"><button class="btn primary">Salvar</button>${c.id ? `<button type="button" class="btn danger" data-action="del-client" data-id="${c.id}">Excluir</button>` : ''}</div></form>`;
}

/* ============ projetos ============ */
function stageBadge(pr) {
  const done = isDone(pr);
  return `<span class="badge ${done ? 'ok' : ''}">${done ? 'Concluído' : esc(STAGE_NAME[pr.stage] || pr.stage)}</span>`;
}
function projectCard(p) {
  const c = clientOf(p.client_id);
  const idx = STAGES.findIndex(([k]) => k === p.stage);
  return `<a class="card" href="#/projetos/${p.id}"><div class="item"><div><div class="t">${esc(p.name)}</div><div class="muted small">${esc(c?.name || '')}</div></div>${stageBadge(p)}</div>
    <div class="steps">${STAGES.map((_, i) => `<i class="${i < idx ? 'on' : i === idx ? 'now' : ''}"></i>`).join('')}</div>
    <div class="row between small"><span>${brl(p.price)} · recebido ${brl(paidOf(p.id))}</span><span class="muted">${p.due_date ? 'prazo ' + fmtDate(p.due_date) : ''}</span></div></a>`;
}
function vProjects() {
  const list = S.projects.filter((p) => !S.pfilter || p.stage === S.pfilter);
  return `<div class="page-h"><h1>Projetos</h1><button class="btn primary" data-action="new-project">+ Novo</button></div>
  <label>Etapa<select data-action-change="pfilter"><option value="">Todas</option>${STAGES.map(([k, n]) => `<option value="${k}" ${S.pfilter === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
  ${list.length ? `<div class="stack">${list.map(projectCard).join('')}</div>` : '<div class="empty">Nenhum projeto aqui.</div>'}`;
}
function paymentCard(p) {
  const pr = projectOf(p.project_id);
  const late = !p.paid_at && p.due_date && p.due_date < today();
  return `<div class="card"><div class="item"><div><div class="t">${brl(p.amount)} <span class="badge">${PAY_KINDS[p.kind] || p.kind}</span> ${p.paid_at ? '<span class="badge ok">pago</span>' : late ? '<span class="badge bad">atrasado</span>' : '<span class="badge mid">pendente</span>'}</div>
    <div class="muted small">${esc(pr?.name || '')} ${p.paid_at ? '· pago em ' + fmtDate(p.paid_at) : p.due_date ? '· vence ' + fmtDate(p.due_date) : ''} ${p.method ? '· ' + esc(p.method) : ''}</div>${p.notes ? `<div class="small">${esc(p.notes)}</div>` : ''}</div>
    <div class="row">${!p.paid_at ? `<button class="btn sm primary" data-action="pay-today" data-id="${p.id}">Pago hoje</button>` : ''}
    ${!p.paid_at && p.due_date ? `<a class="btn sm" target="_blank" rel="noopener noreferrer" href="${esc(gcal('Cobrar ' + brl(p.amount) + ' — ' + (pr?.name || ''), p.due_date, 'Pagamento do projeto ' + (pr?.name || '')))}">Agenda</a>` : ''}
    <button class="btn sm" data-action="edit-payment" data-id="${p.id}">Editar</button></div></div></div>`;
}
const linkCard = (l) => `<div class="card item"><div><div class="t">${esc(l.title)}</div><a class="small" target="_blank" rel="noopener noreferrer" href="${esc(safeUrl(l.url))}">${esc(l.url)}</a></div><button class="btn sm danger" data-action="del-link" data-id="${l.id}">Remover</button></div>`;
const logCard = (l) => `<div class="card"><div>${esc(l.event)}</div><div class="muted small">${fmtTs(l.created_at)}</div></div>`;
function gcal(title, date, details) {
  const d = String(date).slice(0, 10).replace(/-/g, '');
  const nx = ymd(new Date(new Date(date + 'T12:00:00').getTime() + 864e5)).replace(/-/g, '');
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${d}/${nx}&details=${encodeURIComponent(details || '')}`;
}
function vProject(id) {
  const p = projectOf(id);
  if (!p) return '<div class="empty">Projeto não encontrado.</div>';
  const c = clientOf(p.client_id);
  const paid = paidOf(id), bal = balanceOf(p);
  const tabs = [['resumo', 'Resumo'], ['onde', 'Onde está tudo'], ['pagamentos', 'Pagamentos'], ['arquivos', 'Arquivos'], ['historico', 'Histórico']];
  const idx = STAGES.findIndex(([k]) => k === p.stage);
  const nextStage = STAGES[idx + 1];
  let body = '';
  if (S.ptab === 'resumo') {
    const nextPay = S.payments.filter((x) => x.project_id === id && !x.paid_at).sort((a, b) => String(a.due_date || '9').localeCompare(String(b.due_date || '9')))[0];
    const first = (c?.name || '').split(' ')[0];
    const msgs = [
      ['Demo pronta', `Olá, ${first}! A demo do site ${p.name} está pronta. Posso te mostrar?`],
      ['Cobrar pagamento', `Olá, ${first}! Segue o pagamento referente ao site ${p.name}: ${brl(nextPay ? nextPay.amount : bal)}${nextPay?.due_date ? ' (vencimento ' + fmtDate(nextPay.due_date) + ')' : ''}.${S.settings?.pix_key ? ' Chave Pix: ' + S.settings.pix_key : ''}`],
      ['Site no ar', `Olá, ${first}! Seu site ${p.name} está no ar${p.live_url ? ': ' + p.live_url : '.'}`],
    ];
    body = `<div class="grid g3"><div class="stat"><div class="k">Valor</div><div class="v">${brl(p.price)}</div></div><div class="stat"><div class="k">Recebido</div><div class="v pos">${brl(paid)}</div></div><div class="stat"><div class="k">Saldo</div><div class="v warn">${brl(bal)}</div></div></div>
    <div class="card" style="margin-top:12px"><dl class="kv" style="margin:0">
      <dt>Etapa</dt><dd>${esc(STAGE_NAME[p.stage])}</dd>
      <dt>Prazo</dt><dd>${fmtDate(p.due_date)} ${p.due_date ? `<a target="_blank" rel="noopener noreferrer" href="${esc(gcal('Entrega: ' + p.name, p.due_date, 'Cliente: ' + (c?.name || '')))}">Google Agenda</a>` : ''}</dd>
      <dt>Demo</dt><dd>${p.demo_url ? `<a target="_blank" rel="noopener noreferrer" href="${esc(safeUrl(p.demo_url))}">${esc(p.demo_url)}</a>` : '—'}</dd>
      <dt>Site no ar</dt><dd>${p.live_url ? `<a target="_blank" rel="noopener noreferrer" href="${esc(safeUrl(p.live_url))}">${esc(p.live_url)}</a>` : '—'}</dd>
      <dt>Publicado</dt><dd>${p.published_at ? fmtDate(p.published_at) + ' <button class="link" data-action="set-published" data-id="' + id + '" data-v="0">desmarcar</button>' : 'não <button class="link" data-action="set-published" data-id="' + id + '" data-v="1">marcar como publicado</button>'}</dd>
      ${p.notes ? `<dt>Escopo/notas</dt><dd>${esc(p.notes)}</dd>` : ''}</dl></div>
    <div class="section"><h2>Mensagens e documentos</h2></div>
    <div class="row">${c?.whatsapp ? msgs.map(([n, t]) => `<a class="btn sm" target="_blank" rel="noopener noreferrer" href="${esc(waLink(c.whatsapp, t))}">WhatsApp: ${n}</a>`).join('') : '<span class="muted small">Cadastre o WhatsApp do cliente para ver os atalhos.</span>'}
    <a class="btn sm" href="#/doc/${id}">Orçamento / contrato (PDF)</a></div>
    <div class="section"><h2>Zona de perigo</h2></div><button class="btn danger sm" data-action="del-project" data-id="${id}">Excluir projeto</button>`;
  } else if (S.ptab === 'onde') {
    const ss = S.services.filter((s) => s.project_id === id);
    body = `<div class="row between"><span class="muted small">Senhas ficam criptografadas e só aparecem com confirmação.</span><button class="btn sm primary" data-action="new-service" data-project="${id}">+ Adicionar</button></div>
    <div class="stack" style="margin-top:10px">${ss.map(serviceCard).join('') || '<div class="empty">Cadastre domínio, hospedagem, GitHub, banco, e-mail… com login e senha de cada um.</div>'}</div>`;
  } else if (S.ptab === 'pagamentos') {
    const pays = S.payments.filter((x) => x.project_id === id);
    body = `<div class="row between"><span class="muted small">Recebido ${brl(paid)} de ${brl(p.price)}</span><button class="btn sm primary" data-action="new-payment" data-project="${id}">+ Pagamento</button></div>
    <div class="stack" style="margin-top:10px">${pays.map(paymentCard).join('') || '<div class="empty">Nenhum pagamento registrado.</div>'}</div>`;
  } else if (S.ptab === 'arquivos') {
    const ls = S.links.filter((l) => l.project_id === id);
    body = `<div class="row between"><span class="muted small">Links para contrato, logo, briefing (Drive, etc.)</span><button class="btn sm primary" data-action="new-link" data-project="${id}">+ Link</button></div>
    <div class="stack" style="margin-top:10px">${ls.map(linkCard).join('') || '<div class="empty">Sem arquivos.</div>'}</div>`;
  } else {
    body = `<div class="stack">${S.log.filter((l) => l.project_id === id).map(logCard).join('') || '<div class="empty">Sem histórico.</div>'}</div>`;
  }
  return `<div class="page-h"><div><a class="small" href="#/projetos">← Projetos</a><h1>${esc(p.name)}</h1><a href="#/clientes/${p.client_id}" class="muted">${esc(c?.name || '')}</a></div>
    <div class="row"><button class="btn sm" data-action="edit-project" data-id="${id}">Editar</button></div></div>
  <div class="card"><div class="item"><div class="stack" style="flex:1"><div class="row">${stageBadge(p)}</div>
    <div class="steps">${STAGES.map((_, i) => `<i class="${i < idx ? 'on' : i === idx ? 'now' : ''}"></i>`).join('')}</div></div></div>
    <div class="row" style="margin-top:6px"><select data-action-change="stage" data-id="${id}" style="flex:1;margin:0">${STAGES.map(([k, n]) => `<option value="${k}" ${k === p.stage ? 'selected' : ''}>${n}</option>`).join('')}</select>
    ${nextStage ? `<button class="btn primary" data-action="next-stage" data-id="${id}">→ ${esc(nextStage[1])}</button>` : ''}</div>
    <p class="muted small" style="margin:8px 0 0">Pagamento final e publicação podem acontecer em qualquer ordem.</p></div>
  <div class="tabs">${tabs.map(([k, n]) => `<button class="tab ${S.ptab === k ? 'on' : ''}" data-action="ptab" data-tab="${k}">${n}</button>`).join('')}</div>${body}`;
}
function formProject(p = {}, presetClient = '') {
  const cid = p.client_id || presetClient;
  return `<form data-form="project" class="stack"><input type="hidden" name="id" value="${esc(p.id || '')}">
    <label>Cliente*<select name="client_id" required><option value="">Selecione…</option>${S.clients.map((c) => `<option value="${c.id}" ${c.id === cid ? 'selected' : ''}>${esc(c.name)}${c.company ? ' — ' + esc(c.company) : ''}</option>`).join('')}</select></label>
    <label>Nome do projeto*<input name="name" required value="${esc(p.name || '')}" placeholder="Ex.: Site da doceria"></label>
    <div class="two"><label>Valor (R$)<input name="price" type="number" step="0.01" min="0" inputmode="decimal" value="${esc(p.price ?? '')}"></label><label>Prazo<input name="due_date" type="date" value="${esc(p.due_date || '')}"></label></div>
    <label>Etapa<select name="stage">${STAGES.map(([k, n]) => `<option value="${k}" ${k === (p.stage || 'demo') ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <label>Link da demo<input name="demo_url" value="${esc(p.demo_url || '')}" placeholder="GitHub Pages ou arquivo"></label>
    <label>Link do site no ar<input name="live_url" value="${esc(p.live_url || '')}"></label>
    <label>Escopo / notas<textarea name="notes">${esc(p.notes || '')}</textarea></label>
    <button class="btn primary">Salvar</button></form>`;
}

/* ============ serviços (cofre) ============ */
function serviceCard(s) {
  const k = SERVICE_KINDS[s.kind] || 'Outro';
  const exp = s.expires_at ? (s.expires_at < today() ? `<span class="badge bad">venceu ${fmtDate(s.expires_at)}</span>` : `<span class="badge">vence ${fmtDate(s.expires_at)}</span>`) : '';
  return `<div class="card"><div class="item"><div><div class="t">${esc(s.label || k)} <span class="badge">${esc(k)}</span> ${exp}</div><div class="muted small">${esc(s.provider || '')}</div></div>
    <button class="btn sm" data-action="edit-service" data-id="${s.id}">Editar</button></div>
    <dl class="kv" style="margin:10px 0 0">
    ${s.url ? `<dt>Link</dt><dd><a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.url)}</a></dd>` : ''}
    ${s.username ? `<dt>Usuário</dt><dd>${esc(s.username)} <button class="link" data-action="copy" data-text="${esc(s.username)}">copiar</button></dd>` : ''}
    ${s.secret_ciphertext ? `<dt>Senha</dt><dd><span class="secret" id="sec-${s.id}">••••••••</span> <button class="link" data-action="reveal" data-id="${s.id}">mostrar</button> <button class="link" data-action="copy-secret" data-id="${s.id}">copiar</button><div id="secnote-${s.id}" class="small muted"></div></dd>` : ''}
    ${s.notes ? `<dt>Notas</dt><dd>${esc(s.notes)}</dd>` : ''}</dl></div>`;
}
async function openServiceForm(s = {}, projectId = '') {
  let sec = { p: '', n: '' };
  if (s.id && s.secret_ciphertext) {
    if (!(await freshAuth())) return;
    try { sec = await V.decryptSecret(S.dk, s.id, s.secret_ciphertext, s.secret_iv); } catch { toast('Não foi possível abrir esta senha', true); return; }
  }
  openModal(s.id ? 'Editar acesso' : 'Novo acesso', `<form data-form="service" class="stack"><input type="hidden" name="id" value="${esc(s.id || '')}"><input type="hidden" name="project_id" value="${esc(s.project_id || projectId)}">
    <div class="two"><label>Tipo<select name="kind">${Object.entries(SERVICE_KINDS).map(([k, n]) => `<option value="${k}" ${k === (s.kind || 'dominio') ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <label>Nome<input name="label" value="${esc(s.label || '')}" placeholder="Ex.: Registro.br"></label></div>
    <label>Onde está cadastrado (provedor)<input name="provider" value="${esc(s.provider || '')}"></label>
    <label>Link de acesso<input name="url" value="${esc(s.url || '')}"></label>
    <label>Usuário / login<input name="username" autocomplete="off" value="${esc(s.username || '')}"></label>
    <label>Senha (criptografada)<input name="password" type="text" autocomplete="off" spellcheck="false" value="${esc(sec.p || '')}"></label>
    <label>Notas secretas (criptografadas: 2FA, recuperação…)<textarea name="secretnote" autocomplete="off">${esc(sec.n || '')}</textarea></label>
    <label>Vencimento (domínio, hospedagem…)<input name="expires_at" type="date" value="${esc(s.expires_at || '')}"></label>
    <label>Observações (NÃO criptografadas — não coloque senhas aqui)<textarea name="notes">${esc(s.notes || '')}</textarea></label>
    <div class="row"><button class="btn primary">Salvar</button>${s.id ? `<button type="button" class="btn danger" data-action="del-service" data-id="${s.id}">Excluir</button>` : ''}</div></form>`);
}
async function getSecret(id) {
  const s = S.services.find((x) => x.id === id);
  if (!s?.secret_ciphertext) return null;
  if (!(await freshAuth())) return null;
  try { return await V.decryptSecret(S.dk, id, s.secret_ciphertext, s.secret_iv); } catch { toast('Não foi possível abrir esta senha', true); return null; }
}

/* ============ despesas ============ */
function vExpenses() {
  const total = sum(S.expenses, (e) => e.amount);
  return `<div class="page-h"><h1>Despesas</h1><button class="btn primary" data-action="new-expense">+ Nova</button></div>
  <div class="grid"><div class="stat"><div class="k">Total</div><div class="v">${brl(total)}</div></div><div class="stat"><div class="k">Este mês</div><div class="v">${brl(sum(S.expenses.filter((e) => e.spent_at >= periodStart('mes')), (e) => e.amount))}</div></div></div>
  <div class="stack" style="margin-top:12px">${S.expenses.map((e) => { const pr = projectOf(e.project_id); return `<div class="card item"><div><div class="t">${esc(e.description)} ${e.category ? `<span class="badge">${esc(e.category)}</span>` : ''}</div><div class="muted small">${fmtDate(e.spent_at)} ${pr ? '· ' + esc(pr.name) : ''}</div></div><div class="row"><b>${brl(e.amount)}</b><button class="btn sm" data-action="edit-expense" data-id="${e.id}">Editar</button></div></div>`; }).join('') || '<div class="empty">Nenhuma despesa registrada (domínio, hospedagem, ferramentas…).</div>'}</div>`;
}
function formExpense(e = {}) {
  return `<form data-form="expense" class="stack"><input type="hidden" name="id" value="${esc(e.id || '')}">
    <label>Descrição*<input name="description" required value="${esc(e.description || '')}" placeholder="Ex.: Domínio .com.br"></label>
    <div class="two"><label>Valor (R$)*<input name="amount" type="number" step="0.01" min="0" required inputmode="decimal" value="${esc(e.amount ?? '')}"></label><label>Data<input name="spent_at" type="date" required value="${esc(e.spent_at || today())}"></label></div>
    <div class="two"><label>Categoria<input name="category" value="${esc(e.category || '')}" placeholder="domínio, hospedagem…"></label>
    <label>Projeto<select name="project_id"><option value="">— geral —</option>${S.projects.map((p) => `<option value="${p.id}" ${p.id === e.project_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label></div>
    <div class="row"><button class="btn primary">Salvar</button>${e.id ? `<button type="button" class="btn danger" data-action="del-expense" data-id="${e.id}">Excluir</button>` : ''}</div></form>`;
}

/* ============ pagamentos / links ============ */
function formPayment(p = {}, projectId = '') {
  return `<form data-form="payment" class="stack"><input type="hidden" name="id" value="${esc(p.id || '')}"><input type="hidden" name="project_id" value="${esc(p.project_id || projectId)}">
    <div class="two"><label>Tipo<select name="kind">${Object.entries(PAY_KINDS).map(([k, n]) => `<option value="${k}" ${k === (p.kind || 'entrada') ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <label>Valor (R$)*<input name="amount" type="number" step="0.01" min="0" required inputmode="decimal" value="${esc(p.amount ?? '')}"></label></div>
    <div class="two"><label>Vencimento<input name="due_date" type="date" value="${esc(p.due_date || '')}"></label><label>Pago em<input name="paid_at" type="date" value="${esc(p.paid_at || '')}"></label></div>
    <label>Forma (Pix, cartão…)<input name="method" value="${esc(p.method || '')}"></label>
    <label>Observações<textarea name="notes">${esc(p.notes || '')}</textarea></label>
    <div class="row"><button class="btn primary">Salvar</button>${p.id ? `<button type="button" class="btn danger" data-action="del-payment" data-id="${p.id}">Excluir</button>` : ''}</div></form>`;
}

/* ============ orçamento / contrato (imprimir → PDF) ============ */
function vDoc(id) {
  const p = projectOf(id);
  if (!p) return '<div class="empty">Projeto não encontrado.</div>';
  const c = clientOf(p.client_id) || {};
  const st = S.settings || {};
  const ent = S.payments.filter((x) => x.project_id === id && x.kind === 'entrada');
  const entAmt = ent.length ? sum(ent, (x) => x.amount) : 0;
  const isC = S.doctype === 'contrato';
  const who = st.business_name || 'Prestador';
  const parts = `<table><tr><th>Contratado</th><th>Contratante</th></tr><tr><td>${esc(who)}<br>${st.business_doc ? 'CPF/CNPJ: ' + esc(st.business_doc) + '<br>' : ''}${esc(st.business_email || '')} ${esc(st.business_whatsapp || '')}</td><td>${esc(c.name || '')}${c.company ? ' — ' + esc(c.company) : ''}<br>${esc(c.email || '')} ${esc(c.whatsapp || '')}</td></tr></table>`;
  const valor = `<h2>Valor e pagamento</h2><p>Valor total: <b>${brl(p.price)}</b>${entAmt ? `, sendo <b>${brl(entAmt)}</b> de entrada para início da produção e o restante na confirmação/publicação` : ', com forma de pagamento a combinar (entrada e saldo)'}.${st.pix_key ? ` Chave Pix: <b>${esc(st.pix_key)}</b>.` : ''}</p>`;
  const prazo = `<h2>Prazo</h2><p>${p.due_date ? 'Entrega prevista até <b>' + fmtDate(p.due_date) + '</b>, desde que o contratante envie textos, imagens e acessos necessários em tempo hábil.' : 'Prazo a combinar após a aprovação da demonstração.'}</p>`;
  const escopo = `<h2>Escopo</h2><p>${p.notes ? esc(p.notes).replace(/\n/g, '<br>') : 'Criação do site “' + esc(p.name) + '”, conforme demonstração apresentada ao contratante.'}</p>`;
  const clausulas = `<h2>Condições</h2><ol>
    <li>O trabalho segue as etapas: demonstração, aprovação, pagamento inicial, produção, confirmação, pagamento final e publicação.</li>
    <li>Alterações fora do escopo acordado serão orçadas à parte.</li>
    <li>Após o pagamento integral, o contratante recebe o direito de uso do site entregue. O contratado poderá exibir o projeto em seu portfólio.</li>
    <li>O contratante é responsável pelo conteúdo (textos, marcas e imagens) que fornecer.</li>
    <li>Domínio e hospedagem, quando não incluídos, são custos do contratante.</li></ol>
    <p class="meta">Modelo simples. Revise e adapte antes de assinar.</p>`;
  return `<div class="page-h no-print"><div><a class="small" href="#/projetos/${id}">← Projeto</a><h1>${isC ? 'Contrato' : 'Orçamento'}</h1></div>
    <div class="row"><button class="btn sm ${isC ? '' : 'primary'}" data-action="doctype" data-t="orcamento">Orçamento</button><button class="btn sm ${isC ? 'primary' : ''}" data-action="doctype" data-t="contrato">Contrato</button><button class="btn sm primary" data-action="print">Imprimir / salvar PDF</button></div></div>
  <div class="doc"><h1>${isC ? 'Contrato de prestação de serviços — criação de site' : 'Orçamento — criação de site'}</h1>
  <p class="meta">Projeto: ${esc(p.name)} · Emitido em ${fmtDate(today())}${isC ? '' : ' · Validade: 7 dias'}</p>${parts}${escopo}${valor}${prazo}${isC ? clausulas : ''}
  ${isC ? `<div class="sig"><div>${esc(who)}</div><div>${esc(c.name || 'Contratante')}</div></div>` : '<p class="meta" style="margin-top:24px">Para aprovar, responda esta mensagem confirmando o orçamento.</p>'}</div>`;
}

/* ============ ajustes ============ */
function vSettings() {
  const st = S.settings || {};
  const bio = V.deviceInfo();
  return `<div class="page-h"><h1>Ajustes</h1></div>
  <div class="section"><h2>Dados para orçamento e contrato</h2></div>
  <form class="card stack" data-form="settings">
    <label>Seu nome / marca<input name="business_name" value="${esc(st.business_name || '')}"></label>
    <div class="two"><label>WhatsApp<input name="business_whatsapp" value="${esc(st.business_whatsapp || '')}"></label><label>E-mail<input name="business_email" type="email" value="${esc(st.business_email || '')}"></label></div>
    <div class="two"><label>CPF/CNPJ<input name="business_doc" value="${esc(st.business_doc || '')}"></label><label>Chave Pix<input name="pix_key" value="${esc(st.pix_key || '')}"></label></div>
    <button class="btn primary">Salvar</button></form>
  <div class="section"><h2>Segurança</h2></div>
  <div class="card stack">
    <div class="item"><div><div class="t">Biometria neste aparelho</div><div class="muted small">${bio ? 'Ativa (' + (bio.mode === 'prf' ? 'chave protegida pelo aparelho' : 'atalho de acesso') + '). O login normal continua valendo.' : 'Atalho para abrir o app com digital ou rosto.'}</div></div>
    ${bio ? '<button class="btn sm" data-action="disable-bio">Desativar</button>' : '<button class="btn sm primary" data-action="enable-bio">Ativar</button>'}</div>
    <div class="item"><div><div class="t">Trocar senha</div><div class="muted small">Também reprotege o cofre com a nova senha.</div></div><button class="btn sm" data-action="change-pw">Trocar</button></div>
    <div class="item"><div><div class="t">Bloquear agora</div><div class="muted small">Bloqueia sozinho após 5 min parado ou 1 min em segundo plano.</div></div><button class="btn sm" data-action="lock">Bloquear</button></div>
  </div>
  <div class="section"><h2>Backup</h2></div>
  <div class="card stack"><p class="muted small" style="margin:0">Gera um arquivo com todos os dados (senhas continuam criptografadas). No celular, escolha “Drive” no menu de compartilhar para guardar lá.</p><button class="btn" data-action="export">Exportar tudo</button>
    <p class="muted small" style="margin:0">Restaurar: lê um arquivo de backup e recoloca os registros (mescla com o que já existe, não apaga nada). Senhas só abrem se o backup for da mesma conta/cofre.</p>
    <label class="btn" style="text-align:center;cursor:pointer">Restaurar de arquivo<input type="file" accept="application/json,.json" data-action-change="restore-file" hidden></label></div>
  <div class="section"><h2>Conta</h2></div>
  <div class="card item"><div><div class="t">${esc(S.user?.email || '')}</div><div class="muted small">Sair apaga a biometria deste aparelho.</div></div><button class="btn sm danger" data-action="logout">Sair</button></div>`;
}
async function exportAll() {
  const dump = { app: 'central', version: 1, exported_at: new Date().toISOString(), vault_keys: S.vaultRow,
    tables: { clients: S.clients, projects: S.projects, project_services: S.services, payments: S.payments, expenses: S.expenses, project_links: S.links, activity_log: S.log, app_settings: S.settings } };
  const file = new File([JSON.stringify(dump, null, 2)], `central-backup-${today()}.json`, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Backup Central' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Backup baixado');
}

const RESTORE_ORDER = ['clients', 'projects', 'project_services', 'payments', 'expenses', 'project_links', 'activity_log'];
async function restoreBackup(file) {
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) return toast('Arquivo grande demais para ser um backup do Central.', true);
  let dump;
  try { dump = JSON.parse(await file.text()); } catch { return toast('Arquivo inválido (não é JSON).', true); }
  if (dump?.app !== 'central' || typeof dump.tables !== 'object' || !dump.tables) return toast('Este arquivo não é um backup do Central.', true);
  const t = dump.tables;
  for (const k of [...RESTORE_ORDER, 'app_settings']) {
    if (k === 'app_settings' ? (t[k] != null && typeof t[k] !== 'object') : (t[k] != null && !Array.isArray(t[k]))) return toast('Backup com formato inesperado: ' + k, true);
  }
  const resumo = RESTORE_ORDER.map((k) => `${(t[k] || []).length} ${k.replace('_', ' ')}`).join(', ');
  if (!(await confirmModal(`Restaurar backup de ${fmtDate((dump.exported_at || '').slice(0, 10))}? (${resumo}). Registros com o mesmo id serão sobrescritos; nada é apagado.`))) return;
  const uid = S.user.id;
  for (const k of RESTORE_ORDER) {
    const rows = (t[k] || []).map((r) => ({ ...r, user_id: uid }));
    for (let i = 0; i < rows.length; i += 200) {
      const r = await sb.from(k).upsert(rows.slice(i, i + 200), { onConflict: 'id' });
      if (r.error) throw new Error(`Falha em ${k}: ${r.error.message}`);
    }
  }
  if (t.app_settings) {
    const r = await sb.from('app_settings').upsert({ ...t.app_settings, user_id: uid }, { onConflict: 'user_id' });
    if (r.error) throw new Error('Falha em app_settings: ' + r.error.message);
  }
  await refresh();
  toast('Backup restaurado');
}

/* ============ ações (cliques) ============ */
const act = {
  'show-signup': showSignup,
  'show-login': () => showLogin(),
  'show-recover': () => showRecover(''),
  'close-modal': () => closeModal(null),
  'ask-yes': () => closeModal({ ok: true }),
  logout,
  lock,
  'unlock-bio': () => unlockBio(false),
  period: (el) => { S.period = el.dataset.p; route(); },
  ptab: (el) => { S.ptab = el.dataset.tab; route(); },
  ctab: (el) => { S.ctab = el.dataset.tab; route(); },
  'filter-stage': (el) => { S.pfilter = el.dataset.stage; },
  doctype: (el) => { S.doctype = el.dataset.t; route(); },
  print: () => window.print(),
  copy: async (el) => { await navigator.clipboard.writeText(el.dataset.text); toast('Copiado'); },
  'new-client': () => openModal('Novo cliente', formClient()),
  'edit-client': (el) => openModal('Editar cliente', formClient(clientOf(el.dataset.id))),
  'del-client': (el) => guard(async () => {
    const id = el.dataset.id;
    if (S.projects.some((p) => p.client_id === id)) return toast('Exclua ou mova os projetos deste cliente primeiro.', true);
    if (!(await confirmModal('Excluir este cliente?'))) return;
    await remove('clients', id); closeModal(); location.hash = '#/clientes'; await refresh();
  }),
  'new-project': (el) => {
    if (!S.clients.length) return toast('Cadastre um cliente primeiro.', true);
    openModal('Novo projeto', formProject({}, el.dataset.client || ''));
  },
  'edit-project': (el) => openModal('Editar projeto', formProject(projectOf(el.dataset.id))),
  'del-project': (el) => guard(async () => {
    if (!(await confirmModal('Excluir este projeto com pagamentos, acessos e links?'))) return;
    await remove('projects', el.dataset.id); location.hash = '#/projetos'; await refresh();
  }),
  'next-stage': (el) => guard(async () => {
    const p = projectOf(el.dataset.id);
    const nx = STAGES[STAGES.findIndex(([k]) => k === p.stage) + 1];
    if (nx) await setStage(p, nx[0]);
  }),
  'set-published': (el) => guard(async () => {
    await save('projects', el.dataset.id, { published_at: el.dataset.v === '1' ? today() : null });
    await logEvent(projectOf(el.dataset.id).client_id, el.dataset.id, el.dataset.v === '1' ? 'Marcado como publicado' : 'Publicação desmarcada');
    await refresh();
  }),
  'new-service': (el) => openServiceForm({}, el.dataset.project),
  'edit-service': (el) => openServiceForm(S.services.find((s) => s.id === el.dataset.id)),
  'del-service': (el) => guard(async () => {
    if (!(await confirmModal('Excluir este acesso?'))) return;
    const s = S.services.find((x) => x.id === el.dataset.id);
    await remove('project_services', s.id); await logEvent(projectOf(s.project_id)?.client_id, s.project_id, 'Acesso removido: ' + (s.label || SERVICE_KINDS[s.kind]));
    closeModal(); await refresh();
  }),
  reveal: (el) => guard(async () => {
    const sec = await getSecret(el.dataset.id);
    if (!sec) return;
    const span = $(`#sec-${CSS.escape(el.dataset.id)}`), note = $(`#secnote-${CSS.escape(el.dataset.id)}`);
    span.textContent = sec.p || '(vazia)';
    if (note && sec.n) note.textContent = sec.n;
    setTimeout(() => { if (span.isConnected) span.textContent = '••••••••'; if (note?.isConnected) note.textContent = ''; }, 20000);
  }),
  'copy-secret': (el) => guard(async () => {
    const sec = await getSecret(el.dataset.id);
    if (!sec?.p) return;
    await navigator.clipboard.writeText(sec.p);
    toast('Senha copiada (limpa em 30 s)');
    setTimeout(() => navigator.clipboard.writeText('').catch(() => {}), 30000);
  }),
  'new-payment': (el) => openModal('Novo pagamento', formPayment({}, el.dataset.project)),
  'edit-payment': (el) => openModal('Editar pagamento', formPayment(S.payments.find((p) => p.id === el.dataset.id))),
  'pay-today': (el) => guard(async () => {
    const p = S.payments.find((x) => x.id === el.dataset.id);
    await save('payments', p.id, { paid_at: today() });
    await logEvent(projectOf(p.project_id)?.client_id, p.project_id, `Pagamento recebido: ${brl(p.amount)} (${PAY_KINDS[p.kind]})`);
    await refresh(); toast('Pagamento registrado');
  }),
  'del-payment': (el) => guard(async () => {
    if (!(await confirmModal('Excluir este pagamento?'))) return;
    await remove('payments', el.dataset.id); closeModal(); await refresh();
  }),
  'new-link': (el) => openModal('Novo link', `<form data-form="link" class="stack"><input type="hidden" name="project_id" value="${esc(el.dataset.project)}"><label>Título*<input name="title" required placeholder="Contrato, logo, briefing…"></label><label>Link*<input name="url" required placeholder="https://drive.google.com/…"></label><button class="btn primary">Salvar</button></form>`),
  'del-link': (el) => guard(async () => { await remove('project_links', el.dataset.id); await refresh(); }),
  'new-expense': () => openModal('Nova despesa', formExpense()),
  'edit-expense': (el) => openModal('Editar despesa', formExpense(S.expenses.find((e) => e.id === el.dataset.id))),
  'del-expense': (el) => guard(async () => {
    if (!(await confirmModal('Excluir esta despesa?'))) return;
    await remove('expenses', el.dataset.id); closeModal(); await refresh();
  }),
  'enable-bio': () => guard(async () => {
    if (!(await V.biometricSupported())) return toast('Este aparelho/navegador não oferece biometria.', true);
    if (!(await freshAuth())) return;
    const mode = await V.enableBiometric(S.dk, S.user.email);
    toast(mode === 'prf' ? 'Biometria ativada (protegida pelo aparelho)' : 'Biometria ativada'); route();
  }),
  'disable-bio': () => guard(async () => { await V.disableBiometric(); toast('Biometria desativada'); route(); }),
  'change-pw': () => openModal('Trocar senha', `<form data-form="changepw" class="stack"><label>Nova senha (12+ caracteres)<input name="pw" type="password" autocomplete="new-password" minlength="12" required></label><label>Repita<input name="pw2" type="password" autocomplete="new-password" minlength="12" required></label><button class="btn primary">Trocar</button></form>`),
  export: () => guard(exportAll),
};
async function setStage(p, stage) {
  const patch = { stage };
  if (stage === 'publicacao' && !p.published_at) patch.published_at = today();
  await save('projects', p.id, patch);
  await refresh();
}
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = act[el.dataset.action];
  if (fn) { if (el.tagName === 'BUTTON' || el.dataset.action === 'close-modal') e.preventDefault?.(); Promise.resolve(fn(el, e)).catch((err) => toast(friendly(err), true)); }
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-action-change]');
  if (!el) return;
  if (el.dataset.actionChange === 'pfilter') { S.pfilter = el.value; route(); }
  if (el.dataset.actionChange === 'restore-file') { const f = el.files?.[0]; el.value = ''; guard(() => restoreBackup(f)); }
  if (el.dataset.actionChange === 'stage') guard(() => setStage(projectOf(el.dataset.id), el.value));
});
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(null); });

/* ============ formulários ============ */
const forms = {
  login: async (f, d) => {
    const { data, error } = await sb.auth.signInWithPassword({ email: d.email.trim(), password: d.password });
    if (error) throw error;
    S.user = data.user; S.loginPassword = d.password;
    await afterSignIn();
  },
  signup: async (f, d) => {
    if (d.password !== d.password2) throw new Error('As senhas não conferem.');
    if (d.password.length < 12) throw new Error('Use pelo menos 12 caracteres.');
    const { data, error } = await sb.auth.signUp({ email: d.email.trim(), password: d.password });
    if (error) throw error;
    if (data.session) { S.user = data.user; S.loginPassword = d.password; return afterSignIn(); }
    showLogin('Enviamos um link de confirmação para o seu e-mail. Confirme e entre aqui.');
  },
  mfa: async (f, d) => {
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: f.dataset.factor, code: d.code.trim() });
    if (error) throw error;
    const { data } = await sb.auth.getUser();
    S.user = data.user || S.user;
    await afterAal2();
  },
  vaultpw: async (f, d) => { await createVaultFlow(d.password); },
  'recovery-done': async () => { S.loginPassword = null; await enterApp(); },
  recover: async (f, d) => {
    const dk = await V.openWithRecovery(S.vaultRow, d.key).catch(() => { throw new Error('Chave de recuperação incorreta.'); });
    const patch = await V.rewrapPassword(dk, d.password);
    const r = await sb.from('vault_keys').update(patch).eq('user_id', S.user.id).select().single();
    if (r.error) throw r.error;
    S.vaultRow = r.data; S.dk = dk; S.lastAuthAt = Date.now(); S.loginPassword = null;
    toast('Cofre recuperado');
    await enterApp();
  },
  unlock: async (f, d) => {
    if (!d.password) return toast('Digite a senha ou use a biometria.', true);
    try { S.dk = await V.openWithPassword(S.vaultRow, d.password); } catch { throw new Error('Senha incorreta.'); }
    S.lastAuthAt = Date.now();
    await enterApp();
  },
  ask: (f, d) => closeModal(d),
  client: async (f, d) => {
    const obj = { name: d.name.trim(), company: nn(d.company), whatsapp: nn(d.whatsapp), email: nn(d.email), instagram: nn(d.instagram), notes: nn(d.notes) };
    const row = await save('clients', d.id || null, obj);
    closeModal(); await refresh();
    if (!d.id) location.hash = '#/clientes/' + row.id;
  },
  project: async (f, d) => {
    const prev = d.id ? projectOf(d.id) : null;
    const obj = { client_id: d.client_id, name: d.name.trim(), price: num(d.price), due_date: nn(d.due_date), stage: d.stage, demo_url: nn(d.demo_url), live_url: nn(d.live_url), notes: nn(d.notes) };
    if (d.stage === 'publicacao' && !prev?.published_at) obj.published_at = today();
    const row = await save('projects', d.id || null, obj);
    closeModal(); await refresh();
    if (!d.id) { S.ptab = 'resumo'; location.hash = '#/projetos/' + row.id; }
  },
  service: async (f, d) => {
    const id = d.id || crypto.randomUUID();
    const obj = { kind: d.kind, label: nn(d.label), provider: nn(d.provider), url: nn(d.url), username: nn(d.username), expires_at: nn(d.expires_at), notes: nn(d.notes), project_id: d.project_id };
    if (d.password || d.secretnote) Object.assign(obj, await V.encryptSecret(S.dk, id, { p: d.password || '', n: d.secretnote || '' }));
    else Object.assign(obj, { secret_ciphertext: null, secret_iv: null });
    if (d.id) await save('project_services', d.id, obj); else await save('project_services', null, { ...obj, id });
    await logEvent(projectOf(d.project_id)?.client_id, d.project_id, (d.id ? 'Acesso atualizado: ' : 'Acesso adicionado: ') + (obj.label || SERVICE_KINDS[obj.kind]));
    closeModal(); S.ptab = 'onde'; await refresh();
  },
  payment: async (f, d) => {
    const obj = { project_id: d.project_id, kind: d.kind, amount: num(d.amount), due_date: nn(d.due_date), paid_at: nn(d.paid_at), method: nn(d.method), notes: nn(d.notes) };
    await save('payments', d.id || null, obj);
    if (obj.paid_at) await logEvent(projectOf(d.project_id)?.client_id, d.project_id, `Pagamento recebido: ${brl(obj.amount)} (${PAY_KINDS[obj.kind]})`);
    closeModal(); S.ptab = 'pagamentos'; await refresh();
  },
  link: async (f, d) => {
    await save('project_links', null, { project_id: d.project_id, title: d.title.trim(), url: d.url.trim() });
    closeModal(); S.ptab = 'arquivos'; await refresh();
  },
  expense: async (f, d) => {
    await save('expenses', d.id || null, { description: d.description.trim(), amount: num(d.amount), spent_at: d.spent_at, category: nn(d.category), project_id: nn(d.project_id) });
    closeModal(); await refresh();
  },
  settings: async (f, d) => {
    const r = await sb.from('app_settings').upsert({ user_id: S.user.id, business_name: nn(d.business_name), business_whatsapp: nn(d.business_whatsapp), business_email: nn(d.business_email), business_doc: nn(d.business_doc), pix_key: nn(d.pix_key) }).select().single();
    if (r.error) throw r.error;
    S.settings = r.data; toast('Salvo');
  },
  changepw: async (f, d) => {
    if (d.pw !== d.pw2) throw new Error('As senhas não conferem.');
    if (d.pw.length < 12) throw new Error('Use pelo menos 12 caracteres.');
    const { error } = await sb.auth.updateUser({ password: d.pw });
    if (error) throw error;
    const patch = await V.rewrapPassword(S.dk, d.pw);
    const r = await sb.from('vault_keys').update(patch).eq('user_id', S.user.id).select().single();
    if (r.error) throw r.error;
    S.vaultRow = r.data; closeModal(); toast('Senha trocada');
  },
};
document.addEventListener('submit', (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  const fn = forms[f.dataset.form];
  if (!fn) return;
  const btn = f.querySelector('button:not([type=button])');
  if (btn) btn.disabled = true;
  Promise.resolve(fn(f, formObj(f))).catch((err) => { console.error(err); toast(friendly(err), true); }).finally(() => { if (btn?.isConnected) btn.disabled = false; });
});

/* ============ início ============ */
async function boot() {
  try {
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return showLogin();
    S.user = session.user;
    await afterSignIn();
  } catch (e) {
    console.error(e);
    showLogin(friendly(e));
  }
}
boot();
