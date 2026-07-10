# M11 Returned Evidence Receive Quickstart

This quickstart standardizes how external evidence is returned and received for
the ChipMate non-QA migration to Kilo-code.

## 1. Generate a skeleton bundle

```bash
python3 docs/chipmate-feature-migration-m11-returned-evidence-bundle-template.py \
  --output-dir /tmp/chipmate-m11-returned-evidence-bundle \
  --force
```

The generated bundle is a template only. Do not change `PENDING` placeholders to
`PASS` by hand.

## 2. Replace placeholders with typed verifier outputs

Use these producer commands to replace the placeholder summary files:

```bash
python3 docs/chipmate-feature-migration-s16-decision-intake.py \
  --decision-record <decision-record.md> \
  --output /tmp/chipmate-m11-returned-evidence-bundle/s16/current-summary.md

python3 docs/chipmate-feature-migration-runtime-smoke-intake-verify.py \
  --runtime-evidence <runtime-run-dir> \
  --output /tmp/chipmate-m11-returned-evidence-bundle/installed-runtime/runtime-intake-summary.md

python3 docs/chipmate-feature-migration-target-evidence-intake-verify.py \
  --target win32-x64 \
  --package-evidence <windows-package-evidence-dir> \
  --runtime-evidence <windows-runtime-evidence-dir> \
  --output /tmp/chipmate-m11-returned-evidence-bundle/windows-target/target-intake-summary.md

python3 docs/chipmate-feature-migration-target-evidence-intake-verify.py \
  --target linux-x64 \
  --package-evidence <linux-package-evidence-dir> \
  --runtime-evidence <linux-runtime-evidence-dir> \
  --output /tmp/chipmate-m11-returned-evidence-bundle/linux-target/target-intake-summary.md

python3 docs/chipmate-feature-migration-internal-embedded-c-intake.py \
  --evidence-dir <internal-embedded-c-evidence-dir> \
  --output /tmp/chipmate-m11-returned-evidence-bundle/internal-embedded-c/summary.md

python3 docs/chipmate-feature-migration-company-docx-template-validate.py \
  --template-docx <company-template.docx> \
  --generated-docx <generated-docx-from-kilo.docx> \
  --output /tmp/chipmate-m11-returned-evidence-bundle/company-template/summary.md

python3 docs/chipmate-feature-migration-agent-terminal-visible-ux-intake.py \
  --evidence-dir <agent-terminal-visible-ux-evidence-dir> \
  --output /tmp/chipmate-m11-returned-evidence-bundle/agent-terminal-visible-ux/summary.md
```

## 3. Package the bundle for return

```bash
cd /tmp
tar -czf chipmate-m11-returned-evidence-bundle.tar.gz chipmate-m11-returned-evidence-bundle
```

## 4. Receive the returned bundle

```bash
python3 docs/chipmate-feature-migration-m11-returned-evidence-receive.py \
  --bundle /tmp/chipmate-m11-returned-evidence-bundle.tar.gz \
  --output-dir docs/chipmate-feature-migration-validation-runs/<stamp>-m11-returned-evidence-receive \
  --accept-s16-decision
```

Only use `--accept-s16-decision` after the typed S16 decision intake shows a
real accepted decision. If the company template summary is `PASS_WITH_LIMITS`,
add `--accept-company-template-pass-with-limits` only after manual acceptance.

## 5. Continue M11 signoff only after receive passes

The receive helper runs archive verification first and then delegates to bundle
intake. A receive `PASS` means the returned evidence is ready for M11 readiness
review; it is not final signoff.

## Boundary

This quickstart does not migrate QA, does not run Kilo QA, does not execute
target-machine commands, does not run autocomplete, does not generate Word
output, does not run missing-diagram repair, does not trigger document-contract planning,
and does not accept `nextToolContract`, `missingDeliverable`, or
`validate_artifacts` as migration evidence.
