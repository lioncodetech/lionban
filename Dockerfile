FROM node:24-bookworm-slim AS base
ARG GIT_SHA=unknown
ARG RTK_VERSION=v0.42.4
ENV APP_COMMIT_SHA=$GIT_SHA
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends git curl ca-certificates \
    && curl -fsSL "https://raw.githubusercontent.com/rtk-ai/rtk/${RTK_VERSION}/install.sh" -o /tmp/install-rtk.sh \
    && RTK_INSTALL_DIR=/usr/local/bin RTK_VERSION="${RTK_VERSION}" sh /tmp/install-rtk.sh \
    && rtk --version \
    && rtk gain \
    && rm -f /tmp/install-rtk.sh \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["sh","-c","npm run migrate && npm start"]
