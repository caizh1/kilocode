#!/usr/bin/env python3
"""
Validate S1-S16 runtime smoke evidence for the ChipMate feature migration.

This verifier is intentionally stricter than the runtime smoke runner:
- NEEDS_REVIEW is not PASS.
- BLOCKED_AUTH, TIMEOUT, ERROR_NEEDS_REVIEW, and FAIL remain blockers.
- Every requested S-id must be present.
- Only explicit PASS for every requested S-id returns final PASS.
- When S16 source-checkout evidence provides a source guard summary, the guard
  must be PASS or PASS_WITH_LIMITS before S16 can be accepted.

The script accepts either runtime-smoke.tsv files produced by
chipmate-feature-migration-runtime-smoke.sh or manually reviewed Markdown/text
evidence that contains S-id plus status tokens.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path


DEFAULT_IDS = [f"S{index}" for index in range(1, 17)]

PASS_STATUS = "PASS"
REVIEW_STATUSES = {
    "NEEDS_REVIEW",
    "PASS_WITH_LIMITS",
    "PASS_WITH_REVIEW",
    "PARTIAL_PACKAGE_ONLY",
}
BLOCKING_STATUSES = {
    "FAIL",
    "ERROR",
    "ERROR_NEEDS_REVIEW",
    "BLOCKED",
    "BLOCKED_AUTH",
    "BLOCKED_ENV",
    "PENDING",
    "PARTIAL",
    "NOT_RUN",
    "TODO",
    "TIMEOUT",
}
ALL_STATUSES = BLOCKING_STATUSES | REVIEW_STATUSES | {PASS_STATUS}
S16_SOURCE_GUARD_PASS_STATUSES = {PASS_STATUS, "PASS_WITH_LIMITS"}


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def split_ids(raw: str | None) -> list[str]:
    if not raw:
        return DEFAULT_IDS
    ids = [part.strip().upper() for part in raw.split(",") if part.strip()]
    invalid = [sid for sid in ids if not re.fullmatch(r"S(?:[1-9]|1[0-6])", sid)]
    if invalid:
        raise SystemExit(f"invalid S-id(s): {', '.join(invalid)}")
    return ids


def normalize_status(raw: str | None) -> str | None:
    if not raw:
        return None
    upper = raw.strip().upper()
    if upper in ALL_STATUSES:
        return upper
    for status in sorted(ALL_STATUSES, key=len, reverse=True):
        if re.search(rf"\b{re.escape(status)}\b", upper):
            return status
    return None


def status_rank(status: str) -> int:
    if status in BLOCKING_STATUSES:
        return 3
    if status in REVIEW_STATUSES:
        return 2
    if status == PASS_STATUS:
        return 1
    return 4


def worst_status(statuses: list[str]) -> str:
    return sorted(statuses, key=status_rank, reverse=True)[0]


def read_summary_status(path: Path) -> str | None:
    try:
        text = read_text(path)
    except OSError:
        return None
    match = re.search(r"(?im)^\|\s*Status\s*\|\s*`?([^|`]+)`?\s*\|", text)
    if match:
        return normalize_status(match.group(1))
    match = re.search(r"(?im)^\s*[-*]?\s*Status\s*:\s*`?([A-Z0-9_]+)`?\s*$", text)
    if match:
        return normalize_status(match.group(1))
    return None


def discover_s16_source_guard_summary(directory: Path) -> Path | None:
    direct = directory / "s16-source-guard-summary.md"
    if direct.is_file():
        return direct
    candidates: list[Path] = []
    candidates.extend(path for path in directory.rglob("s16-source-guard-summary.md") if path.is_file())
    candidates.extend(
        path
        for path in directory.rglob("summary.md")
        if path.is_file() and "s16-source-guard" in str(path.parent).lower()
    )
    if not candidates:
        return None
    return sorted(candidates)[0]


def evaluate_s16_source_guard(
    directory: Path,
    explicit_summary: Path | None,
    require_guard: bool,
) -> tuple[str | None, list[str]]:
    summary = explicit_summary or discover_s16_source_guard_summary(directory)
    if summary is None:
        if require_guard:
            return "FAIL", ["S16 source guard: missing required summary"]
        return None, ["S16 source guard: not provided; not required for this evidence set"]
    if not summary.is_file():
        return "FAIL", [f"S16 source guard: summary not found: {summary}"]
    status = read_summary_status(summary)
    if status in S16_SOURCE_GUARD_PASS_STATUSES:
        return None, [f"S16 source guard: {status} ({summary})"]
    if status == "NEEDS_REVIEW":
        return "PARTIAL_NEEDS_REVIEW", [f"S16 source guard: NEEDS_REVIEW ({summary})"]
    return "FAIL", [f"S16 source guard: {status or 'missing status'} ({summary})"]


def collect_from_tsv(directory: Path) -> dict[str, list[str]]:
    collected: dict[str, list[str]] = {}
    for path in sorted(directory.rglob("runtime-smoke.tsv")):
        try:
            with path.open("r", encoding="utf-8", errors="replace", newline="") as handle:
                reader = csv.DictReader(handle, delimiter="\t")
                for row in reader:
                    sid = (row.get("id") or "").strip().upper()
                    status = normalize_status(row.get("status"))
                    if re.fullmatch(r"S(?:[1-9]|1[0-6])", sid) and status:
                        collected.setdefault(sid, []).append(status)
        except OSError:
            continue
    return collected


def collect_from_text(directory: Path) -> dict[str, list[str]]:
    collected: dict[str, list[str]] = {}
    for path in sorted(directory.rglob("*")):
        if not path.is_file():
            continue
        if path.suffix.lower() not in {".md", ".txt", ".log", ".json", ".tsv"}:
            continue
        try:
            text = read_text(path)
        except OSError:
            continue
        for line in text.splitlines():
            id_match = re.search(r"\b(S(?:[1-9]|1[0-6]))\b", line, re.IGNORECASE)
            if not id_match:
                continue
            status = normalize_status(line)
            if status:
                collected.setdefault(id_match.group(1).upper(), []).append(status)
    return collected


def merge_statuses(primary: dict[str, list[str]], fallback: dict[str, list[str]]) -> dict[str, list[str]]:
    merged = {sid: list(statuses) for sid, statuses in fallback.items()}
    for sid, statuses in primary.items():
        merged[sid] = list(statuses)
    return merged


def evaluate(
    directory: Path,
    ids: list[str],
    s16_source_guard_summary: Path | None,
    require_s16_source_guard: bool,
) -> tuple[str, list[str]]:
    tsv_statuses = collect_from_tsv(directory)
    text_statuses = collect_from_text(directory)
    statuses = merge_statuses(tsv_statuses, text_statuses)

    checks: list[str] = []
    final_by_id: dict[str, str] = {}
    for sid in ids:
        seen = statuses.get(sid, [])
        if not seen:
            final_by_id[sid] = "PENDING"
            checks.append(f"{sid}: missing status")
            continue
        current = worst_status(seen)
        final_by_id[sid] = current
        if current == PASS_STATUS:
            checks.append(f"{sid}: PASS")
        else:
            checks.append(f"{sid}: {current}")

    guard_final: str | None = None
    if "S16" in ids:
        guard_final, guard_checks = evaluate_s16_source_guard(
            directory,
            s16_source_guard_summary,
            require_s16_source_guard,
        )
        checks.extend(guard_checks)

    values = list(final_by_id.values())
    if all(value == PASS_STATUS for value in values):
        final = PASS_STATUS
    elif any(value == "BLOCKED_AUTH" for value in values):
        final = "BLOCKED_AUTH"
    elif any(value == "TIMEOUT" for value in values):
        final = "TIMEOUT"
    elif any(value in {"FAIL", "ERROR", "ERROR_NEEDS_REVIEW", "BLOCKED", "BLOCKED_ENV"} for value in values):
        final = "FAIL"
    elif any(value == "NEEDS_REVIEW" for value in values):
        final = "PARTIAL_NEEDS_REVIEW"
    else:
        final = "PARTIAL"

    if guard_final == "FAIL":
        return "FAIL", checks
    if guard_final == "PARTIAL_NEEDS_REVIEW" and final == PASS_STATUS:
        return "PARTIAL_NEEDS_REVIEW", checks
    return final, checks


def write_summary(output: Path, evidence_dir: Path, ids: list[str], final: str, checks: list[str]) -> None:
    lines = [
        "# Runtime Smoke Intake Verify",
        "",
        f"- Evidence directory: `{evidence_dir}`",
        f"- Requested IDs: `{','.join(ids)}`",
        f"- Final status: `{final}`",
        "",
        "## Checks",
        "",
    ]
    lines.extend(f"- {item}" for item in checks)
    lines.extend(
        [
            "",
            "## Boundary",
            "",
            "This verifier is a guardrail for S1-S16 runtime evidence. It does not execute the runtime smoke itself and does not replace manual M11 review. NEEDS_REVIEW remains incomplete until answer quality, tool sequence, and artifact outputs are manually accepted and recorded as PASS.",
            "When S16 is included, a provided source guard summary must be PASS or PASS_WITH_LIMITS. Use --require-s16-source-guard for source-checkout S16 evidence; keep it off for target-machine installed VSIX evidence that has no source checkout.",
            "",
        ]
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime-evidence", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--ids", help="Comma-separated S-id list. Defaults to S1-S16.")
    parser.add_argument("--s16-source-guard-summary", type=Path, help="Optional S16 source guard summary.md to gate source-checkout autocomplete evidence.")
    parser.add_argument("--require-s16-source-guard", action="store_true", help="Require a PASS/PASS_WITH_LIMITS S16 source guard when S16 is requested.")
    parser.add_argument("--allow-incomplete", action="store_true", help="Return 0 for non-PASS statuses after writing the summary.")
    args = parser.parse_args()

    ids = split_ids(args.ids)
    if not args.runtime_evidence.is_dir():
        write_summary(args.output, args.runtime_evidence, ids, "FAIL", [f"runtime evidence directory not found: {args.runtime_evidence}"])
        return 0 if args.allow_incomplete else 1

    final, checks = evaluate(
        args.runtime_evidence,
        ids,
        args.s16_source_guard_summary,
        args.require_s16_source_guard,
    )
    write_summary(args.output, args.runtime_evidence, ids, final, checks)
    if final == PASS_STATUS:
        return 0
    return 0 if args.allow_incomplete else 1


if __name__ == "__main__":
    sys.exit(main())
