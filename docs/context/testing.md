# Testes e validação

## Responsabilidade

Proteger contratos de segurança, anexos, autenticação, GitHub, contexto do projeto, parsing de comandos e metadados de repositórios.

## Arquivos

Testes ficam próximos ao código como `*.test.ts` ou `*.test.tsx` em `src/` e `worker/`. Vitest descobre esses arquivos automaticamente.

## Comandos confirmados

- Suíte: `npm test` (`vitest run`)
- Lint: `npm run lint`
- Build e TypeScript/Next: `npm run build`
- Instalação reproduzível: `npm ci`

Não existe script separado de typecheck nem teste end-to-end configurado.

## Estratégia

- Funções puras e validações: testes unitários.
- Route Handlers: mock das fronteiras externas e validação de status/contrato.
- Banco/migração: PostgreSQL descartável, incluindo idempotência e constraints.
- Worker/fila: cenários com duas aplicações, prioridades iguais/diferentes, cancelamento, recuperação e locks.
- UI: testes de componentes mais inspeção real em desktop/móvel.
- GitHub, Codex e EasyPanel: validação controlada em infraestrutura não produtiva.

## Regras protegidas

Um teste não deve usar token real, banco de produção, webhook real ou diretório externo. Não reduzir assertions para fazer a suíte passar. Para bug, o teste deve falhar antes e passar após a correção quando viável.

## Limitações conhecidas

A cobertura atual é concentrada em helpers e algumas rotas; fluxo completo web-worker-GitHub não possui E2E automatizado. Build pode depender de recursos do Next e demora mais que testes unitários.
