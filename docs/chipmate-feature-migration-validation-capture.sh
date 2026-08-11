#!/usr/bin/env bash

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUN_STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${VALIDATION_RUN_DIR:-${REPO_ROOT}/docs/chipmate-feature-migration-validation-runs/${RUN_STAMP}}"
STATUS_FILE="${RUN_DIR}/status.tsv"

run_commands=0
run_package=0
prepare_smoke=0
inspect_vsix_path=""

usage() {
  cat <<'USAGE'
ChipMate feature migration validation capture helper.

This script is inert by default. It only executes validation commands when a
run flag is passed explicitly.

Usage:
  bash docs/chipmate-feature-migration-validation-capture.sh --run-commands
  bash docs/chipmate-feature-migration-validation-capture.sh --run-package
  bash docs/chipmate-feature-migration-validation-capture.sh --prepare-smoke
  bash docs/chipmate-feature-migration-validation-capture.sh --inspect-vsix <path>
  bash docs/chipmate-feature-migration-validation-capture.sh --run-all

Options:
  --run-commands   Run package-local automated checks C1-C6 and capture logs.
  --run-package    Run VSIX packaging check C7 and capture logs.
  --prepare-smoke  Create an installed VS Code smoke checklist markdown file.
  --inspect-vsix   Inspect an existing VSIX for version, size, manifest, and
                   suspicious renderer payloads. Does not build or install.
  --run-all        Run C1-C7 and create the smoke checklist.
  --help           Show this message.

Environment:
  VALIDATION_RUN_DIR  Optional output directory for logs and status.tsv.

Notes:
  - Do not run this from the repository root with plain `bun test`.
  - Installed VS Code smoke is not automated here; the script only prepares a
    fill-in checklist for manual evidence capture.
USAGE
}

while [[ "$#" -gt 0 ]]; do
  arg="$1"
  case "$arg" in
    --run-commands)
      run_commands=1
      shift
      ;;
    --run-package)
      run_package=1
      shift
      ;;
    --prepare-smoke)
      prepare_smoke=1
      shift
      ;;
    --inspect-vsix)
      if [[ "$#" -lt 2 ]]; then
        echo "--inspect-vsix requires a VSIX path" >&2
        exit 2
      fi
      inspect_vsix_path="$2"
      shift 2
      ;;
    --run-all)
      run_commands=1
      run_package=1
      prepare_smoke=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$run_commands" -eq 0 && "$run_package" -eq 0 && "$prepare_smoke" -eq 0 && -z "$inspect_vsix_path" ]]; then
  usage
  exit 0
fi

mkdir -p "$RUN_DIR"
printf 'id\tarea\tstatus\texit_code\tcwd\tcommand\tlog\n' >"$STATUS_FILE"

run_step() {
  local id="$1"
  local area="$2"
  local cwd="$3"
  local command="$4"
  local log_file="${RUN_DIR}/${id}.log"
  local status="PASS"
  local exit_code=0

  echo "[$id] ${area}"
  echo "cwd: ${cwd}" >"$log_file"
  echo "cmd: ${command}" >>"$log_file"
  echo >>"$log_file"

  (
    cd "$cwd" && bash -lc "$command"
  ) >>"$log_file" 2>&1
  exit_code=$?

  if [[ "$exit_code" -ne 0 ]]; then
    status="FAIL"
  fi

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$id" "$area" "$status" "$exit_code" "$cwd" "$command" "$log_file" >>"$STATUS_FILE"
  echo "  ${status} (${log_file})"
}

