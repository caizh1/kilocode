---
name: source-backed-detail-design
description: Generate or update source-backed detailed design documents with Kilo native code/document evidence tools, Mermaid PNG artifacts, Word docx output, and render diagnostics.
allowed-tools: [codebase_analysis,semantic_search,document_search,read,grep,glob,declare_artifact,list_artifacts,open_artifact,export_artifact_diagnostics,validate_mermaid_diagram,render_mermaid_diagram,save_mermaid_artifact,insert_mermaid_into_word,create_word_document,inspect_word_document,validate_word_document,apply_word_document_edits,apply_word_template_styles,materialize_word_fields,merge_word_documents,diff_word_documents,normalize_word_table_spec,render_word_document]
metadata:
  keywords: [source backed detail design,source-backed detail design,enhanced detail design,detailed design document,源码驱动详细设计,增强版详细设计,基于源码生成详设,模块详细设计,状态机,业务流程,代码流程]
---

`SBDD_RULESET_REVISION=2026-07-source-semantic-v122`;FULL WORD=3–5 turns;only “继续”.
TURN1:root only;task/agent_manager STOP;target=deepest evidenced;orchestrator!=child;DesignUnits only actual implementations under target source root;outside units=dependencies unless user expands scope;map every target-dir implementation;stateless/utility remains child;zero unmapped;Before units:scope+census+D exact impl reads+D file greps;EACH unit has 14 separate numbered headings+14 adjacent markers;range/catch-all heading invalid;`14-business-flow-family-census.csv`;rows>=D;every unit owns>=1 real family;`flowCensusStatus: PASS`;never request “继续”;No 07/08/MMD/figures.
RESUME:reload Skill+07+08;read resume+review+batch units before ANY `04-diagrams` write.
FIGURES:freeze full `5D` rows;five views/unit;source+edge ledgers→all batch MMD/claims write+read;one v1 batch manifest;one source-backed batch render;`semanticMode:"source-backed"`;`semanticEvidencePath`;`documentReady=true`;ordinary fallback invalid.
RENDER:no `remoteEndpoint`/renderer invention or install;tool fallback;failure=checkpoint.
**FIGURE DETAIL:** Omission/deletion/overwrite STOP. Exact `A→B` proof; MMD→`sourceHash`→claim; split-required→overview+focus before next. Architecture maps every child/shared object/input/output/egress with Chinese relation labels.
**CLAIM FIRST PASS:** `scopePath`=target source root, never one file in a full task; architecture `designUnitCensusPath`=canonical census. Exact census IDs; claim every visible node/arrow once. Concept nodes omit symbols and use evidenced `dependency`; strong relation requires exact endpoint symbols+site. Shared evidence uses `nodeGroups`/`edgeGroups`. Literal `$MMD_SHA256` is tool-owned. If prose proves no FSM, topic+slot=`N/A`; otherwise use proved `state-transition` or visible `待确认`, never phase-as-state/dependency.
**NARROW:** grep symbols→targeted read;no guessed ranges;catalog literals only;tool-enforced 10 source-backed validations/4 renders;no escaped quotes;no call quota/anchor ledger.

Final MMD→claim→source-backed validate→render. Never downgrade/delete frozen semantics/reuse PNG. Missing evidence STOP; second failed render=`attempted_failed/STOP_NOW`.
definition/include/order is not proof;minor whitespace/layout/wording is nonblocking;ordinary Mermaid omits both fields.

# Source-backed Detail Design for Kilo

## Non-goals and QA Boundary

Use for explicit deliverables; not a ChipMate runtime pipeline. Ordinary QA stays artifact-free and keeps its native routing/tool loop.

## Kilo Tool Mapping

Preserve scope discovery, line-level control-flow evidence, business abstraction, fourteen-topic local design units, five-view diagrams, existing-document diff, native Word/TOC, QA, and resume. Keep the full multi-unit workflow in the root session; do not use `task`, `agent_manager`.

## Required Reference Loading

Load references progressively:

