# Central

App pessoal (PWA) do Gabriel para organizar o trabalho de criação de sites: clientes, projetos, pagamentos, despesas e acessos (logins/senhas) de cada projeto. Uso individual, em português do Brasil.

## Stack
- Front-end estático, sem build: `index.html`, `app.js` (telas e lógica), `crypto.js` (cofre e biometria), `extras.js` (Pix, Google Drive, cronômetro, checklist), `styles.css`, `sw.js`, `manifest.webmanifest`, `drive-callback.html/.js` (retorno do login do Google).
- `vendor/qrcode.mjs` é o qrcode-generator 2.0.4 (MIT) copiado localmente.
- `vendor/supabase.js` é o supabase-js v2 (UMD) copiado localmente (a CSP só permite scripts de 'self').
- Backend: Supabase, projeto **Central** (ref `llpbtrobjfszgzlvdogr`, região sa-east-1, plano gratuito). URL e chave publishable estão em `config.js` (a chave pública é feita para ficar no navegador).
- Hospedagem: GitHub Pages, publicado em https://gabriellimakuiawinski-alt.github.io/Central/ (repo gabriellimakuiawinski-alt/Central, branch main, pasta raiz). Primeiro cadastro já feito (a vaga única está ocupada).

## Visual
- Vidro fosco sobre um fundo liso com 3 manchas desfocadas das cores da paleta (montadas por `theme.js` em `.aurora`). Sem desenhos/ilustrações no fundo, sem brilhos neon (o usuário achou que tinha "cara de IA").
- `theme.js` (carregado no `<head>`, antes do CSS) aplica no `<html>`: `data-style` = paleta (12: mistico "Petróleo e ouro" padrão, oceano, floresta, terracota, cafe, bauhaus "Mostarda e anil", crepusculo, lavanda, rosa, menta, grafite, carmesim), `data-mode` dark/light (escolhido como automático/escuro/claro), `data-font` (editorial = Fraunces + Instrument Sans, padrão; grotesca = Bricolage Grotesque; tecnica = IBM Plex Sans + Mono), `data-motion` full/calm. Salvo em localStorage (`central.style/mode/font/motion`), só no aparelho. Troca em Ajustes > Aparência; o botão sol/lua do Painel alterna claro/escuro.
- Paletas: o CSS de cada uma (claro e escuro) é gerado a partir de 5 cores com contraste conferido (texto/destaque >= 4.5:1). Para criar outra, siga o mesmo formato de variáveis em `styles.css` e adicione em `STYLES` no `theme.js`.
- Fontes hospedadas em `fonts/` (woff2, subconjunto latino, licença OFL); a CSP não permite fontes externas.
- Cores SEMPRE por variável (`--accent`, `--gold`, `--k1..4`, `--c1..7`, `--text`, `--muted`, `--soft`, `--track`...). Nada de hex fixo em app.js/leads.js: em SVG, use `style="fill:var(--x)"` / `style="stop-color:var(--x)"`.
- Painel: data + saudação, 4 cartões coloridos com minigráfico dos últimos 8 meses, gráfico de linha com tooltip, rosca por etapa, anéis de progresso, contadores e entrada animados. SVG puro, sem bibliotecas.
- Respeita `prefers-reduced-motion`.

## Decisões já tomadas
- Login principal: e-mail + senha + 2FA TOTP. Biometria (WebAuthn) é só atalho de desbloqueio no celular; o login normal sempre funciona.
- O banco exige sessão `aal2` (2FA) em todas as tabelas (política restritiva), RLS por `user_id`, e um trigger em `auth.users` aceita apenas 1 usuário.
- Cofre: uma chave de dados aleatória é protegida pela senha (PBKDF2 600k) e por uma chave de recuperação offline. Senhas dos serviços são cifradas no aparelho (AES-GCM, amarradas ao id do registro). O servidor só vê texto cifrado. Se a senha e a chave de recuperação forem perdidas, as senhas guardadas não são recuperáveis.
- Etapas do projeto: demo, demo_mostrada, pagamento_inicial, producao, confirmacao, pagamento_final, publicacao (as duas últimas podem trocar de ordem). Cada projeto tem preço próprio.
- Sem mensalidade/recorrência por enquanto. Despesas existem para calcular lucro.

