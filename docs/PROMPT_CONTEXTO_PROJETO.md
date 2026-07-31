# Prompt para documentar o contexto de um projeto

Use o texto abaixo em cada repositório antes de cadastrá-lo no LionWorkForce:

```text
Analise este repositório e crie ou atualize o arquivo docs/PROJECT_CONTEXT.md.

O objetivo é produzir um contexto operacional permanente para uma IA corrigir bugs com segurança em chamados futuros. Antes de escrever, leia integralmente as instruções existentes do repositório, incluindo AGENTS.md, README, CONTRIBUTING, CHANGELOG, package.json, arquivos de configuração, workflows, esquema do banco e documentação em docs/.

Documente somente informações confirmadas pelo código, configurações ou documentação existente. Quando algo não puder ser confirmado, escreva “Não confirmado” e indique o que precisa ser verificado. Não invente comandos, regras de negócio ou credenciais. Não inclua senhas, tokens, chaves, URLs secretas nem valores reais de variáveis sensíveis.

O documento deve conter estas seções:

1. Arquitetura e pastas principais
   - Tecnologias, serviços, camadas, pontos de entrada e responsabilidade das pastas importantes.
   - Fluxo de dados e integrações externas relevantes.

2. Regras de negócio importantes
   - Regras, invariantes, permissões, estados e comportamentos que uma correção não pode violar.

3. Comandos corretos de instalação e validação
   - Instalação, testes unitários, integração/E2E, lint, typecheck e build.
   - Pré-requisitos e diretório exato de execução de cada comando.

4. Componentes que não devem ser alterados sem autorização
   - Arquivos gerados, migrações aplicadas, contratos públicos, autenticação, faturamento, infraestrutura e outras áreas sensíveis.
   - Explique o motivo e o procedimento seguro quando uma alteração for inevitável.

5. Padrões visuais e de experiência
   - Design system, componentes reutilizáveis, cores, tipografia, responsividade, acessibilidade e padrões de interação.

6. Limitações conhecidas
   - Dívidas técnicas, testes ausentes, incompatibilidades, dependências frágeis e comportamentos deliberadamente não suportados.

7. Ambiente de execução
   - Versões de runtime, gerenciador de pacotes, banco, filas, serviços externos, Docker/EasyPanel e variáveis necessárias.
   - Liste apenas os nomes das variáveis sensíveis, nunca os valores.

8. Como reproduzir e validar funcionalidades
   - Como iniciar o projeto, preparar dados seguros, reproduzir fluxos principais e comprovar visual e tecnicamente uma correção.
   - Diferencie claramente desenvolvimento, teste e produção.

9. Checklist para correções automatizadas
   - Leitura obrigatória antes de alterar código.
   - Teste de regressão esperado.
   - Validações mínimas antes de commit, push, merge ou deploy.

Mantenha o documento objetivo, específico para este repositório e útil para execução prática. Use caminhos e comandos entre crases. Ao terminar, apresente:
- arquivos consultados;
- pontos que não puderam ser confirmados;
- resumo do documento criado;
- nenhum outro arquivo de implementação deve ser modificado.
```

Depois de revisar o documento gerado, copie seu conteúdo para **Aplicações → Configurar → Contexto permanente do projeto**.
