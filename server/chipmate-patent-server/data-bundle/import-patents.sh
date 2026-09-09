#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PAYLOAD="CN-fulltext-20231003-1-001.zip"
MANIFEST="$PAYLOAD.manifest.json"
BATCH="CNIPA-CN-FULLTEXT-20231003-1-001"
EXPECTED_SHA256="bcb181ab5e7f2ad540e9340551c5fa2f9b143c5cd1919ba7c22935c1e161f572"
SERVER_DIR="${1:-${CHIPMATE_PATENT_SERVER_DIR:-}}"

fail() {
  echo "导入失败：$*" >&2
  exit 1
}

if [[ -z "$SERVER_DIR" ]]; then
  echo "用法：sudo ./import-patents.sh <Patent Server 0.1.2 解压目录>" >&2
  exit 2
fi

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  exec sudo -- "$0" "$SERVER_DIR"
fi

SERVER_DIR="$(cd "$SERVER_DIR" && pwd)"
[[ -f "$SERVER_DIR/compose.yaml" ]] || fail "$SERVER_DIR 中缺少 compose.yaml"
[[ -f "$SERVER_DIR/.env" ]] || fail "$SERVER_DIR 中缺少 .env，请先完成 Patent Server 配置和安装"
[[ -f "$ROOT/$PAYLOAD" ]] || fail "数据文件不存在：$ROOT/$PAYLOAD"
[[ -f "$ROOT/$MANIFEST" ]] || fail "manifest 不存在：$ROOT/$MANIFEST"
[[ -f "$ROOT/MANIFEST.sha256" ]] || fail "数据包缺少 MANIFEST.sha256"

(cd "$ROOT" && sha256sum -c MANIFEST.sha256)
ACTUAL_SHA256="$(sha256sum "$ROOT/$PAYLOAD" | awk '{ print $1 }')"
[[ "$ACTUAL_SHA256" == "$EXPECTED_SHA256" ]] || fail "专利 ZIP SHA-256 不匹配：$ACTUAL_SHA256"

if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif [[ -x "$SERVER_DIR/tools/docker-compose" ]]; then
  COMPOSE=("$SERVER_DIR/tools/docker-compose")
else
  fail "没有找到 Docker Compose"
fi
COMPOSE+=(--env-file "$SERVER_DIR/.env" -f "$SERVER_DIR/compose.yaml")

