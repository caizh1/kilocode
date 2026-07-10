---
name: source-backed-detail-design
description: Generate or update source-backed detailed design documents with Kilo native code/document evidence tools, Mermaid PNG artifacts, Word docx output, and render diagnostics.
allowed-tools:
  - codebase_analysis
  - semantic_search
  - document_search
  - read
  - grep
  - glob
  - declare_artifact
  - list_artifacts
  - open_artifact
  - export_artifact_diagnostics
  - validate_mermaid_diagram
  - render_mermaid_diagram
  - save_mermaid_artifact
  - insert_mermaid_into_word
  - create_word_document
  - inspect_word_document
  - apply_word_document_edits
  - apply_word_template_styles
  - materialize_word_fields
  - merge_word_documents
  - diff_word_documents
  - normalize_word_table_spec
  - render_word_document
metadata:
  keywords:
    - source backed detail design
    - source-backed detail design
    - enhanced detail design
    - detailed design document
    - 源码驱动详细设计
    - 增强版详细设计
    - 基于源码生成详设
    - 模块详细设计
    - 状态机
    - 业务流程
    - 代码流程
---

# Source-backed Detail Design for Kilo

Use this skill when the user explicitly asks to regenerate, enhance, update, or export a detailed design document from current source code, optionally comparing against an existing detailed design document.

This is a Kilo native skill. It is not a ChipMate runtime pipeline, not question routing, not a migrated Word/document contract, and not a replacement for Kilo ordinary QA. The model owns scope discovery, evidence planning, work-package sequencing, diagram semantics, section writing, artifact selection, and Word document assembly. Kilo tools execute evidence retrieval, artifact writes, Mermaid rendering, generic Word generation, Word edits, and optional render QA.

Do not import ChipMate runtime contract mechanisms into this skill. In particular, do not add contract-steering metadata, required-deliverable validators, document-depth gates, recipe-specific Word repair loops, or blocking skill-contract gates to Kilo's native QA path.

## Non-goals and QA Boundary

- Do not migrate or assume ChipMate `DesignDocAgentFlow`, ChipMate planner, ChipMate question routing, or ChipMate CodeGraph/RAG management UI.
- Do not migrate or assume ChipMate Word/document runtime contracts, artifact-consumption gates, recipe-specific repair prompts, or mandatory delivery gates.
- Do not force ordinary code QA, call-chain questions, macro/register analysis, or document QA into this workflow.
- For ordinary code understanding, use Kilo native `codebase_analysis`, `semantic_search`, `document_search`, `grep`, `glob`, and `read` directly.
- Trigger this skill only for explicit detailed-design, design-doc, Word/docx, Mermaid/diagram, or source-backed documentation deliverables.
- If the user only asks a normal coding question, answer through Kilo native QA tools and do not create artifacts.

## Kilo Tool Mapping

Use Kilo native evidence tools first:

| Need | Kilo tool |
|---|---|
| Source module map, symbol facts, callers/callees, function/control-flow evidence, state machines | `codebase_analysis` |
| Open-ended conceptual source search | `semantic_search` |
| Existing DOCX/PDF/Markdown/reference document evidence | `document_search` |
| Exact source confirmation and line-level citations | `read`, `grep`, `glob` |
| Artifact manifest and diagnostics | `declare_artifact`, `list_artifacts`, `open_artifact`, `export_artifact_diagnostics` |
| Mermaid source validation/rendering/saving | `validate_mermaid_diagram`, `render_mermaid_diagram`, `save_mermaid_artifact` |
| Word generation/editing/render QA | `create_word_document`, `apply_word_document_edits`, `insert_mermaid_into_word`, `render_word_document` |

Do not call Mermaid tools to decide business semantics. The model must decide diagram type, main flow, exception flow, state role, split strategy, and figure placement from evidence and this skill's references. Mermaid tools only validate, render, save, and insert artifacts.

## Optional Resource Loading

For a full detailed-design deliverable, use the listed references from this skill directory as guidance. Load only the references relevant to the user's requested scope and the current work package. These references are not a ChipMate-style mandatory contract gate, and missing or skipped references should be disclosed as scope limits rather than used to block ordinary QA.

When this skill is loaded as a Kilo built-in skill, it may not have a filesystem base directory or bundled `references/` files. In that mode, treat this `SKILL.md` as self-contained guidance and do not fail or block the task because reference files are unavailable. If a project-level `.kilo/skills/source-backed-detail-design/` directory exists, its references can provide deeper templates and checks and may override this built-in skill.

