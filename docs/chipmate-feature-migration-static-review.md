# ChipMate Feature Migration Static Review

This review records the current source-level evidence for the ChipMate non-QA feature migration into ChipMate. It is intentionally limited to static inspection and does not claim test, package, or installed VS Code validation.

## Scope Reviewed

- Document artifact manager
- Word document tools
- Mermaid document tools
- Source-backed detail-design skill
- Document artifact UI
- Agent Terminal
- ChipMate native QA, Document RAG, autocomplete, terminal/session manager boundaries

## Static Evidence

### ChipMate native QA tools remain registered

Evidence:

- `packages/opencode/src/chipmate/tool/registry.ts` still tells the agent to use `codebase_analysis`, `semantic_search`, and `document_search` for code/document understanding.
- `packages/opencode/test/chipmate/tool-registry-indexing.test.ts` contains regression coverage expecting `codebase_analysis`, `semantic_search`, and `document_search` when indexing is ready.
- Document, Word, and Mermaid tools are added as extra tools alongside the native tools rather than replacing them.
- Dynamic imports for artifact, Word, and Mermaid sidecar tools catch load failures, log warnings, and return an empty tool list for that sidecar group instead of replacing native QA tools.

Static conclusion:

- No source-level evidence that ChipMate QA planner, question routing, or CodeGraph/RAG management replaced ChipMate native QA.

### Document artifact tools are sidecar tools

Evidence:

- `declare_artifact` description says it is for generated deliverable artifacts and should not be used for ordinary QA.
- Artifact root is `.chipmate/artifacts`.
- VS Code artifact commands read `chipmate.documents.artifacts.root` for browse/export diagnostics, while current tool-generated artifacts still default to `.chipmate/artifacts`.
- VS Code artifact commands respect `chipmate.documents.tools.enabled`; disabling this setting blocks artifact browsing/export commands without touching native QA tools.
- Root `.gitignore` ignores `.chipmate/artifacts/` and `.chipmate/artifacts/`, so generated document artifacts should not pollute tracked source by default.
- Artifact path helpers contain workspace/artifact-root containment checks.
- Tool outputs return manifest paths, artifact paths, summaries, diagnostics, and warnings rather than binary content.

Static conclusion:

- Artifact manager is a sidecar artifact registry, not a QA routing path.

### Word tools are explicit document-deliverable tools

Evidence:

- `create_word_document` description limits use to explicit Word/docx deliverables.
- `inspect_word_document` says it is for Word edit planning, not general document QA, and points to `document_search` for indexed document questions.
- `apply_word_document_edits` writes a new artifact, defaults delete operations to dry-run-first behavior, and now supports default source backup.
- `render_word_document` uses an external renderer endpoint and reports warning artifacts when no endpoint is configured.
- The current render runtime is driven by explicit tool parameters or `CHIPMATE_WORD_RENDER_ENDPOINT`; VS Code `wordRender` settings are not used to replace ChipMate's native session configuration chain.
- Word render failures are reported through bounded diagnostics such as endpoint-not-configured or remote-failed, with artifact warnings rather than binary payloads in chat context.
- Word sidecar tool operation failures are wrapped as ordinary tool results with `failed` metadata and readable output, after the permission prompt has completed. This keeps explicit Word failures separate from ChipMate native QA routing.
- Word merge implementation remaps image relationships, copies media bytes to new merged media targets, updates `word/_rels/document.xml.rels`, and ensures image content types in `[Content_Types].xml`.
- Word render creates fresh `diagnostics` and `warnings` arrays per invocation and derives `qualityStatus` from the current renderer response, reducing stale-warning carryover risk.

Static conclusion:

- Word generation/edit/render tools do not replace ChipMate native `document_search`.
- Word edits are artifact-producing and should not mutate source documents by default.
- Static merge review supports the intended image/rels handling, but real complex `.docx` visual fidelity still requires M10 runtime validation.
- Static render review supports per-call warning isolation, but real endpoint behavior still requires M10 runtime validation.

### Mermaid tools do not own business semantics

Evidence:

- `validate_mermaid_diagram` says it does not decide business flow, exception flow, state roles, or diagram semantics.
- `render_mermaid_diagram` uses an external endpoint or externally installed `mmdc`.
- `insert_mermaid_into_word` creates a new Word artifact and does not replace Word or `document_search` QA.
- Mermaid render failures are mapped to explicit diagnostic codes such as `mermaid-render-failed`, `mermaid-render-timeout`, `chrome-not-found`, `chrome-startup-failed`, and `png-invalid`.
- Mermaid sidecar tool operation failures are wrapped as ordinary tool results with `failed` metadata and readable output, after the permission prompt has completed.

Static conclusion:

- Mermaid migration is renderer/artifact oriented and does not migrate full draw.io semantics.

### Source-backed detailed design is a ChipMate-native skill

Evidence:

- `.chipmate/skills/source-backed-detail-design/SKILL.md` allows ChipMate native `codebase_analysis`, `semantic_search`, and `document_search`.
- The migrated skill explicitly says it is not ChipMate `DesignDocAgentFlow`, planner, question routing, or CodeGraph/RAG management UI.
- References and tests avoid `chipmate_` runtime tool names.

Static conclusion:

- Detailed design migration is skill/process migration, not ChipMate runtime-flow migration.

### Agent Terminal is default-off and sidecar

Evidence:

- `chipmate.agentTerminal.enabled` default is `false`.
- `registerAgentTerminal` only adds `chipmate.agentTerminal.open` and a terminal profile provider.
- The terminal profile contribution keeps only `id` and `title`; the optional profile icon is intentionally omitted to avoid manifest-icon compatibility risk across the supported VS Code floor.
- Opening through command or profile checks the setting and prompts before enabling for the workspace.
- The Agent Terminal context helper includes package scripts, README/AGENTS excerpts, and common build-system files so build advice can be grounded in the current workspace.
- Helper text says it does not replace ChipMate native shell/tool loop.
- Existing Agent Manager and terminal action registration remain in `extension.ts`.

Static conclusion:

- Agent Terminal does not replace ChipMate terminal/session manager in source structure.

### Autocomplete is preserved

Evidence:

- `extension.ts` still calls both `registerAutocompleteProvider(context)` and `registerQwenAutocompleteProvider(context)`.
- `package.json` still exposes `chipmate.autocomplete.provider` with `qwen-direct`.
- New document and Agent Terminal settings do not change autocomplete provider defaults.

Static conclusion:

- No source-level evidence that the migration replaced ChipMate autocomplete/Qwen direct.

## Static Known Limits

- This review did not run `bun test`, compile, package, or installed VS Code smoke.
- This review does not prove VSIX schema validity, startup behavior, real renderer behavior, or real project QA quality.
- It does not prove Word image relationship fidelity, complex template inheritance, or real `.docx` visual quality.
- It does not prove installed extension command contribution behavior.
- The static dependency scan found no newly bundled LibreOffice, Chromium, Mermaid CLI, or Poppler renderer dependency for the migrated Word/Mermaid tools. The existing internal-offline VSIX build script may still bundle Poppler `pdftotext` for ChipMate's pre-existing document extraction path; runtime packaging review must distinguish that from newly introduced Word/Mermaid renderer dependencies.
- M10 and M11 remain incomplete until tests, packaging, installation, and real project smoke are performed.

## Pending Validation Commands

Run only after explicit approval. Do not run tests from the repository root because the root `bun test` script intentionally exits with failure.

```bash
cd /Users/archer/Work/chipmate/packages/opencode
bun run test
bun run typecheck

cd /Users/archer/Work/chipmate/packages/chipmate-vscode
bun run test:unit
bun run typecheck
bun run lint
bun run package
```

See `docs/chipmate-feature-migration-validation-runbook.md` for the full command matrix, VSIX build notes, installed VS Code smoke matrix, and evidence capture requirements.

Then perform installed VS Code smoke for:

- ordinary embedded C QA through native code tools;
- `document_search` on an existing indexed document;
- Word create/edit/render with a real `.docx`;
- Mermaid PNG and Mermaid-to-Word;
- source-backed detail-design on one internal embedded C module;
- Agent Terminal open and dangerous-command confirmation;
- autocomplete/Qwen direct smoke.
