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
  - validate_word_document
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

## Critical Full-Word Invariants

`SBDD_RULESET_REVISION=2026-07-long-task-gate-v1`. For a full Word task, resolve one source-evidenced target before drafting: explicit user intent wins, and an evidenced ancestor/descendant name chain defaults to its deepest, most specific member unless the user requests separate subjects. Before any DOCX, persist the scope lock; complete fourteen-topic prose for the target and every confirmed submodule; resolve five unique views per DesignUnit, with the state machine allowed only an evidence-backed `N/A`. Missing or duplicate content or figures keeps Word `not_started`. Put the sole `{{TOC}}` summary paragraph before the first Heading 1. After compaction or resume, reload this Skill and read `resume-state.md`. Never deliver an incomplete or working DOCX; end a successful final answer with its authoritative absolute path.

Use this Skill for source-backed detailed-design generation, update, comparison, diagrams, and Word delivery. It uses Kilo's native Skill and document tools; it is not a ChipMate runtime pipeline, question route, ordinary-QA replacement, contract, validator, or repair gate. The model owns scope, evidence, content, diagrams, and assembly.

## Non-goals and QA Boundary

Use this Skill only for explicit detailed-design, Word/docx, Mermaid, or source-backed documentation deliverables. Ordinary code QA continues through native evidence tools without artifacts. Do not migrate ChipMate planner, routing, CodeGraph UI, artifact contract, validator, repair steering, or global delivery gates, and do not change Kilo Skill discovery, ordinary QA, RAG, or tool-loop behavior.

## Non-contract Capability Preservation

Preserve scope discovery, line-level control-flow evidence, business abstraction, fourteen-topic local design units, five-view diagrams, existing-document diff, native Word/TOC, image and page visual review, narrow deliveries, and resumable work packages. Keep their detailed schemas in the existing references. Reorganizing chapters must not delete evidence, build/integration, update/diff, or continuation behavior.

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
| Word generation/inspection/editing/render QA | `create_word_document`, `inspect_word_document`, `validate_word_document`, `apply_word_document_edits`, `insert_mermaid_into_word`, `render_word_document` |

Do not call Mermaid tools to decide business semantics. The model must decide diagram type, main flow, exception flow, state role, split strategy, and figure placement from evidence and this skill's references. Mermaid tools only validate, render, save, and insert artifacts.

## Required Reference Loading

References are phase instructions, not runtime contracts. For full Word work load them progressively:

1. scope/evidence: `01`-`06`, `14`, `15`;
2. prose: `10`, then persist and audit every fourteen-topic unit;
3. diagrams, only after prose readiness: `07`-`09`;
4. Word/review, only after both gates are terminal: `12`-`14`.

Load `11` when an earlier document exists. Narrow requests load only their active work-package references. Missing required references are a disclosed limitation and cannot be called complete.

The reference groups are `input-and-scope` (`references/01-core-principles.md`, `02`, `14`), `source-evidence` (`03`), `control-flow-evidence` (`04`-`06`), `business-flow-abstraction-and-diagrams` (`07`-`09`, `references/15-business-flow-abstraction-rules.md`), `enhanced-detail-design` (`references/10-detail-design-output-templates.md`), `diff-and-feature-report` (`11`), and `review-and-word-export` (`references/12-word-export-rules.md`, `references/13-quality-gates-and-validator.md`).

## Content-first Work Package Order

For a broad end-to-end detailed-design deliverable, use this order:

1. resolve and persist the evidenced owning modules, one target module, source regions, and candidate submodules in `02-source-evidence/module-scope.md`;
2. collect source, control-flow, state, data-ownership, build, and business evidence;
3. freeze the complete ordered target/confirmed-submodule census with evidence-backed exclusions;
4. persist the complete fourteen-topic content unit and evidence table for the target and every confirmed submodule under `05-enhanced-detail-design/units/`, and update root-level `resume-state.md` plus `review-notes.md`;
5. prove prose readiness from those files; if any unit or applicable topic is incomplete, stop before Mermaid and Word work and preserve the continuation point;
6. derive and validate each unit's five semantic views and any focused diagrams from the completed content units;
7. freeze the final ordered Word outline, including every target and submodule H1/H2/H3 heading and exact `[[SBDD-CONTENT:<designUnitId>:<topicId>]]` paragraph anchor;
8. create a text-only, non-deliverable `*-working.docx`, fill every prose/table anchor serially, and pass the heading-body audit before inserting any PNG;
9. insert approved PNGs serially, materialize the native TOC, inspect structure, body coverage and image identity, render all pages, explicitly validate the authoritative DOCX with `validate_word_document`, and complete visual review;
10. add existing-document differences when applicable and publish final coverage, limitations, and owner-review notes.

