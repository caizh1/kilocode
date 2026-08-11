#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

STAMP="$(date -u +%Y%m%d-%H%M%S)"
RUN_DIR="${VALIDATION_RUN_DIR:-docs/chipmate-feature-migration-validation-runs/${STAMP}-document-rag-readiness-smoke}"
SOURCE_DOC="${CHIPMATE_DOCUMENT_RAG_SMOKE_SOURCE:-docs/source-backed-detail-design-skill-contract.md}"
TIMEOUT="${CHIPMATE_DOCUMENT_RAG_SMOKE_TIMEOUT:-${CHIPMATE_SMOKE_TIMEOUT:-180}}"

if [[ "${RUN_DIR}" != /* ]]; then
  RUN_DIR="${REPO_ROOT}/${RUN_DIR}"
fi

SOURCE_PATH="${SOURCE_DOC}"
if [[ "${SOURCE_PATH}" != /* ]]; then
  SOURCE_PATH="${REPO_ROOT}/${SOURCE_PATH}"
fi

if [[ ! -f "${SOURCE_PATH}" ]]; then
  echo "Missing source document for Document RAG smoke: ${SOURCE_PATH}" >&2
  exit 2
fi

WORKSPACE="${RUN_DIR}/workspace"
DOC_REL="${SOURCE_DOC#/}"
if [[ "${DOC_REL}" == "${SOURCE_PATH}" ]]; then
  DOC_REL="docs/$(basename "${SOURCE_PATH}")"
fi

rm -rf "${RUN_DIR}"
mkdir -p "${WORKSPACE}/$(dirname "${DOC_REL}")" "${WORKSPACE}/.opencode"
cp "${SOURCE_PATH}" "${WORKSPACE}/${DOC_REL}"

cat > "${WORKSPACE}/.opencode/opencode.jsonc" <<JSON
{
  "\$schema": "https://app.chipmate.ai/config.json",
  "provider": {
    "chipmate": {
      "options": {}
    }
  },
  "indexing": {
    "enabled": true,
    "documents": {
      "enabled": true,
      "paths": ["${DOC_REL}"],
      "include": ["**/*.md"],
      "maxFileBytes": 1048576,
      "chunkChars": 1600,
      "chunkOverlapChars": 200,
      "searchMaxResults": 8
    }
  },
  "mcp": {},
  "tools": {},
  "disabled_providers": []
}
JSON

set +e
VALIDATION_RUN_DIR="${RUN_DIR}" \
CHIPMATE_SMOKE_DOC_WORKSPACE="${WORKSPACE}" \
CHIPMATE_SMOKE_TIMEOUT="${TIMEOUT}" \
bash "${SCRIPT_DIR}/chipmate-feature-migration-runtime-smoke.sh" --ids S3
SMOKE_EXIT=$?
set -e

GUARD="${RUN_DIR}/s3-guard.txt"
LOG="${RUN_DIR}/s3.log"
SMOKE_SUMMARY="${RUN_DIR}/summary.md"
HELPER_SUMMARY="${RUN_DIR}/document-rag-readiness-summary.md"
PROVIDER_DIAGNOSTICS="${RUN_DIR}/document-rag-provider-diagnostics.md"
PROVIDER_DIAGNOSTICS_TSV="${RUN_DIR}/document-rag-provider-diagnostics.tsv"

STATUS="UNKNOWN"
if [[ -f "${SMOKE_SUMMARY}" ]]; then
  STATUS="$(grep -F "| S3 |" "${SMOKE_SUMMARY}" | head -n 1 | cut -d'|' -f4 | xargs || true)"
fi

GUARD_TEXT=""
if [[ -f "${GUARD}" ]]; then
  GUARD_TEXT="$(cat "${GUARD}")"
fi

PROVIDER_FAILURE="no"
if [[ -f "${LOG}" ]] && grep -Eq "embedder validation failed|embedder validation error|Document RAG unavailable|failed to recreate services" "${LOG}"; then
  PROVIDER_FAILURE="yes"
fi

DOCUMENT_SEARCH_USED="no"
if [[ -f "${LOG}" ]] && grep -q '"tool":"document_search"' "${LOG}"; then
  DOCUMENT_SEARCH_USED="yes"
fi

python3 - "${LOG}" "${PROVIDER_DIAGNOSTICS}" "${PROVIDER_DIAGNOSTICS_TSV}" <<'PY'
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

log_path = Path(sys.argv[1])
md_path = Path(sys.argv[2])
tsv_path = Path(sys.argv[3])

events: list[dict[str, object]] = []
if log_path.is_file():
    for line in log_path.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            events.append(obj)

relevant: list[dict[str, str]] = []
for event in events:
    message = str(event.get("message") or "")
    service = str(event.get("service") or "")
    err = str(event.get("err") or event.get("error") or "")
    provider = str(event.get("provider") or "")
    combined = " ".join([message, service, err, provider])
    if re.search(r"embed|indexing|document rag|validation|provider|configuration|failed", combined, re.I):
        relevant.append({
            "service": service,
            "provider": provider,
            "message": message,
            "error": err,
        })

