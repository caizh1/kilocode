#!/usr/bin/env bash

set -euo pipefail

VERSION="0.0.51"
EXTENSION_ID="chipmate.chipmate"
EXPECTED_SHA256="1acd3e2de403bb715f050516bb2f15f6850dfe04622a235af97100201a70b71a"
DEFAULT_VSIX="/home/caizh/chipmate-0.0.51-linux-x64-baseline.vsix"
EVIDENCE_ROOT="${CHIPMATE_QWEN_EVIDENCE_ROOT:-${HOME}/chipmate-qwen-autocomplete-0.0.51-evidence}"

usage() {
  printf '%s\n' \
    "ChipMate Qwen autocomplete 0.0.51 offline Linux audit" \
    "" \
    "Usage:" \
    "  bash $0 prepare [vsix-path]" \
    "  bash $0 audit [evidence-directory]" \
    "  bash $0 self-test" \
    "" \
    "prepare verifies the VSIX, installs it with --force, and prints the manual test steps." \
    "audit scans recent Extension Host logs and emits a redacted acceptance summary."
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

code_bin() {
  if [[ -n "${CODE_BIN:-}" ]]; then
    [[ -x "${CODE_BIN}" ]] || fail "CODE_BIN is not executable: ${CODE_BIN}"
    printf '%s\n' "${CODE_BIN}"
    return
  fi
  command -v code || fail "code CLI not found; set CODE_BIN to the target VS Code CLI"
}

new_run() {
  local stamp
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  printf '%s/%s\n' "${EVIDENCE_ROOT}" "${stamp}"
}

latest_run() {
  local run
  run="$(ls -1dt "${EVIDENCE_ROOT}"/* 2>/dev/null | head -1 || true)"
  [[ -n "${run}" ]] || fail "no evidence directory found under ${EVIDENCE_ROOT}"
  printf '%s\n' "${run}"
}

locate_extension() {
  local base path
  for base in "${HOME}/.vscode-server/extensions" "${HOME}/.vscode/extensions"; do
    [[ -d "${base}" ]] || continue
    for path in "${base}/${EXTENSION_ID}-${VERSION}" "${base}/${EXTENSION_ID}-${VERSION}-"*; do
      [[ -d "${path}" ]] || continue
      printf '%s\n' "${path}"
      return
    done
  done
  return 1
}

write_steps() {
  local run="$1"
  {
    printf '%s\n' \
      "# ChipMate Qwen autocomplete 0.0.51 remote acceptance" \
      "" \
      "1. Run Developer: Reload Window and confirm the loaded extension path ends in chipmate.chipmate-0.0.51." \
      "2. Recreate the custom @ai-sdk/openai-compatible Provider using only the normal Base URL and API key UI." \
      "3. Confirm Chat still works, then select the real Provider / Qwen Coder FIM autocomplete entry." \
      "4. Confirm the selection does not bounce to Codestral and no authentication warning appears." \
      "5. Run ChipMate: Test qwen-direct Transport and choose Export Diagnostics." \
      "6. In real C/C++ files test empty-body ghost text, partial token, same-line suffix, cancellation, stale suppression, and Tab acceptance." \
      "7. Reload three times and make at least ten editor completion requests." \
      "8. Run: bash $0 audit ${run}" \
      "" \
      "Do not upload API keys, Authorization headers, prompts, source code, or unredacted raw logs."
  } >"${run}/NEXT_STEPS.md"
}

prepare() {
  local vsix="${1:-${DEFAULT_VSIX}}"
  local code run actual extension
  [[ -f "${vsix}" ]] || fail "VSIX not found: ${vsix}"
  need sha256sum
  need file
  actual="$(sha256sum "${vsix}" | awk '{print $1}')"
  [[ "${actual}" == "${EXPECTED_SHA256}" ]] || fail "SHA-256 mismatch: expected ${EXPECTED_SHA256}, got ${actual}"

  code="$(code_bin)"
  run="$(new_run)"
  mkdir -p "${run}"
  {
    printf 'timestamp_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'kernel=%s\n' "$(uname -srmo)"
    printf 'code_bin=%s\n' "${code}"
    printf 'vsix=%s\n' "${vsix}"
    printf 'sha256=%s\n' "${actual}"
  } >"${run}/environment.txt"

  "${code}" --install-extension "${vsix}" --force 2>&1 | tee "${run}/install.log"
  "${code}" --list-extensions --show-versions 2>&1 | tee "${run}/extensions.log"
  grep -Fxq "${EXTENSION_ID}@${VERSION}" "${run}/extensions.log" || fail "${EXTENSION_ID}@${VERSION} is not listed after installation"

  extension="$(locate_extension || true)"
  [[ -n "${extension}" ]] || fail "installed extension directory not found"
  printf 'extension_path=%s\n' "${extension}" >>"${run}/environment.txt"
  [[ -x "${extension}/bin/chipmate" ]] || fail "bundled Linux CLI is missing or not executable"
  file "${extension}/bin/chipmate" | tee "${run}/cli-file.txt"
  grep -q 'ELF 64-bit.*x86-64' "${run}/cli-file.txt" || fail "bundled CLI is not Linux x86-64 ELF"

  write_steps "${run}"
  printf 'PREPARE_RESULT=PASS\n'
  printf 'EVIDENCE_DIR=%s\n' "${run}"
  printf 'NEXT_STEPS=%s/NEXT_STEPS.md\n' "${run}"
}

log_files() {
  local since="${1:-}"
  local roots root
  roots="${CHIPMATE_QWEN_LOG_ROOTS:-${HOME}/.vscode-server/data/logs:${HOME}/.config/Code/logs}"
  IFS=':' read -r -a paths <<<"${roots}"
  for root in "${paths[@]}"; do
    [[ -d "${root}" ]] || continue
    if [[ -n "${since}" && -f "${since}" ]]; then
      find "${root}" -type f \( -name '*.log' -o -name '*.txt' \) -newer "${since}" -print
      continue
    fi
    find "${root}" -type f \( -name '*.log' -o -name '*.txt' \) -mtime -2 -print
  done
}

count() {
  local pattern="$1"
  local file="$2"
  grep -Eic "${pattern}" "${file}" || true
}

audit() {
  local run="${1:-}"
  local combined safe
  [[ -n "${run}" ]] || run="$(latest_run)"
  [[ -d "${run}" ]] || fail "evidence directory not found: ${run}"
  combined="${run}/extension-host-matches.raw"
  safe="${run}/extension-host-matches.redacted.txt"

  logs=()
  while IFS= read -r file; do
    logs+=("${file}")
  done < <(log_files "${run}/environment.txt")
  [[ "${#logs[@]}" -gt 0 ]] || fail "no recent VS Code Extension Host logs found"

  grep -Ehi \
    'qwen|autocomplete|provider-enter|config-read|prompt-built|request-start|response|return-items|Maximum call stack|unhandled|Starting new server instance|inline provider|/chipmate/fim' \
    "${logs[@]}" >"${combined}" || true

  grep -Evi \
    'authorization|api.?key|bearer|secret|promptPreview|completionPreview|"prompt"[=:]|"completion"[=:]|sourceText|sourceCode' \
    "${combined}" \
    | sed "s#${HOME}#~#g" \
    | sed -E 's#(https?://)[^/[:space:]"]+#\1<redacted-host>#g' \
    >"${safe}"
  rm -f "${combined}"

  local smoke editor enter config prompt request response items stack unhandled auth classic duplicate starts over file starts_file
  smoke="$(count 'requestSource[=:" ]+smoke' "${safe}")"
  editor="$(count 'requestSource[=:" ]+editor' "${safe}")"
  enter="$(count 'provider-enter' "${safe}")"
  config="$(count 'config-read' "${safe}")"
  prompt="$(count 'prompt-built' "${safe}")"
  request="$(count 'request-start' "${safe}")"
  response="$(count 'response([^0-9]|.*status[=:" ]*)200' "${safe}")"
  items="$(count 'return-items.*(itemCount[=:" ]*)?[1-9][0-9]*' "${safe}")"
  stack="$(count 'Maximum call stack size exceeded' "${safe}")"
  unhandled="$(count 'unhandled (exception|rejection)|UnhandledPromiseRejection' "${safe}")"
  auth="$(count 'authentication error|authentication warning|paused due to an authentication' "${safe}")"
  classic="$(count '/chipmate/fim([^[:alnum:]_-]|$)' "${safe}")"
  duplicate="$(count 'duplicate.*inline provider|inline provider.*already registered' "${safe}")"
  starts="$(count 'Starting new server instance' "${safe}")"
  over=0
  for file in "${logs[@]}"; do
    starts_file="$(count 'Starting new server instance' "${file}")"
    [[ "${starts_file}" -le 1 ]] || over=$((over + 1))
  done

  {
    printf 'audit_timestamp_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'log_files=%s\n' "${#logs[@]}"
    printf 'request_source_smoke=%s\n' "${smoke}"
    printf 'request_source_editor=%s\n' "${editor}"
    printf 'provider_enter=%s\n' "${enter}"
    printf 'config_read=%s\n' "${config}"
    printf 'prompt_built=%s\n' "${prompt}"
    printf 'request_start=%s\n' "${request}"
    printf 'response_200=%s\n' "${response}"
    printf 'return_items_nonzero=%s\n' "${items}"
    printf 'stack_overflow=%s\n' "${stack}"
    printf 'unhandled=%s\n' "${unhandled}"
    printf 'authentication_warning=%s\n' "${auth}"
    printf 'classic_chipmate_fim=%s\n' "${classic}"
    printf 'duplicate_inline_provider=%s\n' "${duplicate}"
    printf 'server_start_attempts=%s\n' "${starts}"
    printf 'extension_host_logs_with_multiple_server_starts=%s\n' "${over}"
  } | tee "${run}/audit-summary.txt"

  if [[ "${smoke}" -lt 1 || "${editor}" -lt 10 || "${enter}" -lt 11 || "${config}" -lt 11 || "${prompt}" -lt 11 || "${request}" -lt 11 || "${response}" -lt 11 || "${items}" -lt 11 ]]; then
    printf 'AUDIT_RESULT=INCOMPLETE\n'
    printf 'Reason: expected at least one Smoke and ten complete editor request chains.\n'
    exit 1
  fi
  if [[ "${stack}" -ne 0 || "${unhandled}" -ne 0 || "${auth}" -ne 0 || "${classic}" -ne 0 || "${duplicate}" -ne 0 || "${over}" -ne 0 ]]; then
    printf 'AUDIT_RESULT=FAIL\n'
    printf 'Reason: one or more forbidden runtime signals were found.\n'
    exit 1
  fi
  printf 'AUDIT_RESULT=PASS\n'
  printf 'REDACTED_LOG=%s\n' "${safe}"
}