Scale or skip packages only for an explicitly narrow request. Do not begin Mermaid authoring from a name inventory, and do not call `create_word_document` while prose readiness is false or required diagram inputs are unresolved. If an execution boundary is reached, persist the completed evidence, content units, figure state, and continuation point instead of compressing or omitting remaining submodules. An unfinished full-document task has no deliverable DOCX path.

## Delivery Scope Variants

- A full Word delivery uses the canonical outline, all scoped design units, five views, coverage, and visual review.
- A single-chapter or single-submodule delivery expands only the requested unit and keeps enough scope/evidence context.
- A state-machine-only delivery keeps state ownership, transitions, guards/actions, recovery, and evidence without unrelated chapters.
- An existing-document update rebuilds conclusions from current source with generic Word edit/style/diff tools.
- A source-versus-document difference report keeps symbol evolution and `Both` / `CodeOnly` / `DocOnly` without forcing full Word.
- A quick update discloses skipped analysis, unavailable evidence, and unreviewed figures or pages.

Do not expand a narrow request into a full Word deliverable or alter skill discovery, permissions, or ordinary QA.

For a full multi-submodule task, create `resume-state.md`, `continue-prompt.md`, and `review-notes.md` before Word assembly so work can continue without shrinking the requested scope. Do not create these files for ordinary QA or short narrow document tasks.

## Output Root and Artifact Guidance

Use workspace-safe `<module-name>_source_backed_detail_design/`, preferably reserving the artifact root via `declare_artifact`, with existing `00-input/` through `08-word-export/` work packages. Materialize Markdown evidence and unit files under that root with the runtime's existing workspace file-writing tool when it is exposed; do not use shell, Python, Node, or temporary JSON as a substitute. If no safe file-writing tool is exposed, prose readiness is blocked and Word creation must not start. Record logical-to-actual Mermaid paths in `04-diagrams/diagram-index.md`.

## Scope and Module-Relationship Rule

Map the internal owning-module role, requested target module, core implementation, and source-backed handoffs before conclusions. Do not collapse the target into its densest file. Use bounded relationship wording and owner-review items for uncertain mappings.

Keep system-architecture position, source ownership, owning-module relationship, callers/callees, data/state/control handoffs, dependencies, collaboration, management, and resource ownership as separate evidence dimensions everywhere they appear. Never infer one dimension from another. In particular, source containment does not prove system layering; an owning module is not automatically a business upstream or call entry; a call edge does not prove ownership; and a target located inside a system layer cannot also describe that same layer as its downstream. Use “管理” or “位于……之间” only with direct evidence for that exact relationship. Mark unsupported dimensions as `待确认` instead of completing them from industry conventions.

The stable internal scope key remains `context_parent`. Never expose that token or any literal translation of it in Word, Markdown work packages, tables, figures, captions, review notes, or final answers. Use the user-facing label “所属上级模块”, and only when source evidence establishes the relationship. Apply this rule globally rather than only in a particular chapter.

## Terminology and Confidence Rule

Resolve names and ownership from evidence; never invent acronym expansions. Start with a terminology/scope table containing requested and source names, meaning or `UNKNOWN`, evidence, confidence, and owner-review. Use `source_confirmed`, `high_confidence`, `medium_confidence`, `low_confidence_review`, or `not_confirmed`; uncertain claims belong in gaps and risks.

## Word Output Language Rule

Default Word prose, headings, tables, captions, conclusions, review notes, and business-diagram labels to Simplified Chinese. Preserve source symbols, paths, config keys, standards, products, tools, abbreviations, and status tokens. Use `中文说明（Original Term）` only for a well-supported translation; otherwise retain English and explain it in Chinese. Keep code-flow symbols exact and terminology consistent. Render internal scope roles with their approved user-facing Chinese labels; do not copy internal field names into the document.

## Required Content

The document must teach a new maintainer how the current implementation works, not merely prove that source symbols were found. Include the reading path; terminology and scope; system position, owning-module and target boundaries; exhaustive submodule census; business capabilities and complete business flows; implementation, functions, design objects, interfaces, states, algorithms, configuration/build, concurrency/performance, errors and observability; diagrams; evidence/coverage; differences; assumptions, risks, and owner-review items. Report coverage as `PASS / PARTIAL / MISSING / N/A`.

