#!/usr/bin/env bash

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUN_STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${VALIDATION_RUN_DIR:-${REPO_ROOT}/docs/chipmate-feature-migration-validation-runs/${RUN_STAMP}-runtime-smoke}"

MODE=""
IDS=""

usage() {
  cat <<'USAGE'
ChipMate feature migration runtime smoke runner.

This runner captures auth/provider preflight and ChipMate CLI runtime smoke logs for
the S1-S16 acceptance matrix. It is conservative by design: a successful
process exit is recorded as NEEDS_REVIEW, not PASS, because the answer quality,
tool sequence, and artifact outputs still need human review before M10/M11 can
be checked off.

Usage:
  bash docs/chipmate-feature-migration-runtime-smoke.sh --preflight
  bash docs/chipmate-feature-migration-runtime-smoke.sh --run-qa
  bash docs/chipmate-feature-migration-runtime-smoke.sh --run-all
  bash docs/chipmate-feature-migration-runtime-smoke.sh --ids S1,S2,S3

Options:
  --preflight  Run a minimal chat preflight only.
  --run-qa     Run S1-S3.
  --run-all    Run S1-S16.
  --ids LIST   Run comma-separated IDs, for example S1,S5,S13.
  --help       Show this message.

Environment:
  VALIDATION_RUN_DIR             Output directory.
  CHIPMATE_SMOKE_TIMEOUT             Per-prompt timeout seconds, default 180.
  CHIPMATE_SMOKE_QA_WORKSPACE        Workspace for embedded C QA prompts,
                                 default /Users/archer/Work/qemu.
  CHIPMATE_SMOKE_DOC_WORKSPACE       Workspace for document/artifact prompts,
                                 default repository root.
  CHIPMATE_SMOKE_CONFIG_CONTENT      Full JSON config for this smoke run.
  CHIPMATE_SMOKE_PROVIDER_ID         One-shot provider id, default smoke.
  CHIPMATE_SMOKE_PROVIDER_BASE_URL   One-shot OpenAI-compatible base URL.
  CHIPMATE_SMOKE_PROVIDER_API_KEY    One-shot OpenAI-compatible API key.
  CHIPMATE_SMOKE_PROVIDER_MODEL      One-shot model id.

Notes:
  - This script does not modify global or project config.
  - Secret-looking environment values are redacted from captured logs.
  - Use CHIPMATE_SMOKE_CONFIG_CONTENT or the CHIPMATE_SMOKE_PROVIDER_* variables to
    avoid depending on the current user's global model/auth state.
USAGE
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --preflight)
      MODE="preflight"
      shift
      ;;
    --run-qa)
      MODE="ids"
      IDS="S1,S2,S3"
      shift
      ;;
    --run-all)
      MODE="ids"
      IDS="S1,S2,S3,S4,S5,S6,S7,S8,S9,S10,S11,S12,S13,S14,S15,S16"
      shift
      ;;
    --ids)
      if [[ "$#" -lt 2 ]]; then
        echo "--ids requires a comma-separated list" >&2
        exit 2
      fi
      MODE="ids"
      IDS="$2"
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

if [[ -z "$MODE" ]]; then
  usage
  exit 0
fi

mkdir -p "$RUN_DIR"

python3 - "$REPO_ROOT" "$RUN_DIR" "$MODE" "$IDS" <<'PY'
from __future__ import annotations

import json
import hashlib
import os
import pathlib
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass

repo = pathlib.Path(sys.argv[1])
run_dir = pathlib.Path(sys.argv[2])
mode = sys.argv[3]
ids_arg = sys.argv[4]

