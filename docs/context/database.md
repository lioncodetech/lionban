# Banco de dados

## Responsabilidade

Persistir aplicações autorizadas, tickets, execuções, eventos, aprovações, artefatos, controle do worker, locks de deploy, limpezas e retenção.

## Arquivos principais

- `db/schema.sql`: instalação inicial usando nomes históricos `lb_*` antes das migrações.
- `db/migrate.ts`: histórico incremental até o schema `lionworkforce` e tabelas `lwf_*`.
- `src/lib/db.ts`: `search_path`, pool e helper transacional.

## Estruturas

`lwf_applications`, `lwf_tickets`, `lwf_executions`, `lwf_events`, `lwf_approvals`, `lwf_artifacts`, `lwf_repository_connections`, `lwf_worker_heartbeats`, `lwf_worker_control`, `lwf_application_deploy_locks`, `lwf_cleanup_requests`, `lwf_settings` e `lwf_migrations`.

## Regras protegidas

- Todas as tabelas finais usam prefixo `lwf_` no schema `lionworkforce`.
- Migrações usam versão única, advisory lock, transação e devem ser idempotentes.
- Nunca editar uma migração já aplicada para reinterpretar dados; adicionar uma nova versão.
- Preservar compatibilidade durante transições de web/worker.
- Uma execução ativa por aplicação é garantida também por índice parcial.
- Artefatos e imagens possuem `ON DELETE CASCADE` com ticket; exclusão manual e retenção devem apagar o card, não deixar anexos órfãos.
- SQL dinâmico deve limitar identificadores a listas internas; valores usam parâmetros.

## Como testar

Em PostgreSQL descartável: executar `npm run migrate`, conferir schema/tabelas/índices, executar novamente e confirmar ausência de erro. Testar cascata criando ticket e imagem fictícios e removendo o ticket. Validar migração a partir de uma cópia sem dados sensíveis de versão anterior.

## Limitações

Não há ferramenta ORM nem rollback automático de versão. `db/schema.sql` contém nomes iniciais históricos por compatibilidade com a sequência de migrações; não os renomeie isoladamente.
