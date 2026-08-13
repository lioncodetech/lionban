# Frontend

## Responsabilidade

Interface privada do quadro, aplicações, arquivados, configurações, criação/edição/duplicação e detalhe dos chamados.

## Arquivos principais

- `src/app/page.tsx`: estado e fluxo principal da interface.
- `src/app/globals.css`: layout, quadro, cards, modais e responsividade.
- `src/app/login/page.tsx`: formulário de acesso.
- `src/app/attachment-list.tsx` e `attachment-names.ts`: imagens e nomes sequenciais.
- `src/app/layout.tsx`: estrutura global.

## Fluxo

O painel busca aplicações e tickets; tickets recebem atualizações incrementais a cada 5 segundos e uma recarga completa periódica. O detalhe consulta eventos durante a execução. Formulários enviam opções de automação explícitas à API. Cards abertos podem ser editados; duplicação abre formulário revisável e preserva imagens.

## Regras protegidas

- Manter sete colunas e estados coerentes com os enums da API.
- Repositório não pode ser trocado ao editar um chamado.
- Exibir configuração e imagens mesmo depois que edição é bloqueada.
- Cards devem caber no quadro amplo; no móvel, sidebar e grids se reorganizam.
- Preservar atualização automática sem descartar alterações locais de formulário.
- Não mostrar valores secretos de webhooks ou variáveis de teste já salvos.

## Padrão visual

Tema claro com verde escuro, tipografia serifada em títulos, cards compactos e modais centrais arredondados. Estados usam cores consistentes; ações destrutivas são vermelhas e precisam de confirmação. Reutilize classes existentes em `globals.css`; não introduza outra biblioteca visual sem autorização.

## Dependências

React client components, `next/image` e APIs internas. Não há gerenciador externo de estado.

## Como testar

Execute testes de componentes, lint e build. Inspecione manualmente quadro, formulário e detalhe em largura desktop (>1350 px), tablet e móvel (<620 px). Confirme colagem, seleção, visualização, duplicação e remoção de imagens.

## Limitações

`page.tsx` concentra grande parte da interface e deve ser alterado de forma localizada. Atualização em tempo real é polling incremental, não WebSocket/SSE.
