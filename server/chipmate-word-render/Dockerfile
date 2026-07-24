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

RUN apt-get -o Acquire::Retries=5 update \
  && apt-get -o Acquire::Retries=5 install -y --no-install-recommends ca-certificates \
  && sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
  && apt-get -o Acquire::Retries=5 update \
  && apt-get -o Acquire::Retries=5 install -y --no-install-recommends \
    fontconfig \
    fonts-dejavu \
    fonts-liberation \
    fonts-noto-cjk \
    curl \
    chromium \
    graphviz \
    openjdk-17-jre-headless \
    libreoffice-writer \
    python3 \
    python3-uno \
    poppler-utils \
  && rm -rf /var/lib/apt/lists/*

COPY fontconfig/99-chipmate-cjk.conf /etc/fonts/conf.d/99-chipmate-cjk.conf
RUN fc-cache -f \
  && test "$(fc-match --format '%{family[0]}' 'Microsoft YaHei')" = "Noto Sans CJK SC"

WORKDIR /app

ARG PLANTUML_VERSION=1.2026.6
ARG PLANTUML_SHA256=695bcfc423172fff8c9eee6eb88eed4c256458784cbb30a07efe59994d069ee0
RUN curl -fL --retry 5 --retry-all-errors --retry-delay 2 \
      "https://github.com/plantuml/plantuml/releases/download/v${PLANTUML_VERSION}/plantuml-asl-${PLANTUML_VERSION}.jar" \
      -o /app/plantuml-asl.jar \
  && echo "${PLANTUML_SHA256}  /app/plantuml-asl.jar" | sha256sum -c - \
  && mkdir -p /app/licenses \
  && java -jar /app/plantuml-asl.jar -license > /app/licenses/plantuml-ASL-LICENSE.txt \
  && grep -qi "Apache" /app/licenses/plantuml-ASL-LICENSE.txt
COPY package.json package-lock.json tsconfig.base.json /app/
COPY apps/api/package.json /app/apps/api/package.json
COPY apps/web/package.json /app/apps/web/package.json
COPY packages/contracts/package.json /app/packages/contracts/package.json
COPY packages/market-db/package.json /app/packages/market-db/package.json
COPY packages/skill-spec/package.json /app/packages/skill-spec/package.json
RUN npm ci --omit=dev
COPY server.js /app/server.js
COPY scripts/refresh-word-fields.py /app/scripts/refresh-word-fields.py
COPY scripts/merge-managed-seeds.mjs /app/scripts/merge-managed-seeds.mjs
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
    EXTENSION_MARKET_ENABLED=0 \
    EXTENSION_MARKET_ROOT=/data/skill-market/extensions \
    EXTENSION_DROP_SCAN_MS=5000 \
    MARKET_WEB_ROOT=/app/apps/web/dist \
    MAX_DOCX_BYTES=52428800 \
    MAX_MERMAID_SOURCE_BYTES=524288 \
    MAX_PLANTUML_SOURCE_BYTES=131072 \
    MAX_PLANTUML_PNG_BYTES=16777216 \
    MAX_PLANTUML_DIMENSION=4096 \
    MAX_PLANTUML_CONCURRENCY=2 \
    MAX_PLANTUML_QUEUE=16 \
    PLANTUML_JAR=/app/plantuml-asl.jar \
    PLANTUML_VERSION=1.2026.6 \
    PLANTUML_SECURITY_PROFILE=SANDBOX \
    PLANTUML_LIMIT_SIZE=4096 \
    PYTHON_UNO_BIN=/usr/bin/python3 \
    RENDER_TIMEOUT_MS=120000 \
    MAX_WORD_RENDER_PAGES=500 \
    MAX_RENDER_PDF_BYTES=134217728 \
    MAX_RENDER_PAGE_TOTAL_BYTES=268435456 \
    MAX_RENDER_RESPONSE_BYTES=402653184

RUN mkdir -p /packages /data/skill-market/extensions/drop /data/skill-market/extensions/artifacts /data/skill-market/extensions/.tmp

EXPOSE 6001

CMD ["node", "--import", "tsx", "/app/apps/api/src/start.ts"]
