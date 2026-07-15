import { Effect, Schema } from "effect"
import path from "path"
import type { QueryEvidenceResult } from "@kilocode/kilo-indexing/engine"
import * as Tool from "@/tool/tool"
import { KiloIndexing } from "@/kilocode/indexing"
import { Instance } from "@/kilocode/instance"

import DESCRIPTION from "./codebase-analysis.txt"

const Parameters = Schema.Struct({
  query: Schema.String.annotate({
    description: "The codebase analysis question, preferably naming relevant C/C++ symbols, files, modules, or flows.",
  }),
  path: Schema.optional(Schema.String).annotate({
    description:
      "Limit analysis to a specific subdirectory relative to the current workspace directory. Leave empty for the whole workspace.",
  }),
  mode: Schema.optional(Schema.Union([Schema.Literal("hybrid"), Schema.Literal("graph-only")])).annotate({
    description: "Use graph-only for C/C++ graph records only, or hybrid for graph, lexical BM25, and vector evidence.",
  }),
  maxEvidenceItems: Schema.optional(Schema.Number).annotate({
    description: "Maximum evidence items to include in the analysis pack.",
  }),
  maxPackChars: Schema.optional(Schema.Number).annotate({
    description: "Maximum character budget for the formatted analysis pack.",
  }),
})

type Meta = {
  trace: QueryEvidenceResult["trace"]
  answerPolicy: QueryEvidenceResult["answerPolicy"]
  evidenceRefs: QueryEvidenceResult["evidenceRefs"]
  result: QueryEvidenceResult
}

export const CodebaseAnalysisTool = Tool.define(
  "codebase_analysis",
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

        const mode = params.mode ?? "hybrid"

        yield* ctx.ask({
          permission: "codebase_analysis",
          patterns: [params.query],
          always: ["*"],
          metadata: {
            query: params.query,
            path: params.path,
            mode,
          },
        })

        const prefix = normalizeSearchPath(params.path)
        const opts = {
          ...(prefix ? { directoryPrefix: prefix } : {}),
          retrievalMode: mode,
          ...(params.maxEvidenceItems !== undefined ? { maxEvidenceItems: params.maxEvidenceItems } : {}),
          ...(params.maxPackChars !== undefined ? { maxPackChars: params.maxPackChars } : {}),
        }
        const result = yield* Effect.promise(() => KiloIndexing.queryEvidence(params.query, opts))

        return {
          title: "Codebase Analysis",
          metadata: {
            trace: result.trace,
            answerPolicy: result.answerPolicy,
            evidenceRefs: result.evidenceRefs,
            result,
          },
          output: result.formattedPackText,
        }
      }).pipe(Effect.orDie),
  }),
)

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
