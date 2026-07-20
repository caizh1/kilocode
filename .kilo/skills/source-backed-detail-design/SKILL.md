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

This is a Kilo built-in skill using the native skill mechanism. It is not a ChipMate runtime pipeline, not question routing, not a migrated Word/document contract, and not a replacement for Kilo ordinary QA. The model owns scope discovery, evidence planning, work-package sequencing, diagram semantics, section writing, artifact selection, and Word document assembly. Kilo tools execute evidence retrieval, artifact writes, Mermaid rendering, generic Word generation, Word edits, and optional render QA.

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
- diagrams: target-module and confirmed-submodule architecture, business, code, state-machine, and data/lifecycle views, plus readable split views for complex flows;
- Word delivery: generic create/edit/style/merge/diff tools, ordered image blocks, standard business formatting, native TOC, image identity checks, and page-image visual review;
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

## Required Reference Loading

References are progressive instructions, not runtime contract metadata. For a full Word detailed-design delivery, read and record `references/01-core-principles.md` through `references/10-detail-design-output-templates.md`, plus `references/12-word-export-rules.md`, `references/13-quality-gates-and-validator.md`, and `references/15-business-flow-abstraction-rules.md`, before drafting the document. Read `references/11-feature-diff-completeness-rules.md` when an earlier document is supplied. Read `references/14-continuation-checkpoint-protocol.md` whenever the task spans turns or needs resumable state.

A single-chapter, single-submodule, state-machine-only, difference-only, or quick-update request reads only the references listed for its active work packages. Missing materialized references are a disclosed delivery limitation; they do not change skill routing or ordinary QA. A full Word delivery must not silently skip a required reference and still claim complete coverage.

| Work package | References |
|---|---|
| input-and-scope | `references/01-core-principles.md`, `references/02-input-and-module-scope-rules.md`, `references/14-continuation-checkpoint-protocol.md` |
| source-evidence | `references/03-source-exploration-rules.md` |
| control-flow-evidence | `references/04-control-flow-evidence-schema.md`, `references/05-submodule-business-flow-rules.md`, `references/06-state-machine-extraction-rules.md` |
| business-flow-abstraction-and-diagrams | `references/15-business-flow-abstraction-rules.md`, `references/07-diagram-planning-and-splitting-rules.md`, `references/08-mermaid-png-rendering-rules.md` |
| code-level-submodule-diagrams | `references/05-submodule-business-flow-rules.md`, `references/07-diagram-planning-and-splitting-rules.md`, `references/08-mermaid-png-rendering-rules.md` |
| state-machine-diagrams | `references/06-state-machine-extraction-rules.md`, `references/08-mermaid-png-rendering-rules.md` |
| target-module-diagram-and-context | `references/09-parent-module-assembly-rules.md` |
| enhanced-detail-design | `references/10-detail-design-output-templates.md` |
| diff-and-feature-report | `references/11-feature-diff-completeness-rules.md` |
| review-and-word-export | `references/12-word-export-rules.md`, `references/13-quality-gates-and-validator.md` |

## Content-first Work Package Order

For a broad end-to-end detailed-design deliverable, use this order:

1. locate the parent context, target module, source regions, and candidate submodules;
2. collect source, control-flow, state, data-ownership, build, and business evidence;
3. freeze the complete ordered target/confirmed-submodule census with evidence-backed exclusions;
4. draft the complete fourteen-topic content unit and evidence table for the target and every confirmed submodule;
5. derive and validate each unit's five semantic views and any focused diagrams from those completed content units;
6. freeze the final ordered Word outline, including every target and submodule H1/H2/H3 heading and unique content anchor;
7. create the lightweight Word skeleton with available PNGs, then fill prose and tables serially by exact anchor;
8. materialize the native TOC, inspect structure and image identity, render all pages, and complete visual review;
9. add existing-document differences when applicable and publish final coverage, limitations, and owner-review notes.

Scale or skip packages only for an explicitly narrow request. Do not begin Mermaid authoring from a name inventory, and do not begin Word assembly while content units, evidence, or required diagrams are missing. If an execution boundary is reached, persist the completed evidence, content units, figure state, and continuation point instead of compressing or omitting remaining submodules.

## Delivery Scope Variants

