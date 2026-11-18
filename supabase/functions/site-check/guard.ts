// Proteção contra SSRF: a função só busca endereços públicos da internet.
// Regras: só http/https, portas padrão, sem usuário/senha na URL, todo IP resolvido precisa ser público,
// redirecionamentos seguidos manualmente (cada salto é validado de novo), tempo e tamanho limitados.

function v4Private(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51) || (a === 203 && b === 0) || a >= 224;
}
function v6Private(ip: string): boolean {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (s === "::" || s === "::1") return true;
  const m = s.match(/(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/);
  if (m) return v4Private(m[1]);
  if (s.startsWith("::ffff:")) return true; // mapeado em hexadecimal: recusa por segurança
  return /^(fc|fd|fe[89ab]|ff)/.test(s) || s.startsWith("64:ff9b:") || s.startsWith("2001:db8:") || s.startsWith("2002:");
}
export const isIp = (h: string) => /^(\d{1,3}\.){3}\d{1,3}$/.test(h) || h.includes(":");
export const ipIsPrivate = (ip: string) => (ip.includes(":") ? v6Private(ip) : v4Private(ip));

async function resolve(host: string): Promise<string[]> {
  const out: string[] = [];
  let nativeFailed = false;
  for (const type of ["A", "AAAA"] as const) {
    try { out.push(...(await Deno.resolveDns(host, type))); }
    catch (e) { if (!(e instanceof Deno.errors.NotFound)) nativeFailed = true; }
  }
  if (out.length || !nativeFailed) return out;
  // Ambiente sem resolução nativa: usa DNS sobre HTTPS do Google.
  for (const type of ["A", "AAAA"]) {
    const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(host)}&type=${type}`, { signal: AbortSignal.timeout(5000) });
    const j = await r.json();
    for (const a of j.Answer || []) if (a.type === 1 || a.type === 28) out.push(String(a.data));
  }
  return out;
}

export class Blocked extends Error {}
export class Unreachable extends Error {}

export async function assertPublic(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Blocked("Endereço inválido."); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Blocked("Só endereços http/https são analisados.");
  if (u.username || u.password) throw new Blocked("Endereço com usuário/senha não é analisado.");
  if (u.port && u.port !== "80" && u.port !== "443") throw new Blocked("Porta não permitida.");
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") && !host.includes(":")) throw new Blocked("Endereço interno não é analisado.");
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|test|invalid|example)$/.test(host)) throw new Blocked("Endereço interno não é analisado.");
  if (isIp(host)) { if (ipIsPrivate(host)) throw new Blocked("Endereço interno não é analisado."); return u; }
  let ips: string[];
  try { ips = await resolve(host); } catch { throw new Unreachable("Não foi possível resolver o domínio."); }
  if (!ips.length) throw new Unreachable("O domínio não existe ou não responde (DNS).");
  if (ips.some(ipIsPrivate)) throw new Blocked("O domínio aponta para um endereço interno.");
  return u;
}

export interface Fetched { finalUrl: string; status: number; headers: Headers; body: string; bytes: number; ms: number; hops: string[]; truncated: boolean }

export async function safeFetch(raw: string, opt: { maxBytes: number; timeoutMs: number; maxHops?: number }): Promise<Fetched> {
  const t0 = Date.now();
  const hops: string[] = [];
  let url = raw;
  for (let i = 0; i <= (opt.maxHops ?? 5); i++) {
    const u = await assertPublic(url);
    hops.push(u.toString());
    const left = opt.timeoutMs - (Date.now() - t0);
    if (left <= 0) throw new Unreachable("O site demorou demais para responder.");
    let res: Response;
    try {
      res = await fetch(u, {
        redirect: "manual", signal: AbortSignal.timeout(left),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; CentralLeadFinder/1.0; verificacao pontual de site)", "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", "Accept-Language": "pt-BR,pt;q=0.9" },
      });
    } catch (e) {
      const m = String((e as Error)?.message || e);
      if (/timed out|timeout|abort/i.test(m)) throw new Unreachable("O site demorou demais para responder.");
      if (/certificate|tls|ssl/i.test(m)) throw new Unreachable("TLS: falha no certificado de segurança.");
      throw new Unreachable("Não foi possível conectar ao site.");
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel();
      url = new URL(res.headers.get("location")!, u).toString();
      continue;
    }
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0, truncated = false;
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.length;
          if (bytes > opt.maxBytes) { truncated = true; chunks.push(value.slice(0, value.length - (bytes - opt.maxBytes))); await reader.cancel(); break; }
          chunks.push(value);
        }
      } catch { truncated = true; }
    }
    const buf = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.length; }
    return { finalUrl: u.toString(), status: res.status, headers: res.headers, body: new TextDecoder("utf-8", { fatal: false }).decode(buf), bytes, ms: Date.now() - t0, hops, truncated };
  }
  throw new Unreachable("Redirecionamentos demais.");
}