timeout = int(os.environ.get("CHIPMATE_SMOKE_TIMEOUT", "180"))
qa_workspace = os.environ.get("CHIPMATE_SMOKE_QA_WORKSPACE", "/Users/archer/Work/qemu")
doc_workspace = os.environ.get("CHIPMATE_SMOKE_DOC_WORKSPACE", str(repo))
provider_id = os.environ.get("CHIPMATE_SMOKE_PROVIDER_ID", "smoke")
provider_base_url = os.environ.get("CHIPMATE_SMOKE_PROVIDER_BASE_URL", "")
provider_api_key = os.environ.get("CHIPMATE_SMOKE_PROVIDER_API_KEY", "")
provider_model = os.environ.get("CHIPMATE_SMOKE_PROVIDER_MODEL", "")
template_docx = os.environ.get("CHIPMATE_SMOKE_TEMPLATE_DOCX", "")
config_content = os.environ.get("CHIPMATE_SMOKE_CONFIG_CONTENT", "")

def one_shot_config() -> str | None:
    if config_content.strip():
        return config_content
    if provider_base_url and provider_api_key and provider_model:
        cfg = {
            "enabled_providers": [provider_id],
            "model": f"{provider_id}/{provider_model}",
            "small_model": f"{provider_id}/{provider_model}",
            "subagent_model": f"{provider_id}/{provider_model}",
            "provider": {
                provider_id: {
                    "name": "Runtime Smoke Provider",
                    "api": provider_base_url,
                    "npm": "@ai-sdk/openai-compatible",
                    "options": {
                        "apiKey": provider_api_key,
                        "baseURL": provider_base_url,
                        "timeout": max(timeout * 1000, 60000),
                    },
                    "models": {
                        provider_model: {
                            "id": provider_model,
                            "name": "Runtime Smoke Model",
                            "tool_call": True,
                            "temperature": True,
                            "limit": {"context": 128000, "output": 8192},
                        }
                    },
                }
            },
        }
        return json.dumps(cfg, ensure_ascii=False)
    return None

secret_values = [
    value
    for key, value in os.environ.items()
    if value and re.search(r"(API|KEY|TOKEN|SECRET|PASSWORD|BASE_URL)", key, re.I)
]
secret_values.extend([provider_base_url, provider_api_key, config_content])
secret_values = [value for value in secret_values if value]

def redact(text: str | bytes | None) -> str:
    if text is None:
        return ""
    if isinstance(text, bytes):
        text = text.decode("utf-8", "replace")
    out = text
    for value in secret_values:
        if value:
            out = out.replace(value, "<redacted>")
    out = re.sub(r"https?://[^\s\"'<>]+", "<redacted-url>", out)
    out = re.sub(r"(api key:\s*)\S+", r"\1<redacted>", out, flags=re.I)
    return out

@dataclass(frozen=True)
class Smoke:
    sid: str
    area: str
    workspace: str
    prompt: str
    expected: str
    required_tools: tuple[str, ...] = ()
    forbidden_tools: tuple[str, ...] = ()
    guard_paths: tuple[str, ...] = ()