write_smoke_checklist() {
  local smoke_file="${RUN_DIR}/installed-vscode-smoke.md"
  cat >"$smoke_file" <<'SMOKE'
# Installed VS Code Smoke Checklist

Fill this file after installing the generated VSIX into the agreed VS Code profile.

| ID | Area | Prompt or action | Expected behavior | Status | Evidence |
|---|---|---|---|---|---|
| S1 | Native C QA | Ask for a C function call chain | Uses native code understanding; no Word/Mermaid/artifact tools | TODO |  |
| S2 | Macro/register QA | Ask where a macro is defined and used | Uses native code/search tools only | TODO |  |
| S3 | Document RAG | Ask about an indexed existing document | Uses `document_search`; no Word generation | TODO |  |
| S4 | Artifact | Generate and list a report artifact | `.chipmate/artifacts/.../artifact.json` exists and opens | TODO |  |
| S5 | Word create | Generate a module interface design Word | `.docx` artifact exists | TODO |  |
| S6 | Word edit | Add an error-code table | New `.docx` artifact and source backup exist | TODO |  |
| S7 | Word delete | Delete a chapter dry-run first | Impact is reported without writing until explicit apply | TODO |  |
| S8 | Word template | Apply a real company template | Style inheritance result and warnings recorded | TODO |  |
| S9 | Word merge/diff | Merge or compare docs | Bounded summary and artifact paths returned | TODO |  |
| S10 | Word render | Render docx to PDF/page PNG | Render artifact or endpoint-unconfigured warning | TODO |  |
| S11 | Mermaid | Generate state-machine PNG | `.mmd`, `.png`, diagnostics artifact | TODO |  |
| S12 | Mermaid + Word | Insert Mermaid PNG into Word | New Word artifact with figure | TODO |  |
| S13 | Source-backed detail design | Run on one internal embedded C module | Evidence, diagrams, Word output, quality report | TODO |  |
| S14 | Agent Terminal open | Open Agent Terminal | Disabled prompt appears; terminal opens after workspace enable | TODO |  |
| S15 | Agent Terminal danger | Plan/delete temporary artifacts | Dangerous command requires explicit confirmation | TODO |  |
| S16 | Autocomplete | Enable qwen-direct and trigger inline completion | Provider still registers; diagnostics commands exist | TODO |  |

## Package evidence

- VSIX path:
- VSIX version:
- VSIX size:
- Install profile:
- Install result:

## Notes

- Record actual tool sequence or visible behavior when possible.
- Record artifact paths and warnings.
- Do not mark M10/M11 complete until this checklist and command logs are reviewed.
SMOKE
  echo "Prepared smoke checklist: ${smoke_file}"
}

