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

## Non-contract Capability Preservation

Chapter restructuring must preserve every existing non-contract capability in this skill:

- input and scope: existing-document clue extraction, candidate-range scoring, parent/target/core mapping, primary/auxiliary/excluded scope, and bounded terminology;
- source and control-flow evidence: source indexes, exact symbol/line evidence, function coverage, calls, branches, state transitions, data reads/writes, error and cleanup paths, and edge coverage;
- business abstraction: business capabilities, steps, objects, cross-submodule handoffs, terminal outcomes, confidence, and source-backed interpretation;
- document content: full documents, single chapters, single submodules, state-machine-focused reports, existing-document updates, and source-versus-document differences;
- diagrams: parent/target and important-submodule architecture, business, code, state-machine, and data/lifecycle views, plus readable split views for complex flows;
- Word delivery: existing generic create/edit/style/merge/diff tools, ordered image blocks, standard business formatting, image-count checks, and page-image visual review;
- continuation: resumable work-package state and human-readable review notes for long tasks without affecting ordinary QA.

Do not delete evidence schemas, work packages, update/diff behavior, build/integration coverage, narrow-delivery behavior, or continuation guidance merely because the final Word chapters are reorganized.

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
| Word generation/inspection/editing/render QA | `create_word_document`, `inspect_word_document`, `apply_word_document_edits`, `insert_mermaid_into_word`, `render_word_document` |

Do not call Mermaid tools to decide business semantics. The model must decide diagram type, main flow, exception flow, state role, split strategy, and figure placement from evidence and this skill's references. Mermaid tools only validate, render, save, and insert artifacts.

## Optional Resource Loading

For a full detailed-design deliverable, use the listed references from this skill directory as guidance. Load only the references relevant to the user's requested scope and the current work package. These references are not a ChipMate-style mandatory contract gate, and missing or skipped references should be disclosed as scope limits rather than used to block ordinary QA.

When this skill is loaded as a Kilo built-in skill, treat this `SKILL.md` as the self-contained core. Read materialized references when the loaded skill location exposes them. If a deployment or override does not expose references, continue from the core rules here and disclose the missing deeper template instead of failing or changing the QA route. A project-level `.kilo/skills/source-backed-detail-design/` directory may provide deeper templates and may override the built-in skill through the existing discovery mechanism.

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

## Delivery Scope Variants

- A full Word delivery uses the canonical full-document outline, all applicable design units, five source-backed view types, coverage reporting, image checks, and page visual review.
- A single-chapter or single-submodule delivery keeps terminology, scope, and evidence context but expands only the requested design unit and its applicable views.
- A state-machine-only delivery keeps scope, state ownership, dispatch, transitions, guards/actions, handlers, failure/recovery behavior, and evidence without forcing unrelated Word chapters.
- An existing-document update rebuilds conclusions from current source, uses the existing generic Word edit/style/diff tools, and treats old prose only as a clue or comparison input.
- A source-versus-document difference report keeps symbol-evolution mapping and `Both` / `CodeOnly` / `DocOnly` capability classification without requiring a new full Word document unless requested.
- A quick update may reduce work packages, but it must disclose skipped analysis, unavailable evidence, and unreviewed figures or pages.

Do not expand a narrow request into a full Word deliverable, and do not use any scope variant as a reason to alter skill discovery, permissions, or ordinary QA behavior.

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

## Word Output Language Rule

Unless the user explicitly requests another language, write Word document titles, body text, table headers, figure titles, captions, explanations, conclusions, and review notes in Simplified Chinese.

Do not forcibly translate source symbols, function names, type names, variables, macros, file paths, configuration keys, protocol or standard names, product, library, or tool names, technical abbreviations, or fixed evidence and status tokens. When a conventional Chinese translation is source-backed and useful, introduce it as `中文说明（Original Term）` on first use. If the translation is uncertain, keep the original English term and explain its meaning in Chinese instead of inventing a Chinese name.

Use Chinese labels for business-level diagrams by default, while preserving exact source symbols in code-flow diagrams so readers can map the document back to the implementation. Keep terminology consistent throughout the document and do not create translated names that are unsupported by source code, user input, comments, or existing documentation.

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