smokes = [
    Smoke(
        "S1",
        "Native C QA",
        qa_workspace,
        "Analyze the C call chain for hw/ufs/ufs.c function ufs_exec_query_cmd. Explain direct callers, key callees, main flow, and error handling. Do not generate Word, Mermaid, or artifact deliverables.",
        "Uses native code understanding/search. No Word/Mermaid/artifact tools.",
    ),
    Smoke(
        "S2",
        "Macro/register QA",
        qa_workspace,
        "Find where UFS Query related macros or opcodes are defined and which C files/functions use them. If register/MMIO paths are involved, summarize read/write paths. Do not generate Word, Mermaid, or artifacts.",
        "Uses native code/search only. No deliverable tools.",
    ),
    Smoke(
        "S3",
        "Existing document QA",
        doc_workspace,
        "Validation smoke S3: answer this directly in the main agent, do not delegate to task/subagent. First call the exact tool named document_search with a query for docs/source-backed-detail-design-skill-contract.md trigger conditions and required deliverables. After document_search returns, summarize the trigger conditions and required deliverables from the returned document evidence. Do not read the file directly before document_search, and do not generate a new Word document.",
        "Uses document_search in the main agent before answering document QA. No Word generation.",
        required_tools=("document_search",),
        forbidden_tools=("task",),
    ),
    Smoke(
        "S4",
        "Artifact manifest",
        doc_workspace,
        "Validation smoke S4: create a short migration validation report artifact with title, summary, and risk list. Do not create a Word document. Use a shell heredoc, not the write tool, to create .chipmate/artifacts/runtime-smoke-s4/report.md with markdown content. Then call the exact tool named declare_artifact with kind terminal-report, title Runtime Smoke S4 Migration Validation Report, artifactDir .chipmate/artifacts/runtime-smoke-s4, and primaryFile report.md so artifact.json exists. Do not stop after mkdir or file creation alone. Return generated file paths plus the artifact.json manifest path.",
        "Creates .chipmate/artifacts/.../artifact.json.",
        required_tools=("declare_artifact",),
        forbidden_tools=("write",),
    ),
    Smoke(
        "S5",
        "Word create",
        doc_workspace,
        "Generate a module interface design Word document for an embedded C UFS query module, including interface list, parameter table, error code table, and notes.",
        "Creates a .docx artifact and manifest.",
    ),
    Smoke(
        "S6",
        "Word append/edit",
        doc_workspace,
        "Edit the just-created interface design Word document by adding an error-code table after the interface design section. Output a new version and do not overwrite the original.",
        "Creates new .docx and backup when editing existing document.",
    ),
    Smoke(
        "S7",
        "Word delete dry-run",
        doc_workspace,
        "Dry-run deletion of the old-plan section from the Word document. Report impacted paragraphs and do not write a new file.",
        "Dry-run only, no new .docx.",
    ),
    Smoke(
        "S8",
        "Word replace complex blocks",
        doc_workspace,
        "Replace TODO paragraphs in the Word document with an explanatory paragraph, a parameter table, and an ordered list. If no existing Word document contains TODO, first create a small fixture Word document containing a TODO paragraph, then output a new replaced version without mutating the source.",
        "Structured replacement, original not mutated.",
    ),
    Smoke(
        "S9",
        "Word template style",
        doc_workspace,
        f"Apply a real company template DOCX style to the design document. Template path: {template_docx or '<provide CHIPMATE_SMOKE_TEMPLATE_DOCX>'}. Inherit supported styles only and report unsupported behavior.",
        "Style inheritance and warnings recorded.",
    ),
    Smoke(
        "S10",
        "Word merge/diff",
        doc_workspace,
        "Merge three module Word documents. If fewer than three suitable module Word documents are available, create small fixture Word documents first. Then compare v1 and v2 and output bounded diff summary plus JSON artifact.",
        "Merge/diff artifacts with rels/content-types preserved.",
    ),
    Smoke(
        "S11",
        "Mermaid",
        doc_workspace,
        "Generate a Mermaid state-machine diagram and export both .mmd and PNG artifacts.",
        "Creates .mmd, .png, diagnostics artifact.",
    ),
    Smoke(
        "S12",
        "Mermaid plus Word",
        doc_workspace,
        "Insert the Mermaid PNG into the Word design document and output a new Word artifact with the figure registered in the manifest.",
        "New Word artifact with inserted figure.",
    ),
    Smoke(
        "S13",
        "Source-backed detail design",
        qa_workspace,
        "Generate a source-backed detailed design document for the UFS query command path using source evidence. Include evidence summary, diagrams, Markdown draft, Word output, and quality report.",
        "Uses source-backed skill/process with evidence, diagrams, Word output.",
    ),
    Smoke(
        "S16",
        "Autocomplete",
        doc_workspace,
        "Read-only autocomplete preservation smoke. Do not create, edit, or delete any source/package files. Do not implement missing commands. Only inspect existing qwen-direct autocomplete settings, package contributions, registered diagnostics/log commands, and available test or log evidence; if an existing diagnostic command is already registered, report it. Return whether provider registration and diagnostics appear available from existing code/config.",
        "Provider registers; diagnostics are available.",
        forbidden_tools=("write", "edit", "apply_patch"),
        guard_paths=("packages/chipmate-vscode/package.json", "packages/chipmate-vscode/src/services/qwen-autocomplete"),
    ),
]
smoke_map = {item.sid: item for item in smokes}

