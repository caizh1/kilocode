#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(tr -d '[:space:]' < "$ROOT/VERSION")"
IMAGE="chipmate-patent-server:$VERSION"

fail() {
  echo "安装失败：$*" >&2
  exit 1
}

if [[ $# -gt 1 ]]; then
  echo "用法：sudo ./script/install-linux.sh [docker.tar.gz]" >&2
  exit 2
fi

if [[ $# -eq 1 ]]; then
  ARCHIVE="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
else
  shopt -s nullglob
  ARCHIVES=("$ROOT"/images/*.docker.tar.gz)
  shopt -u nullglob
  [[ ${#ARCHIVES[@]} -eq 1 ]] || fail "images/ 中必须恰好有一个 Docker 镜像归档"
  ARCHIVE="${ARCHIVES[0]}"
fi

[[ -f "$ARCHIVE" ]] || fail "镜像归档不存在：$ARCHIVE"
command -v docker >/dev/null 2>&1 || fail "未安装 Docker Engine"
docker info >/dev/null 2>&1 || fail "Docker daemon 不可用"

MACHINE="$(uname -m)"
[[ "$MACHINE" == "x86_64" || "$MACHINE" == "amd64" ]] || fail "目标主机必须是 Linux x86-64，当前为 $MACHINE"
[[ "$(uname -s)" == "Linux" ]] || fail "目标主机必须运行 Linux"

if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif [[ -x "$ROOT/tools/docker-compose" ]]; then
  COMPOSE=("$ROOT/tools/docker-compose")
else
  fail "未找到 Docker Compose 插件或包内 Compose 客户端"
fi

if [[ -f "$ARCHIVE.sha256" ]]; then
  (cd "$(dirname "$ARCHIVE")" && sha256sum -c "$(basename "$ARCHIVE").sha256")
else
  fail "镜像归档缺少 SHA-256 校验文件"
fi
gzip -t "$ARCHIVE"

if [[ -f "$ROOT/MANIFEST.sha256" ]]; then
  (cd "$ROOT" && sha256sum -c MANIFEST.sha256)
else
  fail "部署包缺少 MANIFEST.sha256"
fi

if [[ ! -f "$ROOT/.env" ]]; then
  fail "缺少 $ROOT/.env，请先从 .env.example 复制并设置随机密码、公司网段和模型端点"
fi

ENV_DATA_ROOT="$(awk -F= '$1 == "PATENT_DATA_ROOT_HOST" { sub(/^[^=]*=/, ""); print; exit }' "$ROOT/.env")"
ENV_ENABLE_HTTPS="$(awk -F= '$1 == "PATENT_ENABLE_HTTPS" { sub(/^[^=]*=/, ""); print; exit }' "$ROOT/.env")"
DATA_ROOT="${PATENT_DATA_ROOT_HOST:-${ENV_DATA_ROOT:-/srv/chipmate-patent}}"
ENABLE_HTTPS="${PATENT_ENABLE_HTTPS:-${ENV_ENABLE_HTTPS:-0}}"

[[ "$DATA_ROOT" == /* ]] || fail "PATENT_DATA_ROOT_HOST 必须是绝对路径"
if [[ "$(sysctl -n vm.max_map_count)" -lt 262144 ]]; then
  fail "vm.max_map_count 低于 262144，OpenSearch 无法可靠启动"
fi

install -d -m 0750 \
  "$DATA_ROOT/drop" \
  "$DATA_ROOT/raw" \
  "$DATA_ROOT/processed" \
  "$DATA_ROOT/quarantine" \
  "$DATA_ROOT/reports" \
  "$DATA_ROOT/work" \
  "$DATA_ROOT/postgres" \
  "$DATA_ROOT/opensearch"

gzip -dc "$ARCHIVE" | docker load

for candidate in \
  "$IMAGE" \
  "postgres:17.11-bookworm" \
  "opensearchproject/opensearch:3.8.0" \
  "nginx:1.29.5-alpine"; do
  PLATFORM="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$candidate")"
  [[ "$PLATFORM" == "linux/amd64" ]] || fail "${candidate} 的平台为 ${PLATFORM}，不是 linux/amd64"
done

POSTGRES_UID="$(docker run --rm --entrypoint id postgres:17.11-bookworm -u postgres)"
POSTGRES_GID="$(docker run --rm --entrypoint id postgres:17.11-bookworm -g postgres)"
OPENSEARCH_UID="$(docker run --rm --entrypoint id opensearchproject/opensearch:3.8.0 -u)"
OPENSEARCH_GID="$(docker run --rm --entrypoint id opensearchproject/opensearch:3.8.0 -g)"
PATENT_UID="$(docker run --rm --entrypoint id "$IMAGE" -u node)"
PATENT_GID="$(docker run --rm --entrypoint id "$IMAGE" -g node)"
chown "$POSTGRES_UID:$POSTGRES_GID" "$DATA_ROOT/postgres"
chown "$OPENSEARCH_UID:$OPENSEARCH_GID" "$DATA_ROOT/opensearch"
chown "$PATENT_UID:$PATENT_GID" \
  "$DATA_ROOT/drop" "$DATA_ROOT/raw" "$DATA_ROOT/processed" \
  "$DATA_ROOT/quarantine" "$DATA_ROOT/reports" "$DATA_ROOT/work"

if [[ -n "${PATENT_MIN_FREE_BYTES:-}" ]]; then
  FREE_BYTES="$(df -PB1 "$DATA_ROOT" | awk 'NR == 2 { print $4 }')"
  if [[ "$FREE_BYTES" -lt "$PATENT_MIN_FREE_BYTES" ]]; then
    fail "数据盘可用空间 $FREE_BYTES 字节，低于要求 $PATENT_MIN_FREE_BYTES 字节"
  fi
fi

COMPOSE+=(--env-file "$ROOT/.env" -f "$ROOT/compose.yaml")
if [[ "$ENABLE_HTTPS" == "1" ]]; then
  COMPOSE+=(-f "$ROOT/compose.https.yaml")
fi
"${COMPOSE[@]}" config --quiet
"${COMPOSE[@]}" up -d

for _ in $(seq 1 60); do
  if HEALTH="$("${COMPOSE[@]}" exec -T patent-api node -e 'fetch("http://127.0.0.1:6020/health").then(async response => { console.log(await response.text()); process.exit(response.ok ? 0 : 1) })' 2>/dev/null)"; then
    echo "$HEALTH"
    echo
    echo "Patent Server 已启动；尚未导入语料时 corpus/status 会显示 EMPTY。"
    exit 0
  fi
  sleep 2
done

"${COMPOSE[@]}" logs --tail 100 >&2
fail "Patent Server 健康检查未通过"
