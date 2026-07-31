# LionWorkForce

> No EasyPanel, o contêiner do worker é a fronteira de isolamento do executor.
> O padrão é `CODEX_SANDBOX_MODE=workspace-write`. O subprocesso do Codex recebe um ambiente sanitizado:
> `GITHUB_TOKEN`, `DATABASE_URL` e outros segredos do worker não são repassados.

Central pessoal para registrar bugs e delegar correções ao Codex, sempre no repositório GitHub escolhido no chamado.

## EasyPanel

1. Crie um serviço PostgreSQL e aplique `db/schema.sql`.
2. Crie os serviços `web` (Dockerfile) e `worker` (Dockerfile.worker) usando as mesmas variáveis de `.env.example`.
3. Use um GitHub fine-grained token restrito apenas aos repositórios desejados, com `Contents: Read and write`. Para criar Pull Requests automaticamente, conceda também `Pull requests: Read and write`.
4. Monte um volume persistente em `/home/node/.codex` no worker e autentique o Codex uma vez pelo terminal do EasyPanel. Se o volume antigo estava em `/root/.codex`, autentique novamente.
5. Exponha somente o serviço web por HTTPS. PostgreSQL e worker permanecem privados.

Use `?schema=lionworkforce` na `DATABASE_URL` dos serviços web e worker. O driver configura `search_path=lionworkforce,public`, e a migração `011_lwf_schema` cria o schema e move para ele todas as estruturas `lwf_*` existentes sem apagar os dados.

O worker valida o ID do repositório, cria `lionworkforce/chamado-{id}` e executa apenas as automações marcadas no chamado. Pull Request exige commit e push. O deploy exige um webhook HTTPS configurado em **Aplicações → Configurar** e só é disparado depois da integração na branch principal. Ao criar uma tag em um projeto Node.js, o worker sincroniza antes a versão do `package.json` (e do lockfile atualizado pelo npm), inclui a mudança no commit e somente depois envia a tag.

Ao selecionar **Criar tag e ativar Action** em um chamado, o formulário consulta as tags recentes do repositório da aplicação selecionada para sugerir a próxima versão e mostra também as 5 execuções mais recentes do GitHub Actions, com estado, data e link para os detalhes.

O login exige `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` e `AUTH_SECRET` com pelo menos 32 caracteres. Não existem credenciais padrão. Chamados concluídos, falhados ou cancelados são arquivados e removidos segundo os prazos de **Configurações** (7 e 15 dias por padrão). O worker executa essa manutenção ao iniciar e a cada hora.

Em **Aplicações → Configurar**, cada repositório pode receber comandos próprios e variáveis exclusivas de teste, como `DATABASE_URL` para uma base descartável. Os valores ficam ocultos depois de salvos e são entregues somente aos processos daquele repositório. Se existir `package-lock.json` e nenhum comando de instalação tiver sido informado, o worker executa `npm ci` automaticamente. Nunca use nessas variáveis os segredos internos do LionWorkForce.

Cada aplicação também pode ter um **contexto permanente do projeto**, enviado em todos os chamados daquele repositório. Use esse campo para registrar arquitetura, regras de negócio, comandos de validação, componentes protegidos, padrões visuais, limitações e ambiente de execução. Depois que uma correção é realmente integrada à branch principal, o worker acrescenta ao histórico técnico da aplicação o chamado, o commit e os arquivos alterados. Execuções falhadas, patches isolados e mudanças ainda não integradas não entram nesse histórico.

O arquivo `docs/PROJECT_CONTEXT.md` de cada repositório é a fonte oficial desse contexto. Em **Aplicações → Configurar**, os botões **Abrir arquivo** e **Criar/Editar no GitHub** levam diretamente ao documento, sem manter um editor duplicado no LionWorkForce. O worker o sincroniza ao clonar a branch principal e novamente depois de uma integração, e o Codex o revisa durante a correção. Isso também incorpora no chamado seguinte documentos integrados por Pull Request no GitHub. Arquivos ausentes, vazios ou acima de 30.000 caracteres não substituem o último contexto válido; o motivo aparece nos eventos do chamado.

O prompt reutilizável para preparar essa documentação está em [`docs/PROMPT_CONTEXTO_PROJETO.md`](docs/PROMPT_CONTEXTO_PROJETO.md).

Ao criar, editar ou duplicar um chamado, é possível anexar até cinco imagens. Quando duas ou mais imagens são enviadas, os nomes recebem sufixos sequenciais antes da extensão (`imagem1.png`, `imagem2.png` e assim por diante); ao duplicar, esses sufixos são preservados sem repetição. O nome de uma imagem enviada sozinha é preservado. Clique na miniatura de uma imagem anexada para ampliá-la em um popup; o mesmo recurso está disponível na galeria do detalhe do chamado. Clique fora da imagem ou no botão de fechar para retornar.

O Deployment Trigger do EasyPanel apenas confirma que a solicitação foi aceita. Por isso, o chamado mostra o deploy como em curso até o usuário confirmar, no histórico do EasyPanel, que ele terminou; falhas HTTP ao disparar o webhook são registradas automaticamente.

Webhooks e URLs de verificação são validados ao salvar e antes do acesso. Endereços locais, redes privadas e credenciais embutidas são bloqueados. Em produção, use `DEPLOY_ALLOWED_HOSTS` com os hosts externos autorizados, separados por vírgula.

As imagens executam como usuário não privilegiado, Codex e RTK têm versões fixadas e o instalador do RTK é verificado por SHA-256. O contexto Docker exclui `.env`, `.git`, chaves e artefatos locais. Consulte [`docs/SECURITY.md`](docs/SECURITY.md) antes do deploy.

Cada build grava o SHA do commit em `APP_COMMIT_SHA`. O endpoint público `GET /api/version`
responde com `status: "ready"` e esse SHA, sempre com `Cache-Control: no-store`, para que o
LionWorkForce acompanhe automaticamente quando o novo deploy entrou no ar.

## Renomeação para LionWorkForce

A migração `010_lwf_rename` preserva os dados e renomeia tabelas, tipos, sequências, índices e constraints de `lb_*` para `lwf_*`. Views `lb_*` de compatibilidade são mantidas durante a transição entre versões do web e do worker.

Se o schema de testes estiver no mesmo banco e pertencer ao usuário da conexão, ele será renomeado de `lionban_test` para `lionworkforce_test`. Depois do deploy, atualize a variável da aplicação para usar `?schema=lionworkforce_test`. Se o schema estiver em outro banco, execute nele:

```sql
ALTER SCHEMA lionban_test RENAME TO lionworkforce_test;
```
