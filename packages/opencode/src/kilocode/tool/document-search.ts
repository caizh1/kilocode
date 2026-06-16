import { Effect, Schema } from "effect"
import path from "path"
import type { DocumentSearchResult } from "@kilocode/kilo-indexing/engine"
import * as Tool from "@/tool/tool"
import { KiloIndexing } from "@/kilocode/indexing"
import { Instance } from "@/project/instance"

import DESCRIPTION from "./document-search.txt"

const DEFAULT_MAX_PACK_CHARS = 16_000
const MIN_MAX_PACK_CHARS = 1_000
const MAX_MAX_PACK_CHARS = 64_000
const MAX_RESULTS = 20

const Parameters = Schema.Struct({
  query: Schema.String.annotate({
    description: "The document search query, expressed in natural language.",
  }),
  path: Schema.optional(Schema.String).annotate({
    description:
      "Limit search to a specific configured document subdirectory relative to the current workspace directory.",
  }),
  maxResults: Schema.optional(Schema.Number).annotate({
    description: "Maximum number of document snippets to return.",
  }),
  maxPackChars: Schema.optional(Schema.Number).annotate({
    description: "Maximum character budget for the formatted document evidence pack.",
  }),
})

type Meta = {
  results: DocumentSearchResult[]
  truncated: boolean
  maxPackChars: number
}

export const DocumentSearchTool = Tool.define(
  "document_search",
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

        yield* ctx.ask({
          permission: "document_search",
          patterns: [params.query],
          always: ["*"],
          metadata: {
            query: params.query,
            path: params.path,
            maxResults: params.maxResults,
          },
        })

        const prefix = normalizeSearchPath(params.path)
        const maxResults = clamp(params.maxResults ?? 8, 1, MAX_RESULTS)
        const maxPackChars = clamp(
          params.maxPackChars ?? DEFAULT_MAX_PACK_CHARS,
          MIN_MAX_PACK_CHARS,
          MAX_MAX_PACK_CHARS,
        )
        const results = yield* Effect.promise(() =>
          KiloIndexing.searchDocuments(params.query, {
            ...(prefix ? { directoryPrefix: prefix } : {}),
            maxResults,
          }),
        )

        if (results.length === 0) {
          return {
            title: "Document Search",
            metadata: {
              results,
              truncated: false,
              maxPackChars,
            },
            output: `No relevant documents found for "${params.query}"${prefix ? ` in ${normalizePath(prefix)}` : ""}.`,
          }
        }

        const pack = format(params.query, prefix, results, maxPackChars)
        return {
          title: "Document Search",
          metadata: {
            results,
            truncated: pack.truncated,
            maxPackChars,
          },
          output: pack.text,
        }
      }).pipe(Effect.orDie),
  }),
)

function format(query: string, prefix: string | undefined, results: DocumentSearchResult[], max: number) {
  const head = `Found ${results.length} document result${results.length === 1 ? "" : "s"} for "${query}"${prefix ? ` in ${normalizePath(prefix)}` : ""}.`
  const lines = [
    head,
    "",
    ...results.flatMap((item, index) => [
      `${index + 1}. ${normalizePath(item.sourceRef)} (score ${item.score.toFixed(4)})`,
      item.content.trim(),
      "",
    ]),
  ]
  return fit(lines.join("\n").trim(), max)
}

function fit(value: string, max: number): { text: string; truncated: boolean } {
  if (value.length <= max) return { text: value, truncated: false }
  const note = "\n\n[Document search output truncated by maxPackChars.]"
  const text = `${value.slice(0, Math.max(0, max - note.length)).trimEnd()}${note}`
  return { text, truncated: true }
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

function clamp(input: number, min: number, max: number): number {
  const value = Math.floor(input)
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}
