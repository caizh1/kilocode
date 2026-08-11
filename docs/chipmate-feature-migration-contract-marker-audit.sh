#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUN_STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${VALIDATION_RUN_DIR:-${REPO_ROOT}/docs/chipmate-feature-migration-validation-runs/${RUN_STAMP}-contract-marker-current-source-audit}"

mkdir -p "${RUN_DIR}"

MATCHES="${RUN_DIR}/forbidden-marker-matches.txt"
: >"${MATCHES}"

PATTERNS=(
  "nextToolContract"
  "missingDeliverable"
  "validate_artifacts"
  "missing-required-artifact"
  "missing-mermaid-pngs"
  "建议先渲染缺失图表"
  "缺失文档合同规划"
  "missing-diagram auto-repair"
  "missing diagram auto-repair"
  "missing-document contract planning"
  "missing document contract planning"
  "document-contract planning"
  "auto-render missing diagrams"
  "render missing diagrams first"
  "suggest render missing diagrams"
)

CANDIDATE_PATHS=(
  "${REPO_ROOT}/packages/opencode/src"
  "${REPO_ROOT}/packages/chipmate-vscode/src"
  "${REPO_ROOT}/packages/chipmate-vscode/webview-ui/src"
  "${REPO_ROOT}/packages/chipmate-vscode/package.json"
  "${REPO_ROOT}/.chipmate/skills"
  "${REPO_ROOT}/packages/opencode/.chipmate/skills"
)

CHECK_PATHS=()
for candidate in "${CANDIDATE_PATHS[@]}"; do
  if [[ -e "${candidate}" ]]; then
    CHECK_PATHS+=("${candidate}")
  fi
done

if [[ "${#CHECK_PATHS[@]}" -eq 0 ]]; then
  echo "No source paths available for marker audit." >&2
  exit 2
fi

found=0
for pattern in "${PATTERNS[@]}"; do
  set +e
  rg -n --fixed-strings --color never -- "${pattern}" "${CHECK_PATHS[@]}" >>"${MATCHES}" 2>>"${RUN_DIR}/rg-errors.log"
  rc=$?
  set -e
  if [[ "${rc}" -eq 0 ]]; then
    found=1
  elif [[ "${rc}" -eq 1 ]]; then
    true
  else
    echo "rg failed while searching for ${pattern}; see rg-errors.log" >&2
    exit "${rc}"
  fi
done

STATUS="PASS"
if [[ "${found}" -ne 0 ]]; then
  STATUS="FAIL"
fi

{
  echo "# Contract Marker Current Source Audit"
  echo
  echo "- Status: \`${STATUS}\`"
  echo "- Scope: product source, VS Code source/webview, package contribution manifest, and local skill directories when present."
  echo "- Excluded: docs, validation runs, historical evidence, generated VSIX archives."
  echo "- Matches file: \`forbidden-marker-matches.txt\`"
  echo
  echo "## Checked paths"
  echo
  for path in "${CHECK_PATHS[@]}"; do
    printf -- "- \`%s\`\n" "${path#${REPO_ROOT}/}"
  done
  echo
  echo "## Forbidden markers"
  echo
  for pattern in "${PATTERNS[@]}"; do
    printf -- "- \`%s\`\n" "${pattern}"
  done
  echo
  if [[ "${found}" -eq 0 ]]; then
    echo "No forbidden ChipMate contract/repair/gating markers were found in the checked current source or skill paths."
  else
    echo "Forbidden markers were found:"
    echo
    echo '```text'
    cat "${MATCHES}"
    echo '```'
  fi
  echo
  echo "This audit checks current source/skill surfaces only. Separate VSIX/binary marker audits and installed runtime smoke remain independent evidence."
} >"${RUN_DIR}/summary.md"

cat "${RUN_DIR}/summary.md"

if [[ "${found}" -ne 0 ]]; then
  exit 1
fi