| Work package | Optional references |
|---|---|
| input-and-scope | `references/01-core-principles.md`, `references/02-input-and-module-scope-rules.md`, `references/14-continuation-checkpoint-protocol.md` |
| source-evidence | `references/03-source-exploration-rules.md` |
| control-flow-evidence | `references/04-control-flow-evidence-schema.md`, `references/05-submodule-business-flow-rules.md`, `references/06-state-machine-extraction-rules.md` |
| business-flow-abstraction-and-diagrams | `references/15-business-flow-abstraction-rules.md`, `references/07-diagram-planning-and-splitting-rules.md`, `references/08-mermaid-png-rendering-rules.md` |
| code-level-submodule-diagrams | `references/05-submodule-business-flow-rules.md`, `references/07-diagram-planning-and-splitting-rules.md`, `references/08-mermaid-png-rendering-rules.md` |
| state-machine-diagrams | `references/06-state-machine-extraction-rules.md`, `references/08-mermaid-png-rendering-rules.md` |
| parent-module-diagram | `references/09-parent-module-assembly-rules.md` |
| enhanced-detail-design | `references/10-detail-design-output-templates.md` |
| diff-and-feature-report | `references/11-feature-diff-completeness-rules.md` |
| review-and-word-export | `references/12-word-export-rules.md`, `references/13-quality-gates-and-validator.md` |

## Suggested Work Package Order

For a broad end-to-end detailed-design deliverable, a useful order is:

1. input-and-scope
2. source-evidence
3. control-flow-evidence
4. business-flow-abstraction-and-diagrams
5. code-level-submodule-diagrams
6. state-machine-diagrams
7. parent-module-diagram
8. enhanced-detail-design
9. diff-and-feature-report
10. quality-and-word-export

Scale or skip packages when the user asks for a narrower document, a single chapter, a state-machine-only report, or a quick update. Do not skip directly to Word output when the user asked for source-backed conclusions and evidence is still missing; instead, disclose the evidence gap and ask or proceed with a smaller scope.

For long multi-turn deliverables, record incomplete work in `resume-state.md`, `continue-prompt.md`, or `review-notes.md` when useful. Do not make these files mandatory for ordinary QA or short document tasks.

## Output Root and Artifact Guidance

Use a workspace-safe output root named `<module-name>_source_backed_detail_design/`. Prefer creating it under a Kilo artifact directory through `declare_artifact`; if a user gives an explicit output directory, keep it inside the workspace.

Keep all generated CSV/MD status artifacts under the output root:

- `00-input/`
- `01-scope/`
- `02-source-evidence/`
- `03-control-flow-evidence/`
- `04-diagrams/`
- `05-enhanced-detail-design/`
- `06-review-notes/`
- `07-diff-report/`
- `08-word-export/`

Mermaid tools may create `.mmd` and `.png` artifacts under a separate artifact directory. For full deliverables, record logical-to-actual path mappings in `04-diagrams/diagram-index.md` and in coverage tables.

## Scope and Parent-to-Core Rule

Detailed design must explain the target from owning architecture down to core implementation. Do not collapse the target module into the densest implementation file or deepest helper directory.

Build a scope map before writing conclusions:

- parent subsystem: only as far as needed to explain the target module's role;
- target module: the requested module, its responsibilities, boundaries, triggers, inputs, outputs, and state/data ownership;
- core implementation: lower-level source area that realizes target capabilities;
- handoff evidence: calls, shared structures, queues, callbacks, states, macros, or configuration connecting those scopes.

If a relationship is uncertain, include a scope mapping and confidence table, use bounded wording such as `implemented by`, `delegates to`, `uses`, or `is realized through`, and mark unresolved mappings as owner-review items.

## Terminology and Confidence Rule

Resolve module names, abbreviations, translations, and ownership wording from user wording, source symbols, comments, directories, existing documents, or explicit evidence. Do not invent acronym expansions or ownership.

At the start of the document, include a terms and scope mapping table with:

- user-requested target name;
- source-backed candidate name;
- abbreviation meaning or `UNKNOWN`;
- evidence source;
- confidence;
- owner-review item.

Key conclusions must use confidence labels:

- `source_confirmed`;
- `high_confidence`;
- `medium_confidence`;
- `low_confidence_review`;
- `not_confirmed`.

Low-confidence and unconfirmed claims belong in assumptions, gaps, risks, or owner-review items, not in definitive design body text.

## Required Content

The generated detailed design should include:

- reading path for new maintainers;
- parent subsystem positioning and target-module boundary;
- target responsibilities, non-responsibilities, upstream/downstream dependencies, business triggers, inputs, outputs, and state/data ownership;
- internal submodule map and key submodule responsibilities;
- module scope, source files, entry points, public/internal interfaces, data structures, macros/register definitions, dependencies, and implementation scheme;
- function and feature details with responsibility, inputs, outputs, side effects, dependencies, error handling, and evidence;
- business capability overview table;
- main business flow, subflows, code flow, error/cleanup paths, and state-machine transitions;
- key design objects: structures, globals, context variables, queues, caches, bitmaps, tables, enums, states, macros, and configuration values;
- interfaces and collaboration: external/internal APIs, cross-module calls, callbacks, queues, notifications, async completion, hardware/register/firmware adapter interfaces when applicable;
- algorithms, strategies, performance, concurrency, resource usage, retries/timeouts, bottlenecks, thresholds, tuning knobs;
- debugging and observability notes;
- diagram coverage summary;
- detailed-design coverage table using `PASS / PARTIAL / MISSING / N/A`;
- evidence ledger, assumptions, limitations, gaps, risks, and owner-review items.

