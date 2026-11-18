// Central — funções de apoio da fase 2: Pix (BR Code + QR), Google Drive, cronômetro de horas, checklist.
// Sem dependências externas além do gerador de QR copiado em vendor/ (a CSP só aceita scripts de 'self').
import qrcode from './vendor/qrcode.mjs';

/* ---------------- Pix (padrão BR Code do Banco Central) ---------------- */
const ascii = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 .,/-]/g, '').trim();
const field = (id, v) => id + String(v.length).padStart(2, '0') + v;
function crc16(s) {
  let c = 0xffff;
  for (let i = 0; i < s.length; i++) {
    c ^= s.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
  }
  return c.toString(16).toUpperCase().padStart(4, '0');
}
function cpfOk(d) {
  if (!/^\d{11}$/.test(d) || /^(\d)\1+$/.test(d)) return false;
  const dv = (n) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}
// Normaliza a chave: e-mail, chave aleatória, CPF, CNPJ ou celular (+55…).
export function pixKey(raw) {
  const k = String(raw || '').trim();
  if (!k) return '';
  if (k.includes('@')) return k.toLowerCase();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)) return k.toLowerCase();
  if (k.startsWith('+')) return '+' + k.replace(/\D/g, '');
  const d = k.replace(/\D/g, '');
  if (d.length === 14) return d;
  if (d.length === 11 && cpfOk(d)) return d;
  if (d.length === 10 || d.length === 11) return '+55' + d;
  if (d.length === 13 && d.startsWith('55')) return '+' + d;
  return k;
}
export function pixPayload({ key, name, city, amount, txid }) {
  const k = pixKey(key);
  if (!k) throw new Error('Cadastre sua chave Pix em Ajustes.');
  const nm = ascii(name).slice(0, 25) || 'RECEBEDOR';
  const ct = ascii(city).slice(0, 15) || 'SAO PAULO';
  const tx = String(txid || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';
  let p = field('00', '01') + field('26', field('00', 'br.gov.bcb.pix') + field('01', k)) + field('52', '0000') + field('53', '986');
  if (amount > 0) p += field('54', Number(amount).toFixed(2));
  p += field('58', 'BR') + field('59', nm) + field('60', ct) + field('62', field('05', tx)) + '6304';
  return p + crc16(p);
}
// SVG do QR Code (texto gerado pelo próprio app, sem dados de terceiros).
export function qrSVG(text) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  const n = q.getModuleCount(), m = 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + m},${r + m}h1v1h-1z`;
  return `<svg viewBox="0 0 ${n + m * 2} ${n + m * 2}" shape-rendering="crispEdges" role="img" aria-label="QR Code do Pix"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

/* ---------------- Google Drive (backup) ---------------- */
// Fluxo OAuth do Google para apps só de navegador. O token volta em drive-callback.html,
// que guarda na sessionStorage desta aba e retorna para Ajustes. Escopo mínimo: arquivos criados pelo app.
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const driveRedirect = () => new URL('drive-callback.html', location.href.split('#')[0]).toString();
export function driveAuthUrl(clientId) {
  const state = crypto.randomUUID();
  sessionStorage.setItem('central.drive.state', state);
  sessionStorage.setItem('central.drive.pending', '1');
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.search = new URLSearchParams({ client_id: clientId, redirect_uri: driveRedirect(), response_type: 'token', scope: SCOPE, state, include_granted_scopes: 'true' }).toString();
  return u.toString();
}
export function driveToken() {
  try {
    const t = JSON.parse(sessionStorage.getItem('central.drive.token') || 'null');
    return t && t.exp - 60_000 > Date.now() ? t.token : null;
  } catch { return null; }
}
export const drivePending = () => sessionStorage.getItem('central.drive.pending') === '1';
export const driveClearPending = () => sessionStorage.removeItem('central.drive.pending');
const driveErr = async (r, what) => {
  let msg = '';
  try { msg = (await r.json())?.error?.message || ''; } catch { /* sem corpo */ }
  if (r.status === 401) sessionStorage.removeItem('central.drive.token');
  return new Error(`Google Drive (${what}): ${r.status === 401 ? 'acesso expirou, conecte de novo' : msg || 'erro ' + r.status}`);
};
async function ensureFolder(token, folderId) {
  if (folderId) {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,trashed`, { headers: { Authorization: 'Bearer ' + token } });
    if (r.ok) { const j = await r.json(); if (!j.trashed) return folderId; }
    else if (r.status !== 404) throw await driveErr(r, 'pasta');
  }
  const r = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Central — backups', mimeType: 'application/vnd.google-apps.folder' }),
  });
  if (!r.ok) throw await driveErr(r, 'criar pasta');
  return (await r.json()).id;
}
export async function driveUpload(token, folderId, name, text) {
  const folder = await ensureFolder(token, folderId);
  const b = 'central' + Math.random().toString(36).slice(2);
  const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folder], mimeType: 'application/json' })}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${b}--`;
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': `multipart/related; boundary=${b}` }, body,
  });
  if (!r.ok) throw await driveErr(r, 'enviar');
  return { folderId: folder, fileId: (await r.json()).id };
}

/* ---------------- cronômetro de horas (fica neste aparelho até parar) ---------------- */
export function timerGet() {
  try { const t = JSON.parse(localStorage.getItem('central.timer') || 'null'); return t && t.pid && t.start ? t : null; } catch { return null; }
}
export const timerStart = (pid) => { try { localStorage.setItem('central.timer', JSON.stringify({ pid, start: Date.now() })); } catch { /* sem armazenamento */ } };
export const timerClear = () => { try { localStorage.removeItem('central.timer'); } catch { /* idem */ } };
export const fmtClock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
export const fmtHours = (min) => { const m = Math.round(min || 0); return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}`; };
// Aceita "90", "1:30", "1h30", "1,5h".
export function parseMinutes(v) {
  const s = String(v || '').trim().toLowerCase().replace(',', '.');
  let m;
  if ((m = s.match(/^(\d+)\s*[:h]\s*(\d{1,2})?\s*(min)?$/))) return Number(m[1]) * 60 + Number(m[2] || 0);
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*h$/))) return Math.round(Number(m[1]) * 60);
  if ((m = s.match(/^(\d+)\s*(min)?$/))) return Number(m[1]);
  return 0;
}

/* ---------------- checklist de entrega ---------------- */
export const DEFAULT_CHECKLIST = [
  'Domínio registrado e apontado', 'HTTPS (cadeado) funcionando', 'Versão para celular revisada', 'Formulário/WhatsApp testado',
  'Título e descrição para o Google', 'Google Meu Negócio atualizado com o site', 'Google Analytics ou contador de visitas',
  'Imagens otimizadas', 'Textos revisados pelo cliente', 'Backup do site guardado', 'Acessos entregues ao cliente',
];
