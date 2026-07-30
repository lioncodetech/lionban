# LionWorkForce

> No EasyPanel, o contêiner do worker é a fronteira de isolamento do executor.
> `CODEX_SANDBOX_MODE=danger-full-access` evita a criação de namespaces
> bloqueada pelo contêiner. O subprocesso do Codex recebe um ambiente sanitizado:
> `GITHUB_TOKEN`, `DATABASE_URL` e outros segredos do worker não são repassados.

Central pessoal para registrar bugs e delegar correções ao Codex, sempre no repositório GitHub escolhido no chamado.

## EasyPanel

1. Crie um serviço PostgreSQL e aplique `db/schema.sql`.
2. Crie os serviços `web` (Dockerfile) e `worker` (Dockerfile.worker) usando as mesmas variáveis de `.env.example`.
3. Use um GitHub fine-grained token restrito apenas aos repositórios desejados, com `Contents: Read and write`. Para criar Pull Requests automaticamente, conceda também `Pull requests: Read and write`.
4. Monte um volume persistente em `/root/.codex` no worker e autentique o Codex uma vez pelo terminal do EasyPanel.
5. Exponha somente o serviço web por HTTPS. PostgreSQL e worker permanecem privados.

O worker valida o ID do repositório, cria `lionworkforce/chamado-{id}` e executa apenas as automações marcadas no chamado. Pull Request exige commit e push. O deploy exige um webhook HTTPS configurado em **Aplicações → Configurar** e só é disparado depois da integração na branch principal. Ao criar uma tag em um projeto Node.js, o worker sincroniza antes a versão do `package.json` (e do lockfile atualizado pelo npm), inclui a mudança no commit e somente depois envia a tag.

O login usa `ADMIN_USERNAME` (padrão `admin` quando ausente) e `ADMIN_PASSWORD_HASH`. Chamados concluídos, falhados ou cancelados são arquivados e removidos segundo os prazos de **Configurações** (7 e 15 dias por padrão). O worker executa essa manutenção ao iniciar e a cada hora.

Em **Aplicações → Configurar**, cada repositório pode receber comandos próprios e variáveis exclusivas de teste, como `DATABASE_URL` para uma base descartável. Os valores ficam ocultos depois de salvos e são entregues somente aos processos daquele repositório. Se existir `package-lock.json` e nenhum comando de instalação tiver sido informado, o worker executa `npm ci` automaticamente. Nunca use nessas variáveis os segredos internos do LionWorkForce.

O Deployment Trigger do EasyPanel apenas confirma que a solicitação foi aceita. Por isso, o chamado mostra o deploy como em curso até o usuário confirmar, no histórico do EasyPanel, que ele terminou; falhas HTTP ao disparar o webhook são registradas automaticamente.

## Renomeação para LionWorkForce

A migração `010_lwf_rename` preserva os dados e renomeia tabelas, tipos, sequências, índices e constraints de `lb_*` para `lwf_*`. Views `lb_*` de compatibilidade são mantidas durante a transição entre versões do web e do worker.

Se o schema de testes estiver no mesmo banco e pertencer ao usuário da conexão, ele será renomeado de `lionban_test` para `lionworkforce_test`. Depois do deploy, atualize a variável da aplicação para usar `?schema=lionworkforce_test`. Se o schema estiver em outro banco, execute nele:

```sql
ALTER SCHEMA lionban_test RENAME TO lionworkforce_test;
```