## Hybrid Chapter Placement Rule

Use a hybrid structure:

- global opening chapters establish reading paths, terminology, source-backed scope, parent context, target-module role, target capabilities, the detailed main business loop, and internal decomposition;
- the target module and every important submodule then receive one continuous local detailed-design unit;
- global closing chapters contain only cross-module collaboration, ownership, state handoff, shared configuration/build concerns, resource contention, indexes, coverage, differences, and review items.

A global object list, interface list, code-flow chapter, state-machine chapter, or performance chapter cannot satisfy missing local detail for an important submodule. Link summary rows back to the owning design unit instead of duplicating its detailed prose.

## Design Unit Template

The target module and every important submodule must follow this semantic order. Use natural source-backed headings, but do not reorder implementation detail ahead of business meaning:

1. Introduction and business positioning
2. Responsibilities, non-responsibilities, and boundaries
3. Triggers, preconditions, inputs, and outputs
4. Internal architecture, upstream/downstream context, and dependencies
5. Business capabilities and complete business flow
6. Core structures, variables, queues, caches, ownership, and lifecycle
7. Function/feature coverage, key functions, and code execution flow
8. States, events, dispatch, guards, actions, and state-machine behavior
9. External, internal, cross-module, asynchronous, callback, queue, and hardware interfaces
10. Error, wait, retry, timeout, cancellation, recovery, rollback, and cleanup paths
11. Algorithms, strategies, configuration, concurrency, resources, and performance
12. Build targets, module registration, initialization order, feature flags, and platform differences
13. Logs, counters, assertions, diagnostics, failure symptoms, and source-reading entry points
14. Source evidence, confidence, gaps, and owner-review items

Place the unit's architecture, business-flow, data/lifecycle, code-flow, and state-machine or evidenced-`N/A` views next to the matching subsections. For an important state machine, cover dispatch, overview, transition conditions, error/retry/timeout behavior, and handler details through as many readable figures as the evidence needs; do not target a mechanical figure count.

For the target module, place an internal-decomposition table after its architecture and before drilling into submodule implementation. The table must include submodule name, source location, business role, responsibility, inputs/outputs, upstream/downstream collaboration, key state or lifecycle object, importance decision and basis, destination detail section, evidence, and confidence.

For every capability and main-flow family, explain the trigger, preconditions, business object, participating units, main path, conditions, wait/retry/error/recovery branches, terminal outcome, state/data/resource effects, and evidence. Do not impose a fixed number of capabilities or flows.

## Diagram Requirements

Use Mermaid for formal detailed-design diagrams. Generate PNG figures with `render_mermaid_diagram` or save known-good PNGs with `save_mermaid_artifact`. Mermaid source alone is not a figure unless the user explicitly asks for source code blocks.

Before Word assembly, keep a diagram map with `diagramId -> viewType -> semanticPurpose -> sourceEvidence -> targetSection -> pngPath -> QA status`. For each successful render, retain the returned display dimensions, pixel dimensions, scale, warnings, and QA issues. Every diagram ID must point to the intended source and PNG; do not reuse one `pngPath`, Mermaid source, or generic placeholder visual for different architecture, business-flow, code-flow, state-machine, or lifecycle claims unless the diagram map records an intentional shared view and explains why. Put every successful render into the lightweight initial Word skeleton as an image block at the exact intended position in `sections[].blocks[]`; use the returned `pngPath` instead of embedding base64 when a path exists. Structural Word edits cannot add new image blocks, so use `insert_mermaid_into_word` only for a late or missing-image repair after the initial Word document has been created.

For a full detailed-design deliverable, use this coverage matrix. `Required` means the view must be present and source-backed. A state-machine view may be `N/A` only when the inspected source has no explicit or implicit state, phase, event, dispatch, handler, lifecycle, or transition evidence; record the evidence for that decision instead of silently omitting the view or inventing states.

| Scope | Architecture | Business flow | Code flow | State machine | Data/lifecycle |
|---|---|---|---|---|---|
| Parent/target module | Required | Required | Required | Required or evidenced `N/A` | Required |
| Every important submodule | Required | Required | Required | Required or evidenced `N/A` | Required |

