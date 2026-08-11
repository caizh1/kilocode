# M11 External Evidence Action Packet

This packet is the current execution checklist for the remaining ChipMate
non-QA migration evidence. It keeps ChipMate native QA intact and routes all
returned evidence through typed intake helpers before M11 review.

## Current status

- Current M11 readiness: `NOT_READY_FOR_M11_REVIEW`
- Current final signoff: `NOT_READY_FOR_FINAL_SIGNOFF`
- Current completion audit: `Completion allowed: no`
- Current external evidence receive quickstart: `docs/chipmate-feature-migration-m11-returned-evidence-receive-quickstart.md`

## Required returned evidence

| Gate | Owner action | Required output |
|---|---|---|
| S3 Document RAG | Restore embedding/indexing provider readiness, then rerun S3 readiness smoke. | `document-rag-readiness-summary.md` with `Status: PASS`, `document_search used: yes`, and `provider/readiness failure detected: no`. |
| S16 autocomplete | Make an explicit product decision through the typed decision intake. Do not edit protected Qwen autocomplete files in this packet. | `s16/current-summary.md` with `READY_FOR_READONLY_S16_SMOKE`, then run read-only S16 smoke. |
| Installed runtime S1-S16 | Run installed VSIX runtime smoke, manually accept answer/tool/artifact quality, then run runtime smoke intake. | `installed-runtime/runtime-intake-summary.md` with `Final status: PASS`. |
| Offline Windows x86-64 | Run target-side Windows package/runtime evidence and target intake. | `windows-target/target-intake-summary.md` with `Final status: PASS`. |
| Offline Linux x86-64 | Run target-side Linux package/runtime evidence and target intake. | `linux-target/target-intake-summary.md` with `Final status: PASS`. |
| Internal embedded-C detail design | Run installed source-backed detail-design flow on one representative internal embedded-C module, then run internal intake. | `internal-embedded-c/summary.md` with `Status: PASS`. |
| Company DOCX template | Validate a real company `.docx` style/template source and generated ChipMate output. | `company-template/summary.md` with `Status: PASS`, or explicitly accepted `PASS_WITH_LIMITS`. |
| Visible Agent Terminal UX | Capture installed VS Code visible UX evidence and run visible UX intake. | `agent-terminal-visible-ux/summary.md` with `Status: PASS`. |

## Standard return workflow

```bash
python3 docs/chipmate-feature-migration-m11-returned-evidence-bundle-template.py \
  --output-dir /tmp/chipmate-m11-returned-evidence-bundle \
  --force

# Replace all PENDING placeholders with typed verifier outputs.

cd /tmp
tar -czf chipmate-m11-returned-evidence-bundle.tar.gz chipmate-m11-returned-evidence-bundle

python3 docs/chipmate-feature-migration-m11-returned-evidence-receive.py \
  --bundle /tmp/chipmate-m11-returned-evidence-bundle.tar.gz \
  --output-dir docs/chipmate-feature-migration-validation-runs/<stamp>-m11-returned-evidence-receive \
  --accept-s16-decision
```

Only add `--accept-company-template-pass-with-limits` after manual review
accepts the company template limitation.

## Source-side receiving order

1. Generate the returned-evidence bundle template.
2. Replace placeholders with typed verifier outputs.
3. Package the bundle.
4. Run the receive wrapper.
5. Use the generated readiness summary as input to M11 final review.
6. Run final signoff intake only after readiness, completion audit,
   current-state consistency, and manual final review are all ready.

## Boundary

This packet does not migrate QA, does not replace ChipMate native code
understanding, does not run target-machine commands, does not modify protected
Qwen autocomplete files, does not generate Word output, does not trigger missing-diagram repair,
does not trigger document-contract planning, and does
not accept `nextToolContract`, `missingDeliverable`, or `validate_artifacts` as
migration evidence.
