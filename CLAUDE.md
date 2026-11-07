# Central

App pessoal (PWA) do Gabriel para organizar o trabalho de criação de sites: clientes, projetos, pagamentos, despesas e acessos (logins/senhas) de cada projeto. Uso individual, em português do Brasil.

## Stack
- Front-end estático, sem build: `index.html`, `app.js` (telas e lógica), `crypto.js` (cofre e biometria), `styles.css`, `sw.js`, `manifest.webmanifest`.
- `vendor/supabase.js` é o supabase-js v2 (UMD) copiado localmente (a CSP só permite scripts de 'self').
- Backend: Supabase, projeto **Central** (ref `llpbtrobjfszgzlvdogr`, região sa-east-1, plano gratuito). URL e chave publishable estão em `config.js` (a chave pública é feita para ficar no navegador).
- Hospedagem: GitHub Pages, publicado em https://gabriellimakuiawinski-alt.github.io/central/ (repo gabriellimakuiawinski-alt/central, branch main, pasta raiz). Primeiro cadastro já feito (a vaga única está ocupada).

## Visual
- Tema "vidro líquido" preto com luz vermelha (referência: dashboard roxo com cartões de vidro). Fundo `.aurora` animado, cartões com `backdrop-filter`, brilho que segue o cursor (`--mx/--my`).
- Painel com gráficos em SVG puro e interativos (linha recebido x despesas com tooltip, rosca por etapa, anéis de progresso) e contadores animados. Sem bibliotecas: a CSP só aceita scripts de 'self'.
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