The target module and every confirmed submodule require one continuous local content unit. A heading, one-line overview, function list, state list, macro list, structure list, or diagram alone is not detailed design. Each unit must explain business meaning before implementation detail and must cover all fourteen topics in the Design Unit Template. If a topic applies but is only named or listed, mark it `PARTIAL`; if it is absent, mark it `MISSING`.

For every business-flow family, explain the trigger, preconditions, business object, participants, ordered main path, decisions, handoffs, state/data/resource changes, wait and asynchronous behavior, retry/timeout/cancellation, failure/recovery/rollback/cleanup, terminal results, diagram interpretation, and source evidence. A function chain without this interpretation is not a business flow.

For every key function, explain responsibility, parameters and return value, preconditions and postconditions, callers and callees, local decisions and loops, state/data/resource side effects, synchronous or asynchronous completion, error behavior, cleanup, and line-level evidence. A table that contains only function names and one-line labels is incomplete.

## Prose Readiness Rule

For every full Word task, prose readiness is a required, inspectable phase result rather than an internal claim. Persist `02-source-evidence/module-scope.md`, one `05-enhanced-detail-design/units/<designUnitId>.md` file per target or confirmed submodule, and root-level `resume-state.md` plus `review-notes.md` before any Word creation. Each unit file uses the fourteen-topic template and records every topic as `PASS`, evidence-backed `N/A`, or `MISSING`, with its explanation and evidence beside the status.

Prose readiness is true only when the resolved target is distinct from every evidenced owning module, the frozen DesignUnit count equals the number of complete unit files, and every applicable topic in every unit is explanatory `PASS` or justified `N/A`. A heading, picture, caption, list, table, source-symbol inventory, single summary sentence, or status checkbox cannot establish readiness. If any unit file, topic explanation, exception path, or evidence link is absent, keep Word state `not_started`, record the first incomplete item, and continue from the persisted drafts in a later turn. Do not create or report a partial DOCX merely to preserve progress.

After text is copied into Word, audit each final heading's own local range before image insertion. The range ends at the next heading of any level and must contain explanatory Normal/code content; a parent DesignUnit's aggregate coverage is checked separately across its child headings. Empty paragraphs, `{{TOC}}`, `[[SBDD-CONTENT:*]]` anchors, image titles, captions, figure IDs, drawings, and standalone lists or tables do not count as explanatory body. Container headings also require a short orientation paragraph before their first child heading. Any empty, image-only, list-only, table-only, or one-line-name section is `MISSING` or `PARTIAL`; repair it before inserting figures, materializing the TOC, treating the file as final, or reporting a Word path.

## Key Design Objects Rule

Do not present structures, variables, states, configuration, queues, caches, indexes, or tables as inventories. Explain meaning, creation/initialization, owner, readers/writers, mutations, capacity or boundary rules, lifecycle, invalidation/release, concurrency/consistency risks, affected flows, configuration behavior, and evidence. A field or configuration-name list is not lifecycle, strategy, or performance design; detailed object templates stay in reference `10`.

## Interfaces and Collaboration Rule

Separate external/public, internal, cross-module, callback/asynchronous, queue/notification/handoff, and source-evidenced adapter interfaces. For each key interface explain caller, callee, parameters, return or completion result, precondition, postcondition, call timing, synchronous/asynchronous behavior, state/data/resource side effects, failure behavior, and source evidence. For callbacks, queues, adapter submissions, and cross-boundary notifications, include the complete request-to-completion sequence. An API-name list is `PARTIAL`, not interface design.

## Algorithms, Strategy, and Performance Rule

Explain non-trivial scheduling, caching, mapping, merge/split, allocation, retry/timeout, state-progression, concurrency, and recovery mechanisms as strategies. For each strategy include its objective, inputs, rules or pseudo-code, boundary conditions, failure path, complexity or performance impact, thresholds/capacity/queue depth/timeout, hot path and bottleneck, platform or feature variation, tuning knobs, and evidence. Configuration values are inputs to the strategy; listing values alone is not a performance analysis.

## Evidence-backed State Machine Rule

