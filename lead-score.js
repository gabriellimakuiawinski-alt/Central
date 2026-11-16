// Lead Finder — pontuação (Lead Score 0–100) e textos dos achados da análise.
// Regra central: só pontua o que foi verificado. Indício sem confirmação vale metade e aparece como confiança baixa.

export const DEFAULT_WEIGHTS = { sem_site: 30, problemas_site: 25, presenca_limitada: 15, contato: 10, adequacao: 20 };
export const CRITERIA = [
  ['sem_site', 'Ausência de site próprio'], ['problemas_site', 'Problemas técnicos no site'],
  ['presenca_limitada', 'Presença digital limitada'], ['contato', 'Facilidade de contato'], ['adequacao', 'Adequação aos seus serviços'],
];

// Achados da análise: texto para a ficha (t) e frase curta para mensagens (m). Só "problems" são fatos comprovados.
export const FINDINGS = {
  fora_do_ar: { t: 'O site não abriu (fora do ar, domínio inexistente ou erro do servidor).', m: 'o site não estava abrindo quando tentei acessar', w: 25 },
  sem_https: { t: 'O site não funciona com HTTPS (conexão sem cadeado de segurança).', m: 'o site abre sem o cadeado de segurança (HTTPS)', w: 10 },
  https_falha: { t: 'O HTTPS do site está com defeito: só a versão sem segurança (http) abriu.', m: 'o endereço seguro (HTTPS) do site está com erro', w: 12 },
  sem_viewport: { t: 'A página não declara viewport: não se adapta à tela do celular.', m: 'o site não se ajusta bem à tela do celular', w: 12 },
  sem_titulo: { t: 'A página inicial não tem título (tag title).', m: 'a página inicial está sem título para o Google', w: 5 },
  sem_descricao: { t: 'A página inicial não tem descrição para buscadores (meta description).', m: 'o site está sem a descrição que aparece no Google', w: 4 },
  links_quebrados: { t: 'Há links internos que levam a páginas com erro.', m: 'alguns links do site levam a páginas com erro', w: 6 },
  conteudo_misto: { t: 'A página segura carrega arquivos por conexão insegura (conteúdo misto).', m: 'partes do site carregam sem segurança', w: 4 },
  lento_mobile: { t: 'Desempenho baixo no celular (nota abaixo de 50 no PageSpeed/Lighthouse).', m: 'o site demora para carregar no celular', w: 10 },
  // sugestões (não entram como problema comprovado nem em mensagens)
  https_sem_redirecionar: { t: 'O HTTPS existe, mas o endereço http não redireciona para ele.' },
  sem_h1: { t: 'Nenhum título principal (h1) encontrado no HTML inicial.' },
  sem_og: { t: 'Sem dados de compartilhamento (Open Graph): o link fica sem prévia no WhatsApp.' },
  sem_lang: { t: 'O idioma da página não está declarado.' },
  desempenho_medio: { t: 'Desempenho mediano no celular (nota entre 50 e 89 no PageSpeed).' },
  seo_baixo: { t: 'Nota de SEO abaixo de 80 no Lighthouse.' },
  // inconclusivos
  bloqueio_automatico: { t: 'O site bloqueou a verificação automática. Não dá para afirmar nada: confira abrindo no navegador.' },
  sem_resposta: { t: 'O site não respondeu à verificação a tempo. Isso não prova que ele está fora do ar: confira abrindo no navegador.' },
  nao_html: { t: 'O endereço não devolveu uma página HTML comum.' },
  desempenho_nao_medido: { t: 'Desempenho não medido (PageSpeed indisponível ou sem cota no momento).' },
};

// Adequação ao que você vende (sites de uma página, cardápio digital, sites sob medida). Critério seu, não medido.
const FIT = { restaurantes: 1, barbearias: 0.9, clinicas: 0.85, oficinas: 0.8, lojas: 0.8, academias: 0.75, servicos: 0.7, outro: 0.5 };

export const priorityOf = (s) => (s >= 80 ? ['Muito alta', 'bad'] : s >= 60 ? ['Alta', 'mid'] : s >= 40 ? ['Média', ''] : ['Baixa', '']);
const isMobile = (pn) => /^[1-9]\d9\d{8}$/.test(String(pn || ''));

export function computeScore(c, weights) {
  const W = { ...DEFAULT_WEIGHTS, ...(weights || {}) };
  const parts = [];
  const add = (key, frac, why, conf) => parts.push({ key, max: W[key], pts: Math.round(W[key] * frac), why, conf });
  const a = c.site_analysis;
  const hasSite = c.site_status === 'informado' && c.site_confirmed !== 'sem_site';

  // 1) Ausência de site próprio
  if (c.site_confirmed === 'sem_site') add('sem_site', 1, 'Você confirmou que a empresa não tem site próprio.', 'alta');
  else if (c.site_confirmed === 'tem_site' || hasSite) add('sem_site', 0, 'A empresa tem site.', 'alta');
  else if (a?.status === 'fora_do_ar' && c.website) add('sem_site', 0, 'Há um site cadastrado (mesmo fora do ar).', 'alta');
  else add('sem_site', 0.5, 'A fonte não informa site. É um indício, não uma certeza: confirme para valer os pontos inteiros.', 'baixa');

  // 2) Problemas técnicos comprovados
  if (!hasSite) add('problemas_site', 0, 'Sem site para analisar.', 'alta');
  else if (!a) add('problemas_site', 0, 'Site ainda não analisado.', 'nenhuma');
  else if (a.status === 'bloqueado' || a.status === 'inconclusivo') add('problemas_site', 0, 'A verificação automática não conseguiu ler o site: nada comprovado.', 'nenhuma');
  else {
    const sum = (a.problems || []).reduce((n, id) => n + (FINDINGS[id]?.w || 0), 0);
    add('problemas_site', Math.min(1, sum / 25), (a.problems || []).length ? `${a.problems.length} problema(s) comprovado(s) na análise.` : 'Nenhum problema comprovado na análise.', a.unknown?.includes('desempenho_nao_medido') ? 'média' : 'alta');
  }

  // 3) Presença digital limitada
  if (hasSite) add('presenca_limitada', 0, 'Tem site próprio.', 'alta');
  else if (c.site_status === 'rede_social' || c.instagram || c.facebook) add('presenca_limitada', 1, 'Na fonte aparece só rede social, sem site próprio.', c.site_confirmed === 'sem_site' ? 'alta' : 'média');
  else if (c.site_confirmed === 'sem_site') add('presenca_limitada', 1, 'Sem site e sem rede social cadastrada.', 'média');
  else add('presenca_limitada', 0, 'Não dá para verificar a presença digital só pela fonte.', 'nenhuma');

  // 4) Facilidade de contato
  if (isMobile(c.phone_norm)) add('contato', 1, 'Tem celular público (permite WhatsApp).', 'alta');
  else if (c.phone_norm) add('contato', 0.6, 'Tem telefone fixo público.', 'alta');
  else add('contato', 0, 'Nenhum telefone na fonte.', 'alta');

  // 5) Adequação
  add('adequacao', FIT[c.segment] ?? 0.5, 'Critério seu: quanto o segmento combina com os serviços que você oferece.', 'média');

  const max = parts.reduce((n, p) => n + p.max, 0) || 1;
  const score = Math.max(0, Math.min(100, Math.round((parts.reduce((n, p) => n + p.pts, 0) / max) * 100)));
  const weak = parts.filter((p) => p.conf === 'baixa' || p.conf === 'nenhuma').length;
  const confidence = weak === 0 ? 'alta' : weak === 1 ? 'média' : 'baixa';
  return { score, confidence, parts };
}