1. scope/evidence/flow census: load `references/02-input-and-module-scope-rules.md`, `references/03-source-exploration-rules.md`, and `references/15-business-flow-abstraction-rules.md`; load `01`, `04`, `05`, or `06` only for a concrete unresolved principle/evidence/flow/FSM question;
2. prose: load `references/10-detail-design-output-templates.md` before the first unit, record `reference10Loaded: true`, then verify one fourteen-topic unit at a time;
3. diagrams only in the next `继续` turn after a persisted prose boundary: read `references/07-diagram-planning-and-splitting-rules.md` and then `references/08-mermaid-png-rendering-rules.md` before the first figure write; load `references/09-parent-module-assembly-rules.md` only for troubleshooting;
4. Word/review after diagram readiness: load `references/12-word-export-rules.md` and `references/13-quality-gates-and-validator.md`.

`11`: old-doc diff only. For `D>1`, load `14` before the first phase response and on every `继续`; otherwise load it only for resume. A narrow source-backed figure reads only `08`; never guess filenames. Missing an active reference blocks completion.

## Content-first Work Package Order

For a full detailed-design deliverable:

1. Turn 1 calls `declare_artifact` once to obtain a unique canonical work root; never invent a fixed reusable root or create it with shell. Before the first unit prose write, persist the evidenced module scope and zero-unmapped implementation census with owning modules, unique target/root, and ordered DesignUnits.
2. The root writes all frozen fourteen-topic unit files. Before the first unit, tool history has `D` distinct exact implementation-file native `read` calls and `D` distinct file-targeted native `grep` calls, one pair per unit; recursive/directory grep is invalid. After edits repeat that unit's read+grep. Each file has fourteen separate numbered headings and fourteen adjacent markers; range/catch-all headings leave topics missing. Repair failures and derive each audit from those calls; receipts, shell, memory and self-reported counts prove nothing.
3. Before Turn 1 ends, write/read parse-valid `14-business-flow-family-census.csv`; require at least `D` evidenced rows, owning-unit set equality, and >=1 real local family per unit. Close decision, async, recovery/cleanup and terminal sets with four zero missing counts; absent rows/units cannot yield zero. Freeze 1–3-unit batches, `figureBatchCount = min(3, max(1, ceil(D / 3)))`, `expectedTurnCount = 2 + figureBatchCount`, and one next action. Reload 14; write/read manifest, resume, continue and review. Each records `flowCensusStatus: PASS`, `flowCensusParseStatus: PASS`, `flowFamilyCount >= D`, `flowOwningDesignUnitCount = D`, one path and equal zero counts. Repair absent/unread/`not_started`/contradictions before requesting `继续`. Loading 07/08 or writing figures in Turn 1 invalidates the run.
4. Process only the next batch. Each `继续` reloads Skill+07+08 and reads resume/review/batch units before diagram writes. Repair missing flow PASS/zeros first; then read immutable `5D`, unit ledgers and final MMD/adjacent v1 claims. The manifest has `version:1`, work-root `basePath`, a new immutable `resultPath`, and 1–20 unique items `{diagramId,sourcePath,semanticEvidencePath}`. Evidence stays workspace-relative; census paths are batch-normalized. Never copy/move evidence or repair paths/hashes with shell; after MMD edits restore literal `$MMD_SHA256` using native write/edit. Call `render_mermaid_diagram` exactly once for that frozen batch using only `batchManifestPath`, `semanticMode:"source-backed"` and render options; do not also pass `source` or `semanticEvidencePath`. Read `batchResultPath`; its item set equals the batch and each item is semantically valid, uniquely rendered and `documentReady=true`. Then obey `workflowProgress`; current `complete:true` cannot override global `wordAllowed=false`. Invalid path/ID, fallback or unread result stops. No Word in figure turns.
5. An invalid/split batch is not a turn boundary: repair it or report a real blocker. Create `pendingSplitDetails.suggestedChildren` exactly as grouped (same suggested ID, parent, nodes and edges). While a parent is pending, the next manifest is repair-only and its IDs equal the latest suggestions; never rerun the full batch or include unrelated/stale IDs. Require the parent in `resolvedSplitDiagramIds`; only readable children satisfy its slot. End a turn only with unique terminal PNG/hash and no split parent.
6. On the final-turn `继续`, verify every prose file and figure result, create bounded text-complete Word fragments in frozen order, insert each exact approved PNG, merge target base → child fragments → closing fragment with `separatorHeading: false`, materialize the sole TOC, inspect structure/body/image/XML, render and review every page, validate the refreshed DOCX, declare only the authoritative artifact, and report its absolute path. Each DesignUnit owns exactly one Heading 1 containing its exact frozen census name and fourteen local H2/H3 topic headings; copy every persisted explanatory prose block into its matching local topic instead of summarizing it. Every inserted image carries one unique visible Diagram ID and the persisted approved `pngPath`.

