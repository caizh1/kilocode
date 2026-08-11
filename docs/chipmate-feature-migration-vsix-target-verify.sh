#!/usr/bin/env bash

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUN_STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${VALIDATION_RUN_DIR:-${REPO_ROOT}/docs/chipmate-feature-migration-validation-runs/${RUN_STAMP}-vsix-target-verify}"
OUT_DIR="${OUT_DIR:-${REPO_ROOT}/packages/chipmate-vscode/out}"
VERSION="${CHIPMATE_OFFLINE_VERSION:-0.0.38}"

LINUX_VSIX="${LINUX_VSIX:-${OUT_DIR}/chipmate-vscode-linux-x64-baseline.vsix}"
WIN32_VSIX="${WIN32_VSIX:-${OUT_DIR}/chipmate-vscode-win32-x64-baseline.vsix}"

usage() {
  cat <<'USAGE'
Verify ChipMate offline Windows/Linux VSIX target package identity and contents.

Usage:
  bash docs/chipmate-feature-migration-vsix-target-verify.sh

Environment:
  VALIDATION_RUN_DIR          Optional output directory.
  OUT_DIR                     VSIX out directory. Defaults to packages/chipmate-vscode/out.
  CHIPMATE_OFFLINE_VERSION    Expected extension version. Defaults to 0.0.38.
  LINUX_VSIX                  Optional Linux target VSIX path.
  WIN32_VSIX                  Optional Windows target VSIX path.

Checks:
  - Both target VSIX files exist.
  - extension/package.json keeps ChipMate identity and expected version.
  - Each target contains its expected CLI binary and LanceDB native module.
  - Windows target contains bundled rg.exe and Poppler pdftotext.exe.
  - Targets do not contain obvious opposite-platform CLI/native-module files.
  - Targets do not contain macOS AppleDouble, .DS_Store, or __MACOSX noise.
  - Target CLI binaries contain migrated built-in skill markers.
  - Target CLI binaries do not contain old ChipMate document-contract repair markers.

This script does not build, package, install, launch VS Code, or run chat/runtime smoke.
USAGE
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

mkdir -p "$RUN_DIR"

SUMMARY="${RUN_DIR}/summary.md"
STATUS="${RUN_DIR}/status.tsv"
DETAIL_JSON="${RUN_DIR}/details.json"

python3 - "$LINUX_VSIX" "$WIN32_VSIX" "$VERSION" "$DETAIL_JSON" "$STATUS" >"${RUN_DIR}/verify.log" 2>&1 <<'PY'
import json
import pathlib
import sys
import zipfile

linux_vsix = pathlib.Path(sys.argv[1])
win32_vsix = pathlib.Path(sys.argv[2])
expected_version = sys.argv[3]
detail_json = pathlib.Path(sys.argv[4])
status_tsv = pathlib.Path(sys.argv[5])

TARGETS = [
    {
        "id": "linux-x64",
        "path": linux_vsix,
        "cli": "extension/bin/chipmate",
        "required": [
            "extension/package.json",
            "extension/dist/extension.js",
            "extension/bin/chipmate",
            "extension/bin/codegraph-parser-worker.mjs",
            "extension/bin/lancedb/node_modules/@lancedb/lancedb-linux-x64-gnu/lancedb.linux-x64-gnu.node",
        ],
        "forbidden": [
            "extension/bin/chipmate.exe",
            "extension/bin/lancedb/node_modules/@lancedb/lancedb-win32-x64-msvc/lancedb.win32-x64-msvc.node",
            "extension/bin/lancedb/node_modules/@lancedb/lancedb-darwin-arm64/lancedb.darwin-arm64.node",
            "extension/bin/lancedb/node_modules/@lancedb/lancedb-darwin-x64/lancedb.darwin-x64.node",
        ],
    },
    {
        "id": "win32-x64",
        "path": win32_vsix,
        "cli": "extension/bin/chipmate.exe",
        "required": [
            "extension/package.json",
            "extension/dist/extension.js",
            "extension/bin/chipmate.exe",
            "extension/bin/codegraph-parser-worker.mjs",
            "extension/bin/rg.exe",
            "extension/bin/poppler/pdftotext.exe",
            "extension/bin/lancedb/node_modules/@lancedb/lancedb-win32-x64-msvc/lancedb.win32-x64-msvc.node",
        ],
        "forbidden": [
            "extension/bin/chipmate",
            "extension/bin/lancedb/node_modules/@lancedb/lancedb-linux-x64-gnu/lancedb.linux-x64-gnu.node",
            "extension/bin/lancedb/node_modules/@lancedb/lancedb-darwin-arm64/lancedb.darwin-arm64.node",
            "extension/bin/lancedb/node_modules/@lancedb/lancedb-darwin-x64/lancedb.darwin-x64.node",
        ],
    },
]

REQUIRED_CLI_MARKERS = [
    ("source-backed-detail-design", b"source-backed-detail-design"),
    ("generic Word/Mermaid/artifact guidance", b"generic Word/Mermaid/artifact guidance"),
    ("not a migrated Word/document contract", b"not a migrated Word/document contract"),
]

FORBIDDEN_CLI_MARKERS = [
    ("validate_artifacts", b"validate_artifacts"),
    ("nextToolContract", b"nextToolContract"),
    ("missingDeliverable", b"missingDeliverable"),
    ("missing-required-artifact", b"missing-required-artifact"),
    ("missing-mermaid-pngs", b"missing-mermaid-pngs"),
    ("先渲染缺失图表", "先渲染缺失图表".encode()),
    ("缺失文档合同规划", "缺失文档合同规划".encode()),
]

def noisy(name: str) -> bool:
    parts = pathlib.PurePosixPath(name).parts
    return (
        "__MACOSX" in parts
        or ".DS_Store" in parts
        or any(part.startswith("._") for part in parts)
    )

def inspect(target: dict) -> dict:
    result = {
        "target": target["id"],
        "path": str(target["path"]),
        "status": "PASS",
        "checks": [],
    }

    def add(check: str, status: str, detail: str):
        result["checks"].append({"check": check, "status": status, "detail": detail})
        if status == "FAIL":
            result["status"] = "FAIL"

    path = target["path"]
    if not path.is_file():
        add("exists", "FAIL", str(path))
        return result
    add("exists", "PASS", str(path))
    add("size", "PASS", str(path.stat().st_size))

    try:
        with zipfile.ZipFile(path) as zf:
            names = set(zf.namelist())
            pkg = json.loads(zf.read("extension/package.json").decode("utf-8"))
    except Exception as exc:
        add("zip-open", "FAIL", repr(exc))
        return result

    add("zip-open", "PASS", f"{len(names)} entries")

    expected_identity = {
        "publisher": "chipmate",
        "name": "chipmate",
        "version": expected_version,
    }
    for key, expected in expected_identity.items():
        actual = pkg.get(key)
        add(f"manifest-{key}", "PASS" if actual == expected else "FAIL", f"actual={actual!r} expected={expected!r}")

    actual_engine = (pkg.get("engines") or {}).get("vscode")
    add("manifest-engines.vscode", "PASS" if actual_engine == "^1.93.0" else "FAIL", f"actual={actual_engine!r}")
    add("manifest-main", "PASS" if pkg.get("main") == "./dist/extension.js" else "FAIL", f"actual={pkg.get('main')!r}")
    add("manifest-extension-id", "PASS", f"{pkg.get('publisher')}.{pkg.get('name')}")

    for required in target["required"]:
        add(f"required:{required}", "PASS" if required in names else "FAIL", required)
    for forbidden in target["forbidden"]:
        add(f"forbidden:{forbidden}", "PASS" if forbidden not in names else "FAIL", forbidden)

    cli_member = target["cli"]
    try:
        with zipfile.ZipFile(path) as zf:
            cli_data = zf.read(cli_member)
        add("cli-marker-read", "PASS", cli_member)
    except Exception as exc:
        add("cli-marker-read", "FAIL", f"{cli_member}: {exc!r}")
        cli_data = b""

    for label, marker in REQUIRED_CLI_MARKERS:
        add(f"cli-required-marker:{label}", "PASS" if marker in cli_data else "FAIL", label)
    for label, marker in FORBIDDEN_CLI_MARKERS:
        add(f"cli-forbidden-marker:{label}", "PASS" if marker not in cli_data else "FAIL", label)

    noise = sorted(name for name in names if noisy(name))
    add("macos-noise", "PASS" if not noise else "FAIL", "none" if not noise else ", ".join(noise[:20]))

    return result

results = [inspect(target) for target in TARGETS]
overall = "PASS" if all(result["status"] == "PASS" for result in results) else "FAIL"
detail_json.write_text(json.dumps({"overall": overall, "targets": results}, indent=2) + "\n", encoding="utf-8")

with status_tsv.open("w", encoding="utf-8") as status:
    status.write("target\tcheck\tstatus\tdetail\n")
    for result in results:
        for check in result["checks"]:
            status.write(f"{result['target']}\t{check['check']}\t{check['status']}\t{check['detail']}\n")

print(f"overall={overall}")
for result in results:
    print(f"{result['target']}={result['status']}")

raise SystemExit(0 if overall == "PASS" else 1)
PY
rc=$?

{
  echo "# VSIX target package verification"
  echo
  echo "This verifies current Windows/Linux VSIX package identity and target-specific contents. It does not build, install, launch VS Code, or run chat/runtime smoke."
  echo
  echo "- Linux VSIX: \`${LINUX_VSIX}\`"
  echo "- Windows VSIX: \`${WIN32_VSIX}\`"
  echo "- Expected version: \`${VERSION}\`"
  echo "- Exit code: \`${rc}\`"
  echo "- Detail JSON: \`${DETAIL_JSON}\`"
  echo
  echo "## Status"
  echo
  echo "| Target | Check | Status | Detail |"
  echo "|---|---|---:|---|"
  tail -n +2 "$STATUS" | while IFS=$'\t' read -r target check status detail; do
    escaped_detail="${detail//|/\\|}"
    echo "| ${target} | ${check} | ${status} | \`${escaped_detail}\` |"
  done
  echo
  echo "## Log"
  echo
  echo '```text'
  cat "${RUN_DIR}/verify.log"
  echo '```'
} >"$SUMMARY"

echo "RUN_DIR=${RUN_DIR}"
exit "$rc"
