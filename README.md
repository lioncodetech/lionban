# LionBan

Kanban pessoal para registrar bugs e delegar correções ao Codex, sempre no repositório GitHub escolhido no chamado.

## EasyPanel

1. Crie um serviço PostgreSQL e aplique `db/schema.sql`.
2. Crie os serviços `web` (Dockerfile) e `worker` (Dockerfile.worker) usando as mesmas variáveis de `.env.example`.
3. Use um GitHub fine-grained token restrito apenas aos repositórios desejados, com Contents (read/write).
4. Monte um volume persistente em `/root/.codex` no worker e autentique o Codex uma vez pelo terminal do EasyPanel.
5. Exponha somente o serviço web por HTTPS. PostgreSQL e worker permanecem privados.

O worker nunca executa deploy. Ele valida o ID do repositório, cria `lionban/chamado-{id}`, exige testes configurados para merge automático e coloca o chamado em aprovação quando não há teste confiável.
