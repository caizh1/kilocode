#!/usr/bin/env bash

set -uo pipefail

# You may fill these two values before running the script. Leaving API_KEY empty
# is safer: the script will prompt for it without echoing it to the terminal.
BASE_URL="${BASE_URL:-}"
API_KEY="${API_KEY:-}"

MODEL="${MODEL:-qwen-coder-30b0}"
MAX_TOKENS="${MAX_TOKENS:-64}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-60}"
KEEP_RESULTS="${KEEP_RESULTS:-1}"

for command in curl python3; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "ERROR: required command is missing: $command" >&2
    exit 2
  fi
done

if [[ -z "$BASE_URL" ]]; then
  read -r -p "Provider Base URL (for example https://HOST/v1): " BASE_URL
fi

if [[ -z "$API_KEY" ]]; then
  read -r -s -p "API key: " API_KEY
  echo
fi

BASE_URL="${BASE_URL%/}"
if [[ "$BASE_URL" == */completions ]]; then
  COMPLETIONS_URL="$BASE_URL"
else
  COMPLETIONS_URL="$BASE_URL/completions"
fi

if [[ -z "$BASE_URL" || -z "$API_KEY" ]]; then
  echo "ERROR: Base URL and API key must not be empty." >&2
  exit 2
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/chipmate-qwen-fim.XXXXXX")"
chmod 700 "$WORK_DIR"
AUTH_FILE="$WORK_DIR/request.headers"
printf 'Authorization: Bearer %s\nContent-Type: application/json\nAccept: application/json, text/event-stream\n' \
  "$API_KEY" >"$AUTH_FILE"
chmod 600 "$AUTH_FILE"

cleanup() {
  rm -f "$AUTH_FILE"
  API_KEY=""
  unset API_KEY
  if [[ "$KEEP_RESULTS" == "0" ]]; then
    rm -rf "$WORK_DIR"
  fi
}
trap cleanup EXIT INT TERM

declare -a SUMMARY=()

build_body() {
  local prompt="$1"
  local stream="$2"
  local suffix="$3"

  python3 - "$MODEL" "$prompt" "$MAX_TOKENS" "$stream" "$suffix" <<'PY'
import json
import sys

body = {
    "model": sys.argv[1],
    "prompt": sys.argv[2],
    "max_tokens": int(sys.argv[3]),
    "temperature": 0.1,
    "stream": sys.argv[4] == "true",
}
if sys.argv[5] == "include":
    body["suffix"] = ""
print(json.dumps(body, ensure_ascii=False))
PY
}

validate_response() {
  local body="$1"
  local status="$2"
  local mode="$3"

  python3 - "$body" "$status" "$mode" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
status = int(sys.argv[2]) if sys.argv[2].isdigit() else 0
mode = sys.argv[3]
raw = path.read_text(errors="replace") if path.exists() else ""

def compact(value, limit=500):
    text = " ".join(value.split())
    return text if len(text) <= limit else text[:limit] + "..."

if not 200 <= status < 300:
    message = compact(raw) or "empty response body"
    print(f"HTTP {status}: {message}")
    raise SystemExit(1)

if mode == "json":
    try:
        payload = json.loads(raw)
    except Exception as error:
        print(f"HTTP {status}, but response is not JSON: {error}; body={compact(raw)}")
        raise SystemExit(1)

    choices = payload.get("choices") if isinstance(payload, dict) else None
    first = choices[0] if isinstance(choices, list) and choices else {}
    text = first.get("text") if isinstance(first, dict) else None
    message = first.get("message") if isinstance(first, dict) else None
    content = message.get("content") if isinstance(message, dict) else None
    finish = first.get("finish_reason") if isinstance(first, dict) else None

    if isinstance(text, str) and text:
        print(f"choices[0].text={text!r}; finish_reason={finish!r}")
        raise SystemExit(0)

    if isinstance(content, str) and content:
        print(
            "FAIL: chat-shaped message.content was returned instead of "
            f"choices[0].text; content={content!r}"
        )
        raise SystemExit(1)

    print(
        "FAIL: HTTP 2xx without usable choices[0].text; "
        f"message.content={content!r}; finish_reason={finish!r}; body={compact(raw)}"
    )
    raise SystemExit(1)

legacy = []
delta = []
events = 0
done = False
errors = []
for line in raw.splitlines():
    if not line.startswith("data:"):
        continue
    data = line[5:].strip()
    if data == "[DONE]":
        done = True
        continue
    if not data:
        continue
    try:
        payload = json.loads(data)
    except Exception as error:
        errors.append(str(error))
        continue
    events += 1
    choices = payload.get("choices") if isinstance(payload, dict) else None
    first = choices[0] if isinstance(choices, list) and choices else {}
    text = first.get("text") if isinstance(first, dict) else None
    item = first.get("delta") if isinstance(first, dict) else None
    content = item.get("content") if isinstance(item, dict) else None
    if isinstance(text, str):
        legacy.append(text)
    if isinstance(content, str):
        delta.append(content)

joined = "".join(legacy)
chat = "".join(delta)
if joined:
    print(f"SSE choices[0].text={joined!r}; events={events}; done={done}")
    raise SystemExit(0)

if chat:
    print(
        "FAIL: stream used chat-shaped delta.content instead of choices[0].text; "
        f"delta.content={chat!r}; events={events}; done={done}"
    )
    raise SystemExit(1)

print(
    "FAIL: HTTP 2xx stream contained no completion text; "
    f"events={events}; done={done}; parse_errors={len(errors)}; body={compact(raw)}"
)
raise SystemExit(1)
PY
}

