# Package Refresh Owner Action Packet

This packet is for the final-delivery owner who must resolve the package
refresh gate before M11 final signoff can pass.

## Current gate state

- Current decision intake: `docs/chipmate-feature-migration-validation-runs/20260709-164500-package-refresh-decision-intake/summary.md`
- Current decision status: `NEEDS_PACKAGE_REFRESH_DECISION`
- Package refresh boundary: `docs/chipmate-feature-migration-validation-runs/20260709-164000-package-refresh-boundary-check/summary.md`
- Boundary status: `REFRESH_REQUIRED_FOR_FINAL_DELIVERY`
- M11 final signoff: `docs/chipmate-feature-migration-validation-runs/20260709-152000-m11-final-signoff-after-dashboard-consistency/current-signoff-summary.md`
- M11 final signoff status: `NOT_READY_FOR_FINAL_SIGNOFF`

## Owner decision required

Choose exactly one:

- `REGENERATE_OFFLINE_PACKAGES`
- `EXCLUDE_SOURCE_SIDE_EVIDENCE_FROM_TARGET_KIT`

The decision must include:

- `Accepted by`
- `Accepted date`

## Recommended command path

1. Copy the decision template:

```bash
cp docs/chipmate-feature-migration-package-refresh-decision-template.md \
  docs/chipmate-feature-migration-package-refresh-owner-decision.md
```

2. Edit `docs/chipmate-feature-migration-package-refresh-owner-decision.md` and replace:

```text
Decision: TODO
Accepted by: TODO
Accepted date: TODO
```

3. Run decision intake:

```bash
python3 docs/chipmate-feature-migration-package-refresh-decision-intake.py \
  --decision docs/chipmate-feature-migration-package-refresh-owner-decision.md \
  --output docs/chipmate-feature-migration-validation-runs/<stamp>-package-refresh-decision-intake/summary.md
```

Expected owner-decision status:

```text
READY_FOR_PACKAGE_REFRESH_SCOPE
```

4. Refresh final signoff with the new decision summary:

```bash
python3 docs/chipmate-feature-migration-m11-final-signoff-intake.py \
  --package-refresh-decision docs/chipmate-feature-migration-validation-runs/<stamp>-package-refresh-decision-intake/summary.md \
  --output docs/chipmate-feature-migration-validation-runs/<stamp>-m11-final-signoff/current-signoff-summary.md
```

## If choosing REGENERATE_OFFLINE_PACKAGES

- Rebuild offline handoff / delivery-set / target-kit artifacts before final delivery.
- Refresh package hashes, delivery manifests, checksum sidecars, package marker audit, package refresh boundary, current-state consistency, and M11 final signoff.
- Do not treat package regeneration as Windows/Linux target execution.
- Do not treat package regeneration as installed VSIX S1-S16 runtime smoke.

## If choosing EXCLUDE_SOURCE_SIDE_EVIDENCE_FROM_TARGET_KIT

- Keep latest source-side M11/readiness/dashboard/boundary evidence outside the packaged target kit.
- Release notes and final review must explicitly state that scope.
- Do not claim the current offline target kit contains the latest source-side M11 evidence chain.
- Target-side package integrity and runtime evidence remain separate gates.

## Required follow-up after decision

- Re-run package refresh decision intake.
- Re-run M11 final signoff intake.
- Re-run current-state consistency.
- Re-run M11 current status dashboard.
- Keep M11 final signoff `NOT_READY_FOR_FINAL_SIGNOFF` if S3, S16, installed runtime, Windows/Linux target execution, internal embedded-C, company template, visible Agent Terminal UX, completion audit, or final review gates remain open.

## Boundary

This action packet does not choose the decision for the owner, does not rebuild
packages, does not install VSIX files, does not run target OS evidence, does not
execute S1-S16, and does not migrate ChipMate QA or contract/repair/gating
behavior.
