FROM node:24-bookworm-slim AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["sh","-c","npm run migrate && npm start"]
