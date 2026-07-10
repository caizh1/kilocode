# Package Refresh Decision Quickstart

This quickstart is for the final-delivery owner who must resolve the current
package refresh gate before M11 final signoff can pass.

Current gate:

- Decision intake: `docs/chipmate-feature-migration-validation-runs/20260709-164500-package-refresh-decision-intake/summary.md`
- Current status: `NEEDS_PACKAGE_REFRESH_DECISION`
- Boundary evidence: `docs/chipmate-feature-migration-validation-runs/20260709-164000-package-refresh-boundary-check/summary.md`
- Decision template: `docs/chipmate-feature-migration-package-refresh-decision-template.md`

## Step 1: Choose exactly one final-delivery scope

Option A:

```text
Decision: REGENERATE_OFFLINE_PACKAGES
Accepted by: <owner>
Accepted date: <YYYY-MM-DD>
```

Use this when the final offline handoff must contain the latest source-side
M11/readiness/dashboard/target-boundary evidence chain.

Option B:

```text
Decision: EXCLUDE_SOURCE_SIDE_EVIDENCE_FROM_TARGET_KIT
Accepted by: <owner>
Accepted date: <YYYY-MM-DD>
```

Use this when the latest source-side M11 evidence remains outside the packaged
target kit and the release notes/final review explicitly state that scope.

## Step 2: Save the owner decision

Create a decision file, for example:

```bash
cat > docs/chipmate-feature-migration-package-refresh-owner-decision.md <<'EOF'
Decision: REGENERATE_OFFLINE_PACKAGES
Accepted by: <owner>
Accepted date: <YYYY-MM-DD>
EOF
```

Replace the decision value with Option B when that is the accepted final-delivery
scope.

## Step 3: Run decision intake

```bash
python3 docs/chipmate-feature-migration-package-refresh-decision-intake.py \
  --decision docs/chipmate-feature-migration-package-refresh-owner-decision.md \
  --output docs/chipmate-feature-migration-validation-runs/<stamp>-package-refresh-decision-intake/summary.md
```

Expected passing status:

```text
READY_FOR_PACKAGE_REFRESH_SCOPE
```

## Step 4: Refresh M11 signoff inputs

After the decision intake is ready, refresh the final signoff helper with the
new decision summary:

```bash
python3 docs/chipmate-feature-migration-m11-final-signoff-intake.py \
  --package-refresh-decision docs/chipmate-feature-migration-validation-runs/<stamp>-package-refresh-decision-intake/summary.md \
  --output docs/chipmate-feature-migration-validation-runs/<stamp>-m11-final-signoff/current-signoff-summary.md
```

M11 can still remain `NOT_READY_FOR_FINAL_SIGNOFF` if S3, S16, installed runtime,
target execution, internal embedded-C, company template, visible Agent Terminal
UX, completion audit, or final review gates remain open.

## Boundary

This quickstart does not choose the decision for the owner, does not rebuild
packages, does not install VSIX files, does not run target OS evidence, does not
execute S1-S16, and does not migrate ChipMate QA or contract/repair/gating
behavior.