combined_text = "\n".join(" ".join(item.values()) for item in relevant)
status_match = re.search(r"\b([1-5][0-9]{2})\s+status code\b", combined_text, re.I)
http_status = status_match.group(1) if status_match else ""
classification = "none"
if http_status in {"401", "403"}:
    classification = "auth_or_permission"
elif http_status == "404":
    classification = "endpoint_or_model_not_found"
elif http_status == "429":
    classification = "rate_limited"
elif http_status.startswith("5"):
    classification = "server_or_upstream_unavailable"
elif re.search(r"timeout|timed out|econn|connection refused|network", combined_text, re.I):
    classification = "network_or_timeout"
elif re.search(r"validation failed|validation error|configuration error", combined_text, re.I):
    classification = "configuration_or_provider_validation"
elif relevant:
    classification = "provider_or_indexing_error"

provider = next((item["provider"] for item in relevant if item["provider"]), "")
service = next((item["service"] for item in relevant if item["service"]), "")
first_error = next((item["error"] for item in relevant if item["error"]), "")
first_message = next((item["message"] for item in relevant if item["message"]), "")
indexing_failed = "yes" if re.search(r"failed to recreate services|indexing-manager", combined_text, re.I) else "no"
embedder_validation_failed = "yes" if re.search(r"embedder validation failed|embedder validation error", combined_text, re.I) else "no"

rows = {
    "classification": classification,
    "http_status": http_status or "n/a",
    "provider": provider or "n/a",
    "service": service or "n/a",
    "embedder_validation_failed": embedder_validation_failed,
    "indexing_manager_failed": indexing_failed,
    "first_message": first_message or "n/a",
    "first_error": first_error or "n/a",
}
tsv_path.write_text("field\tvalue\n" + "".join(f"{key}\t{value}\n" for key, value in rows.items()), encoding="utf-8")

lines = [
    "# Document RAG Provider Diagnostics",
    "",
    "| Field | Value |",
    "|---|---|",
]
for key, value in rows.items():
    escaped = str(value).replace("|", "\\|")
    lines.append(f"| {key} | `{escaped}` |")
lines.extend(["", "## Relevant log events", ""])
if relevant:
    for item in relevant[:12]:
        lines.append(f"- service `{item['service'] or 'n/a'}` provider `{item['provider'] or 'n/a'}` message `{item['message'] or 'n/a'}` error `{item['error'] or 'n/a'}`")
    if len(relevant) > 12:
        lines.append(f"- ... {len(relevant) - 12} additional relevant events omitted.")
else:
    lines.append("- No provider/indexing diagnostic events were parsed from the log.")
lines.extend([
    "",
    "## Interpretation",
    "",
    "- `auth_or_permission` usually means credentials, API key, tenant, or permission must be fixed.",
    "- `endpoint_or_model_not_found` usually means embedding endpoint path or embedding model name must be fixed.",
    "- `server_or_upstream_unavailable` usually means the configured embedding upstream is unavailable or returning 5xx.",
    "- `configuration_or_provider_validation` means the embedder failed validation but no more specific HTTP/network class was found.",
    "",
])
md_path.write_text("\n".join(lines), encoding="utf-8")
PY

{
  echo "# Document RAG Readiness Smoke"
  echo
  echo "- Status: \`${STATUS:-UNKNOWN}\`"
  echo "- Smoke exit: \`${SMOKE_EXIT}\`"
  echo "- Workspace: \`${WORKSPACE}\`"
  echo "- Source document: \`${SOURCE_DOC}\`"
  echo "- Document RAG config: \`enabled=true\`, path \`${DOC_REL}\`"
  echo "- document_search used: \`${DOCUMENT_SEARCH_USED}\`"
  echo "- provider/readiness failure detected: \`${PROVIDER_FAILURE}\`"
  if [[ -f "${PROVIDER_DIAGNOSTICS_TSV}" ]]; then
    while IFS=$'\t' read -r key value; do
      if [[ "${key}" == "classification" ]]; then
        echo "- provider diagnostic classification: \`${value}\`"
      elif [[ "${key}" == "http_status" ]]; then
        echo "- provider diagnostic http status: \`${value}\`"
      elif [[ "${key}" == "provider" ]]; then
        echo "- provider diagnostic provider: \`${value}\`"
      fi
    done < <(tail -n +2 "${PROVIDER_DIAGNOSTICS_TSV}")
  fi
  echo "- Smoke summary: \`${SMOKE_SUMMARY#${REPO_ROOT}/}\`"
  echo "- Guard file: \`${GUARD#${REPO_ROOT}/}\`"
  echo "- Log file: \`${LOG#${REPO_ROOT}/}\`"
  echo "- Provider diagnostics: \`${PROVIDER_DIAGNOSTICS#${REPO_ROOT}/}\`"
  echo
  echo "## Guard"
  echo
  if [[ -n "${GUARD_TEXT}" ]]; then
    sed 's/^/- /' "${GUARD}"
  else
    echo "- missing guard file"
  fi
  echo
  echo "## Boundary"
  echo
  echo "This helper creates an isolated workspace with Document RAG enabled and runs only S3. It does not modify project config, does not migrate QA, and does not mark S3 complete unless runtime evidence shows document_search was exposed and used."
} > "${HELPER_SUMMARY}"

echo "SUMMARY=${HELPER_SUMMARY#${REPO_ROOT}/}"
exit 0
