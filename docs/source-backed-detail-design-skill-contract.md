# Source-Backed Detail Design Skill Boundary

## Purpose

- [x] This document defines the boundary for source-backed detailed-design capability in Kilo as an optional skill-guided workflow.
- [x] This is not a migrated ChipMate skill contract, Word contract, artifact-consumption gate, or runtime planning contract.
- [x] Only reusable skill guidance, evidence expectations, and generic deliverable mechanics migrate.
- [x] ChipMate runtime planner, question routing, and `DesignDocAgentFlow` do not migrate.
- [x] ChipMate document-depth contracts, required-artifact validators, recipe-specific Word repair loops, and `nextToolContract` style steering do not migrate.

## Trigger Boundary

- [x] Use this skill when the user explicitly asks for a source-backed detailed design document, module design document, design report, state-machine design chapter, or similar deliverable artifact.
- [x] Do not use this skill for ordinary code QA, bug explanation, call-chain analysis, symbol lookup, or document QA unless the user requests a deliverable design document.

## Evidence Tools

- [x] Use Kilo-native `codebase_analysis` for C/C++ symbol relationships, callers/callees, call chains, macro/register/MMIO usage, state machines, error paths, cleanup paths, lifecycle, module flow, and impact analysis.
- [x] Use Kilo-native `semantic_search` for broad conceptual source-code discovery before narrowing with grep/read.
- [x] Use Kilo-native `document_search` for configured workspace PDF, DOCX, XLSX, ODS, Markdown, CSV, TSV, RST, or text evidence.
- [x] Use ordinary file read/search tools only after evidence tools identify precise files or anchors.

## Required Output Structure

- [x] Current design overview.
- [x] Functional coverage.
- [x] Key interfaces.
- [x] Key data structures.
- [x] Main business/code flows.
- [x] Exceptional and cleanup flows.
- [x] State-machine states and transitions where present.
- [x] Configuration and build-time constraints where relevant.
- [x] Hardware, register, MMIO, or protocol constraints where relevant.
- [x] Test and verification suggestions.
- [x] Evidence references for key claims.

## Diagram Requirements

- [x] Business-flow diagrams may be generated only from explicit model/skill decisions.
- [x] Code-flow diagrams must cite source evidence.
- [x] State-machine diagrams must cite state and transition evidence.
- [x] Architecture diagrams must distinguish source-backed facts from inferred structure.
- [x] Mermaid PNG artifacts must be generated through the Mermaid tools and registered in the artifact manifest.

## Deliverable Requirements

- [x] For a full detailed-design request, produce a Markdown draft when useful.
- [x] Produce Mermaid source files and PNG files only for diagrams the model/user explicitly chooses.
- [x] Produce a Word `.docx` using Word tools when the user asks for Word output or the task scope requires a deliverable document.
- [x] Render PDF/page PNGs only when requested, configured, or needed for explicit visual QA.
- [x] Register generated deliverables through the artifact manager.
- [x] Missing optional deliverables should be reported as scope limits or warnings, not as a ChipMate-style blocking contract failure.

## Non-Migration Boundary

- [x] Do not migrate ChipMate `DesignDocAgentFlow`.
- [x] Do not migrate ChipMate QA planner.
- [x] Do not migrate ChipMate question routing.
- [x] Do not migrate ChipMate Word/document runtime contracts or required-artifact repair gates.
- [x] Do not bypass Kilo-native evidence tools.
- [x] Do not make this skill the default path for ordinary code-understanding questions.

## Review Guidance

- [x] Confirm generated design content is evidence-backed.
- [x] Confirm claims without direct evidence are labeled as inference.
- [x] Confirm Word/Mermaid/artifact tools are used only for explicit deliverables.
- [x] Confirm ordinary Kilo QA still works without entering this skill.
- [x] Confirm no ChipMate-style Word contract or skill contract gate has been added to Kilo's native QA path.