probe() {
  local name="$1"
  local mode="$2"
  local payload="$3"
  local body="$WORK_DIR/$name.body"
  local headers="$WORK_DIR/$name.headers"
  local status
  local curl_status
  local result
  local validate_status

  echo
  echo "===== $name ====="
  status="$(
    curl --silent --show-error --no-buffer \
      --max-time "$TIMEOUT_SECONDS" \
      --request POST \
      --header "@$AUTH_FILE" \
      --data-binary "$payload" \
      --dump-header "$headers" \
      --output "$body" \
      --write-out '%{http_code}' \
      "$COMPLETIONS_URL"
  )"
  curl_status=$?

  if [[ $curl_status -ne 0 ]]; then
    echo "FAIL: curl exited with status $curl_status; HTTP=${status:-none}"
    SUMMARY+=("FAIL  $name  curl=$curl_status HTTP=${status:-none}")
    return 1
  fi

  echo "HTTP=$status"
  result="$(validate_response "$body" "$status" "$mode")"
  validate_status=$?
  echo "$result"

  if [[ $validate_status -eq 0 ]]; then
    SUMMARY+=("PASS  $name  HTTP=$status")
    return 0
  fi

  SUMMARY+=("FAIL  $name  HTTP=$status")
  return 1
}

FIM_PROMPT=$'<|fim_prefix|>int add(int a, int b) {\n    <|fim_suffix|>\n}\n<|fim_middle|>'
PLAIN_PROMPT=$'Complete this C function with code only:\nint add(int a, int b) {\n    return'

echo "Qwen FIM /completions contract smoke"
echo "Endpoint: $COMPLETIONS_URL"
echo "Model: $MODEL"
echo "Results: $WORK_DIR"

current=0
target=0
stream=0
plain=0

probe \
  "current_plugin_nonstream" \
  "json" \
  "$(build_body "$FIM_PROMPT" "false" "include")" || current=$?

probe \
  "target_fim_nonstream" \
  "json" \
  "$(build_body "$FIM_PROMPT" "false" "omit")" || target=$?

probe \
  "continue_fim_stream" \
  "sse" \
  "$(build_body "$FIM_PROMPT" "true" "omit")" || stream=$?

probe \
  "plain_nonstream" \
  "json" \
  "$(build_body "$PLAIN_PROMPT" "false" "omit")" || plain=$?

echo
echo "===== SUMMARY ====="
printf '%s\n' "${SUMMARY[@]}"

echo
if [[ $current -eq 0 ]]; then
  echo "Current installed request contract: PASS (empty suffix is accepted)."
else
  echo "Current installed request contract: FAIL (the deployed plugin request is incompatible)."
fi

if [[ $target -eq 0 && $plain -eq 0 ]]; then
  echo "Target non-streaming contract: PASS (a client that omits suffix can receive choices[0].text)."
else
  echo "Target non-streaming contract: FAIL (the API still cannot supply usable choices[0].text)."
fi

if [[ $stream -eq 0 ]]; then
  echo "Continue-style streaming contract: PASS."
else
  echo "Continue-style streaming contract: FAIL."
fi

rm -f "$AUTH_FILE"

if [[ $current -eq 0 && $target -eq 0 && $stream -eq 0 && $plain -eq 0 ]]; then
  echo "OVERALL: PASS"
  exit 0
fi

echo "OVERALL: FAIL"
exit 1
