#!/usr/bin/env python3
"""Check current-state consistency for the ChipMate feature migration handoff.

This helper is intentionally read-only for source/package inputs.  It verifies
the current delivery artifacts, current-facing migration documents, target-kit
content boundaries, and delivery-manifest capability flags so stale hashes or
old blocker references are caught before final handoff.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import tarfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class ArtifactExpectation:
    path: str
    size: int
    sha256: str


ARTIFACTS = [
    ArtifactExpectation(
        "packages/chipmate-vscode/out/chipmate-0.0.38-offline-handoff.tar.gz",
        317784738,
        "97a70108ae648a1998168d679c3c65638ea7756926860fad113cd06c31d2dba5",
    ),
    ArtifactExpectation(
        "packages/chipmate-vscode/out/chipmate-0.0.38-offline-target-verify-kit.tar.gz",
        32344,
        "803c6a22129cc7fcbe9b9912a43a9ebab741a5b8502e26d6d3d0c9cb741f5471",
    ),
    ArtifactExpectation(
        "packages/chipmate-vscode/out/chipmate-0.0.38-offline-delivery-set.tar.gz",
        317916299,
        "83c8c27dbe058bd0d2bd5fe63f7bb17259c5dea1943ba18a81e83c142c736954",
    ),
    ArtifactExpectation(
        "packages/chipmate-vscode/out/chipmate-0.0.38-offline-delivery-set.zip",
        317917776,
        "d4014986abf84d5d3b4207996427f0bc655e473f9a36a9846790cbbc7b08cbb4",
    ),
]

CURRENT_DOCS = [
    "docs/chipmate-feature-migration-plan.md",
    "docs/chipmate-feature-migration-validation-evidence.md",
    "docs/chipmate-feature-migration-current-blockers-20260708.md",
    "docs/chipmate-feature-migration-final-review-template.md",
    "docs/chipmate-feature-migration-offline-release-signoff.md",
    "docs/chipmate-feature-migration-blocked-handoff-20260708.md",
    "docs/chipmate-feature-migration-m11-current-status-dashboard.md",
    (
        "docs/chipmate-feature-migration-validation-runs/"
        "20260709-152500-m11-current-status-dashboard-self-check/"
        "summary.md"
    ),
    (
        "docs/chipmate-feature-migration-validation-runs/"
        "20260709-161000-m11-readiness-after-latest-s3-rerun/"
        "summary.md"
    ),
    (
        "docs/chipmate-feature-migration-validation-runs/"
        "20260709-152000-m11-final-signoff-after-dashboard-consistency/"
        "current-signoff-summary.md"
    ),
    (
        "docs/chipmate-feature-migration-validation-runs/"
        "20260709-163000-target-execution-boundary-check/"
        "summary.md"
    ),
    (
        "docs/chipmate-feature-migration-validation-runs/"
        "20260709-164000-package-refresh-boundary-check/"
        "summary.md"
    ),
    (
        "docs/chipmate-feature-migration-validation-runs/"
        "20260709-164500-package-refresh-decision-intake/"
        "summary.md"
    ),
    (
        "docs/chipmate-feature-migration-validation-runs/"
        "20260709-170500-package-refresh-decision-intake-self-check/"
        "summary.md"
    ),
    (
        "docs/chipmate-feature-migration-validation-runs/"
        "20260709-171500-m11-final-signoff-package-gate-self-check/"
        "summary.md"
    ),
    "docs/chipmate-feature-migration-package-refresh-decision-template.md",
    "docs/chipmate-feature-migration-package-refresh-decision-quickstart.md",
    "docs/chipmate-feature-migration-package-refresh-owner-action-packet.md",
    (
        "docs/chipmate-feature-migration-validation-runs/"
        "20260709-154500-contract-marker-current-source-audit-english-variants/"
        "summary.md"
    ),
    (
        "docs/chipmate-feature-migration-validation-runs/"
        "20260709-155000-package-marker-audit-english-variants/"
        "summary.md"
    ),
    "docs/chipmate-feature-migration-contract-marker-audit.sh",
    "docs/chipmate-feature-migration-package-marker-audit.sh",
]

LATEST_COMPLETION_AUDIT = (
    "docs/chipmate-feature-migration-validation-runs/"
    "20260709-151000-completion-audit-after-dashboard-consistency/"
    "completion-audit.md"
)

S3_SUMMARY = (
    "docs/chipmate-feature-migration-validation-runs/"
    "20260709-160500-document-rag-readiness-rerun-after-marker-guards/"
    "document-rag-readiness-summary.md"
)
S3_PROVIDER_DIAGNOSTICS = (
    "docs/chipmate-feature-migration-validation-runs/"
    "20260709-160500-document-rag-readiness-rerun-after-marker-guards/"
    "document-rag-provider-diagnostics.md"
)

M11_READINESS_INTAKE = (
    "docs/chipmate-feature-migration-validation-runs/"
    "20260709-161000-m11-readiness-after-latest-s3-rerun/"
    "summary.md"
)

M11_ACCEPTANCE_GUARD = (
    "docs/chipmate-feature-migration-validation-runs/"
    "20260709-070000-m11-readiness-acceptance-guard/"
    "summary.md"
)

M11_VISIBLE_UX_GATE_SELF_CHECK = (
    "docs/chipmate-feature-migration-validation-runs/"
    "20260709-129500-m11-external-evidence-shape-after-s16-decision-shape/"
    "summary.md"
)

INTERNAL_EMBEDDED_C_INTAKE_SELF_CHECK = (
    "docs/chipmate-feature-migration-validation-runs/"
    "20260709-126500-internal-embedded-c-intake-self-check/"
    "summary.md"
)

M11_FINAL_SIGNOFF_INTAKE = (
    "docs/chipmate-feature-migration-validation-runs/"
    "20260709-152000-m11-final-signoff-after-dashboard-consistency/"
    "current-signoff-summary.md"
)
M11_FINAL_SIGNOFF_SELF_CHECK = (
    "docs/chipmate-feature-migration-validation-runs/"
    "20260709-148000-m11-final-signoff-after-unblock-packet-receive-workflow/"
    "summary.md"
)

SOURCE_MARKER_AUDIT_ENGLISH_VARIANTS = (
    "docs/chipmate-feature-migration-validation-runs/"
    "20260709-154500-contract-marker-current-source-audit-english-variants/"
    "summary.md"
)

PACKAGE_MARKER_AUDIT_ENGLISH_VARIANTS = (
    "docs/chipmate-feature-migration-validation-runs/"
    "20260709-155000-package-marker-audit-english-variants/"
    "summary.md"
)

M11_RETURNED_EVIDENCE_BUNDLE_INTAKE_SELF_CHECK = (
    "docs/chipmate-feature-migration-validation-runs/"
    "20260709-132000-m11-returned-evidence-bundle-intake-self-check/"
    "summary.md"
)

M11_RETURNED_EVIDENCE_BUNDLE_TEMPLATE_SELF_CHECK = (
    "docs/chipmate-feature-migration-validation-runs/"
    "20260709-134500-m11-returned-evidence-bundle-template-self-check/"
    "summary.md"
)

M11_RETURNED_EVIDENCE_BUNDLE_ARCHIVE_VERIFY_SELF_CHECK = (
    "docs/chipmate-feature-migration-validation-runs/"
    "20260709-136500-m11-returned-evidence-bundle-archive-verify-self-check/"
    "summary.md"
)

M11_RETURNED_EVIDENCE_RECEIVE_SELF_CHECK = (
    "docs/chipmate-feature-migration-validation-runs/"
    "20260709-138500-m11-returned-evidence-receive-self-check/"
    "summary.md"
)

M11_RETURNED_EVIDENCE_RECEIVE_QUICKSTART_SELF_CHECK = (
    "docs/chipmate-feature-migration-validation-runs/"
    "20260709-140500-m11-returned-evidence-receive-quickstart-self-check/"
    "summary.md"
)

M11_RETURNED_EVIDENCE_RECEIVE_QUICKSTART = (
    "docs/chipmate-feature-migration-m11-returned-evidence-receive-quickstart.md"
)

M11_EXTERNAL_EVIDENCE_ACTION_PACKET = (
    "docs/chipmate-feature-migration-m11-external-evidence-action-packet.md"
)

M11_EXTERNAL_EVIDENCE_ACTION_PACKET_SELF_CHECK = (
    "docs/chipmate-feature-migration-validation-runs/"
    "20260709-144500-m11-external-evidence-action-packet-self-check/"
    "summary.md"
)

REMAINING_BLOCKER_UNBLOCK_PACKET_RECEIVE_WORKFLOW_SELF_CHECK = (
    "docs/chipmate-feature-migration-validation-runs/"
    "20260709-146500-remaining-blocker-unblock-packet-receive-workflow-self-check/"
    "summary.md"
)

M11_FINAL_SIGNOFF_GATE_SELF_CHECK = (
    "docs/chipmate-feature-migration-validation-runs/"
    "20260709-111000-m11-final-signoff-self-check/"
    "summary.md"
)

ARTIFACT_ACCEPTANCE_ROLLUP = (
    "docs/chipmate-feature-migration-validation-runs/"
    "20260709-074000-artifact-acceptance-rollup/"
    "summary.md"
)

COMPANY_TEMPLATE_OUTPUT_COMPAT_SELF_CHECK = (
    "docs/chipmate-feature-migration-validation-runs/"
    "20260709-113000-company-template-output-compat-self-check/"
    "summary.md"
)

CURRENT_STATE_OUTPUT_COMPAT_SELF_CHECK = (
    "docs/chipmate-feature-migration-validation-runs/"
    "20260709-115000-current-state-output-compat-self-check/"
    "summary.md"
)

S16_DECISION_INTAKE = (
    "docs/chipmate-feature-migration-validation-runs/"
    "20260709-085000-s16-decision-intake/"
    "current-summary.md"
)
S16_DECISION_INTAKE_SELF_CHECK = (
    "docs/chipmate-feature-migration-validation-runs/"
    "20260709-085000-s16-decision-intake/"
    "summary.md"
)

REMAINING_BLOCKER_OWNER_MATRIX = (
    "docs/chipmate-feature-migration-validation-runs/"
    "20260709-091000-remaining-blocker-owner-matrix/"
    "remaining-blocker-owner-matrix.md"
)

REMAINING_BLOCKER_UNBLOCK_PACKET = (
    "docs/chipmate-feature-migration-validation-runs/"
    "20260709-093000-remaining-blocker-unblock-packet/"
    "remaining-blocker-unblock-packet.md"
)

TARGET_KIT_REQUIRED_BASENAMES = [
    "chipmate-feature-migration-runtime-smoke-intake-verify.py",
    "chipmate-feature-migration-target-evidence-intake-verify.py",
    "chipmate-feature-migration-offline-delivery-set-verify.py",
    "chipmate-feature-migration-offline-target-run-linux.sh",
    "chipmate-feature-migration-offline-target-run-windows.ps1",
    "chipmate-feature-migration-offline-target-run-windows.cmd",
]

TARGET_KIT_FORBIDDEN_BASENAMES = [
    "chipmate-feature-migration-document-rag-readiness-smoke.sh",
    "chipmate-feature-migration-document-rag-readiness-smoke-windows.ps1",
    "chipmate-feature-migration-runtime-smoke.sh",
    "chipmate-feature-migration-s16-source-guard.sh",
    "chipmate-feature-migration-m11-returned-evidence-bundle-intake.py",
    "chipmate-feature-migration-m11-returned-evidence-bundle-template.py",
    "chipmate-feature-migration-m11-returned-evidence-bundle-archive-verify.py",
    "chipmate-feature-migration-m11-returned-evidence-receive.py",
    "chipmate-feature-migration-m11-returned-evidence-receive-quickstart.py",
]

DELIVERY_MANIFEST_PATH = (
    "packages/chipmate-vscode/out/CHIPMATE_OFFLINE_DELIVERY_MANIFEST-0.0.38.json"
)

REQUIRED_MANIFEST_FLAGS = [
    "runtimeSmokeIntakeSupportsS16SourceGuard",
    "targetPackageRunnersReturnDeliveryManifest",
    "excludesSourceCheckoutDocumentRagReadinessHelper",
    "targetEvidenceIntakeRejectsTemplateContradictions",
    "targetEvidenceReturnPackSupportsVerify",
]

DOC_REQUIREMENTS: dict[str, list[str]] = {
    "docs/chipmate-feature-migration-plan.md": [
        LATEST_COMPLETION_AUDIT,
        S3_SUMMARY,
        S3_PROVIDER_DIAGNOSTICS,
        M11_READINESS_INTAKE,
        M11_ACCEPTANCE_GUARD,
        M11_VISIBLE_UX_GATE_SELF_CHECK,
        INTERNAL_EMBEDDED_C_INTAKE_SELF_CHECK,
        M11_RETURNED_EVIDENCE_BUNDLE_INTAKE_SELF_CHECK,
        M11_RETURNED_EVIDENCE_BUNDLE_TEMPLATE_SELF_CHECK,
        M11_RETURNED_EVIDENCE_BUNDLE_ARCHIVE_VERIFY_SELF_CHECK,
        M11_RETURNED_EVIDENCE_RECEIVE_SELF_CHECK,
        M11_RETURNED_EVIDENCE_RECEIVE_QUICKSTART_SELF_CHECK,
        M11_RETURNED_EVIDENCE_RECEIVE_QUICKSTART,
        M11_EXTERNAL_EVIDENCE_ACTION_PACKET,
        M11_EXTERNAL_EVIDENCE_ACTION_PACKET_SELF_CHECK,
        REMAINING_BLOCKER_UNBLOCK_PACKET_RECEIVE_WORKFLOW_SELF_CHECK,
        M11_FINAL_SIGNOFF_INTAKE,
        M11_FINAL_SIGNOFF_SELF_CHECK,
        M11_FINAL_SIGNOFF_GATE_SELF_CHECK,
        ARTIFACT_ACCEPTANCE_ROLLUP,
        COMPANY_TEMPLATE_OUTPUT_COMPAT_SELF_CHECK,
        CURRENT_STATE_OUTPUT_COMPAT_SELF_CHECK,
        S16_DECISION_INTAKE,
        S16_DECISION_INTAKE_SELF_CHECK,
        REMAINING_BLOCKER_OWNER_MATRIX,
        REMAINING_BLOCKER_UNBLOCK_PACKET,
        "server_or_upstream_unavailable",
        "503",
        ARTIFACTS[1].sha256,
        str(ARTIFACTS[1].size),
        ARTIFACTS[2].sha256,
        str(ARTIFACTS[2].size),
        ARTIFACTS[3].sha256,
        str(ARTIFACTS[3].size),
    ],
    "docs/chipmate-feature-migration-validation-evidence.md": [
        LATEST_COMPLETION_AUDIT,
        S3_SUMMARY,
        S3_PROVIDER_DIAGNOSTICS,
        M11_READINESS_INTAKE,
        M11_ACCEPTANCE_GUARD,
        M11_VISIBLE_UX_GATE_SELF_CHECK,
        INTERNAL_EMBEDDED_C_INTAKE_SELF_CHECK,
        M11_RETURNED_EVIDENCE_BUNDLE_INTAKE_SELF_CHECK,
        M11_RETURNED_EVIDENCE_BUNDLE_TEMPLATE_SELF_CHECK,
        M11_RETURNED_EVIDENCE_BUNDLE_ARCHIVE_VERIFY_SELF_CHECK,
        M11_RETURNED_EVIDENCE_RECEIVE_SELF_CHECK,
        M11_RETURNED_EVIDENCE_RECEIVE_QUICKSTART_SELF_CHECK,
        M11_RETURNED_EVIDENCE_RECEIVE_QUICKSTART,
        M11_EXTERNAL_EVIDENCE_ACTION_PACKET,
        M11_EXTERNAL_EVIDENCE_ACTION_PACKET_SELF_CHECK,
        REMAINING_BLOCKER_UNBLOCK_PACKET_RECEIVE_WORKFLOW_SELF_CHECK,
        M11_FINAL_SIGNOFF_INTAKE,
        M11_FINAL_SIGNOFF_SELF_CHECK,
        M11_FINAL_SIGNOFF_GATE_SELF_CHECK,
        ARTIFACT_ACCEPTANCE_ROLLUP,
        COMPANY_TEMPLATE_OUTPUT_COMPAT_SELF_CHECK,
        CURRENT_STATE_OUTPUT_COMPAT_SELF_CHECK,
        S16_DECISION_INTAKE,
        S16_DECISION_INTAKE_SELF_CHECK,
        REMAINING_BLOCKER_OWNER_MATRIX,
        REMAINING_BLOCKER_UNBLOCK_PACKET,
        "server_or_upstream_unavailable",
        "503",
        ARTIFACTS[0].sha256,
        str(ARTIFACTS[0].size),
        ARTIFACTS[1].sha256,
        str(ARTIFACTS[1].size),
        ARTIFACTS[2].sha256,
        str(ARTIFACTS[2].size),
        ARTIFACTS[3].sha256,
        str(ARTIFACTS[3].size),
    ],
    "docs/chipmate-feature-migration-current-blockers-20260708.md": [
        LATEST_COMPLETION_AUDIT,
        S3_SUMMARY,
        S3_PROVIDER_DIAGNOSTICS,
        M11_READINESS_INTAKE,
        M11_ACCEPTANCE_GUARD,
        M11_VISIBLE_UX_GATE_SELF_CHECK,
        INTERNAL_EMBEDDED_C_INTAKE_SELF_CHECK,
        M11_RETURNED_EVIDENCE_BUNDLE_INTAKE_SELF_CHECK,
        M11_RETURNED_EVIDENCE_BUNDLE_TEMPLATE_SELF_CHECK,
        M11_RETURNED_EVIDENCE_BUNDLE_ARCHIVE_VERIFY_SELF_CHECK,
        M11_RETURNED_EVIDENCE_RECEIVE_SELF_CHECK,
        M11_RETURNED_EVIDENCE_RECEIVE_QUICKSTART_SELF_CHECK,
        M11_RETURNED_EVIDENCE_RECEIVE_QUICKSTART,
        M11_EXTERNAL_EVIDENCE_ACTION_PACKET,
        M11_EXTERNAL_EVIDENCE_ACTION_PACKET_SELF_CHECK,
        REMAINING_BLOCKER_UNBLOCK_PACKET_RECEIVE_WORKFLOW_SELF_CHECK,
        M11_FINAL_SIGNOFF_INTAKE,
        M11_FINAL_SIGNOFF_SELF_CHECK,
        M11_FINAL_SIGNOFF_GATE_SELF_CHECK,
        ARTIFACT_ACCEPTANCE_ROLLUP,
        COMPANY_TEMPLATE_OUTPUT_COMPAT_SELF_CHECK,
        CURRENT_STATE_OUTPUT_COMPAT_SELF_CHECK,
        S16_DECISION_INTAKE,
        S16_DECISION_INTAKE_SELF_CHECK,
        REMAINING_BLOCKER_OWNER_MATRIX,
        REMAINING_BLOCKER_UNBLOCK_PACKET,
        "server_or_upstream_unavailable",
        "503",
    ],
    "docs/chipmate-feature-migration-final-review-template.md": [
        LATEST_COMPLETION_AUDIT,
        S3_SUMMARY,
        S3_PROVIDER_DIAGNOSTICS,
        M11_READINESS_INTAKE,
        M11_ACCEPTANCE_GUARD,
        M11_VISIBLE_UX_GATE_SELF_CHECK,
        INTERNAL_EMBEDDED_C_INTAKE_SELF_CHECK,
        M11_RETURNED_EVIDENCE_BUNDLE_INTAKE_SELF_CHECK,
        M11_RETURNED_EVIDENCE_BUNDLE_TEMPLATE_SELF_CHECK,
        M11_RETURNED_EVIDENCE_BUNDLE_ARCHIVE_VERIFY_SELF_CHECK,
        M11_RETURNED_EVIDENCE_RECEIVE_SELF_CHECK,
        M11_RETURNED_EVIDENCE_RECEIVE_QUICKSTART_SELF_CHECK,
        M11_RETURNED_EVIDENCE_RECEIVE_QUICKSTART,
        M11_EXTERNAL_EVIDENCE_ACTION_PACKET,
        M11_EXTERNAL_EVIDENCE_ACTION_PACKET_SELF_CHECK,
        REMAINING_BLOCKER_UNBLOCK_PACKET_RECEIVE_WORKFLOW_SELF_CHECK,
        M11_FINAL_SIGNOFF_INTAKE,
        M11_FINAL_SIGNOFF_SELF_CHECK,
        M11_FINAL_SIGNOFF_GATE_SELF_CHECK,
        ARTIFACT_ACCEPTANCE_ROLLUP,
        COMPANY_TEMPLATE_OUTPUT_COMPAT_SELF_CHECK,
        CURRENT_STATE_OUTPUT_COMPAT_SELF_CHECK,
        S16_DECISION_INTAKE,
        S16_DECISION_INTAKE_SELF_CHECK,
        REMAINING_BLOCKER_OWNER_MATRIX,
        REMAINING_BLOCKER_UNBLOCK_PACKET,
        "server_or_upstream_unavailable",
        "503",
        ARTIFACTS[0].sha256,
        str(ARTIFACTS[0].size),
        ARTIFACTS[1].sha256,
        str(ARTIFACTS[1].size),
        ARTIFACTS[2].sha256,
        str(ARTIFACTS[2].size),
        ARTIFACTS[3].sha256,
        str(ARTIFACTS[3].size),
    ],
    "docs/chipmate-feature-migration-offline-release-signoff.md": [
        ARTIFACTS[0].sha256,
        str(ARTIFACTS[0].size),
        ARTIFACTS[1].sha256,
        str(ARTIFACTS[1].size),
        ARTIFACTS[2].sha256,
        str(ARTIFACTS[2].size),
        ARTIFACTS[3].sha256,
        str(ARTIFACTS[3].size),
    ],
    "docs/chipmate-feature-migration-blocked-handoff-20260708.md": [
        LATEST_COMPLETION_AUDIT,
        S3_SUMMARY,
        S3_PROVIDER_DIAGNOSTICS,
        M11_READINESS_INTAKE,
        M11_ACCEPTANCE_GUARD,
        M11_VISIBLE_UX_GATE_SELF_CHECK,
        INTERNAL_EMBEDDED_C_INTAKE_SELF_CHECK,
        M11_RETURNED_EVIDENCE_BUNDLE_INTAKE_SELF_CHECK,
        M11_RETURNED_EVIDENCE_BUNDLE_TEMPLATE_SELF_CHECK,
        M11_RETURNED_EVIDENCE_BUNDLE_ARCHIVE_VERIFY_SELF_CHECK,
        M11_RETURNED_EVIDENCE_RECEIVE_SELF_CHECK,
        M11_RETURNED_EVIDENCE_RECEIVE_QUICKSTART_SELF_CHECK,
        M11_RETURNED_EVIDENCE_RECEIVE_QUICKSTART,
        M11_EXTERNAL_EVIDENCE_ACTION_PACKET,
        M11_EXTERNAL_EVIDENCE_ACTION_PACKET_SELF_CHECK,
        REMAINING_BLOCKER_UNBLOCK_PACKET_RECEIVE_WORKFLOW_SELF_CHECK,
        M11_FINAL_SIGNOFF_INTAKE,
        M11_FINAL_SIGNOFF_SELF_CHECK,
        M11_FINAL_SIGNOFF_GATE_SELF_CHECK,
        ARTIFACT_ACCEPTANCE_ROLLUP,
        COMPANY_TEMPLATE_OUTPUT_COMPAT_SELF_CHECK,
        CURRENT_STATE_OUTPUT_COMPAT_SELF_CHECK,
        S16_DECISION_INTAKE,
        S16_DECISION_INTAKE_SELF_CHECK,
        REMAINING_BLOCKER_OWNER_MATRIX,
        REMAINING_BLOCKER_UNBLOCK_PACKET,
        "server_or_upstream_unavailable",
        "503",
        ARTIFACTS[0].sha256,
        str(ARTIFACTS[0].size),
        ARTIFACTS[1].sha256,
        str(ARTIFACTS[1].size),
        ARTIFACTS[2].sha256,
        str(ARTIFACTS[2].size),
        ARTIFACTS[3].sha256,
        str(ARTIFACTS[3].size),
    ],
    SOURCE_MARKER_AUDIT_ENGLISH_VARIANTS: [
        "- Status: `PASS`",
        "missing-diagram auto-repair",
        "missing-document contract planning",
        "render missing diagrams first",
        "No forbidden ChipMate contract/repair/gating markers were found",
    ],
    PACKAGE_MARKER_AUDIT_ENGLISH_VARIANTS: [
        "- Status: `PASS`",
        "missing-diagram auto-repair",
        "missing-document contract planning",
        "render missing diagrams first",
        "No forbidden ChipMate contract/repair/gating markers were found in package runtime surfaces.",
    ],
    "docs/chipmate-feature-migration-contract-marker-audit.sh": [
        "missing-diagram auto-repair",
        "missing-document contract planning",
        "render missing diagrams first",
        "suggest render missing diagrams",
    ],
    "docs/chipmate-feature-migration-package-marker-audit.sh": [
        "missing-diagram auto-repair",
        "missing-document contract planning",
        "render missing diagrams first",
        "suggest render missing diagrams",
    ],
    M11_READINESS_INTAKE: [
        "- Overall status: `NOT_READY_FOR_M11_REVIEW`",
        "- Ready gates: `0`",
        "- Total gates: `8`",
        S3_SUMMARY,
        "S3 Document RAG readiness",
        "ERROR_NEEDS_REVIEW",
    ],
    M11_FINAL_SIGNOFF_INTAKE: [
        "- Overall status: `NOT_READY_FOR_FINAL_SIGNOFF`",
        "- Ready gates: `1`",
        "- Total gates: `5`",
        M11_READINESS_INTAKE,
        LATEST_COMPLETION_AUDIT,
        "docs/chipmate-feature-migration-validation-runs/20260709-151500-current-state-consistency-after-dashboard-consistency/summary.md",
        "Package refresh decision",
        "NEEDS_PACKAGE_REFRESH_DECISION",
        "Final review decision",
        "NOT_READY_FOR_FINAL_PASS",
    ],
    (
        "docs/chipmate-feature-migration-validation-runs/"
        "20260709-163000-target-execution-boundary-check/"
        "summary.md"
    ): [
        "- Status: `PASS_BOUNDARY_RECORDED`",
        "- Can satisfy offline Linux x86-64 target execution on this host directly: `no`",
        "- Can satisfy offline Windows x86-64 target execution on this host directly: `no`",
        "- Installed VSIX S1-S16 runtime smoke satisfied by this check: `no`",
        "- Package-only runner may close target runtime blocker: `no`",
        "docs/chipmate-feature-migration-offline-target-run-linux.sh",
        "docs/chipmate-feature-migration-offline-target-run-windows.ps1",
    ],
    (
        "docs/chipmate-feature-migration-validation-runs/"
        "20260709-164000-package-refresh-boundary-check/"
        "summary.md"
    ): [
        "- Status: `REFRESH_REQUIRED_FOR_FINAL_DELIVERY`",
        "- Latest source-side evidence present in any checked package: `no`",
        "- This check closes M10 packaging acceptance: `no`",
        "- This check closes Windows/Linux target execution: `no`",
        "chipmate-feature-migration-target-execution-boundary-check.py",
        "20260709-161000-m11-readiness-after-latest-s3-rerun/summary.md",
    ],
    (
        "docs/chipmate-feature-migration-validation-runs/"
        "20260709-164500-package-refresh-decision-intake/"
        "summary.md"
    ): [
        "- Overall status: `NEEDS_PACKAGE_REFRESH_DECISION`",
        "- Boundary status: `REFRESH_REQUIRED_FOR_FINAL_DELIVERY`",
        "- Decision file: `not provided`",
        "- Accepted date: `MISSING`",
        "REGENERATE_OFFLINE_PACKAGES",
        "EXCLUDE_SOURCE_SIDE_EVIDENCE_FROM_TARGET_KIT",
        "- This intake closes M10 packaging acceptance: `no`",
    ],
    "docs/chipmate-feature-migration-package-refresh-decision-template.md": [
        "Decision: TODO",
        "Accepted by: TODO",
        "REGENERATE_OFFLINE_PACKAGES",
        "EXCLUDE_SOURCE_SIDE_EVIDENCE_FROM_TARGET_KIT",
        "Do not claim the packaged target kit contains the latest source-side M11 evidence chain.",
        "does not migrate ChipMate",
    ],
    "docs/chipmate-feature-migration-package-refresh-decision-quickstart.md": [
        "NEEDS_PACKAGE_REFRESH_DECISION",
        "REGENERATE_OFFLINE_PACKAGES",
        "EXCLUDE_SOURCE_SIDE_EVIDENCE_FROM_TARGET_KIT",
        "READY_FOR_PACKAGE_REFRESH_SCOPE",
        "chipmate-feature-migration-package-refresh-decision-intake.py",
        "chipmate-feature-migration-m11-final-signoff-intake.py",
        "does not migrate ChipMate",
    ],
    "docs/chipmate-feature-migration-package-refresh-owner-action-packet.md": [
        "NEEDS_PACKAGE_REFRESH_DECISION",
        "REFRESH_REQUIRED_FOR_FINAL_DELIVERY",
        "REGENERATE_OFFLINE_PACKAGES",
        "EXCLUDE_SOURCE_SIDE_EVIDENCE_FROM_TARGET_KIT",
        "Accepted by",
        "Accepted date",
        "READY_FOR_PACKAGE_REFRESH_SCOPE",
        "chipmate-feature-migration-package-refresh-decision-intake.py",
        "chipmate-feature-migration-m11-final-signoff-intake.py",
        "does not migrate ChipMate",
    ],
    (
        "docs/chipmate-feature-migration-validation-runs/"
        "20260709-170500-package-refresh-decision-intake-self-check/"
        "summary.md"
    ): [
        "- Status: `PASS`",
        "- Missing decision returns NEEDS_PACKAGE_REFRESH_DECISION: `yes`",
        "- Missing accepted date returns NEEDS_PACKAGE_REFRESH_DECISION: `yes`",
        "- REGENERATE_OFFLINE_PACKAGES accepted decision can pass: `yes`",
        "- EXCLUDE_SOURCE_SIDE_EVIDENCE_FROM_TARGET_KIT accepted decision can pass: `yes`",
    ],
    (
        "docs/chipmate-feature-migration-validation-runs/"
        "20260709-171500-m11-final-signoff-package-gate-self-check/"
        "summary.md"
    ): [
        "- Status: `PASS`",
        "- Missing package refresh decision blocks final signoff: `yes`",
        "- NEEDS_PACKAGE_REFRESH_DECISION blocks final signoff: `yes`",
        "- READY_FOR_PACKAGE_REFRESH_SCOPE can pass final signoff when other gates pass: `yes`",
    ],
    (
        "docs/chipmate-feature-migration-validation-runs/"
        "20260709-152500-m11-current-status-dashboard-self-check/"
        "summary.md"
    ): [
        "Status: `PASS`",
        "Missing tokens: `0`",
    ],
}

STALE_CURRENT_VALUES = {
    "docs/chipmate-feature-migration-final-review-template.md": [
        "size `28221`",
        "size `317912408`",
        "size `317916714`",
    ],
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_text(relative_path: str) -> str:
    return (REPO_ROOT / relative_path).read_text(encoding="utf-8")


def collect_flag_values(value: Any, key: str) -> list[Any]:
    found: list[Any] = []
    if isinstance(value, dict):
        for item_key, item_value in value.items():
            if item_key == key:
                found.append(item_value)
            found.extend(collect_flag_values(item_value, key))
    elif isinstance(value, list):
        for item in value:
            found.extend(collect_flag_values(item, key))
    return found


def ok_or_fail(condition: bool, ok: str, fail: str, passed: list[str], failed: list[str]) -> None:
    if condition:
        passed.append(ok)
    else:
        failed.append(fail)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir")
    parser.add_argument(
        "--output",
        help="Optional summary markdown output path. Kept for compatibility with older handoff text.",
    )
    args = parser.parse_args()

    if args.output_dir and args.output:
        raise SystemExit("use either --output-dir or --output, not both")
    if not args.output_dir and not args.output:
        raise SystemExit("one of --output-dir or --output is required")

    output_dir = REPO_ROOT / args.output_dir if args.output_dir else (REPO_ROOT / args.output).parent
    summary_path = output_dir / "summary.md" if args.output_dir else REPO_ROOT / args.output
    output_dir.mkdir(parents=True, exist_ok=True)

    passed: list[str] = []
    failed: list[str] = []

    artifact_results: list[dict[str, Any]] = []
    for artifact in ARTIFACTS:
        path = REPO_ROOT / artifact.path
        exists = path.exists()
        actual_size = path.stat().st_size if exists else None
        actual_sha256 = sha256_file(path) if exists else None
        artifact_results.append(
            {
                "path": artifact.path,
                "expectedSize": artifact.size,
                "actualSize": actual_size,
                "expectedSha256": artifact.sha256,
                "actualSha256": actual_sha256,
            }
        )
        ok_or_fail(
            exists and actual_size == artifact.size and actual_sha256 == artifact.sha256,
            f"artifact current: {artifact.path}",
            (
                f"artifact mismatch: {artifact.path} expected size {artifact.size} "
                f"sha256 {artifact.sha256}, got size {actual_size} sha256 {actual_sha256}"
            ),
            passed,
            failed,
        )

    doc_results: list[dict[str, Any]] = []
    for relative_path in CURRENT_DOCS:
        path = REPO_ROOT / relative_path
        if not path.exists():
            failed.append(f"missing current doc: {relative_path}")
            continue
        text = load_text(relative_path)
        missing_needles = [needle for needle in DOC_REQUIREMENTS.get(relative_path, []) if needle not in text]
        stale_hits = [needle for needle in STALE_CURRENT_VALUES.get(relative_path, []) if needle in text]
        doc_results.append(
            {
                "path": relative_path,
                "missingNeedles": missing_needles,
                "staleHits": stale_hits,
            }
        )
        ok_or_fail(
            not missing_needles and not stale_hits,
            f"current doc consistent: {relative_path}",
            (
                f"current doc drift: {relative_path}; missing={missing_needles}; "
                f"stale={stale_hits}"
            ),
            passed,
            failed,
        )

    target_kit_path = REPO_ROOT / ARTIFACTS[1].path
    target_kit_names: list[str] = []
    if target_kit_path.exists():
        with tarfile.open(target_kit_path, "r:gz") as tar:
            target_kit_names = tar.getnames()
    for basename in TARGET_KIT_REQUIRED_BASENAMES:
        ok_or_fail(
            any(name.endswith("/" + basename) or name == basename for name in target_kit_names),
            f"target kit contains required helper: {basename}",
            f"target kit missing required helper: {basename}",
            passed,
            failed,
        )
    for basename in TARGET_KIT_FORBIDDEN_BASENAMES:
        ok_or_fail(
            not any(name.endswith("/" + basename) or name == basename for name in target_kit_names),
            f"target kit excludes source-only helper: {basename}",
            f"target kit contains forbidden source-only helper: {basename}",
            passed,
            failed,
        )

    manifest_path = REPO_ROOT / DELIVERY_MANIFEST_PATH
    manifest: dict[str, Any] | None = None
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        passed.append(f"delivery manifest present: {DELIVERY_MANIFEST_PATH}")
    else:
        failed.append(f"delivery manifest missing: {DELIVERY_MANIFEST_PATH}")
    if manifest is not None:
        for flag in REQUIRED_MANIFEST_FLAGS:
            values = collect_flag_values(manifest, flag)
            ok_or_fail(
                any(value is True for value in values),
                f"delivery manifest flag true: {flag}",
                f"delivery manifest flag missing/not true: {flag}; values={values}",
                passed,
                failed,
            )

    report = {
        "status": "PASS" if not failed else "FAIL",
        "passed": passed,
        "failed": failed,
        "artifacts": artifact_results,
        "documents": doc_results,
        "targetKitRequiredBasenames": TARGET_KIT_REQUIRED_BASENAMES,
        "targetKitForbiddenBasenames": TARGET_KIT_FORBIDDEN_BASENAMES,
        "deliveryManifestPath": DELIVERY_MANIFEST_PATH,
        "requiredManifestFlags": REQUIRED_MANIFEST_FLAGS,
    }
    (output_dir / "current-state-consistency.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    summary_lines = [
        "# Current State Consistency Check",
        "",
        f"Status: `{report['status']}`",
        f"Passed checks: `{len(passed)}`",
        f"Failed checks: `{len(failed)}`",
        "",
        "## Failed checks",
    ]
    if failed:
        summary_lines.extend(f"- {item}" for item in failed)
    else:
        summary_lines.append("- None")
    summary_lines.extend(["", "## Passed checks"])
    summary_lines.extend(f"- {item}" for item in passed)
    summary_path.write_text("\n".join(summary_lines) + "\n", encoding="utf-8")

    print(f"Status: {report['status']}")
    print(f"Summary: {summary_path}")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
