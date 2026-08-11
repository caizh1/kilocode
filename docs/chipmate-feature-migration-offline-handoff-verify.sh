#!/usr/bin/env bash

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUN_STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${VALIDATION_RUN_DIR:-${REPO_ROOT}/docs/chipmate-feature-migration-validation-runs/${RUN_STAMP}-offline-handoff-verify}"
OUT_DIR="${OUT_DIR:-${REPO_ROOT}/packages/chipmate-vscode/out}"
VERSION="${CHIPMATE_OFFLINE_VERSION:-0.0.38}"

SUMS_FILE="${OUT_DIR}/SHA256SUMS-chipmate-${VERSION}-offline.txt"
INDEX_JSON="${OUT_DIR}/OFFLINE_RELEASE_INDEX-chipmate-${VERSION}.json"
INDEX_MD="${OUT_DIR}/OFFLINE_RELEASE_INDEX-chipmate-${VERSION}.md"
NOTES_MD="${OUT_DIR}/OFFLINE_RELEASE_NOTES-chipmate-${VERSION}.md"
BUNDLE_INDEX_JSON="${OUT_DIR}/OFFLINE_BUNDLE_INDEX-chipmate-${VERSION}.json"
BUNDLE_INDEX_MD="${OUT_DIR}/OFFLINE_BUNDLE_INDEX-chipmate-${VERSION}.md"

