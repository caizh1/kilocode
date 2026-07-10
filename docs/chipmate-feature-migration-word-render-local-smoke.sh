#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUN_STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${VALIDATION_RUN_DIR:-${REPO_ROOT}/docs/chipmate-feature-migration-validation-runs/${RUN_STAMP}-word-render-local-soffice-smoke}"
WORKSPACE="${1:-${REPO_ROOT}}"

mkdir -p "${RUN_DIR}"

OPENCODE_TMP_DIR="${REPO_ROOT}/packages/opencode/.chipmate-word-render-local-smoke-${RUN_STAMP}"
SMOKE_TS="${OPENCODE_TMP_DIR}/word-render-local-smoke.ts"
mkdir -p "${OPENCODE_TMP_DIR}"
trap 'rm -rf "${OPENCODE_TMP_DIR}"' EXIT

cat >"${SMOKE_TS}" <<'TS'
import fs from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { WithInstance } from "@/project/with-instance"
import { createWordDocument, renderWordDocument } from "@/kilocode/documents/word"

const workspace = path.resolve(process.argv[2] ?? process.cwd())
const runDir = path.resolve(process.argv[3] ?? path.join(workspace, "docs", "chipmate-feature-migration-validation-runs", "word-render-local-smoke"))

type Summary = {
  status: "PASS" | "FAIL"
  workspace: string
  soffice?: string
  pdftoppm?: string
  sourcePath?: string
  artifactDir?: string
  manifestPath?: string
  pdfPath?: string
  pagePngPaths?: string[]
  diagnosticsPath?: string
  pageCount?: number
  diagnostics?: unknown[]
  error?: string
}

async function main(): Promise<Summary> {
  return await WithInstance.provide({
    directory: workspace,
    fn: async () => {
      const source = await createWordDocument({
        title: "Local Render Smoke",
        outputFile: "local-render-smoke.docx",
        sections: [
          {
            title: "Overview",
            paragraphs: [
              "This document verifies local soffice and pdftoppm rendering without bundling renderer binaries into the VSIX.",
            ],
          },
        ],
      })
      const rendered = await renderWordDocument({
        sourcePath: source.path,
        outputFile: "local-render-smoke.pdf",
        taskSlug: "local-render-smoke",
        maxPages: 5,
      })
      if (!rendered.pdfPath) throw new Error("local render did not produce a PDF")
      if (rendered.pageCount < 1 || rendered.pagePngPaths.length < 1) throw new Error("local render did not produce page PNGs")
      await fs.stat(path.join(workspace, rendered.pdfPath))
      await fs.stat(path.join(workspace, rendered.pagePngPaths[0]!))
      await fs.stat(path.join(workspace, rendered.diagnosticsPath))
      return {
        status: "PASS",
        workspace,
        soffice: process.env.KILO_WORD_RENDER_SOFFICE,
        pdftoppm: process.env.KILO_WORD_RENDER_PDFTOPPM,
        sourcePath: source.path,
        artifactDir: rendered.artifactDir,
        manifestPath: rendered.manifestPath,
        pdfPath: rendered.pdfPath,
        pagePngPaths: rendered.pagePngPaths,
        diagnosticsPath: rendered.diagnosticsPath,
        pageCount: rendered.pageCount,
        diagnostics: rendered.diagnostics,
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
      "# Local Word Render Smoke",
      "",
      `- Status: \`${summary.status}\``,
      `- Workspace: \`${summary.workspace}\``,
      `- soffice: \`${summary.soffice ?? "PATH"}\``,
      `- pdftoppm: \`${summary.pdftoppm ?? "PATH"}\``,
      `- Source DOCX: \`${summary.sourcePath}\``,
      `- Artifact dir: \`${summary.artifactDir}\``,
      `- Manifest: \`${summary.manifestPath}\``,
      `- PDF: \`${summary.pdfPath}\``,
      `- Page count: \`${summary.pageCount}\``,
      `- First page PNG: \`${summary.pagePngPaths?.[0] ?? ""}\``,
      `- Diagnostics: \`${summary.diagnosticsPath}\``,
      "",
      "This proves local Word render output using externally available soffice/pdftoppm binaries.",
      "It does not bundle renderer binaries into the VSIX and does not replace installed chat/runtime S10 validation.",
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
    soffice: process.env.KILO_WORD_RENDER_SOFFICE,
    pdftoppm: process.env.KILO_WORD_RENDER_PDFTOPPM,
    error: err instanceof Error ? err.message : String(err),
  }
  await fs.mkdir(runDir, { recursive: true })
  await fs.writeFile(path.join(runDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8")
  await fs.writeFile(
    path.join(runDir, "summary.md"),
    ["# Local Word Render Smoke", "", "- Status: `FAIL`", `- Error: ${summary.error}`, ""].join("\n"),
    "utf8",
  )
  console.error(summary.error)
  process.exit(1)
}
TS

cp "${SMOKE_TS}" "${RUN_DIR}/word-render-local-smoke.ts"

(
  cd "${REPO_ROOT}/packages/opencode"
  bun "${SMOKE_TS}" "${WORKSPACE}" "${RUN_DIR}"
) >"${RUN_DIR}/word-render-local-smoke.log" 2>&1

cat "${RUN_DIR}/summary.md"
