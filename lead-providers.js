// Lead Finder — fontes de dados.
// Cada fonte implementa a mesma interface: { key, label, attribution, search(params, { signal, onStep }) -> { places, areaLabel } }.
// Para adicionar outra fonte, crie o objeto e registre em PROVIDERS; o resto do sistema não muda.
//
// OpenStreetMap roda no navegador de propósito: os servidores públicos do Overpass são feitos para uso
// humano a partir do navegador e recusam/limitam servidores de nuvem. Não há chave nem segredo envolvidos.
// Fontes que exigem chave (ex.: Google Places) devem rodar em Edge Function, nunca aqui.

/* ---------- normalização comum (base da deduplicação entre fontes) ---------- */
const SOCIAL = ['instagram.com', 'facebook.com', 'fb.com', 'fb.me', 'wa.me', 'whatsapp.com', 'linktr.ee', 'linktree.com', 'tiktok.com', 'youtube.com', 'twitter.com', 'x.com', 'ifood.com.br', 'goo.gl', 'g.page', 'google.com', 'bit.ly', 't.me'];

export const normName = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function normPhone(raw) {
  const first = String(raw || '').split(/[;,\/]| ou /i)[0].trim();
  let d = first.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if ((d.length === 11 || d.length === 12) && d.startsWith('0')) d = d.slice(1);
  return d.length === 10 || d.length === 11 ? d : null;
}

export function normSite(raw) {
  let s = String(raw || '').trim().split(/[;\s]/)[0];
  const none = { url: null, domain: null, social: false };
  if (!s) return none;
  if (!/^https?:\/\//i.test(s)) { if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return none; s = 'https://' + s; }
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return none;
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (!host.includes('.')) return none;
    const social = SOCIAL.some((d) => host === d || host.endsWith('.' + d));
    return { url: u.toString().slice(0, 300), domain: social ? null : host, social };
  } catch { return none; }
}

export const fmtPhone = (pn) => (pn && pn.length === 11 ? `(${pn.slice(0, 2)}) ${pn.slice(2, 7)}-${pn.slice(7)}` : pn && pn.length === 10 ? `(${pn.slice(0, 2)}) ${pn.slice(2, 6)}-${pn.slice(6)}` : pn || '');

const t = (v, max) => { const s = String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim(); return s ? s.slice(0, max) : null; };

// Converte o registro bruto de qualquer fonte no formato que o banco recebe (lf_ingest).
export function normalizeItem(r, segment) {
  const name = t(r.name, 160);
  if (!name || !normName(name)) return null;
  const pn = normPhone(r.phone);
  const site = normSite(r.website);
  const insta = t(r.instagram, 200) || (site.social && /instagram\.com/i.test(site.url || '') ? site.url : null);
  const face = t(r.facebook, 200) || (site.social && /(facebook|fb)\./i.test(site.url || '') ? site.url : null);
  const hasSocial = !!(insta || face || site.social);
  const address = [[r.street, r.number].filter(Boolean).join(', '), r.neighborhood].filter(Boolean).join(' — ');
  return {
    external_id: String(r.external_id), source_url: r.source_url || null,
    name, name_norm: normName(name), segment, category: t(r.category, 80),
    address: t(address, 240), neighborhood: t(r.neighborhood, 100), city: t(r.city, 100), state: t(r.state, 60), postcode: t(r.postcode, 12),
    phone: pn ? fmtPhone(pn) : null, phone_norm: pn,
    website: site.social ? null : site.url, domain_norm: site.domain, instagram: insta, facebook: face,
    // "nao_encontrado_na_fonte" não é certeza de ausência de site: só que a fonte não informa um.
    site_status: site.domain ? 'informado' : hasSocial ? 'rede_social' : 'nao_encontrado_na_fonte',
    lat: typeof r.lat === 'number' ? r.lat : null, lon: typeof r.lon === 'number' ? r.lon : null,
  };
}

/* ---------- OpenStreetMap (gratuito) ---------- */
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

const SEGMENT_FILTERS = {
  oficinas: ['["shop"~"^(car_repair|motorcycle_repair|tyres|car_parts|motorcycle)$"]', '["craft"="car_repair"]'],
  barbearias: ['["shop"~"^(hairdresser|barber|beauty)$"]'],
  restaurantes: ['["amenity"~"^(restaurant|fast_food|cafe|bar|pub|ice_cream|food_court)$"]', '["shop"~"^(bakery|pastry|confectionery)$"]'],
  clinicas: ['["amenity"~"^(clinic|dentist|doctors|veterinary)$"]', '["healthcare"]'],
  academias: ['["leisure"~"^(fitness_centre|sports_centre|dance)$"]', '["amenity"="dojo"]'],
  lojas: ['["shop"]'],
  servicos: ['["craft"]', '["office"]', '["shop"~"^(laundry|dry_cleaning|locksmith|tailor|copyshop|travel_agency|funeral_directors|pet_grooming)$"]'],
};
const reEscape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/["\n\r]/g, '');

async function fetchT(url, init, ms, signal) {
  const c = new AbortController();
  const onAbort = () => c.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...init, signal: c.signal }); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
}