- A full Word delivery uses the canonical full-document outline, all applicable design units, five source-backed view types, coverage reporting, image checks, and page visual review.
- A single-chapter or single-submodule delivery keeps terminology, scope, and evidence context but expands only the requested design unit and its applicable views.
- A state-machine-only delivery keeps scope, state ownership, dispatch, transitions, guards/actions, handlers, failure/recovery behavior, and evidence without forcing unrelated Word chapters.
- An existing-document update rebuilds conclusions from current source, uses the existing generic Word edit/style/diff tools, and treats old prose only as a clue or comparison input.
- A source-versus-document difference report keeps symbol-evolution mapping and `Both` / `CodeOnly` / `DocOnly` capability classification without requiring a new full Word document unless requested.
- A quick update may reduce work packages, but it must disclose skipped analysis, unavailable evidence, and unreviewed figures or pages.

Do not expand a narrow request into a full Word deliverable, and do not use any scope variant as a reason to alter skill discovery, permissions, or ordinary QA behavior.

For a full multi-submodule task, create `resume-state.md`, `continue-prompt.md`, and `review-notes.md` before Word assembly so work can continue without shrinking the requested scope. Do not create these files for ordinary QA or short narrow document tasks.

## Output Root and Artifact Guidance

Use workspace-safe `<module-name>_source_backed_detail_design/`, preferably via `declare_artifact`, with existing `00-input/` through `08-word-export/` work packages. Record logical-to-actual Mermaid paths in `04-diagrams/diagram-index.md`.

## Scope and Parent-to-Core Rule

Map parent context, the requested target module, core implementation, and source-backed handoffs before conclusions. Do not collapse the target into its densest file. Use bounded relationship wording and owner-review items for uncertain mappings.

## Terminology and Confidence Rule

Resolve names and ownership from evidence; never invent acronym expansions. Start with a terminology/scope table containing requested and source names, meaning or `UNKNOWN`, evidence, confidence, and owner-review. Use `source_confirmed`, `high_confidence`, `medium_confidence`, `low_confidence_review`, or `not_confirmed`; uncertain claims belong in gaps and risks.

## Word Output Language Rule

Default Word prose, headings, tables, captions, conclusions, review notes, and business-diagram labels to Simplified Chinese. Preserve source symbols, paths, config keys, standards, products, tools, abbreviations, and status tokens. Use `中文说明（Original Term）` only for a well-supported translation; otherwise retain English and explain it in Chinese. Keep code-flow symbols exact and terminology consistent.

## Required Content

The document must teach a new maintainer how the current implementation works, not merely prove that source symbols were found. Include the reading path; terminology and scope; parent and target boundaries; exhaustive submodule census; business capabilities and complete business flows; implementation, functions, design objects, interfaces, states, algorithms, configuration/build, concurrency/performance, errors and observability; diagrams; evidence/coverage; differences; assumptions, risks, and owner-review items. Report coverage as `PASS / PARTIAL / MISSING / N/A`.

The target module and every confirmed submodule require one continuous local content unit. A heading, one-line overview, function list, state list, macro list, structure list, or diagram alone is not detailed design. Each unit must explain business meaning before implementation detail and must cover all fourteen topics in the Design Unit Template. If a topic applies but is only named or listed, mark it `PARTIAL`; if it is absent, mark it `MISSING`.

For every business-flow family, explain the trigger, preconditions, business object, participants, ordered main path, decisions, handoffs, state/data/resource changes, wait and asynchronous behavior, retry/timeout/cancellation, failure/recovery/rollback/cleanup, terminal results, diagram interpretation, and source evidence. A function chain without this interpretation is not a business flow.

For every key function, explain responsibility, parameters and return value, preconditions and postconditions, callers and callees, local decisions and loops, state/data/resource side effects, synchronous or asynchronous completion, error behavior, cleanup, and line-level evidence. A table that contains only function names and one-line labels is incomplete.

## Key Design Objects Rule

Do not present structures, variables, enums, macros, queues, caches, bitmaps, or tables as a flat inventory:

- structures: explain important field semantics, creator, initializer, owner, readers/writers, mutation points, lifecycle, consistency rules, concurrency risks, and related flows;
- global/context objects: explain stored state, initialization and reset timing, readers/writers, boundary values, invalidation, cleanup, and ownership transfer;
- enums and state fields: explain state meaning, entry condition, triggering event, guard, action, exit condition, next state, side effects, and evidence;
- queues, caches, bitmaps, and tables: explain capacity/index rules, producer/consumer relationship, full/empty or hit/miss behavior, aging/timeout, merge/split behavior, persistence, invalidation, and release;
- macros and configuration: explain the controlled path, enabled/disabled behavior, default or platform value when evidenced, performance/resource effect, and review items.

