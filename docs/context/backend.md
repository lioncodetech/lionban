# Backend e worker

## Responsabilidade

Route Handlers autenticados persistem e consultam estado; o worker executa tarefas demoradas, Git/Codex, validações, publicação, reconciliação, limpeza e retenção.

## Arquivos principais

- `src/app/api/`: contratos HTTP.
- `src/lib/db.ts`: pool e transações.
- `src/lib/github.ts`: GitHub API.
- `worker/index.ts`: orquestração completa.
- `worker/command-parts.ts`: parsing seguro dos comandos configurados.
- `worker/project-context.ts`: normalização do contexto permanente.

## Fluxo relevante

Criar ticket e execução ocorre na mesma transação. `claim()` seleciona um item elegível com lock transacional, respeitando pausa global manual, agendamento, prioridade e exclusão mútua por aplicação. O worker registra eventos, clona em diretório temporário, chama Codex com ambiente sanitizado, executa comandos controlados e publica somente após validação/política. Recuperação e reconciliação tratam reinícios.

## Regras protegidas

- Operações de vários registros devem ser transacionais.
- Trabalho lento ou externo pertence ao worker, nunca à requisição web.
- Uma aplicação não pode executar dois chamados simultâneos.
- Deploy cria lock por aplicação; outras aplicações continuam.
- Git usa array de argumentos e `shell:false`; não interpolar entrada em shell.
- O clone deve corresponder ao ID GitHub gravado no chamado e ser removido em `finally`.
- Codex nunca publica: Git commit/push/merge/tag/deploy ficam no controller.

## Dependências

PostgreSQL, GitHub API/token, Git CLI, Codex CLI, RTK e endpoints HTTPS de deploy/verificação.

## Como testar

Use testes unitários para parsers, contexto e adaptadores. Para filas, prepare registros de duas aplicações e verifique ordem, exclusão mútua e lock de deploy. Para integrações, use repositório e banco descartáveis; nunca force push ou deploy em produção durante teste.

## Erros e limitações

Falhas externas devem virar eventos e estados finais claros. Timeout, cancelamento e saída capturada têm limites. Reinício durante operação externa depende da reconciliação persistida.
