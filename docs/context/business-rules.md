# Regras de negócio

## Aplicações e filas

- Aplicação representa um repositório GitHub autorizado, identificado também pelo ID remoto.
- Ticket mantém referência obrigatória à aplicação; o repositório não muda após criação.
- Há no máximo uma execução ativa por aplicação. Aplicações diferentes possuem filas independentes.
- Menor `queue_priority` (1 a 10) executa primeiro; empate usa o ticket mais antigo.
- Agendamento impede claim antes do horário sem bloquear outros itens elegíveis.
- Pausa manual permite a execução atual terminar e impede novos claims globalmente.
- Deploy em curso bloqueia apenas a aplicação correspondente.

## Ciclo do chamado

Estados: aberto, analisando, corrigindo, testando, aguardando aprovação, concluído, falhou e cancelado. Edição é permitida somente em aberto com execução ainda enfileirada. Duplicação cria outro chamado revisável e copia imagens, não logs.

## Criticidade e aprovação

Baixa e média podem continuar automaticamente. Alta e crítica exigem aprovação antes da publicação. Ausência de teste confiável também pode exigir aprovação. Rejeição encerra como falha; aprovação retoma a partir do patch preservado.

## Automação

- PR automático requer commit e push.
- Deploy automático requer commit, push e integração direta, sem PR pendente.
- Tag requer SemVer, commit/push e integração direta.
- `deploy` é um tipo especial: usa commit atual da branch principal, não inicia Codex, não clona e não aceita imagens.
- Mensagem de commit usa o título do chamado; branch segue `lionworkforce/chamado-ID`.

## Anexos e retenção

Até cinco PNG/JPEG/WebP/GIF, 5 MB cada e 25 MB no total, com assinatura binária validada. Imagens vivem em `lwf_artifacts`; a exclusão do ticket as remove em cascata. Encerrados são arquivados e depois excluídos nos prazos configuráveis.

## Contexto e documentação

`docs/PROJECT_CONTEXT.md` do repositório executado é a fonte oficial, limitado a 30.000 caracteres no sincronizador atual. Atualização do contexto e histórico técnico só deve refletir comportamento realmente integrado. Logs falhados não viram conhecimento permanente.

## Como validar

Crie cenários controlados para cada regra, observe tickets, execuções, eventos e artefatos no banco e confirme que operações externas ocorreram somente quando marcadas. Casos essenciais: duas aplicações simultâneas, dois tickets da mesma aplicação, empate de prioridade, agendamento, aprovação, cancelamento, deploy e retenção.