A field-name list is not a lifecycle explanation, and a macro list is not configuration or performance design.

## Interfaces and Collaboration Rule

Separate external/public, internal, cross-module, callback/asynchronous, queue/notification/handoff, and hardware/register/DMA/adapter interfaces. For each key interface explain caller, callee, parameters, return or completion result, precondition, postcondition, call timing, synchronous/asynchronous behavior, state/data/resource side effects, failure behavior, and source evidence. For callbacks, queues, hardware submissions, and cross-layer notifications, include the complete request-to-completion sequence. An API-name list is `PARTIAL`, not interface design.

## Algorithms, Strategy, and Performance Rule

Explain non-trivial scheduling, caching, mapping, merge/split, allocation, retry/timeout, state-progression, concurrency, and recovery mechanisms as strategies. For each strategy include its objective, inputs, rules or pseudo-code, boundary conditions, failure path, complexity or performance impact, thresholds/capacity/queue depth/timeout, hot path and bottleneck, platform or feature variation, tuning knobs, and evidence. Configuration values are inputs to the strategy; listing values alone is not a performance analysis.

## Evidence-backed State Machine Rule

A state-machine section must identify the persistent state owner and provide an evidence-backed transition table containing current state, event or trigger, guard, transition action, next state, state/data/resource side effects, failure or ignored-event behavior, and source location. A state-enum list, switch cases, handler table, opcode dispatch, result field, or lifecycle stage list does not prove a state machine. If the complete state audit proves no persistent `current state -> event/trigger -> guard/action -> next state` relationship, use evidenced `N/A`; otherwise unresolved transitions are `MISSING`.

## New Maintainer Reading Rule

Provide four reading routes near the beginning: big-picture understanding, core-flow understanding, point-reading code inspection, and debugging/performance investigation. Start each major chapter with a concise design conclusion and end it with what the reader should now understand plus source entry points for deeper inspection. Do not finish a chapter with an unexplained source or symbol list.

## Target Resolution Rule

Keep these roles distinct:

- `context parent`: an owning or enclosing module used only to explain where the subject sits, its external boundary, and upstream/downstream handoffs;
- `target module`: the document subject and the one root target DesignUnit that owns chapters 4 through 8, the complete fourteen-topic content, and five-view coverage;
- `confirmed submodule`: an independently evidenced child owned inside the target module; each receives its own local chapter and five-view coverage.

Resolve the target before drafting, diagram planning, or Word creation. An explicit user statement such as “以 Worker 为主体” wins. When multiple names form a source-confirmed ancestor/descendant chain, choose the deepest, most specific named module as the target and record every named ancestor as a context parent. Therefore a compact request such as “生成 Platform Worker 模块的详细设计” means “document Worker in the context of Platform” when source evidence confirms `Platform -> Worker`. If the names are siblings, the hierarchy is unproven, more than one deepest candidate remains, or the user explicitly asks for multiple modules separately, do not silently collapse the request: obtain the intended subject or delivery split before drafting. A directory, file, or helper function alone is not a module boundary.

Context parents are not DesignUnits and do not receive mandatory fourteen-topic chapters, `FsmAudit`, five-view slots, or figure-count credit. Chapter 3 may include a source-backed context architecture or interaction figure when useful, but that optional figure cannot satisfy any target or confirmed-submodule slot. A context parent becomes a target only when the user explicitly requests its own detailed design.

Before deciding which submodules are confirmed, search the target roots, public interfaces, build/registration files, initialization and cleanup owners, upstream/downstream call paths, persistent state owners, data/resource/queue/cache owners, error/recovery paths, and platform/configuration variants until a terminal pass finds no new ownership boundary. Record positive and zero-result evidence, consume truncated continuations, and preserve every discovered candidate in the decomposition table. Use `references/03-source-exploration-rules.md` for the exact discovery closure schema and equations; keep those bookkeeping details out of the narrative body.

