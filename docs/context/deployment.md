# Deploy e operação

## Responsabilidade

Construir e executar web/worker no EasyPanel, autenticar Codex, publicar alterações autorizadas e confirmar que a versão esperada chegou à produção.

## Arquivos principais

- `Dockerfile`: web, migração e `next start` como usuário `node`.
- `Dockerfile.worker`: Git, RTK e Codex fixados.
- `docker/worker-entrypoint.sh`: corrige volume e reduz privilégio.
- `docker-compose.yml`: ambiente local de referência.
- `src/app/api/version/route.ts`: SHA implantado.
- `worker/index.ts`: webhook, verificação e reconciliação.

## Fluxo

EasyPanel constrói serviços separados do mesmo commit. O worker usa volume `/home/node/.codex`. Após integrar um commit, o controller valida o webhook, cria lock para a aplicação e dispara deploy. Se houver URL de verificação, consulta SHA até sucesso/timeout; sem ela, aguarda confirmação manual. O lock impede somente novos chamados daquela aplicação.

## Regras protegidas

- Somente web recebe domínio público.
- Imagens executam aplicação como usuário `node`; não voltar o processo normal para root.
- Fixar versões do Codex/RTK e verificar checksum do instalador.
- `APP_COMMIT_SHA` deve representar o commit construído.
- Validar webhook e URL de versão contra SSRF e `DEPLOY_ALLOWED_HOSTS`.
- Nunca tratar HTTP aceito pelo webhook como deploy concluído.
- Não disparar deploy sem opção explícita do chamado.

## Variáveis relevantes

`DATABASE_URL`, `GITHUB_TOKEN`, `AUTH_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `CODEX_HOME`, `CODEX_SANDBOX_MODE`, `DEPLOY_ALLOWED_HOSTS`, `APP_COMMIT_SHA` e limites/timeout do worker. Valores e URLs secretas não pertencem à documentação.

## Como testar

Execute build Docker ou `npm run build`. Confirme `/api/version` com `Cache-Control: no-store`, SHA esperado e estado `ready`. Em ambiente descartável, valide webhook, timeout, falha e liberação do lock. Confirme que outro repositório continua processando durante o deploy.

## Limitações

EasyPanel é a fronteira de isolamento do Codex. Sem endpoint de versão confiável, a conclusão é manual. O `docker-compose.yml` conserva nomes antigos (`lionban`) para desenvolvimento e deve ser alinhado somente em mudança operacional planejada (**A confirmar** se ainda é utilizado).
