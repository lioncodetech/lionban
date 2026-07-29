FROM node:24-bookworm-slim AS base
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile=false
COPY . .
RUN pnpm build
EXPOSE 3000
CMD ["pnpm","start"]

