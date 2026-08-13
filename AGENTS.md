<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Regras do LionWorkForce

Leia `docs/PROJECT_CONTEXT.md` e somente os documentos de `docs/context/` relacionados ao chamado antes de alterar código.

## Comandos confirmados

- Instalação: `npm ci`
- Desenvolvimento: `npm run dev`
- Testes: `npm test`
- Lint: `npm run lint`
- Build: `npm run build`
- Migrações: `npm run migrate`
- Worker local: `npm run worker`

## Fluxo obrigatório

1. Reproduza o problema e localize a causa antes da correção.
2. Faça a menor mudança segura possível, sem refatorações não solicitadas.
3. Crie ou ajuste um teste que proteja o comportamento corrigido quando isso for tecnicamente viável.
4. Execute testes relevantes, lint e build conforme o impacto.
5. Atualize `docs/PROJECT_CONTEXT.md` ou `docs/context/` somente se arquitetura, regras, ambiente, comandos, limitações ou validação mudarem.
6. No resumo final, informe arquivos alterados, verificações executadas e limitações restantes.

## Proteções

- Não altere `db/schema.sql`, `db/migrate.ts`, autenticação, publicação Git, validação de URLs externas, isolamento do Codex, retenção ou exclusão em cascata sem justificar o impacto e criar validação específica.
- Preserve os prefixos `lwf_*`, o schema `lionworkforce` e migrações incrementais e idempotentes. Nunca apague ou recrie dados existentes para aplicar uma migração.
- Preserve uma execução ativa por aplicação, a ordenação por `queue_priority` e data de criação, e o bloqueio de deploy somente para a aplicação correspondente.
- O Codex não pode receber `GITHUB_TOKEN`, `DATABASE_URL` do LionWorkForce, webhooks ou variáveis exclusivas de teste. Estas últimas pertencem apenas aos comandos de validação controlados pelo worker.
- Não remova validações Zod, limites de anexos, verificação de assinatura binária, proteção de origem, rate limit, CSP ou verificação de destino externo sem substituição equivalente.
- Não modifique diretamente a branch principal dos projetos executados nem faça force push.
- Não inclua tokens, senhas, hashes, URLs secretas ou dados pessoais em código, testes, logs ou documentação.

## Limites de atuação

- Não acesse arquivos fora deste repositório.
- Não faça commit, push, merge, tag, release ou deploy sem solicitação explícita do usuário.
- Não mude dependências, configurações de produção ou banco fora do escopo do chamado.
- Não invente comandos, variáveis ou regras. Marque informações não comprovadas como **A confirmar**.