The root owns planning, evidence, retries, counters, and the next action. It must never ask the user how to proceed, which units to include, how to repair a failure, or whether to shrink scope; between successful phases the only requested input is `继续`. An unrecoverable tool/evidence failure is reported as a blocker, never converted to a guidance request or false completion.

For `D=1`, work serially and finish in one turn unless genuinely blocked. For `D>1`, only completed prose or immutable figure-batch boundaries may end a successful non-final turn. Time/token pressure is not a boundary; unfinished work has no DOCX path.

## Delivery Scope Variants

- A full Word delivery covers all units, views, and review.
- A single-chapter or single-submodule delivery expands only that unit plus scope/evidence.
- A state-machine-only delivery keeps ownership, transitions, recovery, and evidence.
- An existing-document update rebuilds from source with native edit/diff.
- A source-versus-document difference report keeps `Both` / `CodeOnly` / `DocOnly`.
- A quick update discloses skipped analysis/evidence.

Do not expand a narrow request into a full Word deliverable or alter skill discovery, permissions, or ordinary QA.

For a full multi-submodule task, create `resume-state.md`, `continue-prompt.md`, and `review-notes.md` before Word; never create them for ordinary QA.

## Output Root and Artifact Guidance

Use a workspace-safe root with `00-input/` through `08-word-export/`. Native `write` creates parents; never precreate the tree or use shell/`bash`/`mkdir`/Python/Node/temp JSON. Record Mermaid paths in `04-diagrams/diagram-index.md`. For a new task, ignore these paths even when the target-directory listing exposes them: prior `.kilo`, `.chipmate-v2`, artifact, `resume-state`, diagram, and DOCX paths; source discovery excludes them unless the user requests update or resume.
Without a safe writing tool, stop.

## Scope and Module-Relationship Rule

Before conclusions, separate the internal owning-module role, requested target, core implementation, and handoffs. Independently evidence system position, source ownership, owning relationship, calls, data/state/control flow, dependency, collaboration, management, and resource ownership; never infer one from another. Source containment does not prove layering, an owning module is not automatically an upstream caller, and calls do not prove ownership. Use “管理” or “位于……之间” only with direct evidence; otherwise write `待确认`.

Keep the internal key `context_parent` for compatibility but never expose it or a literal translation. User-visible output uses “所属上级模块” only when evidence establishes that role. Apply this globally.

## Terminology and Confidence Rule

Resolve names and ownership from evidence; never invent acronym expansions. Start with a terminology/scope table containing requested and source names, meaning or `UNKNOWN`, evidence, confidence, and owner-review. Use `source_confirmed`, `high_confidence`, `medium_confidence`, `low_confidence_review`, or `not_confirmed`; uncertain claims belong in gaps and risks.

## Word Output Language Rule

Default Word prose, headings, tables, captions, conclusions, review notes, and business-diagram labels to Simplified Chinese. Preserve source symbols, paths, config keys, standards, products, tools, abbreviations, and status tokens. Use `中文说明（Original Term）` only for a well-supported translation; otherwise retain English and explain it in Chinese. Keep code-flow symbols exact and terminology consistent. Render internal scope roles with their approved user-facing Chinese labels; do not copy internal field names into the document.

## Required Content

