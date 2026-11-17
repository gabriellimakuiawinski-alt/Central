# Central

App pessoal (PWA) do Gabriel para organizar o trabalho de criação de sites: clientes, projetos, pagamentos, despesas e acessos (logins/senhas) de cada projeto. Uso individual, em português do Brasil.

## Stack
- Front-end estático, sem build: `index.html`, `app.js` (telas e lógica), `crypto.js` (cofre e biometria), `styles.css`, `sw.js`, `manifest.webmanifest`.
- `vendor/supabase.js` é o supabase-js v2 (UMD) copiado localmente (a CSP só permite scripts de 'self').
- Backend: Supabase, projeto **Central** (ref `llpbtrobjfszgzlvdogr`, região sa-east-1, plano gratuito). URL e chave publishable estão em `config.js` (a chave pública é feita para ficar no navegador).
- Hospedagem: GitHub Pages, publicado em https://gabriellimakuiawinski-alt.github.io/central/ (repo gabriellimakuiawinski-alt/central, branch main, pasta raiz). Primeiro cadastro já feito (a vaga única está ocupada).

## Visual
- Tema "natureza mística + vidro líquido" (referência: dashboard com nuvens em camadas, lua e ramos dourados). `theme.js` (carregado no `<head>`, antes do CSS) monta a cena de fundo em `.aurora`: céu, lua, estrelas, nuvens e colinas em camadas com linhas de contorno, ramos dourados e vaga-lumes, tudo pintado com variáveis CSS.
- Estilos (`data-style` no `<html>`): mistico (padrão), floresta, crepusculo, carmesim (o visual antigo preto/vermelho). Modo (`data-mode`): dark/light, escolhido como automático/escuro/claro. Animações do fundo (`data-motion`): full/calm. Tudo salvo em localStorage (`central.style`, `central.mode`, `central.motion`), só no aparelho. Troca em Ajustes > Aparência; o botão de sol/lua do Painel alterna claro/escuro (com transição em círculo via View Transitions).
- Cores SEMPRE por variável (`--accent`, `--gold`, `--k1..4`, `--c1..7`, `--text`, `--muted`, `--soft`, `--track`...). Nada de hex fixo em app.js/leads.js: em SVG, use `style="fill:var(--x)"` / `style="stop-color:var(--x)"` (atributo `fill` não aceita var()).
- Painel: saudação por horário, 4 cartões coloridos com minigráfico dos últimos 8 meses e onda líquida animada, inclinação 3D no hover, gráfico de linha com tooltip, rosca por etapa, anéis de progresso, contadores animados. SVG puro, sem bibliotecas (a CSP só aceita scripts de 'self').
- Respeita `prefers-reduced-motion`.

## Decisões já tomadas
- Login principal: e-mail + senha + 2FA TOTP. Biometria (WebAuthn) é só atalho de desbloqueio no celular; o login normal sempre funciona.
- O banco exige sessão `aal2` (2FA) em todas as tabelas (política restritiva), RLS por `user_id`, e um trigger em `auth.users` aceita apenas 1 usuário.
- Cofre: uma chave de dados aleatória é protegida pela senha (PBKDF2 600k) e por uma chave de recuperação offline. Senhas dos serviços são cifradas no aparelho (AES-GCM, amarradas ao id do registro). O servidor só vê texto cifrado. Se a senha e a chave de recuperação forem perdidas, as senhas guardadas não são recuperáveis.
- Etapas do projeto: demo, demo_mostrada, pagamento_inicial, producao, confirmacao, pagamento_final, publicacao (as duas últimas podem trocar de ordem). Cada projeto tem preço próprio.
- Sem mensalidade/recorrência por enquanto. Despesas existem para calcular lucro.

## Tabelas (schema public)
vault_keys, clients, projects, project_services, payments, expenses, project_links, activity_log, app_settings. Migrações já aplicadas: schema inicial, links/config/2FA obrigatório, cadastro único.

## Regras ao mexer no código
- Todo texto vindo do usuário vai para o HTML via `esc()`. Nunca usar scripts ou handlers inline (a CSP bloqueia).
- Nunca guardar senha em texto puro, nem em logs. Campo "Observações" do serviço NÃO é criptografado.
- Mudou o schema? Use migração e rode os advisors de segurança do Supabase.
- Ao publicar nova versão, aumente o nome do cache em `sw.js`.

