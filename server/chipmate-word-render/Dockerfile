FROM node:24-bookworm-slim AS build

WORKDIR /src
COPY package.json package-lock.json tsconfig.base.json tsconfig.e2e.json /src/
COPY apps/api/package.json /src/apps/api/package.json
COPY apps/web/package.json /src/apps/web/package.json
COPY packages/contracts/package.json /src/packages/contracts/package.json
COPY packages/market-db/package.json /src/packages/market-db/package.json
COPY packages/skill-spec/package.json /src/packages/skill-spec/package.json
RUN npm ci
COPY apps /src/apps
COPY packages /src/packages
COPY scripts /src/scripts
RUN npm run generate:check -- --server-only && npm run --workspace @chipmate/market-web build

FROM node:24-bookworm-slim AS runtime

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    fontconfig \
    fonts-dejavu \
    fonts-liberation \
    fonts-noto-cjk \
    chromium \
    libreoffice-writer \
    poppler-utils \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json /app/
COPY apps/api/package.json /app/apps/api/package.json
COPY apps/web/package.json /app/apps/web/package.json
COPY packages/contracts/package.json /app/packages/contracts/package.json
COPY packages/market-db/package.json /app/packages/market-db/package.json
COPY packages/skill-spec/package.json /app/packages/skill-spec/package.json
RUN npm ci --omit=dev
COPY server.js /app/server.js
COPY apps/api/src /app/apps/api/src
COPY packages/contracts/src /app/packages/contracts/src
COPY packages/market-db/src /app/packages/market-db/src
COPY packages/skill-spec/src /app/packages/skill-spec/src
COPY --from=build /src/apps/web/dist /app/apps/web/dist

ENV PORT=6001 \
    PACKAGE_ROOT=/packages \
    MARKET_DB_ROOT=/data/skill-market/.market-db \
    MARKET_IMPORT_ROOT=/data/skill-market \
    MARKET_LEGACY_ROOT=/data/skill-market/.legacy-latest \
    SKILL_MARKET_ROOT=/data/skill-market/.legacy-latest \
    MARKET_WEB_ROOT=/app/apps/web/dist \
    MAX_DOCX_BYTES=52428800 \
    MAX_MERMAID_SOURCE_BYTES=524288 \
    RENDER_TIMEOUT_MS=120000

RUN mkdir -p /packages /data/skill-market

EXPOSE 6001

CMD ["node", "--import", "tsx", "/app/apps/api/src/start.ts"]