A state-machine section must identify the persistent state owner and provide an evidence-backed transition table containing current state, event or trigger, guard, transition action, next state, state/data/resource side effects, failure or ignored-event behavior, and source location. A state-enum list, switch cases, handler table, opcode dispatch, result field, or lifecycle stage list does not prove a state machine. If the complete state audit proves no persistent `current state -> event/trigger -> guard/action -> next state` relationship, use evidenced `N/A`; otherwise unresolved transitions are `MISSING`.

## New Maintainer Reading Rule

Provide four reading routes near the beginning: big-picture understanding, core-flow understanding, point-reading code inspection, and debugging/performance investigation. Start each major chapter with a concise design conclusion and end it with what the reader should now understand plus source entry points for deeper inspection. Do not finish a chapter with an unexplained source or symbol list.

## Target Resolution Rule

Keep three internal roles distinct: `context_parent` records an evidenced owning or enclosing module, the one `target_module` is the document subject, and each `confirmed_submodule` is an independently evidenced child owned inside the target. Generated content labels the first role “所属上级模块” and never exposes the internal key.

Resolve them before drafting. Explicit user wording wins. Otherwise, when requested names form an evidenced ancestor/descendant chain, select the deepest and most specific member as the target and retain its evidenced ancestors only as owning-module context. If candidates are siblings, hierarchy is unproven, several deepest candidates remain, or the user requests separate subjects, clarify before prose, diagrams, or Word. Do not include concrete module-name examples in this Skill; derive every name and relationship from the current request and source.

Persist `module-scope.md` with the original phrase, Skill revision, owning-module roots, unique target and primary root, confirmed target-owned submodules, exclusions, hierarchy evidence, and confidence. Owning modules never enter the DesignUnit census, fourteen-topic denominator, five-view denominator, or FSM audit. Any unit owned outside the target cannot be inserted into the target's submodule census.

Search target interfaces, build/registration, initialization/cleanup, calls, persistent state, resource/queue/cache owners, recovery, and platform variants to discovery closure. Every candidate ends as `confirmed_submodule` or evidence-backed `excluded_non_submodule`; never drop or rename one to reduce work. Confirm an independent responsibility through two signals or one strong ownership/registration/state signal. Detailed closure schemas stay in references `02` and `03`.

Before prose readiness require exact set equality, not only equal counts:

`architecture decomposition names = confirmed census = DesignUnit IDs = detailed chapter IDs = diagram-ledger unit IDs`.

Any substitution, omission, unresolved candidate, foreign context unit, or mismatch keeps Word `not_started`.

## Hybrid Chapter Placement Rule

Use a hybrid structure:

- global opening chapters establish reading paths, terminology, source-backed scope, system position, owning-module relationship, target-module role, target capabilities, the detailed main business loop, and internal decomposition;
- the target module and every confirmed submodule then receive one continuous local detailed-design unit;
- global closing chapters contain only cross-module collaboration, ownership, state handoff, shared configuration/build concerns, resource contention, indexes, coverage, differences, and review items.

A global object list, interface list, code-flow chapter, state-machine chapter, or performance chapter cannot satisfy missing local detail for a confirmed submodule. Link summary rows back to the owning design unit instead of duplicating its detailed prose.

Canonical chapters 4 through 8 together form the target module's one continuous design unit: chapter 4 owns its architecture base slot, chapter 6 owns its one business-flow base slot, chapter 7 decomposes only the target module and owns no five-view slot, and chapter 8 owns its data/lifecycle, code-flow, and state-machine slots plus the remaining implementation detail. The chapter-6 master business flow is the target unit's unique business-flow primary figure; chapter 8 references it and must not insert or count it again. Chapter 9 then contains one continuous local design unit per confirmed submodule owned inside the target. The opening system-position section may introduce an evidenced owning module but must not turn it into the document subject. Relationship-separation rules apply to every chapter, table, figure, caption, and conclusion, not only to this opening section.

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
9. External, internal, cross-module, asynchronous, callback, queue, and source-evidenced adapter interfaces
10. Error, wait, retry, timeout, cancellation, recovery, rollback, and cleanup paths
11. Algorithms, strategies, configuration, concurrency, resources, and performance
12. Build targets, module registration, initialization order, feature flags, and platform differences
13. Logs, counters, assertions, diagnostics, failure symptoms, and source-reading entry points
14. Source evidence, confidence, gaps, and owner-review items

