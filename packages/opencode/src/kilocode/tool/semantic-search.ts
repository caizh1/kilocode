import { Effect, Schema } from "effect"
import path from "path"
import * as Tool from "@/tool/tool"
import { KiloIndexing } from "@/kilocode/indexing"
import { Instance } from "@/project/instance"

import DESCRIPTION from "./semantic-search.txt"

const Parameters = Schema.Struct({
  query: Schema.String.annotate({
    description: "The search query, expressed in natural language.",
  }),
  path: Schema.optional(Schema.String).annotate({
    description:
      "Limit search to specific subdirectory (relative to the current workspace directory). Leave empty for entire workspace.",
  }),
})

type SearchResult = {
  filePath: string
  score: number
  startLine: number
  endLine: number
  codeChunk: string
}

type Meta = {
  results: SearchResult[]
}

export const SemanticSearchTool = Tool.define(
  "semantic_search",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ): Effect.Effect<Tool.ExecuteResult<Meta>> =>
      Effect.gen(function* () {
        if (!params.query) {
          throw new Error("query is required")
        }

        const prefix = normalizeSearchPath(params.path)
        if (!KiloIndexing.ready()) return unavailable()
        const status = yield* Effect.promise(() => KiloIndexing.current())
        const state = status.pipelines?.rag.state
        if (state === "Disabled" || state === "Error") return unavailable(state)

        yield* ctx.ask({
          permission: "semantic_search",
          patterns: [params.query],
          always: ["*"],
          metadata: {
            query: params.query,
            path: params.path,
          },
        })

        const matches = yield* Effect.promise(() => KiloIndexing.search(params.query, prefix))

        const results = matches.flatMap<SearchResult>((item) => {
          const payload = item.payload
          if (!payload) return []
          if (
            typeof payload.filePath !== "string" ||
            typeof payload.codeChunk !== "string" ||
            typeof payload.startLine !== "number" ||
            typeof payload.endLine !== "number"
          ) {
            return []
          }

          return [
            {
              filePath: normalizePath(payload.filePath),
              score: item.score,
              startLine: payload.startLine,
              endLine: payload.endLine,
              codeChunk: payload.codeChunk,
            },
          ]
        })

        if (results.length === 0) {
          if (state === "In Progress" || state === "Standby") {
            return {
              title: "Codebase Search",
              metadata: {
                results,
              },
              output: `No conclusive semantic results yet because the index is ${state.toLowerCase()}. Use Grep, Glob, and Read for this request; do not repeatedly retry semantic_search.`,
            }
          }
          return {
            title: "Codebase Search",
            metadata: {
              results,
            },
            output: `No relevant code found for "${params.query}"${prefix ? ` in ${normalizePath(prefix)}` : ""}.`,
          }
        }

        const output = [
          `Found ${results.length} result${results.length === 1 ? "" : "s"} for "${params.query}"${prefix ? ` in ${normalizePath(prefix)}` : ""}.`,
          "",
          ...results.flatMap((item, index) => {
            return [
              `${index + 1}. ${item.filePath}:${item.startLine}-${item.endLine} (score ${item.score.toFixed(4)})`,
              item.codeChunk,
              "",
            ]
          }),
          ...(state === "In Progress" || state === "Standby"
            ? ["", `[Semantic index state: ${state}; results may be incomplete.]`]
            : []),
        ]

        return {
          title: "Codebase Search",
          metadata: {
            results,
          },
          output: output.join("\n").trim(),
        }
      }).pipe(Effect.orDie),
  }),
)

function unavailable(state?: "Disabled" | "Error"): Tool.ExecuteResult<Meta> {
  const reason = state ? ` unavailable (${state})` : " not ready yet"
  return {
    title: "Codebase Search",
    metadata: { results: [] },
    output: `Semantic index is${reason}. Use Grep, Glob, and Read for this request; do not repeatedly retry semantic_search until indexing status changes.`,
  }
}

function normalizeSearchPath(input?: string): string | undefined {
  if (!input) return undefined

  const absolute = path.resolve(Instance.directory, input)
  const relative = path.relative(Instance.directory, absolute)
  if (!relative || relative === ".") return undefined
  if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`path must be within the current workspace: ${input}`)
  }
  return path.normalize(relative)
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/")
}
