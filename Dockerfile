FROM node:24-bookworm-slim AS base
ARG GIT_SHA=unknown
ENV APP_COMMIT_SHA=$GIT_SHA
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["sh","-c","npm run migrate && npm start"]
