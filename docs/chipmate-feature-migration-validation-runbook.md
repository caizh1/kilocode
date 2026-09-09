# ChipMate Feature Migration Validation Runbook

This runbook maps the remaining checklist items in `chipmate-feature-migration-plan.md` to concrete validation evidence. It is a preparation document only; commands listed here have not been run as part of this note.

## Important Command Boundary

Do not run tests from the repository root with `bun test`; the root package intentionally defines:

```bash
bun test
# echo 'do not run tests from root' && exit 1
```

Use package-specific commands instead.

## Recommended Validation Order

Optional capture helper:

```bash
cd /Users/archer/Work/chipmate
bash docs/chipmate-feature-migration-validation-capture.sh --run-commands
bash docs/chipmate-feature-migration-validation-capture.sh --run-package
bash docs/chipmate-feature-migration-validation-capture.sh --prepare-smoke
bash docs/chipmate-feature-migration-validation-capture.sh --inspect-vsix packages/chipmate-vscode/out/<generated>.vsix
```

The helper is inert without an explicit run flag. It writes logs and `status.tsv`
under `docs/chipmate-feature-migration-validation-runs/<timestamp>/`. Using the
helper is optional, but if used its output should be summarized in
`chipmate-feature-migration-validation-evidence.md`.

`--inspect-vsix` does not build or install anything. It inspects an existing
VSIX, records version/size/file list, and flags high-risk renderer payload names
such as LibreOffice, Chromium, Puppeteer, Mermaid CLI, or `mmdc`. It also lists
Poppler/pdftotext separately because those may belong to ChipMate's pre-existing
internal-offline document extraction path rather than this migration.

After a capture run, create a reviewable summary without changing validation
state:

```bash
python3 docs/chipmate-feature-migration-summarize-validation.py \
  docs/chipmate-feature-migration-validation-runs/<timestamp> \
  --output docs/chipmate-feature-migration-validation-runs/<timestamp>/summary.md
```

The summarizer is read-only. It does not execute tests, package VSIX files,
install extensions, or update `chipmate-feature-migration-validation-evidence.md`.

Before final sign-off, run a read-only completion audit:

```bash
python3 docs/chipmate-feature-migration-completion-audit.py \
  --output docs/chipmate-feature-migration-validation-runs/<timestamp>/completion-audit.md
```

The completion audit exits non-zero while unchecked plan items or TODO/FAIL/REVIEW
evidence markers remain. It is a guardrail, not a replacement for the M11
requirement-by-requirement review.

After validation, use
`docs/chipmate-feature-migration-post-validation-update-guide.md` to map command
and installed-smoke evidence back to plan checkboxes. The guide is intentionally
conservative: when evidence is weak or scoped, leave the related checkbox
unchecked and document a known issue.

Installed smoke prompts:

- Use `docs/chipmate-feature-migration-acceptance-prompts.md` as the canonical prompt/action pack for installed VS Code smoke.
- Replace placeholders with representative internal project values at execution time.
- Keep prompts broad and evidence-oriented; do not convert the examples into production routing logic.

### 1. CLI / tool-layer tests

Working directory:

```bash
cd /Users/archer/Work/chipmate/packages/opencode
```

Commands:

```bash
bun run test
bun run typecheck
```

Covers checklist areas:

- artifact manager creation/list/open/path safety;
- Word create/inspect/edit/template/fields/merge/diff/render tool tests;
- Mermaid validate/render/save/insert tool tests;
- source-backed detail-design skill fixture;
- ordinary QA routing boundary for document tools;
- ChipMate native `codebase_analysis`, `semantic_search`, and `document_search` registry preservation.

Evidence to capture:

- command output summary;
- failing test names if any;
- final pass/fail status;
- any generated artifact paths if tests intentionally create them.

### 2. VS Code extension type/package checks

Working directory:

```bash
cd /Users/archer/Work/chipmate/packages/chipmate-vscode
```

Commands:

```bash
bun run test:unit
bun run typecheck
bun run lint
bun run package
```

Covers checklist areas:

- artifact UI service/view unit tests;
- qwen-direct autocomplete package contribution smoke;
- VS Code extension activation path;
- package contribution validity for new commands/settings/profile;
- Qwen direct autocomplete contribution preservation;
- artifact UI type safety;
- no renderer large dependency bundled by package build.

