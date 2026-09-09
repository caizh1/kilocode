FROM node:24.11.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY script/copy-build-assets.mjs ./script/copy-build-assets.mjs
COPY src ./src
RUN npm run build

FROM node:24.11.0-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates gzip libarchive-tools \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PATENT_PORT=6020 PATENT_DATA_ROOT=/srv/chipmate-patent
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
USER node
EXPOSE 6020
CMD ["node", "dist/src/start.js"]
