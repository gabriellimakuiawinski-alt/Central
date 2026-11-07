// Criptografia do cofre. Tudo acontece no aparelho: o servidor só recebe dados já cifrados.
const enc = new TextEncoder();
const dec = new TextDecoder();

export const b64 = (buf) => {
  const u = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
};
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
const concat = (a, b) => {
  const o = new Uint8Array(a.length + b.length);
  o.set(a, 0);
  o.set(b, a.length);
  return o;
};

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32enc(bytes) {
  let bits = 0, val = 0, out = '';
  for (const b of bytes) {
    val = (val << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(val >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function b32dec(str) {
  let bits = 0, val = 0;
  const out = [];
  for (const ch of str) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('Chave de recuperação inválida');
    val = (val << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((val >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}
export const formatRecovery = (bytes) => b32enc(bytes).match(/.{1,4}/g).join('-');
export function parseRecovery(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  const b = b32dec(clean);
  if (b.length < 32) throw new Error('Chave de recuperação inválida');
  return b.slice(0, 32);
}

export const KDF_ITER = 600000;

async function passwordKek(password, saltB64, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: unb64(saltB64), iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}
const rawKek = (bytes) => crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);

async function wrap(kek, bytes) {
  const iv = rand(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, bytes);
  return b64(concat(iv, new Uint8Array(ct)));
}
async function unwrap(kek, s) {
  const buf = unb64(s);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, kek, buf.slice(12)));
}

// ---- Cofre: chave de dados (DK) protegida pela senha e pela chave de recuperação ----
export async function createVault(password) {
  const dk = rand(32);
  const rk = rand(32);
  const salt = b64(rand(16));
  const row = {
    kdf_salt: salt,
    kdf_iterations: KDF_ITER,
    wrapped_key_password: await wrap(await passwordKek(password, salt, KDF_ITER), dk),
    wrapped_key_recovery: await wrap(await rawKek(rk), dk),
  };
  return { row, dk, recovery: formatRecovery(rk) };
}
export async function openWithPassword(row, password) {
  return unwrap(await passwordKek(password, row.kdf_salt, row.kdf_iterations), row.wrapped_key_password);
}
export async function openWithRecovery(row, recoveryStr) {
  return unwrap(await rawKek(parseRecovery(recoveryStr)), row.wrapped_key_recovery);
}
export async function rewrapPassword(dk, newPassword) {
  const salt = b64(rand(16));
  return {
    kdf_salt: salt,
    kdf_iterations: KDF_ITER,
    wrapped_key_password: await wrap(await passwordKek(newPassword, salt, KDF_ITER), dk),
  };
}

// ---- Segredos de cada serviço (AES-GCM, amarrado ao id do registro) ----
const itemKey = (dk) => crypto.subtle.importKey('raw', dk, 'AES-GCM', false, ['encrypt', 'decrypt']);
export async function encryptSecret(dk, id, obj) {
  const iv = rand(12);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(id) },
    await itemKey(dk),
    enc.encode(JSON.stringify(obj))
  );
  return { secret_ciphertext: b64(ct), secret_iv: b64(iv) };
}
export async function decryptSecret(dk, id, ciphertext, iv) {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(iv), additionalData: enc.encode(id) },
    await itemKey(dk),
    unb64(ciphertext)
  );
  return JSON.parse(dec.decode(pt));
}

// ---- Atalho biométrico neste aparelho (WebAuthn) ----
const LS = 'central.device';
export function deviceInfo() {
  try { return JSON.parse(localStorage.getItem(LS)); } catch { return null; }
}
export async function biometricSupported() {
  try {
    return !!(window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()));
  } catch { return false; }
}
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('central', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('keys');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbPut(k, v) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('keys', 'readwrite');
    tx.objectStore('keys').put(v, k);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function idbGet(k) {
  const db = await idb();
  return new Promise((res, rej) => {
    const rq = db.transaction('keys').objectStore('keys').get(k);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}
async function idbDel(k) {
  const db = await idb();
  return new Promise((res) => {
    const tx = db.transaction('keys', 'readwrite');
    tx.objectStore('keys').delete(k);
    tx.oncomplete = () => res();
    tx.onerror = () => res();
  });
}
async function prfKey(prfBytes) {
  const base = await crypto.subtle.importKey('raw', prfBytes, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode('central-device-wrap') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}
async function assertion(credId, prfSalt) {
  const res = await navigator.credentials.get({
    publicKey: {
      challenge: rand(32),
      rpId: location.hostname,
      allowCredentials: [{ type: 'public-key', id: unb64(credId) }],
      userVerification: 'required',
      timeout: 60000,
      extensions: prfSalt ? { prf: { eval: { first: prfSalt } } } : {},
    },
  });
  if (!res) throw new Error('Biometria cancelada');
  const out = res.getClientExtensionResults?.().prf?.results?.first;
  return out ? new Uint8Array(out) : null;
}
export async function enableBiometric(dk, email) {
  const prfSalt = rand(32);
  const cred = await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Central', id: location.hostname },
      user: { id: rand(16), name: email, displayName: email },
      challenge: rand(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      timeout: 60000,
      extensions: { prf: {} },
    },
  });
  const credId = b64(cred.rawId);
  let mode = 'idb';
  let kek = null;
  if (cred.getClientExtensionResults?.().prf?.enabled) {
    const out = await assertion(credId, prfSalt);
    if (out) { mode = 'prf'; kek = await prfKey(out); }
  }
  if (mode === 'idb') {
    kek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await idbPut('dev', kek);
  }
  localStorage.setItem(LS, JSON.stringify({ credId, mode, prfSalt: b64(prfSalt), wrapped: await wrap(kek, dk), email }));
  return mode;
}
export async function unlockBiometric() {
  const d = deviceInfo();
  if (!d) throw new Error('Biometria não configurada neste aparelho');
  const out = await assertion(d.credId, unb64(d.prfSalt));
  let kek;
  if (d.mode === 'prf') {
    if (!out) throw new Error('Este aparelho não devolveu a chave biométrica');
    kek = await prfKey(out);
  } else {
    kek = await idbGet('dev');
    if (!kek) throw new Error('Chave do aparelho não encontrada');
  }
  return unwrap(kek, d.wrapped);
}
export async function confirmBiometric() {
  const d = deviceInfo();
  if (!d) throw new Error('Biometria não configurada');
  await assertion(d.credId, null);
}
export async function disableBiometric() {
  localStorage.removeItem(LS);
  await idbDel('dev');
}