Place the unit's architecture, business-flow, data/lifecycle, code-flow, and state-machine or evidenced-`N/A` views next to the matching subsections. For an important state machine, cover dispatch, overview, transition conditions, error/retry/timeout behavior, and handler details through as many readable figures as the evidence needs. The prohibition on mechanical figure counts applies only to node counts, edge counts, and how many focused figures a complex view needs; it never permits skipping a confirmed design unit or one of its five semantic coverage slots.

For the target module, place an internal-decomposition table after its architecture and before drilling into submodule implementation. The table must include candidate ID, submodule name, source location, discovery signals, business role, responsibility, inputs/outputs, upstream/downstream collaboration, key state or lifecycle object, confirmation decision and basis, exclusion or merge owner when applicable, importance/depth decision, destination detail section, evidence, and confidence. Print candidate, confirmed, excluded, and unmapped counts beside the table. Every row whose confirmation decision is `confirmed_submodule` must have a continuous local chapter and full five-view coverage; any unmapped candidate blocks a full-delivery `PASS`.

For every capability and main-flow family, explain the trigger, preconditions, business object, participating units, main path, conditions, wait/retry/error/recovery branches, terminal outcome, state/data/resource effects, and evidence. Do not impose a fixed number of capabilities or flows.

## Diagram Requirements

Only plan figures after every DesignUnit draft is prose-ready. Let `D = 1 + confirmedSubmoduleCount`; the `1` is the target, never an owning module. Maintain one row for every unit/view slot and compute `expectedBaseSlots = 5D - evidencedStateMachineNaCount`. Word remains `not_started` unless `missingSlotCount = 0` and `duplicateDiagramIdCount = 0`.

| Design unit | Architecture | Business flow | Code flow | State machine | Data/lifecycle |
|---|---|---|---|---|---|
| Target | Required | Required | Required | Required or evidenced `N/A` | Required |
| Every confirmed submodule | Required | Required | Required | Required or evidenced `N/A` | Required |

Each non-`N/A` slot owns one unique primary Diagram ID, Mermaid source, source evidence, PNG identity, target heading, visual-QA result, and Word relationship. One PNG or Diagram ID cannot satisfy multiple units or views. Caption-only entries, Mermaid source, ASCII, placeholders, repeated visuals, and generic overview figures get zero credit. A state-machine `N/A` requires a complete audit of state storage, reads/writes, events, dispatch, initialization, terminal/error/recovery paths, and unresolved candidates; unknown or incomplete evidence is `MISSING`.

The five views cover distinct semantics:

- architecture: boundary, responsibilities, components, inputs/outputs, dependencies, queues, caches, adapters, and ownership;
- business flow: trigger, business object, main path, all decisions, waits, retry/timeout/cancel, failure/recovery, and terminal results;
- code flow: entry functions, calls, branches, loops, async callbacks, mutations, errors, and cleanup;
- state machine: states, events, guards, actions, next states, illegal/ignored events, failure, recovery, and termination;
- data/lifecycle: create/init, owner, readers/writers, handoffs, persistence/concurrency, invalidation, reclamation, and release.

Add focused figures for every source-evidenced complexity instance that cannot remain readable in its base view. These augment but never replace base slots. Split dense views into overview plus focused figures; never delete branches or indefinitely shrink labels. Track semantic validation, rendering, 100%/200% PNG review, insertion, and all-page review separately. Detailed ledger schemas, Mermaid rendering/cropping, image sizing, and review equations remain in references `07`, `08`, and `13`.

## Evidence Rule

Ground design claims in file/line ranges, definitions, calls, branches, state/data reads and writes, structure fields, configuration paths, callbacks, handoffs, and external-resource or adapter access. File-name-only or symbol-name-only evidence is insufficient for key conclusions; disclose unavailable line granularity.

## Word Output Guidance

Read reference `12` before Word work and use native document tools with object-shaped arguments. Create a formal cover: use the authoritative dynamic title; set `documentType` to a source-backed, scope-specific subtitle that adds information and is neither a placeholder nor exactly “详细设计” nor a repetition of the title; pass `author: "ChipMate source-backed-detail-design"` unless the user explicitly supplies another author; and place concise, evidenced scope, source-baseline, and evidence-status summary paragraphs before exactly one standalone summary item whose text is `{{TOC}}`. Omit or mark unavailable cover facts `待确认`; never invent them. The cover remains page 1 and the materialized TOC starts on page 2. Do not hand-write a directory.

