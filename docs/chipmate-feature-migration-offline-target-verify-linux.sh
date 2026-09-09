#!/usr/bin/env bash
set -euo pipefail

EXPECTED_VERSION="0.0.38"
EXPECTED_BUNDLE_SHA="97a70108ae648a1998168d679c3c65638ea7756926860fad113cd06c31d2dba5"
EXPECTED_BUNDLE_SIZE="317784738"
EXPECTED_LINUX_VSIX="chipmate-vscode-linux-x64-baseline.vsix"
EXPECTED_LINUX_SHA="95218162b0d0a09c6425c80a10e9745569c1b021edd9d666a5f43278d31458ad"
EXPECTED_WINDOWS_VSIX="chipmate-vscode-win32-x64-baseline.vsix"
EXPECTED_WINDOWS_SHA="3c6b9943ecf8259379c6f75b1ff321bb83677c092aac3974584524fcd90e489d"

usage() {
  cat <<'USAGE'
Usage:
  bash docs/chipmate-feature-migration-offline-target-verify-linux.sh <handoff.tar.gz> [evidence-dir]

This target-machine verifier is intended for offline Linux x86-64 validation.
It verifies the transfer bundle SHA256/size, exact tar contents, target VSIX
SHA256 values, and writes a summary.md evidence file.
USAGE
}

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

sha256_file() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  else
    fail "sha256sum or shasum is required"
  fi
}

