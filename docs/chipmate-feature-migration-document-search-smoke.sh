#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUN_STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="${VALIDATION_RUN_DIR:-${REPO_ROOT}/docs/chipmate-feature-migration-validation-runs/${RUN_STAMP}-document-search-deterministic-smoke}"
WORKSPACE="${1:-${REPO_ROOT}}"

mkdir -p "${RUN_DIR}"

OPENCODE_TMP_DIR="${REPO_ROOT}/packages/opencode/.chipmate-document-search-smoke-${RUN_STAMP}"
SMOKE_TS="${OPENCODE_TMP_DIR}/document-search-smoke.ts"
mkdir -p "${OPENCODE_TMP_DIR}"
trap 'rm -rf "${OPENCODE_TMP_DIR}"' EXIT

cat >"${SMOKE_TS}" <<'TS'
import fs from "node:fs/promises"
import path from "node:path"
import { spyOn } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { WithInstance } from "@/project/with-instance"
import { DocumentSearchTool } from "@/kilocode/tool/document-search"
import { KiloIndexing } from "@/kilocode/indexing"
import { Agent } from "@/agent/agent"
import { Truncate } from "@/tool/truncate"
import { Tool } from "@/tool/tool"
import { MessageID, SessionID } from "@/session/schema"
import type { Permission } from "@/permission"

const workspace = path.resolve(process.argv[2] ?? process.cwd())
const runDir = path.resolve(process.argv[3] ?? path.join(workspace, "docs", "chipmate-feature-migration-validation-runs", "document-search-smoke"))
const runtime = ManagedRuntime.make(Layer.mergeAll(Truncate.defaultLayer, Agent.defaultLayer))

type Summary = {
  status: "PASS" | "FAIL"
  workspace: string
  toolId?: string
  permission?: string
  normalizedPath?: string
  maxResults?: number
  resultCount?: number
  truncated?: boolean
  outputContainsSource?: boolean
  outputContainsContent?: boolean
  error?: string
}

async function main(): Promise<Summary> {
  return await WithInstance.provide({
    directory: workspace,
    fn: async () => {
      const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
      const search = spyOn(KiloIndexing, "searchDocuments").mockResolvedValue([
        {
          filePath: "docs/source-backed-detail-design-skill-contract.md",
          sourceRef: "docs/source-backed-detail-design-skill-contract.md#L1-L10",
          score: 0.98765,
          content: "The source-backed detail design skill requires evidence, diagrams, Markdown, Word output, and quality review artifacts.",
          startLine: 1,
          endLine: 10,
        },
      ])

      try {
        const info = await runtime.runPromise(DocumentSearchTool)
        const tool = await runtime.runPromise(Tool.init(info))
        const result = await runtime.runPromise(
          tool.execute(
            {
              query: "source backed detail design required deliverables",
              path: "./docs/../docs",
              maxResults: 3,
              maxPackChars: 4096,
            },
            {
              sessionID: SessionID.make("ses_chipmate_document_search_smoke"),
              messageID: MessageID.make("msg_chipmate_document_search_smoke"),
              callID: "call_chipmate_document_search_smoke",
              agent: "code",
              abort: AbortSignal.any([]),
              messages: [],
              metadata: () => Effect.void,
              ask: (request: Omit<Permission.Request, "id" | "sessionID" | "tool">) => {
                requests.push(request)
                return Effect.void
              },
            },
          ),
        )

        const call = search.mock.calls[0]
        const calledQuery = call?.[0]
        const calledOptions = call?.[1] as { directoryPrefix?: string; maxResults?: number } | undefined
        if (tool.id !== "document_search") throw new Error(`Unexpected tool id: ${tool.id}`)
        if (requests[0]?.permission !== "document_search") throw new Error(`Unexpected permission: ${requests[0]?.permission}`)
        if (calledQuery !== "source backed detail design required deliverables") throw new Error(`Unexpected query: ${calledQuery}`)
        if (calledOptions?.directoryPrefix !== path.normalize("docs")) throw new Error(`Unexpected directoryPrefix: ${calledOptions?.directoryPrefix}`)
        if (calledOptions?.maxResults !== 3) throw new Error(`Unexpected maxResults: ${calledOptions?.maxResults}`)
        if (result.metadata.results.length !== 1) throw new Error(`Unexpected result count: ${result.metadata.results.length}`)
        if (!result.output.includes("docs/source-backed-detail-design-skill-contract.md#L1-L10")) throw new Error("Output missing source reference")
        if (!result.output.includes("requires evidence, diagrams")) throw new Error("Output missing document content")

        return {
          status: "PASS",
          workspace,
          toolId: tool.id,
          permission: requests[0]?.permission,
          normalizedPath: calledOptions.directoryPrefix,
          maxResults: calledOptions.maxResults,
          resultCount: result.metadata.results.length,
          truncated: result.metadata.truncated,
          outputContainsSource: true,
          outputContainsContent: true,
        }
      } finally {
        search.mockRestore()
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
      "# Deterministic Document Search Smoke",
      "",
      `- Status: \`${summary.status}\``,
      `- Workspace: \`${summary.workspace}\``,
      `- Tool id: \`${summary.toolId}\``,
      `- Permission requested: \`${summary.permission}\``,
      `- Normalized path: \`${summary.normalizedPath}\``,
      `- Max results: \`${summary.maxResults}\``,
      `- Result count: \`${summary.resultCount}\``,
      `- Truncated: \`${summary.truncated ? "yes" : "no"}\``,
      `- Output contains source ref: \`${summary.outputContainsSource ? "yes" : "no"}\``,
      `- Output contains document content: \`${summary.outputContainsContent ? "yes" : "no"}\``,
      "",
      "This proves the native `document_search` tool contract, permission path, path normalization, and evidence-pack formatting.",
      "It uses a deterministic `KiloIndexing.searchDocuments` stub and does not prove installed chat/runtime S3 tool selection or live document-index recall.",
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
    ["# Deterministic Document Search Smoke", "", "- Status: `FAIL`", `- Error: ${summary.error}`, ""].join("\n"),
    "utf8",
  )
  console.error(summary.error)
  process.exit(1)
}
TS

cp "${SMOKE_TS}" "${RUN_DIR}/document-search-smoke.ts"

(
  cd "${REPO_ROOT}/packages/opencode"
  bun "${SMOKE_TS}" "${WORKSPACE}" "${RUN_DIR}"
) >"${RUN_DIR}/document-search-smoke.log" 2>&1

cat "${RUN_DIR}/summary.md"