Freeze Title and H1/H2/H3 order, create the text-only `*-working.docx` with unique content anchors, replace each anchor once, and serialize every mutation through the immediately returned path. Require zero anchors, exactly one Title-style paragraph, `阅读路径` as the first outline item, and explanatory local body before inserting images. Insert approved PNGs serially at unique headings with caption, alt text, and cropped display dimensions; then materialize the TOC, require `Title index < TOCHeading index < first Heading 1 index`, render, adopt only a verified refreshed path, reinspect, and open every page. Use `language: "zh-CN"`, decimal headings, cropped Mermaid dimensions, `scale: 3`, white background, and `standard_business_brief`. Never use third-party authoring fallbacks or report a working artifact. Detailed mutation, cover, TOC, inspection, and image rules stay in references `12` and `13`.

## Canonical Full-Document Outline

The default Word outline is:

1. Reading path
2. Terminology, scope, and evidence baseline
3. System-architecture position, owning-module relationship, and target-module role
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

Before Word creation require all content units, evidence tables, coverage slots, and diagrams terminal. Inspect the text-only file exhaustively with `maxParagraphs: 1000` and `maxTables: 200`; require one Title, zero anchors, the frozen outline, local explanatory body, and no truncation. Before TOC materialization require exactly one placeholder whose paragraph index is less than the first Heading 1. Afterwards require no placeholder and `Title index < TOCHeading index < first Heading 1 index`. Reconcile each drawing by heading path, visible Diagram ID, relationship ID, media path, hash, caption, and alt text; `imageCount` alone is insufficient.

Render only after structural checks. Require completed field refresh and adopt its authoritative `refreshedDocxPath`; open every page at 100% and complex pages at 200%. Keep automated page evidence separate from model-owned page review. Unavailable rendering is disclosed, not a visual pass. Any unresolved scoped item yields `acceptanceStatus: PARTIAL`.

## Final Word Location Rule

After the last create/edit/repair/render-refresh mutation, run `validate_word_document` on the authoritative file. Only `valid` or `repaired` may be delivered; a repaired path becomes authoritative. End the final response with `Word 文档位置`, the absolute path of that `.docx`, and its containing directory; a workspace-relative path is optional. Keep this as the last user-facing section. Never report a planned, stale, earlier, prose-incomplete, or `*-working.docx` path. If prose readiness, body audit, or validation failed, report no deliverable DOCX plus the continuation files and first incomplete item; do not fabricate a path.

## Review Checklist

For a full delivery, record `PASS / PARTIAL / MISSING / N/A` in `review-notes.md` for:

- revision, loaded references, locked scope, target/owning-module roles, independently evidenced relationship dimensions, discovery closure, and exact equality of decomposition, unit, chapter, and ledger sets;
- fourteen-topic readiness for the target and every confirmed submodule, including mechanisms, exceptions, line-level evidence, zero anchors, and zero empty or inventory-only headings;
- `D = 1 + confirmedSubmoduleCount`, `expectedBaseSlots = 5D - evidencedStateMachineNaCount`, zero missing slots, zero duplicate Diagram IDs/PNGs, and all focused figures;
- formal cover with an informative non-redundant Subtitle, approved author and evidenced cover statements; serialized Word mutation through the latest returned path; exactly one pre-chapter TOC placeholder; frozen heading order, complete body inspection, and one-to-one image identity;
- per-PNG 100%/200% review, all-page 100% review, complex-page 200% review, completed field refresh, and the authoritative final DOCX;
- separate `artifactStatus` and `acceptanceStatus`, plus design-unit, slot, state-machine-N/A, focused, rendered, inserted, visually reviewed, duplicate, and missing counts.

This checklist is human-readable Skill guidance, not a runtime contract or ordinary-QA gate. While native tools work, continue from the first unresolved unit or figure. If an execution boundary or concrete evidence/render blocker is reached, persist continuation state and keep Word `not_started` unless all prose and diagram gates passed. Never claim `PASS` or a final DOCX while any required topic, unit, slot, unique PNG, TOC placement, or page check is unresolved.

## Continuation Protocol

This workflow can support multiple sessions for large deliverables. For a full multi-submodule task, write resumable state before Word assembly; for other tasks, write it when the effort spans turns or the user requests a resumable artifact.

At the end of each incomplete turn, update:

- `resume-state.md`;
- `continue-prompt.md`;
- `review-notes.md`.

When resuming a saved detailed-design effort, read those files first, then continue from the first incomplete work package. Do not let a checkbox hide unresolved owner-review items or evidence gaps.