file_size() {
  local file="$1"
  if stat -c%s "$file" >/dev/null 2>&1; then
    stat -c%s "$file"
  else
    stat -f%z "$file"
  fi
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" || $# -lt 1 || $# -gt 2 ]]; then
  usage
  [[ $# -lt 1 || $# -gt 2 ]] && exit 2 || exit 0
fi

BUNDLE_PATH="$1"
[[ -f "$BUNDLE_PATH" ]] || fail "bundle not found: $BUNDLE_PATH"

EVIDENCE_DIR="${2:-chipmate-${EXPECTED_VERSION}-offline-target-linux-evidence}"
mkdir -p "$EVIDENCE_DIR"

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/chipmate-target-verify.XXXXXX")"
cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

BUNDLE_SHA="$(sha256_file "$BUNDLE_PATH")"
BUNDLE_SIZE="$(file_size "$BUNDLE_PATH")"

[[ "$BUNDLE_SHA" == "$EXPECTED_BUNDLE_SHA" ]] || fail "bundle sha mismatch: expected $EXPECTED_BUNDLE_SHA got $BUNDLE_SHA"
[[ "$BUNDLE_SIZE" == "$EXPECTED_BUNDLE_SIZE" ]] || fail "bundle size mismatch: expected $EXPECTED_BUNDLE_SIZE got $BUNDLE_SIZE"

tar -tzf "$BUNDLE_PATH" | LC_ALL=C sort > "$EVIDENCE_DIR/tar-contents.actual.txt"
cat > "$EVIDENCE_DIR/tar-contents.expected.txt" <<EOF
OFFLINE_RELEASE_INDEX-chipmate-${EXPECTED_VERSION}.json
OFFLINE_RELEASE_INDEX-chipmate-${EXPECTED_VERSION}.md
OFFLINE_RELEASE_NOTES-chipmate-${EXPECTED_VERSION}.md
SHA256SUMS-chipmate-${EXPECTED_VERSION}-offline.txt
${EXPECTED_LINUX_VSIX}
${EXPECTED_WINDOWS_VSIX}
EOF
LC_ALL=C sort "$EVIDENCE_DIR/tar-contents.expected.txt" -o "$EVIDENCE_DIR/tar-contents.expected.txt"
diff -u "$EVIDENCE_DIR/tar-contents.expected.txt" "$EVIDENCE_DIR/tar-contents.actual.txt" > "$EVIDENCE_DIR/tar-contents.diff.txt" || fail "tar contents differ; see $EVIDENCE_DIR/tar-contents.diff.txt"

if grep -E '(^|/)(\._|\.DS_Store|__MACOSX)(/|$)' "$EVIDENCE_DIR/tar-contents.actual.txt" >/dev/null 2>&1; then
  fail "macOS metadata found in tar contents"
fi

tar -xzf "$BUNDLE_PATH" -C "$WORK_DIR"

LINUX_SHA="$(sha256_file "$WORK_DIR/$EXPECTED_LINUX_VSIX")"
WINDOWS_SHA="$(sha256_file "$WORK_DIR/$EXPECTED_WINDOWS_VSIX")"
[[ "$LINUX_SHA" == "$EXPECTED_LINUX_SHA" ]] || fail "linux vsix sha mismatch: expected $EXPECTED_LINUX_SHA got $LINUX_SHA"
[[ "$WINDOWS_SHA" == "$EXPECTED_WINDOWS_SHA" ]] || fail "windows vsix sha mismatch: expected $EXPECTED_WINDOWS_SHA got $WINDOWS_SHA"

if ! command -v python3 >/dev/null 2>&1; then
  fail "python3 is required for VSIX CLI marker boundary verification"
fi

python3 - "$WORK_DIR/$EXPECTED_LINUX_VSIX" "$WORK_DIR/$EXPECTED_WINDOWS_VSIX" > "$EVIDENCE_DIR/vsix-marker-verify.log" <<'PY'
import pathlib
import sys
import zipfile

required = [
    ("source-backed-detail-design", b"source-backed-detail-design"),
    ("generic Word/Mermaid/artifact guidance", b"generic Word/Mermaid/artifact guidance"),
    ("not a migrated Word/document contract", b"not a migrated Word/document contract"),
]
forbidden = [
    ("validate_artifacts", b"validate_artifacts"),
    ("nextToolContract", b"nextToolContract"),
    ("missingDeliverable", b"missingDeliverable"),
    ("missing-required-artifact", b"missing-required-artifact"),
    ("missing-mermaid-pngs", b"missing-mermaid-pngs"),
    ("先渲染缺失图表", "先渲染缺失图表".encode()),
    ("缺失文档合同规划", "缺失文档合同规划".encode()),
]

def verify(path: pathlib.Path, member: str, label: str) -> None:
    with zipfile.ZipFile(path) as zf:
        data = zf.read(member)
    for name, marker in required:
        if marker not in data:
            raise SystemExit(f"{label}: missing required CLI marker: {name}")
    for name, marker in forbidden:
        if marker in data:
            raise SystemExit(f"{label}: forbidden old ChipMate contract marker present: {name}")
    print(f"{label}: CLI marker boundary OK")

verify(pathlib.Path(sys.argv[1]), "extension/bin/chipmate", "linux")
verify(pathlib.Path(sys.argv[2]), "extension/bin/chipmate.exe", "windows")
PY

grep -F "\"version\": \"${EXPECTED_VERSION}\"" "$WORK_DIR/OFFLINE_RELEASE_INDEX-chipmate-${EXPECTED_VERSION}.json" >/dev/null 2>&1 || fail "release index json does not contain expected version"
grep -F "$EXPECTED_LINUX_SHA" "$WORK_DIR/SHA256SUMS-chipmate-${EXPECTED_VERSION}-offline.txt" >/dev/null 2>&1 || fail "sha256 sums file missing linux vsix hash"
grep -F "$EXPECTED_WINDOWS_SHA" "$WORK_DIR/SHA256SUMS-chipmate-${EXPECTED_VERSION}-offline.txt" >/dev/null 2>&1 || fail "sha256 sums file missing windows vsix hash"

cat > "$EVIDENCE_DIR/summary.md" <<EOF
# ChipMate Offline Target Linux Verification

- Status: PASS
- Target kind: offline linux x86-64
- Bundle: \`$BUNDLE_PATH\`
- Bundle SHA256: \`$BUNDLE_SHA\`
- Bundle size: \`$BUNDLE_SIZE\`
- Version: \`${EXPECTED_VERSION}\`
- Linux VSIX SHA256: \`$LINUX_SHA\`
- Windows VSIX SHA256: \`$WINDOWS_SHA\`
- VSIX CLI marker boundary: \`vsix-marker-verify.log\`
- Tar contents evidence: \`tar-contents.actual.txt\`
- Tar contents diff: \`tar-contents.diff.txt\`

This verifies transfer/package integrity only. It does not prove installed VS Code chat QA, Document RAG, autocomplete, Word, Mermaid, or source-backed detail-design runtime behavior.
EOF

echo "PASS: wrote $EVIDENCE_DIR/summary.md"
