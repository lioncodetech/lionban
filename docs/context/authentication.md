# Autenticação e segurança HTTP

## Responsabilidade

Proteger todo o painel e APIs com uma conta administrativa única, limitar abuso no login e validar origem/corpo das mutações.

## Arquivos principais

- `src/lib/auth.ts`: configuração, bcrypt e JWT.
- `src/lib/login-rate-limit.ts`: limite de tentativas.
- `src/app/api/auth/login/route.ts` e `logout/route.ts`.
- `src/proxy.ts`: proteção global, origem e tamanho do corpo.
- `next.config.ts`: cabeçalhos de segurança e CSP.
- `docs/SECURITY.md`: modelo operacional.

## Fluxo

Login compara usuário sem diferenciar maiúsculas/minúsculas e senha com hash bcrypt. Sessão JWT HS256 possui issuer/audience fixos e expira em 12 horas. Cookie é protegido. O proxy falha fechado quando credenciais não estão configuradas, bloqueia API sem sessão e rejeita origem incompatível em mutações.

## Regras protegidas

- Exigir `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` e `AUTH_SECRET` com ao menos 32 caracteres.
- Nunca armazenar senha em texto puro nem registrar senha/hash/segredo.
- Preservar `HttpOnly`, `Secure`, `SameSite=Strict`, issuer e audience.
- Preservar rate limit, limite de corpo, CSP e proteção de origem.
- Mensagens públicas não devem revelar qual credencial falhou.
- Web é o único serviço exposto; worker e PostgreSQL ficam privados.

## Como testar

Execute `src/lib/auth.test.ts` e `login-rate-limit.test.ts`; valide configuração ausente, hash inválido, sucesso, senha incorreta, expiração/bloqueio e cookie. Para proxy reverso, conferir `x-forwarded-host` e `x-forwarded-proto` sem relaxar origens arbitrárias.

## Limitações

O rate limit vive em memória e reinicia com o processo; múltiplas réplicas não compartilham contagem. Sistema é deliberadamente de usuário único.