## Checklist de configuração (confirmar)
- Supabase > Authentication > URL Configuration: Site URL = a URL publicada acima (senão e-mails de confirmação/redefinição apontam para o lugar errado).
- Chave de recuperação do cofre guardada offline, fora do celular.
- 2FA TOTP ativo; biometria testada no celular (o login normal deve continuar funcionando).
- App instalado na tela inicial do celular.
- Cadastro de segundo usuário: trigger `apenas_um_usuario` em auth.users conferido e ativo.
- Supabase advisor: só resta "Leaked Password Protection" desligado (precisa de plano Pro; ignorar no plano gratuito).

## Pendências / ideias para a fase 2 (em ordem de utilidade)
1. ~~Restaurar backup dentro do app~~ FEITO (Ajustes > Backup > Restaurar de arquivo; mescla por id via upsert, não apaga, não mexe no cofre). Ainda não testado com login real.
2. Envio automático do backup para o Google Drive (exige credencial OAuth do Google).
3. Pix/boleto automático, Gmail, status de deploy do GitHub, cobrança recorrente de manutenção.

## Lead Finder (módulo de prospecção, pessoal — sem relação com a Founders)
- Arquivos: `leads.js` (telas, CRM), `lead-providers.js` (fontes de dados + normalização). Ligado ao `app.js` por `LF.init/view/actions/forms/onChange`; rota `#/leads` e `#/leads/<id>`.
- Fonte gratuita: OpenStreetMap (Nominatim + Overpass) chamada **pelo navegador** (servidores de nuvem são recusados pelo Overpass; testado). Hosts liberados na CSP do `index.html`. Fontes com chave (Google Places) devem ir em Edge Function.
- Banco: tabelas `lf_*` (settings, searches, companies, company_sources, site_analyses, scores, events, tasks, errors, api_usage), mesmo padrão RLS + 2FA. Funções: `lf_begin_search` (limite por hora no servidor), `lf_ingest` (deduplicação: id da fonte, telefone, domínio+nome, nome+proximidade), trigger `lf_log_company_changes` (histórico). Migração em `supabase/migrations/`.
- Regras: nunca mostrar dado fictício; "sem site" = "não encontrado na fonte"; WhatsApp só por clique, um lead por vez, e desativado em "Não contatar"; manter a atribuição do OpenStreetMap.
- Etapas 1 a 4 FEITAS (16/11/2026). Arquivos extras: `lead-score.js` (Lead Score + textos dos achados), `lead-messages.js` (mensagens por modelos, sem IA).
- Análise de sites: Edge Function `lf-analyze` (código em `supabase/functions/lf-analyze/`: `index.ts` sessão+banco, `analyze.ts` núcleo, `guard.ts` proteção SSRF). `verify_jwt` desligado de propósito: a função confere a sessão com `getUser` + `aal2`. Achados em 3 níveis: comprovado, sugestão, inconclusivo (bloqueio ou falta de resposta nunca vira "fora do ar").
- PageSpeed sem chave quase sempre responde "cota esgotada". Para medir desempenho: criar uma chave gratuita da PageSpeed Insights API e salvar como secret `PAGESPEED_API_KEY` da função.
- Lead Score é calculado no navegador a partir do lead (`computeScore`); indício não confirmado vale metade. O usuário confirma "não tem site" na ficha (`site_confirmed`).
- Pesquisas agendadas ficam em `lf_tasks` e rodam só com o app aberto, por toque em Executar (o Overpass recusa servidores de nuvem, então não há execução em segundo plano).
- Google Places: NÃO implementado (exige conta de faturamento). Só há o aviso em Ajustes.
- Pendências: a busca real no Overpass e o fluxo com login real ainda não foram confirmados pelo usuário; a 1ª tentativa dele (São Paulo inteira, "serviços") ficou travada, e por isso o raio padrão virou 2 km e área grande falha rápido.
- A Edge Function `lf-search` no Supabase é um resto desativado (responde 410); pode ser apagada no painel.
- Plano gratuito do Supabase só mantém 2 projetos ativos: em 16/11/2026 o Macacadas Map foi pausado para a Central voltar.