Each important submodule must include a short introduction, responsibilities and boundaries, inputs/outputs, interfaces, key structures/variables, key functions, business triggers, high-level business flow, code-level flow, key conditions, state/data impact, exception/wait/retry paths, performance impact, and evidence references.

## Diagram Requirements

Use Mermaid for formal detailed-design diagrams. Generate PNG figures with `render_mermaid_diagram` or save known-good PNGs with `save_mermaid_artifact`. Insert PNGs into Word with Word image blocks or `insert_mermaid_into_word`; Mermaid source alone is not a figure unless the user explicitly asks for source code blocks.

Required diagram levels when evidence supports them:

- target-module architecture diagram;
- target-module main business-flow diagram;
- target-module code-flow diagram;
- parent-module business master flow;
- parent-module code/architecture flow;
- one high-level business-submodule-flow per important submodule;
- one code-level-submodule-flow per important submodule;
- state-machine overview and transition details when state/event/phase evidence exists.

The main business-flow diagram must cover the module's complete business loop. It cannot be replaced by a single read/write subflow, code call chain, or state-machine diagram.

Diagram nodes and edges must be backed by source/control-flow/business evidence. Business diagrams should use business language and avoid making function names the main node labels. Code-level diagrams may include functions, branches, state/data mutation, cleanup, and error paths.

## Evidence Rule

Every design claim should cite concrete evidence where possible:

- file path and line range;
- function definition;
- call relation;
- branch/condition;
- state field read/write;
- structure field;
- macro/configuration branch;
- callback path;
- queue handoff;
- register/adapter access.

File-name-only or function-name-only evidence is not enough for key design conclusions. If a tool cannot provide line ranges, disclose the evidence granularity limitation.

## Word Output Guidance

When Word output is requested, build an object-shaped Word document spec. Do not pass stringified JSON, Markdown, or prose as the Word spec.

The default Word outline is:

1. Reading path, target scope, evidence basis, and scope-confidence map.
2. Parent subsystem context and target-module role.
3. Target-module responsibilities, boundaries, non-responsibilities, inputs/outputs, dependencies, and architecture diagram.
4. Target-module business capability overview.
5. Target-module main business flow and submodule handoff flow, with PNG figure.
6. Internal architecture and submodule decomposition.
7. Important submodule sections.
8. Core implementation role and capability coverage.
9. Code-level implementation flows, function details, branches, cleanup, and error paths.
10. State-machine transitions and conditions.
11. Key design objects.
12. Interfaces and collaboration.
13. Algorithms, strategies, performance, concurrency, resources, and recovery.
14. Coverage checklist, diagram summary, evidence ledger, assumptions, gaps, risks, and owner-review items.

After `create_word_document`, call `render_word_document` only when the user asks for visual QA, render verification is enabled, or the task explicitly requires PDF/page PNG output. If the renderer endpoint is unavailable, keep the Word delivery and disclose that page-level visual QA was skipped.

## Review Checklist

For a full detailed-design deliverable, review and report these items as `PASS / PARTIAL / MISSING / N/A` where relevant. This is a human-readable review checklist, not a runtime contract, not an automatic repair planner, and not a reason to trigger the skill when the skill tool is disabled:

- required references are loaded and recorded;
- module scope is written;
- source/control-flow/business evidence files are non-empty;
- required Mermaid source and PNG artifacts are paired or gaps are disclosed;
- edge coverage exists for required diagrams;
- parent, business, code, submodule, and state diagrams are referenced in the correct sections where applicable;
- enhanced detail design chapters exist;
- diff/feature report exists when an old design was provided;
- Word docx is generated by `create_word_document`;
- render QA status is recorded when render QA was requested or configured;
- review notes record unresolved evidence gaps, skipped optional diagrams, skipped render QA, and owner-review items.

Do not run or expect a migrated ChipMate artifact validator. Do not turn missing diagrams, missing render output, or skipped optional Word/PDF output into an automatic contract-planning prompt. Report the gap and continue within the user-requested scope.

## Continuation Protocol

This workflow can support multiple sessions for large deliverables. Task state should be written to files when the document effort spans turns or when the user requests a resumable artifact.

At the end of each incomplete turn, update:

- `resume-state.md`;
- `continue-prompt.md`;
- `review-notes.md`.

When resuming a saved detailed-design effort, read those files first, then continue from the first incomplete work package. Do not let a checkbox hide unresolved owner-review items or evidence gaps.
