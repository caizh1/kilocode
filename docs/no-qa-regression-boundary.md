# No-QA-Regression Boundary for ChipMate Feature Migration

## Purpose

- [x] This document defines the boundary for migrating ChipMate non-QA features into Kilo.
- [x] The migration must not replace, bypass, or degrade Kilo's native QA and code-understanding flow.
- [x] New Word, Mermaid, artifact, detailed-design, and Agent Terminal capabilities must be additive side-channel capabilities.

## Authoritative Kilo QA Capabilities

- [x] `codebase_analysis` remains the primary tool for C/C++ symbols, definitions, declarations, references, ownership, callers, callees, call chains, cross-module flow, macro/register/MMIO usage, state machines, error paths, cleanup paths, resource lifetime, module flow, and impact analysis.
- [x] `semantic_search` remains the primary broad conceptual source-code search tool when exact C/C++ relationships are not required or the agent needs to narrow the search scope before deterministic grep/read.
- [x] `document_search` remains the primary document-grounded QA tool for configured workspace PDF, DOCX, XLSX, ODS, Markdown, CSV, TSV, RST, and text documents.
- [x] Existing Kilo file tools remain responsible for reading known local files directly.

## Migration Non-Goals

- [x] Do not migrate ChipMate QA planner.
- [x] Do not migrate ChipMate question routing.
- [x] Do not migrate ChipMate CodeGraph/RAG management UI.
- [x] Do not replace Kilo `codebase_analysis`, `semantic_search`, or `document_search`.
- [x] Do not replace Kilo native skill discovery.
- [x] Do not migrate Kilo autocomplete or Qwen Coder autocomplete, because Kilo already has a `qwen-direct` path.
- [x] Do not replace Kilo terminal/session manager when migrating Agent Terminal.

## Trigger Boundary

- [x] Word tools may be used only when the user explicitly asks for Word, `.docx`, document creation, document editing, document rendering, document merge, document diff, or a deliverable document artifact.
- [x] Mermaid tools may be used only when the user explicitly asks for a diagram, Mermaid, PNG diagram output, or a Word document that requires diagram artifacts.
- [x] Artifact tools may be used only when a file artifact is created, edited, rendered, listed, opened, or diagnosed.
- [x] Source-backed detailed-design skill may be used only when the user explicitly asks for a design document, detailed design, source-backed report, or equivalent deliverable.
- [x] Agent Terminal may be used only when the user explicitly opens or requests the agent terminal experience.

## Regression Rules

- [x] A normal code QA question must not trigger Word, Mermaid, detailed-design, or artifact tools unless the user asks for a generated deliverable.
- [x] A normal document-grounded QA question must continue to use `document_search`, not Word generation tools.
- [x] A C/C++ code-understanding question must continue to prefer `codebase_analysis`.
- [x] New tool descriptions must be narrow and explicit so they do not attract ordinary QA turns.
- [x] New settings must not change existing provider, model, autocomplete, indexing, terminal, or document-search defaults.
- [x] New filesystem writes must use workspace-safe paths and the existing Kilo permission model.
- [x] Remote renderer absence must degrade rendering only; it must not break QA, code search, or document search.

## Required Review Before Final Completion

- [x] Confirm ordinary code QA still routes through Kilo-native code-understanding tools.
- [x] Confirm document QA still routes through `document_search`.
- [x] Confirm Word/Mermaid tools are not enabled by default for unrelated QA.
- [x] Confirm Agent Terminal does not replace the existing terminal/session manager.
- [x] Confirm VS Code extension activation still succeeds when document tools are present but renderer endpoint is empty.
