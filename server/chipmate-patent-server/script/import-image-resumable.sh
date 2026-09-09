#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 5 ]]; then
  echo "用法：import-image-resumable.sh <镜像标签> <仓库> <manifest摘要> <缓存目录> <工作目录>" >&2
  exit 2
fi

IMAGE="$1"
REPOSITORY="$2"
MANIFEST_DIGEST="$3"
CACHE="$4"
WORK="$5"
REGISTRY="public.ecr.aws"
MANIFEST_HASH="${MANIFEST_DIGEST#sha256:}"
MANIFEST="$CACHE/manifests/$MANIFEST_HASH.json"

fail() {
  echo "镜像导入失败：$*" >&2
  exit 1
}

token() {
  curl --fail --silent --show-error \
    --connect-timeout 15 --max-time 60 \
    --retry 8 --retry-delay 2 --retry-all-errors \
    "https://$REGISTRY/token/?scope=repository%3A${REPOSITORY//\//%2F}%3Apull&service=$REGISTRY" \
    | node -e 'let data=""; process.stdin.on("data", chunk => data += chunk); process.stdin.on("end", () => process.stdout.write(JSON.parse(data).token))'
}

valid_sha256() {
  local file="$1"
  local expected="$2"
  [[ -f "$file" ]] && [[ "$(shasum -a 256 "$file" | awk '{ print $1 }')" == "$expected" ]]
}

mkdir -p "$CACHE/manifests" "$CACHE/blobs/sha256"

if ! valid_sha256 "$MANIFEST" "$MANIFEST_HASH"; then
  for attempt in $(seq 1 20); do
    AUTH="$(token)" || true
    if [[ -n "${AUTH:-}" ]] && curl --fail --location --silent --show-error \
      --connect-timeout 15 --max-time 90 \
      --retry 5 --retry-delay 2 --retry-all-errors \
      -H "Authorization: Bearer $AUTH" \
      -H 'Accept: application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json' \
      --output "$MANIFEST.tmp" \
      "https://$REGISTRY/v2/$REPOSITORY/manifests/$MANIFEST_DIGEST" \
      && valid_sha256 "$MANIFEST.tmp" "$MANIFEST_HASH"; then
      mv "$MANIFEST.tmp" "$MANIFEST"
      break
    fi
    echo "manifest 下载第 $attempt 次失败，准备重试……" >&2
    sleep "$((attempt * 2))"
  done
fi
valid_sha256 "$MANIFEST" "$MANIFEST_HASH" || fail "$IMAGE manifest 摘要校验失败"

METADATA="$WORK/metadata.tsv"
node -e '
  const fs = require("fs")
  const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
  console.log(["config", manifest.config.digest, manifest.config.size].join("\t"))
  for (const layer of manifest.layers) console.log(["layer", layer.digest, layer.size].join("\t"))
' "$MANIFEST" > "$METADATA"

while IFS=$'\t' read -r kind digest size; do
  hash="${digest#sha256:}"
  blob="$CACHE/blobs/sha256/$hash"
  if valid_sha256 "$blob" "$hash" && [[ "$(wc -c < "$blob" | tr -d '[:space:]')" == "$size" ]]; then
    continue
  fi

  part="$blob.part"
  if [[ -f "$part" ]] && [[ "$(wc -c < "$part" | tr -d '[:space:]')" -ge "$size" ]]; then
    unlink "$part"
  fi

  for attempt in $(seq 1 40); do
    AUTH="$(token)" || true
    if [[ -n "${AUTH:-}" ]]; then
      CURL_ENV=()
      if (( attempt % 2 == 1 )); then
        CURL_ENV=(env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy)
      fi
      "${CURL_ENV[@]}" curl --fail --location --silent --show-error \
        --connect-timeout 15 --max-time 900 --speed-time 30 --speed-limit 65536 \
        --retry 5 --retry-delay 2 --retry-all-errors \
        --continue-at - --output "$part" \
        -H "Authorization: Bearer $AUTH" \
        "https://$REGISTRY/v2/$REPOSITORY/blobs/$digest" || true
    fi

    if valid_sha256 "$part" "$hash" && [[ "$(wc -c < "$part" | tr -d '[:space:]')" == "$size" ]]; then
      mv "$part" "$blob"
      break
    fi
    if [[ -f "$part" ]] && [[ "$(wc -c < "$part" | tr -d '[:space:]')" -ge "$size" ]]; then
      unlink "$part"
    fi
    echo "$IMAGE 的 $kind 层第 $attempt 次下载未完成，准备断点续传……" >&2
    sleep "$((attempt * 2))"
  done

  valid_sha256 "$blob" "$hash" || fail "$IMAGE 的 $kind 层摘要校验失败：$digest"
done < "$METADATA"

LEGACY="$WORK/legacy-$(printf '%s' "$IMAGE" | tr '/:' '__')"
mkdir -p "$LEGACY"
CONFIG_NAME=""
LAYERS=()

while IFS=$'\t' read -r kind digest size; do
  hash="${digest#sha256:}"
  blob="$CACHE/blobs/sha256/$hash"
  if [[ "$kind" == "config" ]]; then
    CONFIG_NAME="$hash.json"
    cp "$blob" "$LEGACY/$CONFIG_NAME"
    continue
  fi
  gzip -t "$blob"
  mkdir -p "$LEGACY/$hash"
  gzip -dc "$blob" > "$LEGACY/$hash/layer.tar"
  LAYERS+=("$hash/layer.tar")
done < "$METADATA"

[[ -n "$CONFIG_NAME" ]] || fail "$IMAGE 缺少 config"
node -e '
  const [config, ...layers] = process.argv.slice(1)
  process.stdout.write(JSON.stringify([{ Config: config, RepoTags: null, Layers: layers }]))
' "$CONFIG_NAME" "${LAYERS[@]}" > "$LEGACY/manifest.json"

ARCHIVE="$WORK/$(printf '%s' "$IMAGE" | tr '/:' '__').tar"
COPYFILE_DISABLE=1 tar --no-xattrs -cf "$ARCHIVE" -C "$LEGACY" .
OUTPUT="$(docker load -i "$ARCHIVE")"
echo "$OUTPUT"
IDENTIFIER="$(printf '%s\n' "$OUTPUT" | sed -n 's/^Loaded image ID: //p' | tail -1)"
[[ -n "$IDENTIFIER" ]] || fail "无法确定 $IMAGE 导入后的镜像 ID"
docker tag "$IDENTIFIER" "$IMAGE"