Teach a new maintainer how the implementation works. Include reading paths; terminology/scope; system and ownership boundaries; exhaustive submodule census; capabilities and complete flows; functions, objects, interfaces, states, algorithms, build/configuration, concurrency/performance, errors, observability, diagrams, evidence/coverage, differences, risks, and owner-review. Report `PASS / PARTIAL / MISSING / N/A`.

The target and every confirmed submodule require one continuous fourteen-topic unit, with business meaning before implementation detail. Persist exactly fourteen distinct topic IDs and exactly fourteen corresponding local headings in the required order. Never combine, range, alias, or collapse topics: headings such as `6-14`, `6/7/8`, `remaining topics`, or one catch-all section count only as one present topic and leave the other topic IDs `MISSING`. A heading, one-line overview, function list, state list, structure table, generic symbol inventory, or diagram is not detailed design; named-only content is `PARTIAL`, absent content is `MISSING`.

Before drawing, persist one row per source-confirmed business-flow family. The table must have at least `D` rows and its owning-DesignUnit set must exactly equal the frozen DesignUnit set; every target/submodule owns at least one real local family, including a stateless utility's evidenced request/transform/result/error path. Each row identifies trigger and entry, business object, participants, ordered stages, decision-edge IDs, asynchronous handoffs, wait/retry/timeout/cancel behavior, failure/recovery/cleanup edges, every terminal result, state/data/resource effects, evidence IDs, and covering Diagram IDs. Require parse PASS, `unmappedFlowFamilyCount = 0`, `missingBusinessEdgeCount = 0`, `missingAsyncHandoffCount = 0`, and `missingBusinessTerminalCount = 0`; an empty set cannot satisfy a zero. A function chain, component topology, state overview, or happy-path-only picture is not a complete business flow.

For every family explain preconditions, main path, branches, handoffs, effects, recovery, terminals, diagram meaning, and evidence. The target base figure shows the end-to-end loop across all families; if Word readability fails, retain a navigable overview and add focused family/branch/async/error figures without deleting paths.

For each key function explain responsibility, I/O, conditions, calls, decisions/loops, side effects, completion, errors, cleanup, and line evidence. A one-line function table is incomplete.

## Prose Readiness Rule

For full Word, persist `02-source-evidence/module-scope.md`, one `05-enhanced-detail-design/units/<designUnitId>.md` per target/submodule, and root `resume-state.md` plus `review-notes.md` before Word. Directly below each of the fourteen topic headings, persist exactly one `SBDD-TOPIC-STATUS: <two-digit-topic-id> | <PASS|N/A|MISSING> | <evidence IDs>` line; this internal marker is not copied to Word.

Readiness requires a target distinct from owning modules and census/unit-file equality. Every confirmed built unit must mark topics 01–07 and 09–14 `PASS` with explanation: absence of special errors, strategies, platform variance, or diagnostics is a finding to explain, not `N/A`. Only topic 08 may be evidenced `N/A` after the full FSM audit. Derive audit rows/counts from re-read status lines, never memory. An N/A conclusion must use marker `N/A`, never `PASS`. Require 14 unique marker IDs, exclusive statuses, `topicPassCount + evidencedTopicNaCount = 14`, `distinctTopicHeadingCount = 14`, and `missingTopicCount = 0`. Headings, pictures, captions, lists, tables, inventories, summaries, and checkboxes do not count. Any missing unit, explanation, exception, or evidence keeps Word `not_started`.

Prose authoring is fail-closed. The root owns every fourteen-topic unit. Before creation load reference `10` and persist `reference10Loaded: true`:

1. write each heading, its status on the next non-empty line, then explanatory body;
2. after all frozen unit drafts exist, make one native `read` tool call targeted at each saved file; write output, shell `cat`/`grep`, bash, context, or memory is not a substitute;
3. after each file's read, use one `grep` targeted at that same file to enumerate exact headings/status lines and verify heading→status adjacency; a directory or recursive grep is invalid even if its output lists every file; reject ranges, duplicates, missing IDs, PASS/N/A conflicts, or content gaps;
4. after every edit, separately re-read and re-grep that exact file until it passes; derive fourteen audit rows in `review-notes.md`;
5. only after every unit passes may the root replace review placeholders, update the other checkpoints once, and re-read all three to prove identical counts, batches, and next action. Later drafts may precede earlier audits, but unaudited drafts never count. A phase response is not a checkpoint.

