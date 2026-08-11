#!/usr/bin/env bash
set -euo pipefail

VERSION="0.0.38"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'USAGE'
Usage:
  bash chipmate-feature-migration-offline-target-run-linux.sh <delivery-dir> [evidence-dir]

Runs package/delivery integrity checks on an offline Linux target and writes an
evidence directory. This does not run VS Code installed runtime S1-S16.
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" || $# -lt 1 || $# -gt 2 ]]; then
  usage
  [[ $# -lt 1 || $# -gt 2 ]] && exit 2 || exit 0
fi

DELIVERY_DIR="$(cd "$1" && pwd)"
EVIDENCE_DIR="${2:-"$DELIVERY_DIR/chipmate-${VERSION}-target-package-evidence-linux"}"
mkdir -p "$EVIDENCE_DIR"

BUNDLE="$DELIVERY_DIR/chipmate-${VERSION}-offline-handoff.tar.gz"
RUNNER_STATUS="PASS_PACKAGE_ONLY"

{
  echo "# ChipMate Linux Target Package Evidence Environment"
  echo
  echo "- Date UTC: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo "- Working directory: $(pwd)"
  echo "- Delivery directory: $DELIVERY_DIR"
  echo "- Evidence directory: $EVIDENCE_DIR"
  echo "- uname: $(uname -a)"
  if command -v python3 >/dev/null 2>&1; then
    echo "- python3: $(python3 --version 2>&1)"
  else
    echo "- python3: not available"
  fi
  if command -v shasum >/dev/null 2>&1; then
    echo "- shasum: $(shasum --version 2>&1 | head -n 1)"
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    echo "- sha256sum: $(sha256sum --version 2>&1 | head -n 1)"
  fi
  echo
  echo "## Optional Word render availability"
  if [[ -n "${CHIPMATE_WORD_RENDER_ENDPOINT:-}" ]]; then
    echo "- CHIPMATE_WORD_RENDER_ENDPOINT: configured"
  else
    echo "- CHIPMATE_WORD_RENDER_ENDPOINT: not configured"
  fi
  if [[ -n "${CHIPMATE_WORD_RENDER_SOFFICE:-}" ]]; then
    if [[ -x "${CHIPMATE_WORD_RENDER_SOFFICE}" ]]; then
      echo "- CHIPMATE_WORD_RENDER_SOFFICE: ${CHIPMATE_WORD_RENDER_SOFFICE}"
    else
      echo "- CHIPMATE_WORD_RENDER_SOFFICE: configured but not executable: ${CHIPMATE_WORD_RENDER_SOFFICE}"
    fi
  elif command -v soffice >/dev/null 2>&1; then
    echo "- soffice on PATH: $(command -v soffice)"
  else
    echo "- soffice: not configured and not found on PATH"
  fi
  if [[ -n "${CHIPMATE_WORD_RENDER_PDFTOPPM:-}" ]]; then
    if [[ -x "${CHIPMATE_WORD_RENDER_PDFTOPPM}" ]]; then
      echo "- CHIPMATE_WORD_RENDER_PDFTOPPM: ${CHIPMATE_WORD_RENDER_PDFTOPPM}"
    else
      echo "- CHIPMATE_WORD_RENDER_PDFTOPPM: configured but not executable: ${CHIPMATE_WORD_RENDER_PDFTOPPM}"
    fi
  elif command -v pdftoppm >/dev/null 2>&1; then
    echo "- pdftoppm on PATH: $(command -v pdftoppm)"
  else
    echo "- pdftoppm: not configured and not found on PATH"
  fi
} > "$EVIDENCE_DIR/environment.md"

if command -v python3 >/dev/null 2>&1; then
  python3 "$SCRIPT_DIR/chipmate-feature-migration-offline-delivery-set-verify.py" \
    "$DELIVERY_DIR" \
    --output "$EVIDENCE_DIR/delivery-set-summary.md" \
    > "$EVIDENCE_DIR/delivery-set.stdout.txt" \
    2> "$EVIDENCE_DIR/delivery-set.stderr.txt"

  python3 "$SCRIPT_DIR/chipmate-feature-migration-offline-target-verify.py" \
    "$BUNDLE" \
    "$EVIDENCE_DIR/python-bundle-evidence" \
    > "$EVIDENCE_DIR/python-bundle.stdout.txt" \
    2> "$EVIDENCE_DIR/python-bundle.stderr.txt"
else
  RUNNER_STATUS="BLOCKED_ENV"
  cat > "$EVIDENCE_DIR/python-not-available.md" <<'EOF'
# Python Not Available

- Status: BLOCKED_ENV
- Impact: delivery-set verifier and Python bundle verifier were not run.
- Impact: bash bundle verifier and package-only intake self-check also cannot run because VSIX CLI marker-boundary verification requires Python zip support.
EOF
fi

if command -v python3 >/dev/null 2>&1; then
  bash "$SCRIPT_DIR/chipmate-feature-migration-offline-target-verify-linux.sh" \
    "$BUNDLE" \
    "$EVIDENCE_DIR/bash-bundle-evidence" \
    > "$EVIDENCE_DIR/bash-bundle.stdout.txt" \
    2> "$EVIDENCE_DIR/bash-bundle.stderr.txt"
else
  mkdir -p "$EVIDENCE_DIR/bash-bundle-evidence"
  cat > "$EVIDENCE_DIR/bash-bundle-evidence/summary.md" <<'EOF'
# ChipMate Linux Target Bash Bundle Verification

- Status: BLOCKED_ENV
- Reason: python3 is required for VSIX CLI marker-boundary verification.

This is not a package PASS. Install/runtime smoke must not proceed as accepted until package verification is rerun with Python available or an equivalent marker-boundary verifier is provided.
EOF
fi

if [[ -f "$SCRIPT_DIR/chipmate-feature-migration-target-evidence-return-template.md" ]]; then
  cp "$SCRIPT_DIR/chipmate-feature-migration-target-evidence-return-template.md" \
    "$EVIDENCE_DIR/chipmate-feature-migration-target-evidence-return-template.md"
fi

if [[ -f "$DELIVERY_DIR/CHIPMATE_OFFLINE_DELIVERY_MANIFEST-${VERSION}.json" ]]; then
  cp "$DELIVERY_DIR/CHIPMATE_OFFLINE_DELIVERY_MANIFEST-${VERSION}.json" \
    "$EVIDENCE_DIR/CHIPMATE_OFFLINE_DELIVERY_MANIFEST-${VERSION}.json"
fi
if [[ -f "$DELIVERY_DIR/CHIPMATE_OFFLINE_DELIVERY_MANIFEST-${VERSION}.md" ]]; then
  cp "$DELIVERY_DIR/CHIPMATE_OFFLINE_DELIVERY_MANIFEST-${VERSION}.md" \
    "$EVIDENCE_DIR/CHIPMATE_OFFLINE_DELIVERY_MANIFEST-${VERSION}.md"
fi

if command -v python3 >/dev/null 2>&1 && [[ -f "$SCRIPT_DIR/chipmate-feature-migration-target-runtime-evidence-bootstrap.py" ]]; then
  python3 "$SCRIPT_DIR/chipmate-feature-migration-target-runtime-evidence-bootstrap.py" \
    --target linux-x64 \
    --output-dir "$EVIDENCE_DIR/runtime-evidence-skeleton" \
    > "$EVIDENCE_DIR/runtime-bootstrap.stdout.txt" \
    2> "$EVIDENCE_DIR/runtime-bootstrap.stderr.txt"
elif [[ ! -f "$SCRIPT_DIR/chipmate-feature-migration-target-runtime-evidence-bootstrap.py" ]]; then
  RUNNER_STATUS="BLOCKED_ENV"
  cat > "$EVIDENCE_DIR/runtime-bootstrap-not-available.md" <<'EOF'
# Runtime Evidence Bootstrap Helper Not Available

- Status: BLOCKED_ENV
- Impact: runtime evidence skeleton was not generated.
- Expected file: chipmate-feature-migration-target-runtime-evidence-bootstrap.py
EOF
elif ! command -v python3 >/dev/null 2>&1; then
  cat > "$EVIDENCE_DIR/runtime-bootstrap-not-available.md" <<'EOF'
# Runtime Evidence Bootstrap Helper Not Run

- Status: BLOCKED_ENV
- Impact: runtime evidence skeleton was not generated because python3 is not available.
EOF
fi

if command -v python3 >/dev/null 2>&1 && [[ -f "$SCRIPT_DIR/chipmate-feature-migration-target-evidence-intake-verify.py" ]]; then
  python3 "$SCRIPT_DIR/chipmate-feature-migration-target-evidence-intake-verify.py" \
    --target linux-x64 \
    --package-evidence "$EVIDENCE_DIR/bash-bundle-evidence" \
    --output "$EVIDENCE_DIR/intake-summary.md" \
    --allow-package-only \
    > "$EVIDENCE_DIR/intake.stdout.txt" \
    2> "$EVIDENCE_DIR/intake.stderr.txt"
elif [[ ! -f "$SCRIPT_DIR/chipmate-feature-migration-target-evidence-intake-verify.py" ]]; then
  RUNNER_STATUS="BLOCKED_ENV"
  cat > "$EVIDENCE_DIR/intake-not-available.md" <<'EOF'
# Target Evidence Intake Verifier Not Available

- Status: BLOCKED_ENV
- Impact: package-only intake self-check was not run.
- Expected file: chipmate-feature-migration-target-evidence-intake-verify.py
EOF
elif ! command -v python3 >/dev/null 2>&1; then
  cat > "$EVIDENCE_DIR/intake-not-available.md" <<'EOF'
# Target Evidence Intake Verifier Not Run

- Status: BLOCKED_ENV
- Impact: package-only intake self-check was not run because python3 is not available.
EOF
fi

cat > "$EVIDENCE_DIR/summary.md" <<EOF
# ChipMate Linux Target Package Evidence Runner

- Status: ${RUNNER_STATUS}
- Target kind: offline linux x86-64
- Delivery directory: \`$DELIVERY_DIR\`
- Evidence directory: \`$EVIDENCE_DIR\`
- Environment: \`environment.md\` including optional Word renderer availability
- Delivery-set verifier: \`delivery-set-summary.md\` when Python is available
- Python bundle verifier: \`python-bundle-evidence/summary.md\` when Python is available
- Bash bundle verifier: \`bash-bundle-evidence/summary.md\`
- Package-only intake self-check: \`intake-summary.md\` when Python and intake verifier are available
- Delivery manifest copy: \`CHIPMATE_OFFLINE_DELIVERY_MANIFEST-${VERSION}.json\` when present
- Runtime S1-S16 intake verifier available in kit: \`chipmate-feature-migration-runtime-smoke-intake-verify.py\`
- Runtime evidence skeleton: \`runtime-evidence-skeleton/runtime-smoke.tsv\` when Python and bootstrap helper are available
- Evidence return template: \`chipmate-feature-migration-target-evidence-return-template.md\`
- Evidence return pack helper available in kit: \`chipmate-feature-migration-target-evidence-return-pack.py\`

This runner verifies delivery/package integrity only when its status is \`PASS_PACKAGE_ONLY\`. It does not install VS Code, does not run S1-S16 runtime smoke, and does not prove ChipMate native QA/no-regression acceptance.
EOF

echo "${RUNNER_STATUS}: wrote $EVIDENCE_DIR/summary.md"
