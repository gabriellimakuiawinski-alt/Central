// Central — monitor dos sites dos clientes.
// Para cada projeto com "site no ar": confere se responde (status, tempo, HTTPS) e quando o domínio vence (RDAP).
// Só responde a quem está logado com 2FA (getUser + aal2). Grava em site_checks com a sessão do usuário (RLS).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { safeFetch, Blocked } from "./guard.ts";

const ALLOWED_ORIGINS = ["https://gabriellimakuiawinski-alt.github.io", "http://localhost:8080", "http://127.0.0.1:8080"];
function cors(req: Request) {
  const o = req.headers.get("origin") || "";
  return { "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(o) ? o : ALLOWED_ORIGINS[0], "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
}
const json = (req: Request, status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

// Domínio registrável aproximado: "loja.com.br" de "www.loja.com.br"; "site.com" de "app.site.com".
function baseDomain(host: string): string {
  const p = host.toLowerCase().replace(/^www\./, "").split(".");
  const sld2 = /^(com|net|org|edu|gov|art|blog|eco|eng|ind|med|adv|app|dev|tec|inf|nom|psi)$/;
  if (p.length >= 3 && p[p.length - 1] === "br" && sld2.test(p[p.length - 2])) return p.slice(-3).join(".");
  return p.slice(-2).join(".");
}
async function domainExpires(host: string): Promise<string | null> {
  const d = baseDomain(host);
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) || d.endsWith("github.io") || d.endsWith("vercel.app") || d.endsWith("netlify.app")) return null;
  const url = d.endsWith(".br") ? `https://rdap.registro.br/domain/${d}` : `https://rdap.org/domain/${d}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(7000), headers: { Accept: "application/rdap+json" } });
    if (!r.ok) return null;
    const j = await r.json();
    const ev = (j.events || []).find((e: { eventAction?: string }) => e.eventAction === "expiration");
    return ev?.eventDate ? String(ev.eventDate).slice(0, 10) : null;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { error: "Método não permitido." });
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || token.split(".").length !== 3) return json(req, 401, { error: "Faça login na Central." });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: u, error: uerr } = await sb.auth.getUser(token);
  if (uerr || !u?.user) return json(req, 401, { error: "Sessão inválida. Entre de novo na Central." });
  try {
    const claims = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (claims.aal !== "aal2") return json(req, 403, { error: "É preciso confirmar o código de 2 fatores." });
  } catch { return json(req, 401, { error: "Sessão inválida." }); }

  try {
    const body = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body.project_ids) ? body.project_ids.filter((x: unknown) => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)).slice(0, 25) : [];
    let q = sb.from("projects").select("id,live_url").not("live_url", "is", null).limit(25);
    if (ids.length) q = q.in("id", ids);
    const { data: projects, error } = await q;
    if (error) throw new Error(error.message);
    const list = (projects || []).filter((p) => String(p.live_url || "").trim());
    if (!list.length) return json(req, 200, { results: [] });

    const { count } = await sb.from("site_checks").select("id", { count: "exact", head: true }).gte("checked_at", new Date(Date.now() - 3600_000).toISOString());
    if ((count ?? 0) + list.length > 120) return json(req, 429, { error: "Muitas verificações na última hora. Tente mais tarde." });

    const results = await Promise.all(list.map(async (p) => {
      let url = String(p.live_url).trim();
      if (!/^https?:\/\//i.test(url)) url = "https://" + url;
      const row: Record<string, unknown> = { project_id: p.id, url: url.slice(0, 300), ok: false, status: null, ms: null, https: null, final_url: null, domain_expires: null, error: null };
      try {
        const r = await safeFetch(url, { maxBytes: 150_000, timeoutMs: 12_000 });
        row.status = r.status; row.ms = r.ms; row.final_url = r.finalUrl.slice(0, 300);
        row.https = r.finalUrl.startsWith("https://");
        row.ok = r.status < 400;
        if (!row.ok) row.error = `O site respondeu com erro ${r.status}.`;
      } catch (e) {
        row.error = (e instanceof Error ? e.message : "Falha ao verificar").slice(0, 300);
        if (e instanceof Blocked) row.error = "Endereço não permitido: " + row.error;
      }
      try { row.domain_expires = await domainExpires(new URL(String(row.final_url || url)).hostname); } catch { /* sem data */ }
      return row;
    }));
    const ins = await sb.from("site_checks").insert(results).select();
    if (ins.error) throw new Error(ins.error.message);
    return json(req, 200, { results: ins.data });
  } catch (e) {
    return json(req, 400, { error: e instanceof Error ? e.message : "Erro inesperado" });
  }
});