inspect_vsix() {
  local input_path="$1"
  local report_file="${RUN_DIR}/vsix-inspection.md"
  local list_file="${RUN_DIR}/vsix-file-list.txt"
  local inspection_status_file="${RUN_DIR}/vsix-inspection.status"
  local resolved_path
  local status="PASS"
  local exit_code=0

  if [[ "$input_path" = /* ]]; then
    resolved_path="$input_path"
  else
    resolved_path="${REPO_ROOT}/${input_path}"
  fi

  if [[ ! -f "$resolved_path" ]]; then
    status="FAIL"
    exit_code=1
    {
      echo "# VSIX Inspection"
      echo
      echo "VSIX not found: ${resolved_path}"
    } >"$report_file"
  else
    python3 - "$resolved_path" "$report_file" "$list_file" "$inspection_status_file" <<'PY'
import json
import os
import re
import sys
import zipfile

vsix_path, report_path, list_path, status_path = sys.argv[1:5]
size_bytes = os.path.getsize(vsix_path)
high_risk_patterns = [
    re.compile(r"(^|/)(libreoffice|soffice)(/|$)", re.I),
    re.compile(r"(^|/)(chromium|chrome)(/|$)", re.I),
    re.compile(r"puppeteer", re.I),
    re.compile(r"@mermaid-js/mermaid-cli|mermaid-cli|(^|/)mmdc(\.cmd|\.js)?$", re.I),
]
review_patterns = [
    re.compile(r"poppler|pdftotext", re.I),
    re.compile(r"playwright", re.I),
]

with zipfile.ZipFile(vsix_path) as zf:
    names = sorted(zf.namelist())
    package_name = next((name for name in names if name == "extension/package.json"), None)
    package_json = {}
    if package_name:
        package_json = json.loads(zf.read(package_name).decode("utf-8"))

with open(list_path, "w", encoding="utf-8") as f:
    for name in names:
        f.write(f"{name}\n")

high_risk = [name for name in names if any(pattern.search(name) for pattern in high_risk_patterns)]
review_required = [name for name in names if any(pattern.search(name) for pattern in review_patterns)]

if high_risk:
    status = "FAIL"
elif review_required:
    status = "REVIEW"
else:
    status = "PASS"

def sample(items, limit=80):
    if not items:
        return ["none"]
    shown = items[:limit]
    if len(items) > limit:
        shown.append(f"... truncated {len(items) - limit} more")
    return shown

with open(report_path, "w", encoding="utf-8") as f:
    f.write("# VSIX Inspection\n\n")
    f.write(f"- VSIX path: `{vsix_path}`\n")
    f.write(f"- Size bytes: `{size_bytes}`\n")
    f.write(f"- Size MiB: `{size_bytes / 1024 / 1024:.2f}`\n")
    f.write(f"- Package name: `{package_json.get('name', 'unknown')}`\n")
    f.write(f"- Package version: `{package_json.get('version', 'unknown')}`\n")
    f.write(f"- Publisher: `{package_json.get('publisher', 'unknown')}`\n")
    f.write(f"- Inspection status: `{status}`\n")
    f.write(f"- File list: `{list_path}`\n\n")
    f.write("## High-risk renderer payload scan\n\n")
    f.write("These entries require investigation because this migration must not package LibreOffice, Chromium, Puppeteer, Mermaid CLI, or mmdc runtime payloads for Word/Mermaid rendering.\n\n")
    for item in sample(high_risk):
        f.write(f"- `{item}`\n")
    f.write("\n## Review-required existing/offline dependency scan\n\n")
    f.write("Poppler/pdftotext may be ChipMate's pre-existing internal-offline document extraction helper, not a newly introduced Word/Mermaid renderer. Playwright may also be unrelated to this migration. Review and record the conclusion before checking M10 packaging items.\n\n")
    for item in sample(review_required):
        f.write(f"- `{item}`\n")

with open(status_path, "w", encoding="utf-8") as f:
    f.write(status + "\n")
PY
    exit_code=$?
    if [[ "$exit_code" -eq 0 ]]; then
      status="$(cat "$inspection_status_file" 2>/dev/null || echo FAIL)"
      if [[ "$status" == "FAIL" ]]; then
        exit_code=1
      fi
    else
      status="FAIL"
    fi
  fi

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "P1" "VSIX inspection" "$status" "$exit_code" "$REPO_ROOT" "inspect-vsix ${resolved_path}" "$report_file" >>"$STATUS_FILE"
  echo "[P1] VSIX inspection ${status} (${report_file})"
}

if [[ "$run_commands" -eq 1 ]]; then
  run_step C1 "opencode tool tests" "${REPO_ROOT}/packages/opencode" "bun run test"
  run_step C2 "opencode typecheck" "${REPO_ROOT}/packages/opencode" "bun run typecheck"
  run_step C3 "VS Code extension unit tests" "${REPO_ROOT}/packages/chipmate-vscode" "bun run test:unit"
  run_step C4 "VS Code extension typecheck" "${REPO_ROOT}/packages/chipmate-vscode" "bun run typecheck"
  run_step C5 "VS Code extension lint" "${REPO_ROOT}/packages/chipmate-vscode" "bun run lint"
  run_step C6 "VS Code extension package build" "${REPO_ROOT}/packages/chipmate-vscode" "bun run package"
fi

if [[ "$run_package" -eq 1 ]]; then
  run_step C7 "VSIX packaging" "${REPO_ROOT}/packages/chipmate-vscode" "bun run package:internal-offline"
fi

if [[ "$prepare_smoke" -eq 1 ]]; then
  write_smoke_checklist
fi

if [[ -n "$inspect_vsix_path" ]]; then
  inspect_vsix "$inspect_vsix_path"
fi

echo
echo "Validation run directory: ${RUN_DIR}"
echo "Status file: ${STATUS_FILE}"