def classify(exit_code: int, output: str) -> str:
    lower = output.lower()
    if "authentication fails" in lower or "invalid api key" in lower or "statuscode\":401" in lower or "http 401" in lower:
        return "BLOCKED_AUTH"
    if "[timeout" in lower or exit_code == 124:
        return "TIMEOUT"
    if "type\":\"error\"" in lower or "\"error\"" in lower and "apierror" in lower:
        return "ERROR_NEEDS_REVIEW"
    if exit_code != 0:
        return "FAIL"
    return "NEEDS_REVIEW"

def extract_tools(output: str) -> set[str]:
    tools: set[str] = set()
    for line in output.splitlines():
        try:
            item = json.loads(line)
        except Exception:
            continue
        if not isinstance(item, dict):
            continue
        part = item.get("part")
        if not isinstance(part, dict):
            continue
        tool = part.get("tool")
        if isinstance(tool, str) and tool:
            tools.add(tool)
    return tools

def hash_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()

def snapshot_paths(workspace: str, paths: tuple[str, ...]) -> dict[str, str | None]:
    root = pathlib.Path(workspace)
    snapshot: dict[str, str | None] = {}
    for item in paths:
        path = pathlib.Path(item)
        target = path if path.is_absolute() else root / path
        if target.is_file():
            snapshot[str(target)] = hash_file(target)
        elif target.is_dir():
            for child in sorted(target.rglob("*")):
                if child.is_file():
                    snapshot[str(child)] = hash_file(child)
        else:
            snapshot[str(target)] = None
    return snapshot

def guard_messages(smoke: Smoke, output: str, before: dict[str, str | None], after: dict[str, str | None]) -> list[str]:
    messages: list[str] = []
    tools = extract_tools(output)
    for tool in smoke.required_tools:
        if tool not in tools:
            messages.append(f"missing required tool: {tool}")
            if tool == "document_search" and (
                "embedder validation failed" in output
                or "embedder validation error" in output
                or "Document RAG unavailable" in output
                or "failed to recreate services" in output
            ):
                messages.append("document_search unavailable because Document RAG indexing provider/readiness failed")
    for tool in smoke.forbidden_tools:
        if tool in tools:
            messages.append(f"forbidden tool used: {tool}")
    if before != after:
        before_keys = set(before)
        after_keys = set(after)
        for added in sorted(after_keys - before_keys):
            messages.append(f"guarded file added: {added}")
        for removed in sorted(before_keys - after_keys):
            messages.append(f"guarded file removed: {removed}")
        for changed in sorted(key for key in before_keys & after_keys if before[key] != after[key]):
            messages.append(f"guarded file changed: {changed}")
    if not messages:
        messages.append("guardrails passed")
    return messages

def run_one(sid: str, area: str, workspace: str, prompt: str, expected: str) -> dict[str, str | int]:
    prompt_file = run_dir / f"{sid.lower()}-prompt.txt"
    log_file = run_dir / f"{sid.lower()}.log"
    guard_file = run_dir / f"{sid.lower()}-guard.txt"
    prompt_file.write_text(prompt + "\n", encoding="utf-8")
    env = os.environ.copy()
    cfg = one_shot_config()
    if cfg:
        env["CHIPMATE_CONFIG_CONTENT"] = cfg
        env["CHIPMATE_DISABLE_PROJECT_CONFIG"] = env.get("CHIPMATE_DISABLE_PROJECT_CONFIG", "1")
    cmd = [
        "bun",
        "run",
        "--conditions=browser",
        "src/index.ts",
        "run",
        "--format",
        "json",
        "--dir",
        workspace,
        prompt,
    ]
    smoke = smoke_map[sid]
    before = snapshot_paths(workspace, smoke.guard_paths)
    try:
        proc = subprocess.run(
            cmd,
            cwd=repo / "packages" / "opencode",
            env=env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=timeout,
        )
        exit_code = proc.returncode
        output = redact(proc.stdout)
    except subprocess.TimeoutExpired as exc:
        exit_code = 124
        output = redact(exc.stdout) + f"\n[TIMEOUT after {timeout}s]\n"
    after = snapshot_paths(workspace, smoke.guard_paths)
    log_file.write_text(output, encoding="utf-8", errors="replace")
    status = classify(exit_code, output)
    guards = guard_messages(smoke, output, before, after)
    if status == "NEEDS_REVIEW" and any(message != "guardrails passed" for message in guards):
        status = "ERROR_NEEDS_REVIEW"
    guard_file.write_text("\n".join(guards) + "\n", encoding="utf-8")
    return {
        "id": sid,
        "area": area,
        "status": status,
        "exit_code": exit_code,
        "workspace": workspace,
        "expected": expected,
        "prompt_file": str(prompt_file),
        "log_file": str(log_file),
        "guard_file": str(guard_file),
    }