The review evidence for each unit must record `verifiedFile`, `separateReadToolCallCompleted`, `verifiedHeadingIds`, `verifiedStatusMarkerIds`, `combinedHeadingMatchCount`, `distinctTopicHeadingCount`, `topicPassCount`, `evidencedTopicNaCount`, and `missingTopicCount`. Do not record `read+grep verified` unless both separate tool calls actually completed. A handwritten status, checkbox, size claim, or “all covered” summary is not evidence. At a real context boundary, persist the first unaudited or failing file and resume it before figures.

Before images, audit every heading range for explanatory Normal/code content and require a short orientation paragraph before child headings. Empty paragraphs, TOC/anchors, titles/captions/IDs/drawings, and standalone lists/tables do not count. Repair empty, image-only, list-only, table-only, or name-only sections before images, TOC, or final-path reporting.

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

Keep three roles distinct: internal `context_parent` is an evidenced owning/enclosing module, the single `target_module` is the document subject, and each `confirmed_submodule` is an independently evidenced target-owned child. Output labels the first role “所属上级模块”.

Resolve before drafting. Explicit subject wording wins. Otherwise an evidenced ancestor/descendant chain selects its deepest, most specific member; ancestors remain owning context. Clarify siblings, unproven hierarchy, multiple deepest candidates, or separate requested subjects before prose or diagrams. Derive all names from the request and source; this Skill contains no concrete module examples.

Persist `module-scope.md` with original wording, revision, owning roots, unique target/root, confirmed target-owned submodules, exclusions, hierarchy evidence, and confidence. Owning or external units never enter DesignUnit, fourteen-topic, five-view, or FSM denominators.

Derive and reconcile file/unit totals, extension subtotals, compilation rows, and confirmed/excluded rows from tool output. Any contradiction keeps scope unlocked.

Before scope lock, map every built implementation as `confirmed_submodule` or evidenced `excluded_non_submodule`; target orchestration maps to target. Stateless, utility/storage/adapter, small, FSM-free, or single-caller remains confirmed; dependency is not aliasing. Exclude only generated/test, evidenced inactive/non-build variants, or a proved forwarding-only exact alias naming its confirmed owner. For C/C++ persist `targetSourceRoot` and every implementation path in `design-unit-census.json`; self-reported counts are insufficient. Require `unmappedTargetCompilationUnitCount = 0` and zero invalid exclusions; see `02`, `03`, `08`.

Before prose readiness require exact set equality, not only equal counts:

`architecture decomposition names = confirmed census = DesignUnit IDs = detailed chapter IDs = diagram-ledger unit IDs`.

Any substitution, omission, unresolved candidate, foreign unit, or mismatch keeps Word `not_started`.

## Hybrid Chapter Placement Rule

Opening chapters establish reading paths, terminology, scope, system position, target capabilities, the complete business loop, and target-internal decomposition. Chapters 4 through 8 jointly form the target's continuous DesignUnit: chapter 4 owns architecture, chapter 6 owns its unique business-flow base figure, chapter 7 only freezes target-owned submodules, and chapter 8 owns data/lifecycle, code-flow, state-machine, and remaining implementation detail without reinserting chapter 6's figure. Chapter 9 contains one continuous DesignUnit per confirmed submodule. Closing chapters only summarize cross-unit collaboration, indexes, coverage, differences, and review items. An owning module, global list, or cross-cutting chapter cannot replace target or submodule local detail.

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

Place architecture, business, data/lifecycle, code, and state-machine or evidenced-`N/A` views beside matching subsections. Important FSMs cover dispatch, overview, guarded transitions, errors/recovery, and handlers through readable figures. No mechanical node count may excuse a missing unit or view.