Each view must cover its distinct semantics:

- architecture: boundaries, responsibilities, internal components, inputs/outputs, upstream/downstream dependencies, shared context, queues, caches, and adapters;
- business flow: trigger, input object, complete happy path, business decisions, failure, retry, wait, timeout, cancellation, recovery, and terminal outcomes;
- code flow: entry functions, call layers, branches, loops, callbacks, asynchronous completion, state/data writes, error returns, and cleanup;
- state machine: states, events, guards, transition actions, failure/recovery, terminal states, and ignored or illegal events;
- data/lifecycle: creation, initialization, ownership, reads/writes, cross-layer handoff, persistence, concurrent access, invalidation, reclamation, and release.

Do not use mechanical node or edge counts as a quality target. Split a diagram when its labels or branches cannot remain readable at Word body width. Preserve a source-backed overview plus focused branch/subflow diagrams; do not delete exception paths or indefinitely shrink a figure to keep one graph.

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

When Word output is requested, call `create_word_document` with object-shaped top-level arguments containing `title`, optional document fields, and `sections`. Do not wrap the arguments in another object and do not pass stringified JSON, Markdown, or prose.

Treat the tools listed in this skill's frontmatter as permissions, not proof that they are exposed in the active runtime. Before assembling a full detailed-design Word document, confirm that `create_word_document` and `apply_word_document_edits` are actually available. Confirm `render_mermaid_diagram` is available before promising newly rendered figures; a source-mapped, visually reviewed existing PNG may be reused when rendering is unavailable. If `create_word_document` is unavailable, or a full document needs chunked assembly but `apply_word_document_edits` is unavailable, report the blocked deliverable instead of inventing another Word-generation path. A genuinely small single-chapter or narrow-scope document may still use one bounded `create_word_document` call.

For a full detailed-design Word document, use this native bounded assembly sequence:

1. Finish the evidence-backed outline and render or identify every available PNG before Word creation.
2. Choose one stable `taskSlug` and one stable `.docx` `outputFile` for the complete mutation chain. Call `create_word_document` once with a lightweight structural skeleton in this exact front-matter order: the tool's real `title`, optional document type/author, summary paragraphs, one summary item whose complete text is exactly `{{TOC}}`, then the first real Heading 1 section `阅读路径` followed by the remaining canonical headings and unique H2/H3 insertion anchors. Add every successfully rendered image block in its final semantic location. Exclude long prose, long lists, large tables, and code bodies from this initial call. Do not put `{{TOC}}` inside a chapter, combine it with other text, repeat it, or write a manual directory as Normal paragraphs.
3. Fill the skeleton in canonical order with serial `apply_word_document_edits` calls. Pass the stable `taskSlug` and `outputFile` explicitly on every mutation so the delivered filename does not accumulate `-edited` suffixes. One main chapter or one important-submodule design unit is the maximum batch size, not a minimum; split a larger unit across unique H2/H3 anchors. Insert non-image paragraphs, lists, tables, and code after each unique anchor exactly once so repeated `insert_after_heading` calls cannot reverse content order.
4. Keep one authoritative Word path. Every edit, late image insertion, style operation, field operation, inspection, and render uses the path returned by the immediately preceding successful mutation.
5. After all chapter batches and late image repairs are complete, call `materialize_word_fields` with `tocMode: "materialize"` plus the same stable `taskSlug` and `outputFile`. This must replace the standalone placeholder with the native Word TOC field; it must not create a static list of heading text. Inspect the final title, outline and image count, and only then run `render_word_document` and page visual review.

Do not place an image block inside `apply_word_document_edits`; structural edits do not support adding images. A late successfully rendered PNG must be inserted with `insert_mermaid_into_word` at a unique figure heading, and the returned Word path becomes the new authoritative path.

If a large or malformed `create_word_document` call fails, reduce it immediately to the lightweight skeleton instead of retrying the same payload. If a chapter edit is too large, split it across smaller unique subsection anchors. If the smallest meaningful subsection still fails, preserve the last successfully returned DOCX, report the exact missing subsection and native tool error, and do not start a competing document branch.