export async function geocode(p, signal) {
  const q = [p.neighborhood, p.city, p.state, p.country].filter(Boolean).join(', ');
  // layer=address: só lugares e limites administrativos (evita cair em um ponto de interesse com o mesmo nome).
  const url = `${NOMINATIM}?format=jsonv2&limit=5&layer=address&addressdetails=0&accept-language=pt-BR&q=${encodeURIComponent(q)}`;
  let r;
  try { r = await fetchT(url, { headers: { Accept: 'application/json' } }, 15000, signal); }
  catch (e) { if (signal?.aborted) throw e; throw new Error('Não foi possível localizar a área agora. Confira a internet e tente de novo.'); }
  if (!r.ok) throw new Error(`O serviço de localização respondeu com erro (${r.status}). Tente de novo em instantes.`);
  const arr = await r.json();
  if (!Array.isArray(arr) || !arr.length) throw new Error('Local não encontrado. Confira cidade, estado e bairro.');
  const g = arr.find((x) => x.category === 'boundary' || x.category === 'place') || arr[0];
  return {
    lat: Number(g.lat), lon: Number(g.lon), label: String(g.display_name || q).slice(0, 200),
    osmType: String(g.osm_type || ''), osmId: Number(g.osm_id || 0), category: String(g.category || ''),
    bbox: (g.boundingbox || []).map(Number), // [sul, norte, oeste, leste]
  };
}

export function buildQuery(p, g, cap) {
  let scope, pre = '';
  const isArea = g.category === 'boundary' || g.category === 'place';
  if (p.radius_km > 0) scope = `(around:${Math.round(p.radius_km * 1000)},${g.lat},${g.lon})`;
  else if (isArea && g.osmType === 'relation' && g.osmId > 0) { pre = `area(${3600000000 + g.osmId})->.a;`; scope = '(area.a)'; }
  else if (isArea && g.osmType === 'way' && g.bbox.length === 4 && g.bbox.every(Number.isFinite)) scope = `(${g.bbox[0]},${g.bbox[2]},${g.bbox[1]},${g.bbox[3]})`;
  else scope = `(around:1500,${g.lat},${g.lon})`; // local mapeado só como ponto: 1,5 km em volta
  const filters = p.segment === 'outro'
    ? [`[~"^(shop|amenity|craft|office|leisure|healthcare|tourism)$"~"."]["name"~"${reEscape(p.term)}",i]`]
    : SEGMENT_FILTERS[p.segment].map((f) => `${f}["name"]`);
  return `[out:json][timeout:25][maxsize:67108864];${pre}(${filters.map((f) => `nwr${f}${scope};`).join('')});out center tags ${cap};`;
}

export function osmToPlace(el) {
  const tg = el.tags || {};
  if (!tg.name) return null;
  const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
  return {
    external_id: `${el.type}/${el.id}`, source_url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    name: tg.name, category: tg.shop || tg.amenity || tg.craft || tg.office || tg.leisure || tg.healthcare || tg.tourism || '',
    street: tg['addr:street'], number: tg['addr:housenumber'], neighborhood: tg['addr:suburb'] || tg['addr:neighbourhood'],
    city: tg['addr:city'], state: tg['addr:state'], postcode: tg['addr:postcode'],
    phone: tg['contact:mobile'] || tg['contact:whatsapp'] || tg.phone || tg['contact:phone'] || tg.mobile,
    website: tg.website || tg['contact:website'] || tg.url,
    instagram: tg['contact:instagram'], facebook: tg['contact:facebook'],
    lat: typeof lat === 'number' ? lat : undefined, lon: typeof lon === 'number' ? lon : undefined,
  };
}

const osm = {
  key: 'osm',
  label: 'OpenStreetMap',
  attribution: '© colaboradores do OpenStreetMap (ODbL)',
  async search(p, { signal, onStep } = {}) {
    onStep?.('Localizando a área…');
    const g = await geocode(p, signal);
    // Pede mais que o necessário quando há filtro de presença digital, com teto fixo.
    const cap = Math.min(p.presence === 'todas' ? p.limit : p.limit * 4, 600);
    const ql = buildQuery(p, g, cap);
    const wholeArea = !(p.radius_km > 0) && !p.neighborhood;
    let lastErr = 'A fonte de dados está indisponível agora.';
    // Uma passada pelos servidores públicos, um de cada vez (no pior caso, cerca de 1min45).
    for (let i = 0; i < OVERPASS.length; i++) {
      if (signal?.aborted) throw new DOMException('Cancelada', 'AbortError');
      onStep?.(`Consultando estabelecimentos (servidor ${i + 1} de ${OVERPASS.length})…`);
      let r;
      try { r = await fetchT(OVERPASS[i], { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(ql) }, 35000, signal); }
      catch (e) {
        if (signal?.aborted) throw e;
        // Cidade inteira sem bairro nem raio costuma estourar o tempo: não adianta repetir a mesma consulta pesada.
        if (wholeArea && i === 0) throw new Error('A área é grande demais para a fonte gratuita. Informe um bairro ou escolha um raio (ex.: 2 km).');
        lastErr = 'A fonte de dados demorou demais para responder. Tente de novo em alguns minutos ou reduza a área.'; continue;
      }
      if ([429, 502, 503, 504].includes(r.status)) { lastErr = 'A fonte gratuita está ocupada agora. Tente novamente em alguns minutos.'; continue; }
      if (r.status === 400) throw new Error('A fonte recusou a consulta. Simplifique o termo personalizado.');
      if (!r.ok) { lastErr = `A fonte de dados respondeu com erro (${r.status}).`; continue; }
      const data = await r.json().catch(() => null);
      if (!data || !Array.isArray(data.elements)) { lastErr = 'Resposta inesperada da fonte de dados.'; continue; }
      if (typeof data.remark === 'string' && /timed out|out of memory/i.test(data.remark) && !data.elements.length) {
        throw new Error('A área é grande demais para a fonte gratuita. Informe um bairro ou escolha um raio (ex.: 2 km).');
      }
      return { places: data.elements.map(osmToPlace).filter(Boolean), areaLabel: g.label };
    }
    throw new Error(lastErr);
  },
};

export const PROVIDERS = { osm };