def write_summary(rows: list[dict[str, str | int]], title: str) -> None:
    summary = run_dir / "summary.md"
    with summary.open("w", encoding="utf-8") as f:
        f.write(f"# {title}\n\n")
        f.write("- Secret values are redacted.\n")
        f.write("- `NEEDS_REVIEW` means the process returned without a detected auth/runtime error, but M10/M11 still requires manual answer/tool/artifact review.\n")
        f.write("- This script does not mark any acceptance item PASS by itself.\n\n")
        f.write(f"Timeout seconds: `{timeout}`\n\n")
        if one_shot_config():
            f.write("Config source: `one-shot smoke config`\n\n")
        else:
            f.write("Config source: `current ChipMate config/auth state`\n\n")
        f.write("| ID | Area | Status | Exit | Workspace | Log |\n")
        f.write("|---|---|---:|---:|---|---|\n")
        for row in rows:
            f.write(
                f"| {row['id']} | {row['area']} | {row['status']} | {row['exit_code']} | "
                f"`{row['workspace']}` | `{row['log_file']}` |\n"
            )
        f.write("\n## Guardrail files\n\n")
        for row in rows:
            f.write(f"- {row['id']}: `{row['guard_file']}`\n")
        f.write("\n## Review checklist\n\n")
        f.write("- Inspect each log for answer quality and actual tool sequence.\n")
        f.write("- Confirm ordinary QA did not create Word/Mermaid/artifact deliverables.\n")
        f.write("- Confirm generated artifacts exist and have manifests before changing S4-S13 to PASS.\n")
        f.write("- Keep BLOCKED_AUTH/TIMEOUT/ERROR_NEEDS_REVIEW as blockers.\n")
    tsv = run_dir / "runtime-smoke.tsv"
    with tsv.open("w", encoding="utf-8") as f:
        f.write("id\tarea\tstatus\texit_code\tworkspace\tlog\n")
        for row in rows:
            f.write(f"{row['id']}\t{row['area']}\t{row['status']}\t{row['exit_code']}\t{row['workspace']}\t{row['log_file']}\n")

if mode == "preflight":
    workspace = tempfile.mkdtemp(prefix="chipmate-runtime-preflight-")
    rows = [run_one("P0", "Chat provider preflight", workspace, "Reply with exactly OK.", "A working chat provider returns OK.")]
    write_summary(rows, "Runtime smoke preflight")
elif mode == "ids":
    ids = [part.strip().upper() for part in ids_arg.split(",") if part.strip()]
    rows = []
    missing = [sid for sid in ids if sid not in smoke_map]
    if missing:
        raise SystemExit(f"Unknown smoke id(s): {', '.join(missing)}")
    for sid in ids:
        item = smoke_map[sid]
        rows.append(run_one(item.sid, item.area, item.workspace, item.prompt, item.expected))
    write_summary(rows, "Runtime smoke run")
else:
    raise SystemExit(f"Unknown mode: {mode}")

print(f"RUN_DIR={run_dir}")
PY
