#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/out"
CACHE="$OUT/cache"
VERSION="$(node -p 'require(process.argv[1]).version' "$ROOT/package.json")"
PLATFORM="linux-amd64"
IMAGE="chipmate-patent-server:$VERSION"
POSTGRES_IMAGE="postgres:17.11-bookworm"
OPENSEARCH_IMAGE="opensearchproject/opensearch:3.8.0"
NGINX_IMAGE="nginx:1.29.5-alpine"
NODE_IMAGE="node:24.11.0-bookworm-slim"
POSTGRES_DIGEST="sha256:7bade6d532592ca8ce7ee32def7399dad2607c4ea5583839fc4352a095a11ea6"
OPENSEARCH_DIGEST="sha256:39a8f8c63028e8b5d6b70539af1d0339b15a6729002dd5b3f4a65f520376fd30"
NGINX_DIGEST="sha256:123827f4a105eee4054d59a0080f7860b2a7e29fe138d132af7850843b54c833"
NODE_DIGEST="sha256:87ccbf5cc428351bc8e242a9e43ceb998ec546c33a08fe77a839227c9142ab7e"
COMPOSE_VERSION="v5.4.0"
COMPOSE_SHA256="837fd1d35bf6a494f41b5b5988269a7be79de337cf1a1a6ff0e45ab51bb4e9be"
COMPOSE_URL="https://github.com/docker/compose/releases/download/$COMPOSE_VERSION/docker-compose-linux-x86_64"
IMAGE_NAME="chipmate-patent-server-$VERSION-$PLATFORM.docker.tar.gz"
BUNDLE_NAME="chipmate-patent-server-offline-$VERSION-$PLATFORM"
IMAGE_ARCHIVE="$OUT/$IMAGE_NAME"
BUNDLE_ARCHIVE="$OUT/$BUNDLE_NAME.tar.gz"
BUILD_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/chipmate-patent-build.XXXXXX")"

cleanup() {
  rm -rf "$BUILD_ROOT"
}
trap cleanup EXIT

fail() {
  echo "构建失败：$*" >&2
  exit 1
}

verify_image() {
  local image="$1"
  local platform
  platform="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")"
  [[ "$platform" == "linux/amd64" ]] || fail "${image} 的平台是 ${platform}，不是 linux/amd64"
}

image_platform() {
  docker image inspect --format '{{.Os}}/{{.Architecture}}' "$1" 2>/dev/null || true
}

retry() {
  local attempt
  for attempt in 1 2 3 4 5 6 7 8; do
    if "$@"; then
      return 0
    fi
    echo "网络操作第 $attempt 次失败，准备重试……" >&2
    sleep "$((attempt * 2))"
  done
  fail "多次重试后仍无法完成：$*"
}

import_image() {
  local image="$1"
  local repository="$2"
  local digest="$3"
  local marker="$CACHE/image-provenance/$(printf '%s' "$image" | tr '/:' '__').digest"

  if [[ -f "$marker" ]] \
    && [[ "$(tr -d '[:space:]' < "$marker")" == "$digest" ]] \
    && docker image inspect "$image" >/dev/null 2>&1; then
    if [[ "$(image_platform "$image")" == "linux/amd64" ]]; then
      echo "复用已按官方摘要校验的构建缓存：$image"
      return 0
    fi
    echo "缓存标签无法证明为 linux/amd64，重新导入已校验的官方摘要：$image"
  fi

  echo "按官方 amd64 摘要导入 ${image}（${digest}）……"
  "$ROOT/script/import-image-resumable.sh" \
    "$image" "$repository" "$digest" "$CACHE/registry" "$BUILD_ROOT"
  verify_image "$image"
  printf '%s\n' "$digest" > "$marker.tmp"
  mv "$marker.tmp" "$marker"
}

command -v docker >/dev/null 2>&1 || fail "未找到 Docker CLI"
command -v node >/dev/null 2>&1 || fail "未找到 Node.js"
command -v curl >/dev/null 2>&1 || fail "未找到 curl"
docker info >/dev/null 2>&1 || fail "Docker daemon 不可用"