Every candidate ends as exactly `confirmed_submodule` or evidence-backed `excluded_non_submodule`. Confirm a coherent responsibility from at least two independent signals, or from one strong source signal such as a build target/registration, stable public interface, independent persistent state machine, or independent data/resource ownership. Exclusion requires itemized counter-evidence proving alias/duplicate ownership or lack of an independently owned responsibility; the label `helper` or `adapter` is not enough. Do not silently drop, merge, rename, downgrade, or exclude a candidate to reduce writing or diagram work. Every confirmed candidate maps to exactly one design unit, and every confirmed design unit receives a complete local chapter and five-view coverage.

## Hybrid Chapter Placement Rule

Use a hybrid structure:

- global opening chapters establish reading paths, terminology, source-backed scope, parent context, target-module role, target capabilities, the detailed main business loop, and internal decomposition;
- the target module and every confirmed submodule then receive one continuous local detailed-design unit;
- global closing chapters contain only cross-module collaboration, ownership, state handoff, shared configuration/build concerns, resource contention, indexes, coverage, differences, and review items.

A global object list, interface list, code-flow chapter, state-machine chapter, or performance chapter cannot satisfy missing local detail for a confirmed submodule. Link summary rows back to the owning design unit instead of duplicating its detailed prose.

Canonical chapters 4 through 8 together form the target module's one continuous design unit: chapter 4 owns its architecture base slot, chapter 6 owns its one business-flow base slot, chapter 7 decomposes only the target module and owns no five-view slot, and chapter 8 owns its data/lifecycle, code-flow, and state-machine slots plus the remaining implementation detail. The chapter-6 master business flow is the target unit's unique business-flow primary figure; chapter 8 references it and must not insert or count it again. Chapter 9 then contains one continuous local design unit per confirmed submodule owned inside the target. Chapter 3 alone introduces context parents and must not turn them into the document subject.

## Design Unit Template

The target module and every confirmed submodule must follow this semantic order. Use natural source-backed headings, but do not reorder implementation detail ahead of business meaning:

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

Place the unit's architecture, business-flow, data/lifecycle, code-flow, and state-machine or evidenced-`N/A` views next to the matching subsections. For an important state machine, cover dispatch, overview, transition conditions, error/retry/timeout behavior, and handler details through as many readable figures as the evidence needs. The prohibition on mechanical figure counts applies only to node counts, edge counts, and how many focused figures a complex view needs; it never permits skipping a confirmed design unit or one of its five semantic coverage slots.

For the target module, place an internal-decomposition table after its architecture and before drilling into submodule implementation. The table must include candidate ID, submodule name, source location, discovery signals, business role, responsibility, inputs/outputs, upstream/downstream collaboration, key state or lifecycle object, confirmation decision and basis, exclusion or merge owner when applicable, importance/depth decision, destination detail section, evidence, and confidence. Print candidate, confirmed, excluded, and unmapped counts beside the table. Every row whose confirmation decision is `confirmed_submodule` must have a continuous local chapter and full five-view coverage; any unmapped candidate blocks a full-delivery `PASS`.

For every capability and main-flow family, explain the trigger, preconditions, business object, participating units, main path, conditions, wait/retry/error/recovery branches, terminal outcome, state/data/resource effects, and evidence. Do not impose a fixed number of capabilities or flows.

## Diagram Requirements

Use Mermaid for formal detailed-design diagrams. Generate PNG figures with `render_mermaid_diagram` or save known-good PNGs with `save_mermaid_artifact`. Mermaid source alone is not a figure unless the user explicitly asks for source code blocks.

After every design unit's content draft and evidence table are complete, freeze separate `CoverageSlot` and `DiagramRequirement` ledgers so missing or duplicated figures cannot hide inside a count. The coverage ledger has one row for each target/submodule and semantic view; the requirement ledger maps every base or focused diagram to its owning unit/view, source evidence, Mermaid source, validation state, PNG identity, target section, visual review, and Word insertion. Use `references/07-diagram-planning-and-splitting-rules.md` and `references/13-quality-gates-and-validator.md` for the exact schemas and equations rather than carrying that bookkeeping through the main narrative instructions.