self_test() {
  local root run log source i
  root="$(mktemp -d)"
  run="${root}/evidence"
  log="${root}/logs/exthost.log"
  mkdir -p "${run}" "$(dirname "${log}")"

  for ((i = 1; i <= 11; i++)); do
    source="editor"
    [[ "${i}" -eq 1 ]] && source="smoke"
    printf '{"requestId":"r%s","requestSource":"%s","phase":"provider-enter"}\n' "${i}" "${source}" >>"${log}"
    printf '{"requestId":"r%s","phase":"config-read"}\n' "${i}" >>"${log}"
    printf '{"requestId":"r%s","phase":"prompt-built"}\n' "${i}" >>"${log}"
    printf '{"requestId":"r%s","phase":"request-start"}\n' "${i}" >>"${log}"
    printf '{"requestId":"r%s","phase":"response","httpStatus":200}\n' "${i}" >>"${log}"
    printf '{"requestId":"r%s","phase":"return-items","itemCount":1}\n' "${i}" >>"${log}"
  done
  printf '[qwen] endpoint=https://private.example/v1\n' >>"${log}"
  printf '[qwen] Authorization: Bearer secret-value\n' >>"${log}"

  CHIPMATE_QWEN_LOG_ROOTS="$(dirname "${log}")" audit "${run}"
  if grep -Eqi 'secret-value|private\.example' "${run}/extension-host-matches.redacted.txt"; then
    rm -rf "${root}"
    fail "self-test detected an unredacted secret or host"
  fi
  rm -rf "${root}"
  printf 'SELF_TEST_RESULT=PASS\n'
}

case "${1:-}" in
  prepare)
    shift
    prepare "${1:-}"
    ;;
  audit)
    shift
    audit "${1:-}"
    ;;
  self-test)
    self_test
    ;;
  -h|--help|help|"")
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
