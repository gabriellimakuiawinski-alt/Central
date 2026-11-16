// Núcleo da análise técnica de um site (sem banco, sem sessão): recebe a URL e devolve os achados.
import { assertPublic, Blocked, safeFetch, Unreachable } from "./guard.ts";

const attr = (tag: string, name: string) => { const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")); return m ? (m[1] ?? m[2] ?? m[3] ?? "").trim() : null; };
const metas = (html: string) => html.match(/<meta\b[^>]*>/gi) || [];
function metaContent(html: string, key: string, by = "name") { for (const t of metas(html)) if ((attr(t, by) || "").toLowerCase() === key) return attr(t, "content"); return null; }

async function pagespeed(url: string) {
  const key = Deno.env.get("PAGESPEED_API_KEY");
  const q = new URLSearchParams({ url, strategy: "mobile" });
  q.append("category", "performance"); q.append("category", "seo");
  if (key) q.set("key", key);
  try {
    const r = await fetch("https://www.googleapis.com/pagespeedonline/v5/runPagespeed?" + q, { signal: AbortSignal.timeout(50000) });
    if (!r.ok) return { ok: false, reason: r.status === 429 ? "Cota gratuita do PageSpeed esgotada no momento." : `PageSpeed respondeu ${r.status}.` };
    const j = await r.json();
    const lr = j.lighthouseResult;
    if (!lr?.categories?.performance) return { ok: false, reason: "PageSpeed não conseguiu medir este site." };
    const sc = (v: unknown) => (typeof v === "number" ? Math.round(v * 100) : null);
    return { ok: true, perf: sc(lr.categories.performance.score), seo: sc(lr.categories.seo?.score), lcp: lr.audits?.["largest-contentful-paint"]?.displayValue ?? null, viewport_ok: lr.audits?.viewport?.score === 1, tested_url: lr.finalDisplayedUrl || lr.finalUrl || url };
  } catch { return { ok: false, reason: "PageSpeed demorou demais para responder." }; }
}

async function checkLinks(html: string, base: string) {
  const host = new URL(base).hostname.replace(/^www\./, "");
  const set = new Set<string>();
  for (const t of html.match(/<a\b[^>]*>/gi) || []) {
    const h = attr(t, "href");
    if (!h || /^(#|mailto:|tel:|javascript:|whatsapp:|data:)/i.test(h)) continue;
    try { const u = new URL(h, base); u.hash = ""; if ((u.protocol === "http:" || u.protocol === "https:") && u.hostname.replace(/^www\./, "") === host && u.toString() !== base) set.add(u.toString()); } catch { /* href inválido */ }
    if (set.size >= 8) break;
  }
  const links = [...set];
  const broken: { url: string; status: number | string }[] = [];
  let checked = 0;
  await Promise.all(links.map(async (l) => {
    try {
      const r = await safeFetch(l, { maxBytes: 2000, timeoutMs: 8000, maxHops: 3 });
      checked++;
      if (r.status === 404 || r.status === 410 || r.status >= 500) broken.push({ url: l.slice(0, 200), status: r.status });
    } catch (e) { if (e instanceof Unreachable && /DNS|conectar/.test(e.message)) { checked++; broken.push({ url: l.slice(0, 200), status: "sem resposta" }); } }
  }));
  return { checked, broken };
}

export async function analyzeSite(website: string) {
    const problems: string[] = [], suggestions: string[] = [], unknown: string[] = [];
    const checks: Record<string, unknown> = {};
    let status = "ok";
    let start: URL;
    try { start = await assertPublic(website); }
    catch (e) {
      if (e instanceof Blocked) throw e;
      start = new URL(website); // domínio não resolve: é um resultado, não um erro
    }

    const psiP = pagespeed(start.toString());

    let page = null as Awaited<ReturnType<typeof safeFetch>> | null;
    let failMsg = "";
    try { page = await safeFetch(start.toString(), { maxBytes: 1_500_000, timeoutMs: 15000 }); }
    catch (e) {
      if (e instanceof Blocked) throw e;
      failMsg = (e as Error).message;
      // HTTPS falhou? Confere se a versão http responde, para diferenciar "fora do ar" de "HTTPS com defeito".
      if (start.protocol === "https:") {
        try { const alt = new URL(start.toString()); alt.protocol = "http:"; page = await safeFetch(alt.toString(), { maxBytes: 1_500_000, timeoutMs: 12000 }); if (new URL(page.finalUrl).protocol === "http:") problems.push("https_falha"); }
        catch { /* continua fora do ar */ }
      }
    }

    if (!page && /demorou/.test(failMsg)) { status = "inconclusivo"; unknown.push("sem_resposta"); checks.erro = failMsg; } // sem resposta a tempo não prova que o site caiu
    else if (!page) { status = "fora_do_ar"; problems.push("fora_do_ar"); checks.erro = failMsg; }
    else {
      const final = new URL(page.finalUrl);
      const srv = (page.headers.get("server") || "").toLowerCase();
      const blocked = [401, 403, 429, 503].includes(page.status) && (srv.includes("cloudflare") || page.headers.has("cf-ray") || /captcha|challenge|access denied/i.test(page.body.slice(0, 4000)));
      Object.assign(checks, { http_status: page.status, final_url: page.finalUrl.slice(0, 300), tempo_ms: page.ms, html_kb: Math.round(page.bytes / 1024), redirecionamentos: page.hops.length - 1 });
      if (blocked || [401, 403, 429].includes(page.status)) { status = "bloqueado"; unknown.push("bloqueio_automatico"); }
      else if (page.status >= 400) { status = "fora_do_ar"; problems.push("fora_do_ar"); }
      else {
        const html = page.body;
        if (final.protocol === "http:" && !problems.includes("https_falha")) {
          try { const s = new URL(final.toString()); s.protocol = "https:"; const r = await safeFetch(s.toString(), { maxBytes: 2000, timeoutMs: 8000 }); if (r.status < 400) suggestions.push("https_sem_redirecionar"); else problems.push("sem_https"); }
          catch (e) { if (e instanceof Blocked) throw e; problems.push("sem_https"); }
        }
        const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim();
        const desc = metaContent(html, "description");
        const viewport = metaContent(html, "viewport");
        Object.assign(checks, { titulo: title.slice(0, 160) || null, descricao: desc ? desc.slice(0, 200) : null, viewport: viewport ? viewport.slice(0, 120) : null, h1: (html.match(/<h1\b/gi) || []).length, lang: attr(html.match(/<html\b[^>]*>/i)?.[0] || "", "lang"), html_cortado: page.truncated });
        const looksHtml = /<html|<body|<head/i.test(html);
        if (!looksHtml) unknown.push("nao_html");
        else {
          if (!title) problems.push("sem_titulo");
          if (!desc) problems.push("sem_descricao");
          if (!viewport) problems.push("sem_viewport");
          if (!checks.h1 && !page.truncated) suggestions.push("sem_h1");
          if (!metaContent(html, "og:title", "property")) suggestions.push("sem_og");
          if (!checks.lang) suggestions.push("sem_lang");
          if (final.protocol === "https:") {
            const mixed = (html.match(/<(?:img|script|iframe|source)\b[^>]*\bsrc\s*=\s*["']http:\/\//gi) || []).length;
            if (mixed) { problems.push("conteudo_misto"); checks.conteudo_misto = mixed; }
          }
          const lk = await checkLinks(html, page.finalUrl);
          checks.links_testados = lk.checked; checks.links_quebrados = lk.broken;
          if (lk.broken.length) problems.push("links_quebrados");
        }
      }
    }

    const psi = await psiP;
    checks.pagespeed = psi;
    if (status === "ok") {
      if (psi.ok && typeof psi.perf === "number") { if (psi.perf < 50) problems.push("lento_mobile"); else if (psi.perf < 90) suggestions.push("desempenho_medio"); if (typeof psi.seo === "number" && psi.seo < 80) suggestions.push("seo_baixo"); }
      else unknown.push("desempenho_nao_medido");
    }

    return { start: start.toString(), status, problems, suggestions, unknown, checks, psi };
}
