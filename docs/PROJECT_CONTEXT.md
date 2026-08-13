# Contexto do LionWorkForce

## Finalidade

Painel privado para registrar chamados por repositório GitHub e delegar correções ao Codex em um worker isolado. O sistema organiza filas independentes por aplicação, conserva evidências e aprovações, valida alterações e, quando autorizado, publica commit, push, Pull Request, tag ou deploy.

## Arquitetura

- **Web:** Next.js App Router em `src/app`, com painel React e Route Handlers em `src/app/api`.
- **Serviços compartilhados:** autenticação, PostgreSQL, GitHub e controles de segurança em `src/lib`.
- **Worker:** `worker/index.ts` reclama execuções persistidas, clona somente o repositório selecionado, executa Codex e validações, publica resultados e aplica retenção.
- **Dados:** PostgreSQL no schema `lionworkforce`, tabelas `lwf_*`; criação inicial em `db/schema.sql` e evolução idempotente em `db/migrate.ts`.
- **Produção:** serviços web e worker separados no EasyPanel; somente web é público. Dockerfiles distintos e volume persistente para `/home/node/.codex`.

## Mapa principal

| Caminho | Responsabilidade |
| --- | --- |
| `src/app/page.tsx` | Quadro, formulários e detalhes dos chamados |
| `src/app/globals.css` | Sistema visual responsivo |
| `src/app/api/` | API autenticada de aplicações, chamados, saúde e configurações |
| `src/lib/` | Banco, autenticação, GitHub e validações de segurança |
| `worker/` | Executor, fila, contexto do projeto e publicação |
| `db/` | Schema inicial e migrações incrementais |
| `docker/`, `Dockerfile*` | Execução web/worker e identidade não privilegiada |
| `docs/` | Segurança e contexto operacional |

## Tecnologias

Next.js 16.2, React 19, TypeScript estrito, PostgreSQL via `pg`, Zod, JOSE, bcrypt, Vitest, ESLint, Docker, GitHub API, Codex CLI e RTK.

## Fluxo principal

1. Usuário autentica-se e importa um repositório autorizado pelo token GitHub.
2. Cria um chamado ligado de forma imutável a uma aplicação, com criticidade, prioridade de fila, automações e imagens opcionais.
3. Uma execução persistente entra na fila. Cada aplicação aceita somente uma execução ativa; prioridades menores saem primeiro e empates usam a data de criação.
4. O worker valida o ID do repositório, cria clone temporário e branch `lionworkforce/chamado-ID`.
5. Codex lê instruções/documentação, reproduz, altera e produz eventos públicos. O controller executa instalação e validações com o ambiente de teste configurado.
6. Conforme criticidade e opções, o resultado segue para aprovação ou publicação. Deploy bloqueia apenas aquela aplicação até confirmação.
7. O clone é removido ao final. Cards encerrados são arquivados e excluídos pelos prazos configurados; anexos acompanham a exclusão.

## Regras essenciais

- Repositório do chamado não muda depois da criação; edição só é aceita enquanto ticket e execução estão em aberto/fila.
- Pull Request exige commit e push. Deploy direto exige integração sem PR. Tag exige versão SemVer e publicação direta.
- Criticidades alta e crítica exigem aprovação; baixa e média podem continuar automaticamente.
- Chamado `deploy` não clona, não inicia Codex e não aceita imagens.
- Tokens e banco interno ficam no controller; o ambiente do Codex é sanitizado.
- Publicação direta, reconciliação e limpeza de branches pertencem ao worker, não ao subprocesso do Codex.

## Componentes sensíveis

`worker/index.ts`, `db/migrate.ts`, `db/schema.sql`, `src/proxy.ts`, `src/lib/auth.ts`, `src/lib/github.ts`, `src/lib/outbound-url.ts`, rotas de alteração/exclusão de tickets e Dockerfiles. Mudanças nesses pontos exigem testes direcionados e revisão de segurança.

## Ambiente

Node.js 24 nas imagens Docker. Web executa migração antes de `next start`; worker executa migração antes do loop. Ambos usam a mesma `DATABASE_URL` com `schema=lionworkforce`. O worker requer `GITHUB_TOKEN`, autenticação persistida do Codex e, para saídas externas, hosts autorizados. Consulte `docs/context/deployment.md` e `docs/SECURITY.md`.

## Testes e validação

Execute `npm test`, `npm run lint` e `npm run build`. Para mudanças de banco, valide migração em base descartável e segunda execução idempotente. Para UI, valide desktop e viewport móvel. Integrações reais com GitHub, Codex e EasyPanel exigem ambiente autorizado e não devem ser simuladas como concluídas sem evidência.

## Limitações conhecidas

- Uso pessoal e autenticação de usuário único.
- Estado de rate limit de login é local ao processo web.
- Logs públicos mostram eventos estruturados, não raciocínio privado do modelo.
- Confirmação automática de deploy depende de endpoint de versão correto; sem ele, é manual.
- O container EasyPanel é a fronteira de isolamento, pois sandbox Linux aninhado pode não criar namespaces.
- Testes unitários não substituem validação real das integrações externas.

## Como reproduzir e validar

Use o menor cenário relacionado: crie aplicação/chamado em ambiente de teste, observe transições e eventos, confirme o estado no PostgreSQL e execute a suíte automatizada. Não use credenciais ou banco de produção em testes. Para regressões de fila, use ao menos duas aplicações e dois chamados na mesma aplicação.

## Contextos detalhados

- [`frontend.md`](context/frontend.md)
- [`backend.md`](context/backend.md)
- [`database.md`](context/database.md)
- [`authentication.md`](context/authentication.md)
- [`deployment.md`](context/deployment.md)
- [`testing.md`](context/testing.md)
- [`business-rules.md`](context/business-rules.md)