After target architecture, add an internal-decomposition table with candidate ID/name/location/signals, business role, responsibility, I/O, collaboration, key state/lifecycle object, decision/basis, exclusion or merge owner, destination section, evidence, and confidence. Report candidate/confirmed/excluded/unmapped counts. Every confirmed row needs a local chapter and five views; any unmapped row blocks `PASS`.

For every capability and flow family, explain trigger, preconditions, business object, participants, main path, decisions, asynchronous handoffs, wait/retry/error/recovery, every terminal outcome, state/data/resource effects, Diagram IDs, and evidence. Do not impose a fixed number of capabilities or flows.

## Diagram Requirements

Only plan figures after every DesignUnit is prose-ready and the flow-family census is closed. Let `D = 1 + confirmedSubmoduleCount`; the `1` is the target, never an owning module. Maintain exactly `5D` base-slot rows and compute `expectedBaseSlots = 5D - evidencedStateMachineNaCount`. Keep assignment separate from rendering: `unassignedSlotIdCount`, `pendingRenderSlotCount`, and `missingRenderedPngCount` must each be zero. Word remains `not_started` unless those counts, `remainingRequiredFigureCount`, `duplicateDiagramIdCount`, `unmappedFlowFamilyCount`, `missingBusinessEdgeCount`, `missingAsyncHandoffCount`, and `missingBusinessTerminalCount` are all zero.

| Design unit | Architecture | Business flow | Code flow | State machine | Data/lifecycle |
|---|---|---|---|---|---|
| Target | Required | Required | Required | Required or evidenced `N/A` | Required |
| Every confirmed submodule | Required | Required | Required | Required or evidenced `N/A` | Required |

Each non-`N/A` slot owns one unique Diagram ID, evidenced source, terminal PNG/hash, heading, QA result, and Word relationship. The root processes only the current frozen batch; the batch tool renders its manifest items sequentially and returns one result per ID. A terminal PNG requires `rendered: true`, no error, valid dimensions, scale 3/4, crop metadata, `contentCropRatio >= 0.2`, sufficient density, tool `wordFitStatus=readable` and `documentReady=true`, and unique artifact/PNG/hash. Require aggregate `uniqueTerminalPngSha256Count = uniqueSuccessfulDiagramIdCount = requiredFigureCount` and zero duplicate/collision counts. Without vision record `pixelReviewStatus: unavailable` and `qaLevel: render-service-basic`. Failure, shared/repeated/generic/unrendered output, or unsupported FSM `N/A` stops before final merge and gets zero credit.

The five views cover distinct semantics:

- architecture: boundary, responsibilities, components, inputs/outputs, dependencies, queues, caches, adapters, and ownership;
- business flow: trigger, business object, all applicable multi-entry flow families, decisions, cross-unit and asynchronous handoffs, waits, retry/timeout/cancel, failure/recovery/cleanup, state/data effects, and every terminal result;
- code flow: entry functions, calls, branches, loops, async callbacks, mutations, errors, and cleanup;
- state machine: states, events, guards, actions, next states, illegal/ignored events, failure, recovery, and termination;
- data/lifecycle: create/init, owner, readers/writers, handoffs, persistence/concurrency, invalidation, reclamation, and release.

Architecture shows units; route 4 boundary calls through an evidence hub; move fanout to code flow. No `...`/wildcards; groups need caller anchors. At Word width reject overlap, crossings, clipping, or 3+ unhubbed edges; reorient, aggregate, or split. Data needs one-object producer+consumer evidence; async needs submit+consume/complete.

Every base overview directly maps its frozen semantic sets: component/responsibility/dependency, flow/branch/handoff/recovery/terminal, transition, or object/lifecycle. Phase names, counts, placeholders, focused-figure links, raw inventories, and giant canvases are not detail. Each node has its evidenced name, concise Chinese responsibility, and at most one source anchor; move inventories/parameters to focus, captions, evidence tables, or prose. Detail means complete traceable edges at readable Word scale. A `split-required` render is evidence-only: readable replacements use unique IDs plus `splitFromDiagramId` naming the oldest pending parent; their node/edge-ID union must cover it before the next view. Oversized probes add no pending parent. Same-ID re-layout cannot delete semantics. Only `documentReady=true` counts. Report paths. Attempt 4 failure stops.

