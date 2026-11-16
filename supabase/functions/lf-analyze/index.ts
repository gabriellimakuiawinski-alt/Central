// Lead Finder — análise técnica do site de um lead.
// Só responde a quem está logado na Central com 2FA (getUser + aal2 conferidos aqui dentro).
// Cada achado é classificado: "comprovado" (fato medido), "sugestao" (melhoria possível) ou "inconclusivo".
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Blocked } from "./guard.ts";
import { analyzeSite } from "./analyze.ts";

const ALLOWED_ORIGINS = ["https://gabriellimakuiawinski-alt.github.io", "http://localhost:8080", "http://127.0.0.1:8080"];
function cors(req: Request) {
  const o = req.headers.get("origin") || "";
  return { "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(o) ? o : ALLOWED_ORIGINS[0], "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
}
const json = (req: Request, status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

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

  let companyId = "";
  try {
    const body = await req.json().catch(() => ({}));
    companyId = String(body.company_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(companyId)) return json(req, 400, { error: "Lead inválido." });
    // RLS garante que só o dono enxerga o lead; a URL analisada é sempre a que está salva no lead.
    const { data: c, error: cerr } = await sb.from("lf_companies").select("id,website,status").eq("id", companyId).maybeSingle();
    if (cerr) throw new Error(cerr.message);
    if (!c) return json(req, 404, { error: "Lead não encontrado." });
    if (!c.website) return json(req, 400, { error: "Este lead não tem site cadastrado para analisar." });

    const { data: cfg } = await sb.from("lf_settings").select("max_analyses_per_hour").maybeSingle();
    const maxHour = Math.min(Math.max(cfg?.max_analyses_per_hour ?? 30, 1), 60);
    const { count } = await sb.from("lf_site_analyses").select("id", { count: "exact", head: true }).gte("checked_at", new Date(Date.now() - 3600_000).toISOString());
    if ((count ?? 0) >= maxHour) return json(req, 429, { error: `Limite de ${maxHour} análises por hora atingido.` });

    const day = new Date().toISOString().slice(0, 10);
    await sb.rpc("lf_count_usage", { p_provider: "pagespeed", p_day: day, p_calls: 1 });
    let r: Awaited<ReturnType<typeof analyzeSite>>;
    try { r = await analyzeSite(c.website); }
    catch (e) { if (e instanceof Blocked) return json(req, 400, { error: e.message }); throw e; }
    const { status, problems, suggestions, unknown, checks, psi } = r;
    const start = new URL(r.start);

    const checked_at = new Date().toISOString();
    const summary = { checked_at, status, problems, suggestions, unknown, perf: psi.ok ? psi.perf : null, seo: psi.ok ? psi.seo : null, lcp: psi.ok ? psi.lcp : null, final_url: checks.final_url ?? null, tempo_ms: checks.tempo_ms ?? null };
    const ins = await sb.from("lf_site_analyses").insert({ company_id: companyId, url: start.toString().slice(0, 300), status, result: { ...summary, checks }, checked_at });
    if (ins.error) throw new Error(ins.error.message);
    const up = await sb.from("lf_companies").update({ site_analysis: summary }).eq("id", companyId);
    if (up.error) throw new Error(up.error.message);
    return json(req, 200, { ...summary, checks });
  } catch (e) {
    const msg = e instanceof Blocked ? e.message : e instanceof Error ? e.message : "Erro inesperado";
    await sb.from("lf_errors").insert({ scope: "analise", message: msg.slice(0, 500), meta: { company_id: companyId } });
    return json(req, 400, { error: msg });
  }
});