Never write a giant tool payload to a temporary JSON file or use shell commands to bypass the structured Word tools. Do not run `pip install`, `npm install`, `apt install`, `python-docx`, a custom Python or Node DOCX generator, `node-docx`, Pandoc, LibreOffice, or `soffice` as a model-selected creation or fallback route. The local LibreOffice/Poppler fallback encapsulated inside `render_word_document` remains valid because it renders an existing DOCX; it is not an alternate authoring path.

If Mermaid rendering is unavailable and there is no source-mapped, visually reviewed existing PNG, record the figure as missing and disclose the gap. Do not substitute Mermaid source, an ASCII diagram, a text box, or a prose-only pseudo-diagram as if the required PNG existed.

For every successful Mermaid render, add this shape directly to the target section's ordered `blocks` array:

```json
{
  "type": "image",
  "path": "<pngPath returned by render_mermaid_diagram>",
  "contentType": "image/png",
  "title": "Figure title",
  "caption": "Figure explanation",
  "altText": "Accessible description",
  "width": 480,
  "height": 280
}
```

Use the `blocks` order to place explanatory text, image, title, and caption in the intended chapter. Prefer the returned cropped display `width` and `height` when they fit the page; retain `pixelWidth` and `pixelHeight` as high-DPI render QA evidence rather than Word display dimensions. Use `scale: 3` and a white background by default; use `scale: 4` only after a dense diagram has already been simplified or split.

Before inserting any PNG, open it at 100% and inspect the whole composition, then inspect text, edge labels, and arrows at 200%. Also compare its visible title, node vocabulary, structure, and role with the diagram map so a correctly rendered but semantically wrong or duplicated figure cannot pass. Reject and rerender figures with excessive whitespace, clipping, overlap, missing arrows or branches, unreadable labels, distorted proportions, unexpected backgrounds, unintended duplicate content, or insufficient source-backed detail. Record the result in the diagram map; metadata, successful render status, distinct file hashes, or image counts alone are not visual inspection.

The default Word format is Codex `standard_business_brief`: US Letter portrait, one-inch margins, Calibri 11 pt body text, the standard blue H1/H2/H3 ladder, real numbering, fixed-DXA tables, quiet running header, and a right-aligned page number. For a full detailed design, place one standalone `{{TOC}}` summary paragraph after the real Title/Subtitle/summary and before the first Heading 1. Use the existing `materialize_word_fields` tool only after all chapter and late-image mutations so the native Word table of contents is derived from the final real heading structure. The directory heading uses a non-outline TOC style and the title, directory, and first chapter remain distinct page regions.

## Canonical Full-Document Outline

The default Word outline is:

1. Reading path
2. Terminology, scope, and evidence baseline
3. Parent-system positioning and target-module role
4. Target-module responsibilities, boundaries, and architecture
5. Business capability overview
6. Detailed main business flows
7. Internal architecture and submodule decomposition
8. Target-module implementation details
9. One continuous detailed-design chapter per important submodule
10. Cross-module collaboration and end-to-end paths
11. Global object, interface, state, configuration, and build index
12. Cross-module algorithms, concurrency, resources, and performance
13. Debugging, observability, and source-reading guide
14. Function, feature, diagram, and evidence coverage
15. Existing-document differences and feature evolution when an earlier document exists
16. Assumptions, limitations, risks, and owner-review items

Keep the first seven topics visible near the front because they provide the reusable new-maintainer path, terminology/scope map, detailed business loop, and submodule decomposition. Chapters 8 and 9 carry local depth. Chapters 10 through 14 summarize and index cross-cutting concerns without replacing local design-unit content. Omit chapter 15 when there is no earlier document.

Before calling `create_word_document`, confirm that every successful render in the diagram map has a corresponding image block in the lightweight skeleton and that every later content batch has a unique heading anchor. Do not require the initial call to carry the document's long-form prose, tables, lists, or code. After all serial chapter edits, field operations, and late image insertions, call `inspect_word_document`. Require exactly one inspected paragraph with `styleId: "Title"` and the exact planned document title, require no remaining `{{TOC}}`, and require the first outline entry to be `阅读路径`, followed by `术语、范围与证据基线`. Also require `imageCount` to equal the number of successfully rendered figures planned for insertion. If any front matter or chapter is missing or reordered, repair the last authoritative DOCX before delivery. If image counts differ, reuse the existing PNGs with `insert_mermaid_into_word` for the missing figures only, then inspect again; do not regenerate unrelated content.