## Evidence Rule

Ground design claims in file/line ranges, definitions, calls, branches, state/data reads and writes, structure fields, configuration paths, callbacks, handoffs, and external-resource or adapter access. File-name-only or symbol-name-only evidence is insufficient for key conclusions; disclose unavailable line granularity.

## Word Output Guidance

Word starts only after every prose and figure manifest passes, all DesignUnits are complete, unique successful Diagram/PNG counts equal required figures, and every pending/missing/unassigned/duplicate count is zero. Then read references `12` and `13`; build text-complete fragments, insert approved images, merge in frozen order, materialize TOC, inspect, render, and validate. Tool gates require one exact-name H1 and fourteen local topic headings with persisted explanatory prose per DesignUnit, enough images, and one unique visible Diagram ID per image.

The target base owns the only cover: authoritative title, useful scope-specific subtitle, `author: "ChipMate source-backed-detail-design"` unless overridden, concise evidenced scope/baseline/status, and exactly one standalone `{{TOC}}` before Heading 1 `阅读路径`. It has no handwritten directory; child/closing fragments are cover-free. Preserve full persisted explanations and frozen order. Insert only approved `pngPath` values; the tool recovers and rechecks their authoritative Mermaid source, so never omit `pngPath` or request re-render. Use unique-ID captions, independent alt text, cropped dimensions, `zh-CN`, decimal headings, white scale-3 figures, and `standard_business_brief`. Require zero anchors/bodyless ranges and `Title < TOCHeading < first Heading 1`; adopt only a verified refreshed path. Never use third-party authoring fallbacks or report a working artifact.

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

Chapters 4–8 jointly carry the target DesignUnit; chapter 9 carries each confirmed child in frozen order; closing chapters only summarize/index and never replace local content. Omit chapter 15 without an earlier document.

Before Word, require terminal content, flow, and figure ledgers. Inspect with `maxParagraphs: 1000`, `maxTables: 200`; require one Title, zero anchors, frozen outline, explanatory bodies, no truncation, one pre-H1 TOC placeholder, no directory H1, and `阅读路径` first. After materialization require no placeholder. Reconcile drawings by heading, visible ID, relationship, media/hash, caption, and alt text; `imageCount` alone is insufficient.

After structure passes require completed render, page evidence and field refresh, exact page PNGs, passing text QA, no error/blank/image-loss/duplicate/page-sequence diagnostic, and a valid `refreshedDocxPath`; adopt it and reinspect. This is Render Service basic QA, not human pixel review. If image vision exists inspect all pages; otherwise record `pixelReviewStatus: unavailable`. Any render, refresh, page, TOC, or scope gap means no final DOCX/path; `PARTIAL` describes the unfinished task. Disclose `qaLevel: render-service-basic` when pixel review did not run.

## Final Word Location Rule

After the last mutation, run `validate_word_document` on the authoritative file; only accepted `valid` or `repaired` output is deliverable. End success with `Word 文档位置`, the literal unabridged absolute `.docx` path and containing directory; `...`, `~`, placeholders, relative-only and stale/working paths are forbidden. Keep it last. Any failed content, diagram, TOC, render, refresh, review, inspection or validation gate means no deliverable path; report continuation files and the first incomplete item.

## Review Checklist

For a full delivery, record `PASS / PARTIAL / MISSING / N/A` for scope/census equality, fourteen-topic bodies, flow/edge/terminal closure, `5D`/focused figures, unique PNGs, cover/TOC, Word/image identity, page review, validation/path, and separate artifact/acceptance counts.

This is guidance, not a runtime contract. Continue from the first unresolved item. At a real boundary persist state. Never claim `PASS` or a final DOCX with any required topic, flow, slot, PNG, TOC, validation, or page review unresolved.
