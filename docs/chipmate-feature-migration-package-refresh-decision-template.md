# Package Refresh Decision Template

Use this template only when deciding how final offline delivery should handle
source-side M11 evidence added after the currently built offline package
snapshot.

## Required decision

Choose exactly one:

```text
Decision: TODO
```

Accepted values:

- `REGENERATE_OFFLINE_PACKAGES`
- `EXCLUDE_SOURCE_SIDE_EVIDENCE_FROM_TARGET_KIT`

## Acceptance

```text
Accepted by: TODO
Accepted date: TODO
```

## Decision meaning

If the decision is `REGENERATE_OFFLINE_PACKAGES`:

- Rebuild offline handoff / delivery-set / target-kit artifacts before final delivery.
- Refresh package hashes, manifests, sidecars, package marker audit, current-state consistency, and M11 final signoff.
- Do not mark Windows/Linux target execution or installed VSIX S1-S16 runtime smoke complete unless returned target/runtime evidence exists.

If the decision is `EXCLUDE_SOURCE_SIDE_EVIDENCE_FROM_TARGET_KIT`:

- Keep latest source-side M11/readiness/dashboard/boundary evidence outside the packaged target kit.
- Release notes and final review must explicitly state that these source-side evidence updates are not inside the offline target package snapshot.
- Do not claim the packaged target kit contains the latest source-side M11 evidence chain.

## Boundary

This template does not rebuild packages, does not install VSIX files, does not
run target OS evidence, does not execute S1-S16, and does not migrate ChipMate
QA or contract/repair/gating behavior.