Mutations to the same Word document are strictly serial. Diagram rendering may run in parallel, but `apply_word_document_edits`, `insert_mermaid_into_word`, style/field operations, and other writes targeting one DOCX must form a single chain: every call uses the path returned by the immediately preceding successful mutation. Never launch parallel insertions from the same source DOCX, because their outputs are sibling forks rather than cumulative edits. Keep one authoritative working path, update it after every successful call, and do not mark Word assembly complete while any successful planned figure is absent or `inspect_word_document.imageCount` differs from the diagram map.

After any Word repair, re-run `inspect_word_document` against the authoritative path and compare both structure and figures with the plan. The Title paragraph, native TOC materialization result, first outline entry, expected outline order, every target-module and important-submodule design-unit heading, later cross-module chapters, captions, image relationships, and image count must still be present. An image-count match does not compensate for a missing chapter. It also cannot compensate for a missing cover title, missing first chapter, static fake directory, collapsed image relationship, repeated wrong figure, or reordered design unit.

For a full Word delivery from this skill, call `render_word_document` after the image-count and outline checks so the configured Render Service can render pages and return visual evidence. A completed render is not a completed review: open every returned page PNG at 100%, and inspect pages containing complex diagrams, tables, or code again at 200%. Check blank or near-blank pages, clipping, overflow, overlap, broken tables, orphan headings, separated titles/captions, tiny or blurry labels, unexplained whitespace, repeated wrong figures, and header/footer/page-number defects. Automated `pageQa`, ink ratios, edge checks, successful render status, or a model statement that it cannot view images cannot substitute for actually opening all pages. If the active environment cannot open them, record page visual review as skipped and do not mark the visual checklist complete. Fix the Mermaid source or Word layout, rerender the complete document, and repeat the all-page review. If both remote and local render paths are unavailable, keep the Word delivery, record `visualQaStatus: skipped`, disclose the reason, and do not claim page-image visual QA passed.

## Final Word Location Rule

When a Word document is generated successfully, end the final user-facing response with a clearly labeled `Word 文档位置` section. Report both the containing directory and the final authoritative `.docx` file path returned by the completed create/edit/repair chain. Prefer a workspace-relative path and also include the absolute path when it is available, so the user can locate the document without searching artifact manifests or earlier tool output. This location section must be the last user-facing section, not buried in a progress summary. If Word generation failed or no `.docx` was produced, state that explicitly and do not report a placeholder, stale intermediate path, or planned output directory as the delivered document location.

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
- every successful Mermaid render has a target-section image block;
- `inspect_word_document.imageCount` matches the successfully rendered and planned figure count after any bounded repair;
- every mutation of the same DOCX was serialized through one authoritative returned-path chain, with no parallel sibling forks;
- the final inspected outline and figure relationships still match the planned chapters, local design units, captions, and diagram identities after every repair;
- every produced PNG was inspected at 100% and text/edges at 200%;
- every rendered Word page was inspected, with complex figure/table/code pages checked again at 200%;
- render QA status is recorded when render QA was requested or configured;
- review notes record unresolved evidence gaps, skipped optional diagrams, skipped render QA, and owner-review items.

Do not run or expect a migrated ChipMate artifact validator. Do not turn missing diagrams, missing render output, or skipped optional Word/PDF output into a global automatic contract-planning prompt. The image-count check and bounded reuse of an existing PNG apply only inside an explicitly requested Word delivery using this skill.

## Continuation Protocol

This workflow can support multiple sessions for large deliverables. Task state should be written to files when the document effort spans turns or when the user requests a resumable artifact.

At the end of each incomplete turn, update:

- `resume-state.md`;
- `continue-prompt.md`;
- `review-notes.md`.

When resuming a saved detailed-design effort, read those files first, then continue from the first incomplete work package. Do not let a checkbox hide unresolved owner-review items or evidence gaps.
