#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUN_STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${VALIDATION_RUN_DIR:-${REPO_ROOT}/docs/chipmate-feature-migration-validation-runs/${RUN_STAMP}-artifact-manifest-deterministic-smoke}"
WORKSPACE="${1:-${REPO_ROOT}}"

mkdir -p "${RUN_DIR}"

OPENCODE_TMP_DIR="${REPO_ROOT}/packages/opencode/.chipmate-artifact-smoke-${RUN_STAMP}"
SMOKE_TS="${OPENCODE_TMP_DIR}/artifact-smoke.ts"
mkdir -p "${OPENCODE_TMP_DIR}"
trap 'rm -rf "${OPENCODE_TMP_DIR}"' EXIT

cat >"${SMOKE_TS}" <<'TS'
import fs from "node:fs/promises"
import path from "node:path"
import { WithInstance } from "@/project/with-instance"
import {
  declareArtifact,
  exportArtifactDiagnostics,
  listArtifacts,
  resolveOpenArtifact,
} from "@/chipmate/documents/artifacts"

const workspace = path.resolve(process.argv[2] ?? process.cwd())
const runDir = path.resolve(process.argv[3] ?? path.join(workspace, "docs", "chipmate-feature-migration-validation-runs", "artifact-smoke"))
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-")
const artifactDir = `.chipmate/artifacts/${stamp}-s4-deterministic-artifact-smoke`
const reportFile = "report.md"

type Summary = {
  status: "PASS" | "FAIL"
  workspace: string
  artifactDir?: string
  manifestPath?: string
  reportPath?: string
  diagnosticsPath?: string
  listed?: boolean
  openedManifest?: boolean
  error?: string
}

function fail(message: string): never {
  throw new Error(message)
}

async function main(): Promise<Summary> {
  return await WithInstance.provide({
    directory: workspace,
    fn: async () => {
      const absoluteArtifactDir = path.join(workspace, artifactDir)
      await fs.mkdir(absoluteArtifactDir, { recursive: true })
      await fs.writeFile(
        path.join(absoluteArtifactDir, reportFile),
        [
          "# Migration Validation Report",
          "",
          "## Summary",
          "",
          "This deterministic smoke verifies the migrated document artifact manager without depending on model tool selection.",
          "",
          "## Risks",
          "",
          "- Chat/runtime S4 still needs separate evidence that the agent selects declare_artifact.",
          "- This smoke must not be treated as a replacement for installed VSIX S1-S16 validation.",
          "",
        ].join("\n"),
        "utf8",
      )

      const declared = await declareArtifact({
        kind: "migration-validation-report",
        title: "S4 Deterministic Artifact Smoke",
        artifactDir,
        primaryFile: reportFile,
        sourceFiles: ["docs/chipmate-feature-migration-plan.md"],
        warnings: ["deterministic smoke; chat/runtime S4 tool selection remains separately reviewed"],
        qualityStatus: "ok",
      })

      if (declared.artifactDir !== artifactDir) fail(`Unexpected artifactDir: ${declared.artifactDir}`)
      if (declared.manifestPath !== `${artifactDir}/artifact.json`) fail(`Unexpected manifestPath: ${declared.manifestPath}`)

      const manifestRaw = await fs.readFile(path.join(workspace, declared.manifestPath), "utf8")
      const manifest = JSON.parse(manifestRaw) as { kind?: string; title?: string; primaryFile?: string; quality?: { status?: string } }
      if (manifest.kind !== "migration-validation-report") fail(`Unexpected manifest kind: ${manifest.kind}`)
      if (manifest.primaryFile !== reportFile) fail(`Unexpected primaryFile: ${manifest.primaryFile}`)
      if (manifest.quality?.status !== "ok") fail(`Unexpected quality status: ${manifest.quality?.status}`)

      const listedArtifacts = await listArtifacts()
      const listed = listedArtifacts.some((artifact) => artifact.manifestPath === declared.manifestPath)
      if (!listed) fail("Declared artifact was not returned by listArtifacts()")

      const opened = await resolveOpenArtifact({ path: declared.manifestPath })
      if (opened.path !== declared.manifestPath || opened.isDirectory) fail(`Unexpected open result: ${JSON.stringify(opened)}`)

      const diagnostics = await exportArtifactDiagnostics()
      const diagnosticsRaw = await fs.readFile(path.join(workspace, diagnostics.path), "utf8")
      if (!diagnosticsRaw.includes("S4 Deterministic Artifact Smoke")) fail("Diagnostics export did not include the declared artifact")

      return {
        status: "PASS",
        workspace,
        artifactDir: declared.artifactDir,
        manifestPath: declared.manifestPath,
        reportPath: `${artifactDir}/${reportFile}`,
        diagnosticsPath: diagnostics.path,
        listed,
        openedManifest: true,
      }
    },
  })
}

try {
  const summary = await main()
  await fs.mkdir(runDir, { recursive: true })
  await fs.writeFile(path.join(runDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8")
  await fs.writeFile(
    path.join(runDir, "summary.md"),
    [
      "# Deterministic Artifact Manifest Smoke",
      "",
      `- Status: \`${summary.status}\``,
      `- Workspace: \`${summary.workspace}\``,
      `- Artifact dir: \`${summary.artifactDir}\``,
      `- Manifest: \`${summary.manifestPath}\``,
      `- Primary report: \`${summary.reportPath}\``,
      `- Diagnostics: \`${summary.diagnosticsPath}\``,
      `- Listed by artifact manager: \`${summary.listed ? "yes" : "no"}\``,
      `- Opened manifest path: \`${summary.openedManifest ? "yes" : "no"}\``,
      "",
      "This proves the artifact manifest lifecycle through the migrated artifact manager API.",
      "It does not prove that chat/runtime S4 selected the `declare_artifact` tool.",
      "",
    ].join("\n"),
    "utf8",
  )
  console.log(JSON.stringify(summary, null, 2))
  process.exit(0)
} catch (err) {
  const summary: Summary = {
    status: "FAIL",
    workspace,
    error: err instanceof Error ? err.message : String(err),
  }
  await fs.mkdir(runDir, { recursive: true })
  await fs.writeFile(path.join(runDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8")
  await fs.writeFile(
    path.join(runDir, "summary.md"),
    ["# Deterministic Artifact Manifest Smoke", "", "- Status: `FAIL`", `- Error: ${summary.error}`, ""].join("\n"),
    "utf8",
  )
  console.error(summary.error)
  process.exit(1)
}
TS

cp "${SMOKE_TS}" "${RUN_DIR}/artifact-smoke.ts"

(
  cd "${REPO_ROOT}/packages/opencode"
  bun "${SMOKE_TS}" "${WORKSPACE}" "${RUN_DIR}"
) >"${RUN_DIR}/artifact-smoke.log" 2>&1

cat "${RUN_DIR}/summary.md"