usage() {
  cat <<'USAGE'
Verify ChipMate offline handoff files for the current Windows/Linux VSIX release.

Usage:
  bash docs/chipmate-feature-migration-offline-handoff-verify.sh

Environment:
  VALIDATION_RUN_DIR          Optional output directory.
  OUT_DIR                     VSIX out directory. Defaults to packages/chipmate-vscode/out.
  CHIPMATE_OFFLINE_VERSION    Offline release version. Defaults to 0.0.38.

Checks:
  - Required handoff files exist.
  - SHA256SUMS verifies current VSIX files.
  - OFFLINE_RELEASE_INDEX JSON parses.
  - Release index target files exist and match declared size/SHA256.
  - Bundle checksum sidecar matches the bundle index SHA256.
  - Bundle tarball contents match the bundle index content list.

This script does not build, package, install, or run chat/runtime smoke.
USAGE
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

mkdir -p "$RUN_DIR"

SUMMARY="${RUN_DIR}/summary.md"
STATUS="${RUN_DIR}/status.tsv"
CHECKSUM_LOG="${RUN_DIR}/checksum.log"
INDEX_LOG="${RUN_DIR}/index-verify.log"

printf 'check\tstatus\tdetail\n' >"$STATUS"

record() {
  local check="$1"
  local status="$2"
  local detail="$3"
  printf '%s\t%s\t%s\n' "$check" "$status" "$detail" >>"$STATUS"
}

overall=0

for required in "$SUMS_FILE" "$INDEX_JSON" "$INDEX_MD" "$NOTES_MD" "$BUNDLE_INDEX_JSON" "$BUNDLE_INDEX_MD"; do
  if [[ -f "$required" ]]; then
    record "exists" "PASS" "$required"
  else
    record "exists" "FAIL" "$required"
    overall=1
  fi
done

if [[ -f "$SUMS_FILE" ]]; then
  (
    cd "$OUT_DIR" && shasum -a 256 -c "$(basename "$SUMS_FILE")"
  ) >"$CHECKSUM_LOG" 2>&1
  rc=$?
  if [[ "$rc" -eq 0 ]]; then
    record "checksum" "PASS" "$CHECKSUM_LOG"
  else
    record "checksum" "FAIL" "$CHECKSUM_LOG"
    overall=1
  fi
else
  echo "missing checksum file: $SUMS_FILE" >"$CHECKSUM_LOG"
fi

if [[ -f "$INDEX_JSON" ]]; then
  python3 - "$INDEX_JSON" "$BUNDLE_INDEX_JSON" "$OUT_DIR" >"$INDEX_LOG" 2>&1 <<'PY'
import collections
import hashlib
import json
import pathlib
import sys
import tarfile

index_path = pathlib.Path(sys.argv[1])
bundle_index_path = pathlib.Path(sys.argv[2])
out_dir = pathlib.Path(sys.argv[3])
data = json.loads(index_path.read_text())

required_top = ["product", "extensionId", "version", "targets", "handoffFiles", "verification", "releaseCaveats"]
missing = [key for key in required_top if key not in data]
if missing:
    raise SystemExit(f"missing top-level keys: {missing}")

for rel in data.get("handoffFiles", []):
    path = out_dir / rel
    if not path.is_file():
        raise SystemExit(f"missing handoff file: {path}")

for target in data.get("targets", []):
    name = target.get("file")
    if not name:
        raise SystemExit(f"target missing file: {target}")
    path = out_dir / name
    if not path.is_file():
        raise SystemExit(f"missing target file: {path}")
    size = path.stat().st_size
    expected_size = int(target.get("sizeBytes", -1))
    if size != expected_size:
        raise SystemExit(f"size mismatch for {name}: got {size}, expected {expected_size}")
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    expected_digest = target.get("sha256")
    if digest != expected_digest:
        raise SystemExit(f"sha256 mismatch for {name}: got {digest}, expected {expected_digest}")
    print(f"{name}: OK size={size} sha256={digest}")

if not bundle_index_path.is_file():
    raise SystemExit(f"missing bundle index: {bundle_index_path}")

bundle_data = json.loads(bundle_index_path.read_text())
bundle = bundle_data.get("bundle")
if not bundle:
    raise SystemExit("bundle index missing bundle field")
name = bundle.get("file")
if not name:
    raise SystemExit(f"bundle missing file: {bundle}")
path = out_dir / name
if not path.is_file():
    raise SystemExit(f"missing bundle file: {path}")
size = path.stat().st_size
expected_size = int(bundle.get("sizeBytes", -1))
if size != expected_size:
    raise SystemExit(f"bundle size mismatch for {name}: got {size}, expected {expected_size}")
digest = hashlib.sha256(path.read_bytes()).hexdigest()
expected_digest = bundle.get("sha256")
if digest != expected_digest:
    raise SystemExit(f"bundle sha256 mismatch for {name}: got {digest}, expected {expected_digest}")
checksum_file = bundle.get("checksumFile")
if checksum_file:
    checksum_path = out_dir / checksum_file
    if not checksum_path.is_file():
        raise SystemExit(f"missing bundle checksum file: {checksum_path}")
    checksum_tokens = checksum_path.read_text().split()
    if not checksum_tokens:
        raise SystemExit(f"empty bundle checksum file: {checksum_path}")
    if checksum_tokens[0] != expected_digest:
        raise SystemExit(
            f"bundle checksum sidecar mismatch for {name}: got {checksum_tokens[0]}, expected {expected_digest}"
        )
    if len(checksum_tokens) > 1 and pathlib.Path(checksum_tokens[-1]).name != name:
        raise SystemExit(
            f"bundle checksum sidecar filename mismatch: got {checksum_tokens[-1]}, expected {name}"
        )

expected_contents = bundle_data.get("contents", [])
for item in expected_contents:
    if not item:
        raise SystemExit("bundle contents contains empty item")
if not expected_contents:
    raise SystemExit("bundle contents list is empty")

with tarfile.open(path, "r:gz") as tar:
    actual_contents = [
        pathlib.PurePosixPath(member.name).name
        for member in tar.getmembers()
        if member.isfile()
    ]
expected_counter = collections.Counter(expected_contents)
actual_counter = collections.Counter(actual_contents)
if actual_counter != expected_counter:
    raise SystemExit(
        "bundle contents mismatch: "
        f"actual={sorted(actual_counter.elements())}, expected={sorted(expected_counter.elements())}"
    )
print(f"{name}: OK size={size} sha256={digest}")
print(f"{checksum_file}: OK sha256={expected_digest}")
print(f"{name}: OK contents={','.join(sorted(expected_contents))}")

print("release index: OK")
PY
  rc=$?
  if [[ "$rc" -eq 0 ]]; then
    record "release-index" "PASS" "$INDEX_LOG"
  else
    record "release-index" "FAIL" "$INDEX_LOG"
    overall=1
  fi
else
  echo "missing release index: $INDEX_JSON" >"$INDEX_LOG"
fi

{
  echo "# Offline handoff verification"
  echo
  echo "This verifies current on-disk offline handoff files. It does not build, package, install, or run chat/runtime smoke."
  echo
  echo "- Out dir: \`${OUT_DIR}\`"
  echo "- Version: \`${VERSION}\`"
  echo "- Exit code: \`${overall}\`"
  echo
  echo "## Status"
  echo
  echo "| Check | Status | Detail |"
  echo "|---|---:|---|"
  tail -n +2 "$STATUS" | while IFS=$'\t' read -r check status detail; do
    echo "| ${check} | ${status} | \`${detail}\` |"
  done
  echo
  echo "## Checksum log"
  echo
  echo '```text'
  cat "$CHECKSUM_LOG"
  echo '```'
  echo
  echo "## Release index verification log"
  echo
  echo '```text'
  cat "$INDEX_LOG"
  echo '```'
} >"$SUMMARY"

echo "RUN_DIR=${RUN_DIR}"
exit "$overall"
