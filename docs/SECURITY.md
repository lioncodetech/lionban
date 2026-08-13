# Segurança operacional

## Limites implementados

- A autenticação falha fechada e exige usuário, hash de senha e segredo JWT forte.
- O login limita tentativas; cookies são `HttpOnly`, `Secure` e `SameSite=Strict`.
- Requisições mutáveis exigem origem compatível e corpos HTTP têm limite.
- Anexos têm limites, tipos permitidos e validação da assinatura binária.
- Saídas, transcrições, listas, concorrência e tempos de execução são limitados.
- O subprocesso do Codex recebe apenas variáveis operacionais permitidas. Token GitHub, banco do LionWorkForce, webhooks e variáveis exclusivas de teste não são repassados; estas últimas são usadas somente pelos comandos de validação controlados pelo worker.
- O Codex usa `workspace-write` por padrão.
- URLs de deploy bloqueiam destinos privados e podem ser limitadas por `DEPLOY_ALLOWED_HOSTS`.
- Pull Requests e pushes na branch principal são reconciliados com o GitHub depois de reinícios.

## EasyPanel

1. Exponha somente `lion-ban-web`; worker e PostgreSQL não recebem domínio público.
2. No worker, monte o volume do Codex em `/home/node/.codex`.
3. Restrinja o token GitHub aos repositórios autorizados e às permissões necessárias.
4. Defina limites de CPU, memória e disco para web e worker.
5. Configure `DEPLOY_ALLOWED_HOSTS` com os hosts exatos que podem receber deploy.
6. Não coloque segredos do LionWorkForce nas variáveis de teste de uma aplicação.
7. Rotacione imediatamente qualquer token que apareça em captura de tela ou log.

## Modelo de confiança

O controller mantém as credenciais necessárias para clonar e publicar, mas não as inclui no ambiente do Codex. O Codex lê e altera somente o clone temporário do repositório selecionado. O diretório é removido ao final, inclusive em falha ou cancelamento. A publicação é executada pelo controller depois das validações.

Para isolamento máximo contra falhas do runtime do container, execute o worker em serviço dedicado, sem outros segredos da infraestrutura, e limite sua rede de saída. O EasyPanel é a fronteira de isolamento: não compartilhe o container do worker com serviços de produção.

## Atualizações

`npm audit --package-lock-only --omit=dev` deve retornar zero vulnerabilidades antes do deploy. Não use `npm audit fix --force`, pois ele pode instalar uma versão incompatível do Next.js. Codex, RTK, PostCSS e Sharp estão fixados/forçados para versões verificadas no build.