DATA_ROOT="$(awk -F= '$1 == "PATENT_DATA_ROOT_HOST" { sub(/^[^=]*=/, ""); print; exit }' "$SERVER_DIR/.env")"
DATA_ROOT="${DATA_ROOT:-/srv/chipmate-patent}"
[[ "$DATA_ROOT" == /* ]] || fail "PATENT_DATA_ROOT_HOST 必须是绝对路径"

JURISDICTIONS="$(awk -F= '$1 == "PATENT_JURISDICTIONS" { sub(/^[^=]*=/, ""); print; exit }' "$SERVER_DIR/.env")"
ALLOW_INCOMPLETE="$(awk -F= '$1 == "PATENT_ALLOW_INCOMPLETE_CORPUS_SEARCH" { sub(/^[^=]*=/, ""); print; exit }' "$SERVER_DIR/.env")"
[[ ",${JURISDICTIONS:-CN,JP,KR,US,EP,RU}," == *,CN,* ]] || fail "PATENT_JURISDICTIONS 未包含 CN"
[[ "$ALLOW_INCOMPLETE" == "1" ]] || fail "局部语料试运行必须在 .env 中设置 PATENT_ALLOW_INCOMPLETE_CORPUS_SEARCH=1"

"${COMPOSE[@]}" up -d postgres opensearch patent-api
PARSER_VERSION="$("${COMPOSE[@]}" exec -T patent-api node -e '
const fs=require("fs");
const value=fs.readFileSync("dist/src/parser.js","utf8").match(/cnipa-st36-compatible-v[0-9]+/)?.[0];
if (!value) process.exit(2);
console.log(value);
')" || fail "无法读取 Patent Server 解析器版本"
[[ "$PARSER_VERSION" == "cnipa-st36-compatible-v3" ]] || fail "需要 cnipa-st36-compatible-v3，当前为 $PARSER_VERSION"
SERVER_VERSION="$("${COMPOSE[@]}" exec -T patent-api node -e '
const fs=require("fs");
console.log(JSON.parse(fs.readFileSync("package.json","utf8")).version);
')" || fail "无法读取 Patent Server 版本"
[[ "$SERVER_VERSION" == "0.1.2" ]] || fail "需要 Patent Server 0.1.2，当前为 $SERVER_VERSION"

install -d -m 0750 "$DATA_ROOT/drop" "$DATA_ROOT/.incoming"
INCOMING_PAYLOAD="$DATA_ROOT/.incoming/$PAYLOAD.$$.tmp"
INCOMING_MANIFEST="$DATA_ROOT/.incoming/$MANIFEST.$$.tmp"
FINAL_PAYLOAD="$DATA_ROOT/drop/$PAYLOAD"
FINAL_MANIFEST="$DATA_ROOT/drop/$MANIFEST"

cleanup() {
  rm -f "$INCOMING_PAYLOAD" "$INCOMING_MANIFEST"
  "${COMPOSE[@]}" start patent-ingest >/dev/null 2>&1 || true
}
trap cleanup EXIT

"${COMPOSE[@]}" stop patent-ingest >/dev/null 2>&1 || true
install -m 0644 "$ROOT/$PAYLOAD" "$INCOMING_PAYLOAD"
install -m 0644 "$ROOT/$MANIFEST" "$INCOMING_MANIFEST"
COPIED_SHA256="$(sha256sum "$INCOMING_PAYLOAD" | awk '{ print $1 }')"
[[ "$COPIED_SHA256" == "$EXPECTED_SHA256" ]] || fail "复制到数据盘后的 SHA-256 不匹配"

if [[ -e "$FINAL_PAYLOAD" || -e "$FINAL_MANIFEST" ]]; then
  fail "drop 目录已经存在同名文件，请先确认是否有其他导入任务：$FINAL_PAYLOAD"
fi
mv "$INCOMING_MANIFEST" "$FINAL_MANIFEST"
mv "$INCOMING_PAYLOAD" "$FINAL_PAYLOAD"

echo "开始导入批次 $BATCH，请勿中断……"
RESULT="$("${COMPOSE[@]}" run --rm --no-deps -T patent-ingest \
  node dist/src/cli.js import "/srv/chipmate-patent/drop/$PAYLOAD")"
printf '%s\n' "$RESULT"
if ! grep -Eq '"status"[[:space:]]*:[[:space:]]*"(published|duplicate)"' <<<"$RESULT"; then
  fail "导入结果不是 published 或 duplicate"
fi
if grep -q '"status"[[:space:]]*:[[:space:]]*"published"' <<<"$RESULT"; then
  EXPECT_CURRENT_BATCH=1
  grep -Eq '"discoveredRecords"[[:space:]]*:[[:space:]]*2000' <<<"$RESULT" || fail "解析记录数不是 2000"
  grep -Eq '"acceptedRecords"[[:space:]]*:[[:space:]]*2000' <<<"$RESULT" || fail "接受记录数不是 2000"
  grep -Eq '"rejectedRecords"[[:space:]]*:[[:space:]]*0' <<<"$RESULT" || fail "存在被拒绝记录"
else
  EXPECT_CURRENT_BATCH=0
fi

"${COMPOSE[@]}" start patent-ingest >/dev/null
trap - EXIT
STATUS="$("${COMPOSE[@]}" exec -T patent-api node -e '
fetch("http://127.0.0.1:6020/api/v1/corpus/status")
  .then(async response => { console.log(await response.text()); process.exit(response.ok ? 0 : 1) })
')"
printf '%s\n' "$STATUS"
if [[ "$EXPECT_CURRENT_BATCH" == "1" ]]; then
  grep -q "$BATCH" <<<"$STATUS" || fail "语料状态中没有成功批次 $BATCH"
fi

echo
echo "专利数据一键导入完成：$BATCH"
echo "当前为局部中国语料，DEGRADED 属于预期状态，不代表完整历史库。"