# 本包只使用公开固定镜像。隔离构建期 Docker 配置，避免构建机残留的
# Desktop credential helper 阻断匿名拉取，同时不读取或改写现有登录凭据。
DOCKER_ENDPOINT="$(docker context inspect --format '{{.Endpoints.docker.Host}}')"
mkdir -p "$BUILD_ROOT/docker-config"
printf '{"auths":{}}\n' > "$BUILD_ROOT/docker-config/config.json"
export DOCKER_HOST="$DOCKER_ENDPOINT"
export DOCKER_CONFIG="$BUILD_ROOT/docker-config"

SERVER_OS="$(docker info --format '{{.OSType}}')"
SERVER_ARCH="$(docker info --format '{{.Architecture}}')"
[[ "$SERVER_OS" == "linux" ]] || fail "Docker 构建环境必须运行 Linux 容器，当前为 ${SERVER_OS}/${SERVER_ARCH}"
if [[ "$SERVER_ARCH" != "x86_64" && "$SERVER_ARCH" != "amd64" ]]; then
  echo "Docker daemon 为 ${SERVER_OS}/${SERVER_ARCH}，将使用 Docker Desktop 跨架构构建 Linux x86-64 产物。"
fi

mkdir -p "$OUT" "$CACHE/image-provenance"
FREE_KIB="$(df -Pk "$OUT" | awk 'NR == 2 { print $4 }')"
[[ "$FREE_KIB" -ge 8388608 ]] || fail "构建盘可用空间少于 8 GiB"

echo "运行源码质量检查……"
(cd "$ROOT" && npm run check)

echo "拉取并构建固定版本 Linux x86-64 镜像……"
import_image "$POSTGRES_IMAGE" "docker/library/postgres" "$POSTGRES_DIGEST"
import_image "$OPENSEARCH_IMAGE" "opensearchproject/opensearch" "$OPENSEARCH_DIGEST"
import_image "$NGINX_IMAGE" "docker/library/nginx" "$NGINX_DIGEST"
import_image "$NODE_IMAGE" "docker/library/node" "$NODE_DIGEST"
retry docker build --pull=false --no-cache --platform linux/amd64 -t "$IMAGE" "$ROOT"

verify_image "$IMAGE"
verify_image "$POSTGRES_IMAGE"
verify_image "$OPENSEARCH_IMAGE"
verify_image "$NGINX_IMAGE"
docker run --rm --platform linux/amd64 --entrypoint test "$IMAGE" -r /app/dist/src/sql/001-initial.sql || \
  fail "Patent Server 镜像缺少可读的数据库迁移文件"

echo "下载并校验官方 Docker Compose Linux x86-64 客户端……"
COMPOSE_CACHE="$CACHE/docker-compose-linux-x86_64-$COMPOSE_VERSION"
if [[ ! -f "$COMPOSE_CACHE" ]] \
  || [[ "$(shasum -a 256 "$COMPOSE_CACHE" | awk '{ print $1 }')" != "$COMPOSE_SHA256" ]]; then
  curl --fail --location --silent --show-error \
    --connect-timeout 15 --max-time 120 \
    --retry 10 --retry-delay 2 --retry-max-time 600 --retry-all-errors \
    --output "$COMPOSE_CACHE.tmp" "$COMPOSE_URL"
  mv "$COMPOSE_CACHE.tmp" "$COMPOSE_CACHE"
fi
COMPOSE_BINARY="$BUILD_ROOT/docker-compose"
cp "$COMPOSE_CACHE" "$COMPOSE_BINARY"
COMPOSE_ACTUAL_SHA256="$(shasum -a 256 "$COMPOSE_BINARY" | awk '{ print $1 }')"
[[ "$COMPOSE_ACTUAL_SHA256" == "$COMPOSE_SHA256" ]] || \
  fail "Docker Compose SHA-256 不匹配：$COMPOSE_ACTUAL_SHA256"