Evidence to capture:

- command output summary;
- produced build/package artifact paths if any;
- VSIX/package size if produced by the chosen packaging command;
- any warning about missing renderer, Chromium, LibreOffice, Poppler, or package schema.

### 3. VSIX build

Working directory:

```bash
cd /Users/archer/Work/chipmate/packages/chipmate-vscode
```

Candidate commands:

```bash
bun run package:internal-offline
```

`package:internal-offline` runs `script/build.ts --internal-offline` and packages `.vsix` files under `packages/chipmate-vscode/out/`. It may include ChipMate's pre-existing internal-offline Poppler `pdftotext` helper for document extraction; do not treat that existing dependency as a Word/Mermaid renderer migration. The renderer boundary check is specifically whether this migration added LibreOffice, Chromium, Mermaid browser runtimes, or additional renderer payloads to support the new Word/Mermaid tools.

Covers checklist areas:

- `打包 VSIX`;
- `Review packaging，确认 VSIX 可安装`;
- `检查打包流程不会把 renderer 大依赖塞入 VSIX`;
- `记录版本、artifact、验证命令、已知限制`.

Evidence to capture:

- package version;
- VSIX filename;
- VSIX size;
- renderer dependency inspection result, preferably from `--inspect-vsix`, distinguishing pre-existing ChipMate offline dependencies from newly introduced renderer payloads;
- package command output summary.

### 4. Installed VS Code smoke

Install the generated VSIX into a disposable VS Code profile or agreed internal profile.

Smoke matrix:

| Area | Smoke prompt/action | Expected evidence |
|---|---|---|
| Native code QA | Ask for a C function call chain | Uses ChipMate native code understanding tools; no Word/Mermaid/artifact tools |
| Macro/register QA | Ask where a macro is defined and used | Uses native search/code tools; no document artifact creation |
| Document RAG | Ask about an existing indexed document | Uses `document_search`; does not call Word generation |
| Artifact | Generate/list/open a report artifact | `.chipmate/artifacts/.../artifact.json` exists and can be opened |
| Word create | Generate a module interface design Word | `.docx` artifact exists |
| Word edit | Add an error-code table | New version `.docx` exists; source backup exists |
| Word delete | Delete a chapter dry-run first | Reports impact without writing until apply is explicit |
| Word template | Apply a real template docx | Style/template warnings recorded |
| Word merge/diff | Merge/compare docs | Bounded summary and artifact paths returned |
| Word render | Render docx to PDF/page PNG | Render artifact or endpoint-unconfigured warning |
| Mermaid | Generate state-machine PNG | `.mmd`, `.png`, diagnostics artifact |
| Mermaid + Word | Insert Mermaid PNG into Word | New Word artifact with figure |
| Source-backed detail design | Run on one internal embedded C module | Evidence, diagrams, Word output, quality report |
| Autocomplete | Enable qwen-direct and trigger inline completion | Provider still registers and diagnostics commands exist |

Evidence to capture:

- prompt/action;
- actual tool sequence or visible behavior;
- artifact paths;
- warnings;
- whether native ChipMate QA behavior remained intact.

### 5. Final review

After tests, package, install smoke, and real project validation pass, update:

- `chipmate-feature-migration-plan.md` checklist;
- `chipmate-feature-migration-static-review.md` with runtime evidence or link to a new runtime review note;
- `chipmate-feature-migration-validation-evidence.md` with command, packaging, VSIX inspection, installed smoke, and known issue evidence;
- `chipmate-feature-migration-chipmate-no-regression-review.md` with native ChipMate capability preservation evidence;
- final known issues and limitations.

Only then mark M10, M11, and the active goal complete.

As a final guardrail, the completion audit should report no blockers before
marking the active goal complete.

## Remaining Known Limits Before Validation

- Static inspection cannot prove package schema validity.
- Static inspection cannot prove installed VS Code activation.
- Static inspection cannot prove renderer behavior.
- Static inspection cannot prove real `.docx` visual fidelity.
- Static inspection cannot prove internal embedded C project QA quality.
- Static inspection cannot prove VSIX size and installability.
