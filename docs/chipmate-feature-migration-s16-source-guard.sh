#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="${VALIDATION_RUN_DIR:-}"
EVIDENCE_DIR=""

usage() {
  cat <<'USAGE'
S16 autocomplete source guard.

This helper is intentionally read-only. It records hashes/metadata for the
protected autocomplete source paths and scans an optional runtime evidence
directory for signs that an S16 smoke used mutating tools or touched protected
paths. It does not run autocomplete, invoke providers, or modify source files.

Usage:
  bash docs/chipmate-feature-migration-s16-source-guard.sh [--run-dir DIR] [--evidence-dir DIR]

Options:
  --run-dir DIR       Output directory. Defaults to a timestamped validation run.
  --evidence-dir DIR  Existing S16 runtime evidence directory to scan.
  --help             Show this message.
USAGE
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --run-dir)
      [[ "$#" -ge 2 ]] || { echo "--run-dir requires a directory" >&2; exit 2; }
      RUN_DIR="$2"
      shift 2
      ;;
    --evidence-dir)
      [[ "$#" -ge 2 ]] || { echo "--evidence-dir requires a directory" >&2; exit 2; }
      EVIDENCE_DIR="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$RUN_DIR" ]]; then
  RUN_DIR="docs/chipmate-feature-migration-validation-runs/$(date +%Y%m%d-%H%M%S)-s16-source-guard"
fi

mkdir -p "$ROOT_DIR/$RUN_DIR"

python3 - "$ROOT_DIR" "$RUN_DIR" "$EVIDENCE_DIR" <<'PY'
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
run_dir_arg = sys.argv[2]
evidence_dir_arg = sys.argv[3] if len(sys.argv) > 3 else ""
run_dir = (root / run_dir_arg).resolve() if not Path(run_dir_arg).is_absolute() else Path(run_dir_arg).resolve()
evidence_dir = None
if evidence_dir_arg:
    evidence_dir = (root / evidence_dir_arg).resolve() if not Path(evidence_dir_arg).is_absolute() else Path(evidence_dir_arg).resolve()

protected_paths = [
    Path("packages/chipmate-vscode/package.json"),
    Path("packages/chipmate-vscode/src/services/qwen-autocomplete/smoke.ts"),
    Path("packages/chipmate-vscode/src/services/qwen-autocomplete/index.ts"),
]
protected_prefixes = [
    "packages/chipmate-vscode/package.json",
    "packages/chipmate-vscode/src/services/qwen-autocomplete",
]
mutating_tools = {"write", "edit", "apply_patch"}
source_markers = (
    "modified source",
    "source modifications",
    "modified source files",
    "changed files",
    "write",
    "edit",
    "apply_patch",
)

run_dir.mkdir(parents=True, exist_ok=True)

snapshots = []
for rel in protected_paths:
    p = root / rel
    if p.exists():
        data = p.read_bytes()
        stat = p.stat()
        snapshots.append({
            "path": rel.as_posix(),
            "exists": "yes",
            "size": str(stat.st_size),
            "mtime": str(int(stat.st_mtime)),
            "sha256": hashlib.sha256(data).hexdigest(),
        })
    else:
        snapshots.append({
            "path": rel.as_posix(),
            "exists": "no",
            "size": "",
            "mtime": "",
            "sha256": "",
        })

(run_dir / "protected-files.tsv").write_text(
    "path\texists\tsize\tmtime\tsha256\n"
    + "".join(
        f"{row['path']}\t{row['exists']}\t{row['size']}\t{row['mtime']}\t{row['sha256']}\n"
        for row in snapshots
    ),
    encoding="utf-8",
)

findings = []
mutating_tool_seen = False
protected_path_seen = False
source_modification_seen = False
scanned_files = []