Each non-`N/A` base slot requires at least one unique primary diagram. Mermaid source, ASCII or text-box diagrams, generic or duplicate visuals, placeholder PNGs, and images without semantic source validation satisfy zero coverage slots. Only a unique, source-backed, syntax-validated, semantic-validated, successfully rendered and visually approved PNG may satisfy one design unit and one view type. Cross-module overview figures and focused split figures are additional figures and cannot be counted again as another unit's primary view. For each successful render, retain the returned display dimensions, pixel dimensions, scale, warnings, and QA issues. Put every required rendered PNG into the lightweight initial Word skeleton as an image block at the exact intended position in `sections[].blocks[]`; use the returned `pngPath` instead of embedding base64 when a path exists. Structural Word edits cannot add new image blocks, so use `insert_mermaid_into_word` serially for a late, missing, or skeleton-size fallback insertion after the initial Word document has been created.

For a full detailed-design deliverable, use this coverage matrix. `Required` means the view must be present, unique to its design unit/view, source-backed, rendered, inserted next to the corresponding explanation, and visually reviewed. Give every design unit an `FsmAudit` covering state storage/enums, state reads and writes, events/triggers, dispatch/handlers, initialization, terminal/error/recovery paths, and unresolved candidates. Its decision is exactly `PRESENT`, `N/A`, or `MISSING`. A state-machine view may be `N/A` only after a complete negative audit; incomplete evidence or unknown transitions are `MISSING`, not `N/A`.

| Design unit | Architecture | Business flow | Code flow | State machine | Data/lifecycle |
|---|---|---|---|---|---|
| Target module | Required | Required | Required | Required or evidenced `N/A` | Required |
| Every confirmed submodule | Required | Required | Required | Required or evidenced `N/A` | Required |

Context parents are excluded from this matrix. An optional context-parent overview is an additional orientation figure, not a base slot and not a substitute for a target or confirmed-submodule figure.

Each view must cover its distinct semantics:

- architecture: boundaries, responsibilities, internal components, inputs/outputs, upstream/downstream dependencies, shared context, queues, caches, and adapters;
- business flow: trigger, input object, complete happy path, business decisions, failure, retry, wait, timeout, cancellation, recovery, and terminal outcomes;
- code flow: entry functions, call layers, branches, loops, callbacks, asynchronous completion, state/data writes, error returns, and cleanup;
- state machine: states, events, guards, transition actions, failure/recovery, terminal states, and ignored or illegal events;
- data/lifecycle: creation, initialization, ownership, reads/writes, cross-layer handoff, persistence, concurrent access, invalidation, reclamation, and release.

Do not use mechanical node or edge counts as a quality target. Derive focused figures from real multi-entry flows, asynchronous wait/callback/timeout/cancellation chains, independent error/retry/recovery paths, persistent FSM domains, ownership/lifecycle families, and meaningful platform/build/initialization variants. Multiple instances may share a focused diagram only within the same design unit and view when the merged semantics and evidence remain explicit and readable. Never share one primary diagram across design units or base slots, delete exception paths, or indefinitely shrink a dense figure.

Track source validation, render outcome, visual review, and Word insertion independently. A planned source or successful render is not enough. A concrete child-source or PNG blocker may produce a useful `PARTIAL` artifact, but it cannot pass and must not be hidden by target summaries or context-parent figures. Never invent Mermaid source merely to report an attempt, and never use a failed child figure as a reason to skip target-module attempts.

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

When Word output is requested, call `create_word_document` with object-shaped top-level arguments containing `title`, `language: "zh-CN"`, `documentType: "详细设计"`, `headingNumbering: "decimal"`, optional document fields, and `sections`. Do not wrap the arguments in another object and do not pass stringified JSON, Markdown, or prose.

Treat allowed tools as permissions, not runtime availability. For the exact Word mutation, fallback, TOC, inspection, and visual-QA protocol, read `references/12-word-export-rules.md`; it is authoritative for this work package. The core sequence is:

1. Complete the discovery census, ordered design-unit list, fourteen-topic content draft, and evidence table for the target and every confirmed submodule. Do not replace unfinished content with shorter prose in order to reach Word creation.
2. Derive, validate, render, and visually review every required base and focused diagram from those completed content units. A concrete blocker remains `PARTIAL`, but never let a child PNG failure prevent target-module attempts.
3. Freeze the final ordered outline before calling `create_word_document`. The bounded skeleton contains the real title, `language: "zh-CN"`, one summary item whose complete text is exactly `{{TOC}}`, every final H1/H2/H3 heading in order, one unique content anchor for every prose/table batch, and every available PNG at its intended location. Do not hand-number headings or write a manual directory as Normal paragraphs.
4. Fill prose and tables serially through exact anchors with `apply_word_document_edits`, at most one chapter or design unit per batch. Never append a completed unit at the document end merely because its anchor is missing or ambiguous. If a unit is too large, split it across its predeclared H3 anchors. Each anchor is consumed once, and every mutation uses the path returned by the immediately preceding successful mutation plus the stable output name, so the document does not fork or accumulate `-edited` suffixes.
5. Structural edits never carry images. Insert late PNGs serially through `insert_mermaid_into_word` with its required `source` argument, unique heading, plain Chinese title/alt text, and visible figure-ID caption. Mermaid source, ASCII, or prose cannot masquerade as a PNG.
6. After all content and image mutations, call `materialize_word_fields` with `tocMode: "materialize"`, inspect the exact title and frozen outline order, render, adopt a verified `refreshedDocxPath`, and inspect again. Never use temporary JSON, `pip install`, `python-docx`, custom DOCX scripts, Pandoc, or shell LibreOffice as an authoring fallback.

For every successful Mermaid render, add this shape directly to the target section's ordered `blocks` array:

```json
{
  "type": "image",
  "path": "<pngPath returned by render_mermaid_diagram>",
  "contentType": "image/png",
  "title": "中文图题",
  "caption": "[DU-<designUnitId>/<viewType>/<diagramId>] 中文图注",
  "altText": "完整的中文可访问性说明，源码符号保持原样",
  "width": 480,
  "height": 280
}
```

Use the returned cropped display size, `scale: 3`, white background, and Codex `standard_business_brief`. For every PNG, open it at 100% and inspect labels/arrows at 200%; reject clipping, overlap, missing branches, unreadable text, wrong semantics, or duplicate content. Distinct paths, hashes, and image counts are not visual review. Keep the real Title, native directory, and first chapter as separate regions.

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
9. One continuous detailed-design chapter per confirmed submodule
10. Cross-module collaboration and end-to-end paths
11. Global object, interface, state, configuration, and build index
12. Cross-module algorithms, concurrency, resources, and performance
13. Debugging, observability, and source-reading guide
14. Function, feature, diagram, and evidence coverage
15. Existing-document differences and feature evolution when an earlier document exists
16. Assumptions, limitations, risks, and owner-review items

Keep the first seven topics visible near the front because they provide the reusable new-maintainer path, terminology/scope map, detailed business loop, and submodule decomposition. Chapters 4 through 8 jointly carry the target module's local design unit, and chapter 9 carries each confirmed submodule's local depth. Chapters 10 through 14 summarize and index cross-cutting concerns without replacing local design-unit content. Omit chapter 15 when there is no earlier document.

Before Word creation require every content unit, evidence table, and diagram ledger to be terminal. Track `skeletonRelationshipIds`, `lateInsertedRelationshipIds`, `replacedRelationshipIds`, `removedRelationshipIds`, and final IDs by inspected set difference. After every repair call `inspect_word_document` with `maxParagraphs: 1000` and `maxTables: 200`; require one exact `styleId: "Title"`, no `{{TOC}}`, the first outline entry to be `阅读路径`, the complete frozen target/submodule order, `paragraphsTruncated: false`, and `tablesTruncated: false`. Reconcile every actual drawing occurrence by its `headingPath`, caption, visible figure ID, alt text, relationship ID, media path, and hash. `imageCount` remains only a coarse relationship count and cannot compensate for missing content, a misplaced unit, or a duplicated semantic figure.

Call `render_word_document` only after structural checks. Keep `pageEvidenceStatus` separate from model-owned `pageReviewStatus`; `visualQaStatus` is a compatibility alias, not human review. Require `fieldRefreshStatus: completed`, an authoritative `refreshedDocxPath`, and matching TOC heading, entry, and numeric page counts whenever a native TOC exists; a plain LibreOffice conversion or an updated DOCX without that explicit status is not field refresh. Require exact page count and open every page at 100%; inspect pages containing complex diagrams, tables, or code again at 200%. Automated `pageQa`, ink ratios, edge checks cannot substitute for actually opening all pages. If pages cannot be opened, use `pageReviewStatus: skipped`; if rendering is unavailable, record `pageEvidenceStatus: unavailable`. Report DOCX existence as `artifactStatus` and full scoped result as `acceptanceStatus`; any unresolved required item yields `acceptanceStatus: PARTIAL`.

