// Lead Finder — gerador de mensagens por modelos (gratuito, sem IA externa).
// Regras: só cita problemas COMPROVADOS pela análise; "sem site" só aparece como pergunta/observação
// quando a fonte não informa site, nunca como afirmação; nada é enviado sozinho.
import { FINDINGS } from './lead-score.js';

export const TONES = [['curta', 'Curta'], ['profissional', 'Profissional'], ['informal', 'Informal']];
export const SERVICES = [
  ['site', 'Site de uma página'], ['cardapio', 'Cardápio digital com pedidos'], ['sob_medida', 'Site sob medida'],
  ['melhoria', 'Melhorar o site atual'], ['sistema', 'Sistema web'],
];
const SERVICE_TEXT = {
  site: 'um site simples e bonito, que aparece no Google e leva o cliente direto para o seu WhatsApp',
  cardapio: 'um cardápio digital em que o cliente vê os produtos e já faz o pedido pelo próprio site',
  sob_medida: 'um site feito sob medida para o seu negócio',
  melhoria: 'uma versão melhor do site de vocês, mais rápida e ajustada para o celular',
  sistema: 'um sistema web para organizar o dia a dia do negócio',
};
const SEGMENT_WORD = { oficinas: 'oficinas', barbearias: 'barbearias e salões', restaurantes: 'restaurantes e lanchonetes', clinicas: 'clínicas', academias: 'academias', lojas: 'lojas', servicos: 'prestadores de serviço' };

export function defaultService(c) {
  if (c.site_status === 'informado' && c.site_confirmed !== 'sem_site') return 'melhoria';
  return c.segment === 'restaurantes' ? 'cardapio' : 'site';
}

// Fatos que a mensagem pode citar, com a origem de cada um.
export function factsFor(c) {
  const a = c.site_analysis;
  const hasSite = c.site_status === 'informado' && c.site_confirmed !== 'sem_site';
  const problems = hasSite && a && a.status !== 'bloqueado' && a.status !== 'inconclusivo' ? (a.problems || []).filter((id) => FINDINGS[id]?.m) : [];
  return { hasSite, noSiteConfirmed: c.site_confirmed === 'sem_site', problems };
}

export function buildMessage(c, { tone = 'profissional', service, sender = '' } = {}) {
  const f = factsFor(c);
  const svc = SERVICE_TEXT[service || defaultService(c)] || SERVICE_TEXT.site;
  const eu = sender.trim();
  const seg = SEGMENT_WORD[c.segment];
  const nome = c.name;
  // Observação baseada em fatos (ou nenhuma, se não houver fato verificável).
  let obs = '';
  if (f.problems.length) {
    const list = f.problems.slice(0, 2).map((id) => FINDINGS[id].m);
    obs = `Dei uma olhada no site de vocês e notei que ${list.join(' e que ')}.`;
  } else if (f.noSiteConfirmed) obs = 'Procurei e não encontrei um site de vocês.';
  else if (!f.hasSite) obs = 'Procurei o site de vocês e não achei. Vocês têm um?';

  if (tone === 'curta') {
    return [`Olá! Tudo bem?${eu ? ` Sou ${eu} e` : ''} ${eu ? 'trabalho' : 'Trabalho'} com criação de sites.`, obs, `Posso mostrar uma ideia de ${svc} para a ${nome}? É sem compromisso.`].filter(Boolean).join(' ');
  }
  if (tone === 'informal') {
    return [`Oi, pessoal da ${nome}! Tudo certo?`, `${eu ? `Aqui é ${eu}, ` : ''}${eu ? 'eu' : 'Eu'} faço sites${seg ? ` para ${seg}` : ''} aqui da região e encontrei vocês numa pesquisa de negócios locais.`, obs, `Queria mostrar uma ideia: ${svc}. Posso te mandar um exemplo? Sem compromisso nenhum 🙂`].filter(Boolean).join('\n\n');
  }
  return [`Olá! Tudo bem?`, `${eu ? `Meu nome é ${eu} e ` : ''}${eu ? 'trabalho' : 'Trabalho'} com desenvolvimento de sites. Encontrei a ${nome} durante uma pesquisa de negócios da região.`, obs, `Gostaria de apresentar uma ideia para melhorar a presença de vocês na internet: ${svc}.`, `Posso te mostrar um exemplo, sem compromisso?`].filter(Boolean).join('\n\n');
}