file "$COMPOSE_BINARY" | grep -Eq 'ELF 64-bit.*x86-64' || \
  fail "Docker Compose 不是 Linux x86-64 ELF"
chmod 0755 "$COMPOSE_BINARY"

echo "生成 Docker 镜像归档……"
rm -f "$IMAGE_ARCHIVE.tmp"
COPYFILE_DISABLE=1 docker save \
  "$IMAGE" \
  "$POSTGRES_IMAGE" \
  "$OPENSEARCH_IMAGE" \
  "$NGINX_IMAGE" \
  | gzip -9 > "$IMAGE_ARCHIVE.tmp"
gzip -t "$IMAGE_ARCHIVE.tmp"
mv "$IMAGE_ARCHIVE.tmp" "$IMAGE_ARCHIVE"
(
  cd "$OUT"
  shasum -a 256 "$IMAGE_NAME" > "$IMAGE_NAME.sha256"
)

echo "组装可直接传入内网的部署包……"
BUNDLE_ROOT="$BUILD_ROOT/$BUNDLE_NAME"
mkdir -p "$BUNDLE_ROOT/images" "$BUNDLE_ROOT/script" "$BUNDLE_ROOT/tools"
cp "$ROOT/compose.yaml" "$ROOT/compose.https.yaml" "$ROOT/.env.example" "$BUNDLE_ROOT/"
cp "$ROOT/README.md" "$ROOT/DEPLOYMENT.md" "$BUNDLE_ROOT/"
cp -R "$ROOT/deploy" "$ROOT/examples" "$BUNDLE_ROOT/"
cp "$ROOT/script/install-linux.sh" "$BUNDLE_ROOT/script/"
cp "$COMPOSE_BINARY" "$BUNDLE_ROOT/tools/docker-compose"
cp "$IMAGE_ARCHIVE" "$IMAGE_ARCHIVE.sha256" "$BUNDLE_ROOT/images/"
printf '%s\n' "$VERSION" > "$BUNDLE_ROOT/VERSION"
printf '%s\n' \
  "产品：ChipMate Patent Server" \
  "版本：$VERSION" \
  "目标平台：Linux x86-64（amd64）" \
  "镜像：$IMAGE" \
  "镜像：$POSTGRES_IMAGE" \
  "镜像：$OPENSEARCH_IMAGE" \
  "镜像：$NGINX_IMAGE" \
  "Docker Compose：${COMPOSE_VERSION}，SHA-256 ${COMPOSE_SHA256}" \
  "注意：本包不包含任何专利语料。" > "$BUNDLE_ROOT/包信息.txt"

(
  cd "$BUNDLE_ROOT"
  find . -type f ! -name MANIFEST.sha256 -print \
    | LC_ALL=C sort \
    | xargs shasum -a 256 > MANIFEST.sha256
  shasum -a 256 -c MANIFEST.sha256
)

rm -f "$BUNDLE_ARCHIVE.tmp"
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$BUNDLE_ARCHIVE.tmp" -C "$BUILD_ROOT" "$BUNDLE_NAME"
gzip -t "$BUNDLE_ARCHIVE.tmp"
tar -tzf "$BUNDLE_ARCHIVE.tmp" | grep -Eq '(^|/)MANIFEST\.sha256$' || fail "部署包缺少 MANIFEST.sha256"
if tar -tvzf "$BUNDLE_ARCHIVE.tmp" | grep -Eq 'com\.apple|LIBARCHIVE\.xattr|SCHILY\.xattr|AppleDouble|__MACOSX|/\._'; then
  fail "部署包包含 Apple 扩展属性或 AppleDouble 元数据"
fi
mv "$BUNDLE_ARCHIVE.tmp" "$BUNDLE_ARCHIVE"
(
  cd "$OUT"
  shasum -a 256 "$(basename "$BUNDLE_ARCHIVE")" > "$(basename "$BUNDLE_ARCHIVE").sha256"
)

echo "离线部署包已生成：$BUNDLE_ARCHIVE"
echo "SHA-256：$(shasum -a 256 "$BUNDLE_ARCHIVE" | awk '{ print $1 }')"