## Final Word Location Rule

When a Word document is generated successfully, end the final user-facing response with a clearly labeled `Word 文档位置` section. It must report the absolute path of the final authoritative `.docx` returned by the completed create/edit/repair/render-refresh chain; a workspace-relative path may be included only as additional location help. Also report the containing directory. This location section must be the last user-facing section, not buried in a progress summary. Never report an intermediate file, planned path, stale file, or earlier mutation result as the delivered document. If Word generation failed or no `.docx` was produced, state that explicitly and do not fabricate an absolute path.

## Review Checklist

For a full detailed-design deliverable, review and report these items as `PASS / PARTIAL / MISSING / N/A` where relevant. This is a human-readable review checklist, not a runtime contract, not an automatic repair planner, and not a reason to trigger the skill when the skill tool is disabled:

- required references are loaded and recorded;
- module scope is written;
- source/control-flow/business evidence files are non-empty;
- the target and every confirmed submodule contain all fourteen local content topics with explanations rather than name lists;
- every key function, design object, interface, strategy, state transition, error path, and source entry is explained with the required semantics and evidence;
- required Mermaid source and PNG artifacts are paired or gaps are disclosed;
- edge coverage exists for required diagrams;
- the target module and every confirmed submodule have all five coverage slots resolved in their local sections, while context parents have no mandatory slots;
- enhanced detail design chapters exist;
- diff/feature report exists when an old design was provided;
- Word docx is generated by `create_word_document`;
- the coverage ledger contains every design unit and five semantic view types, and every non-`N/A` slot has a unique primary Mermaid PNG plus any required split figures;
- every required Mermaid render has a target-section image block or completed serial insertion;
- the discovery inventory has no silently omitted signal or candidate, and every confirmed candidate maps to exactly one complete local design unit;
- every detected complexity instance has evidence and an owning base or focused diagram; any merge remains within one design unit/view and preserves per-instance semantics;
- the final inspected relationship-ID set matches the recorded baseline, skeleton, late-inserted, replaced, and actually removed sets after any bounded repair;
- every mutation of the same DOCX was serialized through one authoritative returned-path chain, with no parallel sibling forks;
- the final inspected outline and caption-only visible figure IDs still match the planned chapters and local design units; inspection uses `maxParagraphs: 1000` and `maxTables: 200`, and `paragraphsTruncated: false` plus `tablesTruncated: false` or complete all-page QA proves the affected audits are exhaustive;
- every produced PNG was inspected at 100% and text/edges at 200%;
- every rendered Word page was inspected, with complex figure/table/code pages checked again at 200%;
- `artifactStatus` and `acceptanceStatus` are reported separately, and render QA status is recorded when render QA was requested or configured;
- the final report states design-unit count, base-slot count, evidenced state-machine `N/A` count, split-figure count, rendered count, inserted image count, visually reviewed count, and missing count;
- review notes record unresolved evidence gaps, required diagram status, skipped render QA, and owner-review items.

Do not run or expect a migrated ChipMate artifact validator. Do not turn missing content, diagrams, render output, or skipped optional Word/PDF output into a global automatic contract-planning prompt. These checks apply only inside an explicitly requested delivery using this skill. While required native tools remain available and bounded attempts have not failed, continue from the first unresolved content unit or figure instead of voluntarily stopping at `PARTIAL`. Use `PARTIAL` only for a user-approved narrower scope or a concrete disclosed blocker such as unavailable evidence/rendering, a minimum native Word mutation failure, user interruption, or an exhausted execution boundary. At an execution boundary, persist state and do not generate or claim a complete Word document. Never claim full design completion while a required content topic or view remains `MISSING`.

## Continuation Protocol

This workflow can support multiple sessions for large deliverables. For a full multi-submodule task, write resumable state before Word assembly; for other tasks, write it when the effort spans turns or the user requests a resumable artifact.

At the end of each incomplete turn, update:

- `resume-state.md`;
- `continue-prompt.md`;
- `review-notes.md`.

When resuming a saved detailed-design effort, read those files first, then continue from the first incomplete work package. Do not let a checkbox hide unresolved owner-review items or evidence gaps.