## Tabelas (schema public)
vault_keys, clients, projects, project_services, payments, expenses, project_links, activity_log, app_settings, time_entries, reminders, site_checks (+ tabelas `lf_*`). Migrações já aplicadas: schema inicial, links/config/2FA obrigatório, cadastro único, lead finder, `central_fase2` (18/11/2026, arquivo em `supabase/migrations/20261118_central_fase2.sql`).

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

## Fase 2 (18/11/2026)
- **Pix**: `extras.js` gera o BR Code (CRC16 conferido com o exemplo do Banco Central) e o QR em SVG. Usa `pix_key`, `business_name` e `pix_city` de app_settings. Botão "Pix" em cada pagamento pendente e "Pix de R$ X" no resumo do projeto; a mensagem "Cobrar pagamento" leva o copia e cola.
- **Lead vira cliente**: botão "Virou cliente" na ficha do lead (`convertLead` no app.js, passado ao leads.js pelo `LF.init`). Cria cliente + projeto com `lead_id`, marca o lead como venda concluída e registra no histórico.
- **Mensalidades**: projeto tem `monthly_fee`, `monthly_day`, `monthly_start`, `monthly_end`. `ensureMonthly()` (no loadAll) cria um pagamento `kind='mensalidade'` com `ref_month` por mês até o atual (índice único project_id+kind+ref_month). Mensalidade NÃO entra no saldo do projeto (`paidOf`), mas entra no faturamento.
- **Meta do mês** (`app_settings.monthly_goal`) e mensalidades ativas: cartão no Painel.
- **Checklist de entrega**: modelo em `app_settings.checklist_template` (null = padrão `DEFAULT_CHECKLIST`); marcações em `projects.checklist` ({item: data}). Aba "Entrega" do projeto.
- **Horas**: tabela `time_entries`; aba "Horas" com cronômetro (localStorage `central.timer`, um por vez, chip flutuante) e lançamento manual; mostra valor por hora.
- **Lembretes**: tabela `reminders` (cliente, projeto ou lead); página `#/lembretes`, bloco no Painel e alertas. Também lista as próximas ações dos leads (`lf_companies.next_action_at`).
- **Monitor de sites**: Edge Function `site-check` (`supabase/functions/site-check/`, `verify_jwt` desligado, confere getUser + aal2, mesma proteção SSRF do lf-analyze). Verifica status, tempo, HTTPS e vencimento do domínio (RDAP; registro.br para .br). Roda sozinha 1x/dia ao abrir o app e pelo "verificar agora". Resultados em `site_checks`; alertas no Painel.
- **Backup no Google Drive**: OAuth do Google só no navegador (token implícito, escopo `drive.file`), retorno em `drive-callback.html` (token na sessionStorage da aba). Precisa de um ID de cliente OAuth criado pelo usuário no Google Cloud (passo a passo em Ajustes > Backup); redirecionamento `.../Central/drive-callback.html`. Envio diário ao abrir o app se o token ainda valer; senão aparece alerta e o botão "Enviar agora". CSP libera `https://www.googleapis.com`.
- Pendente de teste com login real: tudo da fase 2 foi testado só na prévia com dados de exemplo; a Edge Function `site-check` está publicada mas não foi chamada com sessão real; o Drive depende do ID de cliente do usuário.

## Pendências / ideias
1. ~~Restaurar backup dentro do app~~ FEITO. Ainda não testado com login real.
2. ~~Backup no Google Drive~~ FEITO (falta o usuário criar o ID de cliente OAuth).
3. Boleto/Pix automático com confirmação (exige banco/PSP), Gmail, status de deploy do GitHub.

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