if evidence_dir and evidence_dir.exists():
    candidates = []
    for pattern in ("*.log", "*.txt", "*.md", "*.json", "*.jsonl"):
        candidates.extend(evidence_dir.glob(pattern))
    for path in sorted(set(candidates)):
        if not path.is_file():
            continue
        scanned_files.append(path)
        try:
            lines = path.read_text(errors="replace").splitlines()
        except OSError as exc:
            findings.append({
                "file": str(path.relative_to(root)) if path.is_relative_to(root) else str(path),
                "line": "",
                "kind": "read_error",
                "detail": str(exc),
            })
            continue
        for lineno, line in enumerate(lines, 1):
            lower = line.lower()
            rel_file = str(path.relative_to(root)) if path.is_relative_to(root) else str(path)
            detected_kind = None
            detected_detail = None
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                obj = None
            if isinstance(obj, dict):
                part = obj.get("part")
                if isinstance(part, dict) and part.get("type") == "tool":
                    tool = str(part.get("tool", ""))
                    if tool in mutating_tools:
                        mutating_tool_seen = True
                        detected_kind = "mutating_tool"
                        detected_detail = f"tool={tool}"
            if any(prefix.lower() in lower for prefix in protected_prefixes):
                protected_path_seen = True
                if detected_kind is None:
                    detected_kind = "protected_path_reference"
                    detected_detail = line.strip()[:240]
            if any(marker in lower for marker in source_markers) and any(prefix.lower() in lower for prefix in protected_prefixes):
                source_modification_seen = True
                detected_kind = "source_modification_marker"
                detected_detail = line.strip()[:240]
            if detected_kind:
                findings.append({
                    "file": rel_file,
                    "line": str(lineno),
                    "kind": detected_kind,
                    "detail": detected_detail or line.strip()[:240],
                })

elif evidence_dir:
    findings.append({
        "file": str(evidence_dir),
        "line": "",
        "kind": "missing_evidence_dir",
        "detail": "evidence directory does not exist",
    })

status = "PASS_WITH_LIMITS"
if any(row["exists"] == "no" for row in snapshots):
    status = "NEEDS_REVIEW"
if mutating_tool_seen or source_modification_seen:
    status = "NEEDS_REVIEW"
if evidence_dir and not evidence_dir.exists():
    status = "NEEDS_REVIEW"

(run_dir / "evidence-scan.tsv").write_text(
    "file\tline\tkind\tdetail\n"
    + "".join(
        f"{item['file']}\t{item['line']}\t{item['kind']}\t{str(item['detail']).replace(chr(9), ' ')}\n"
        for item in findings
    ),
    encoding="utf-8",
)

summary_lines = [
    "# S16 source guard summary",
    "",
    "| Field | Value |",
    "|---|---|",
    f"| Status | {status} |",
    f"| Repository | `{root}` |",
    f"| Runtime evidence scanned | `{str(evidence_dir) if evidence_dir else 'not provided'}` |",
    f"| Evidence files scanned | {len(scanned_files)} |",
    f"| Protected files snapshotted | {len(snapshots)} |",
    f"| Missing protected files | {'yes' if any(row['exists'] == 'no' for row in snapshots) else 'no'} |",
    f"| Mutating tool evidence | {'yes' if mutating_tool_seen else 'no'} |",
    f"| Protected path reference evidence | {'yes' if protected_path_seen else 'no'} |",
    f"| Source modification marker evidence | {'yes' if source_modification_seen else 'no'} |",
    "",
    "## Protected source paths",
    "",
]
for row in snapshots:
    summary_lines.append(f"- `{row['path']}`: `{row['exists']}` sha256 `{row['sha256'] or 'n/a'}`")
summary_lines.extend([
    "",
    "## Interpretation",
    "",
    "- This helper is read-only and is only a guard/evidence helper for S16 autocomplete preservation.",
    "- `PASS_WITH_LIMITS` means the guard did not find source-mutation evidence in the provided evidence directory; it does not prove installed ghost-text UX or real autocomplete quality.",
    "- `NEEDS_REVIEW` means S16 evidence must not be accepted until the listed source-mutation risk is reviewed and resolved.",
    "- This helper does not decide whether existing S16 source changes should be kept or reverted.",
    "",
    "## Findings",
    "",
])
if findings:
    for item in findings[:80]:
        summary_lines.append(f"- `{item['kind']}` at `{item['file']}:{item['line']}`: {item['detail']}")
    if len(findings) > 80:
        summary_lines.append(f"- ... {len(findings) - 80} additional findings omitted from summary; see `evidence-scan.tsv`.")
else:
    summary_lines.append("- No source-mutation findings recorded by this guard.")
summary_lines.append("")

(run_dir / "summary.md").write_text("\n".join(summary_lines), encoding="utf-8")
print(run_dir.relative_to(root) if run_dir.is_relative_to(root) else run_dir)
print(status)
PY
