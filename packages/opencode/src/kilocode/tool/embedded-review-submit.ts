import { Effect, Schema } from "effect"
import { EmbeddedReviewThinRuntime } from "@/kilocode/embedded-review/thin-runtime"
import * as Tool from "@/tool/tool"

const Finding = Schema.Struct({
  category: Schema.Literals([
    "INTEGER_BOUNDARY",
    "CONDITION_USE",
    "LOCAL_RESOURCE",
    "RETURN_ERROR",
    "UNIT_WIDTH_ENDIAN",
  ]),
  severity: Schema.Literals(["P0", "P1"]),
  path: Schema.String,
  line: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  trigger: Schema.String,
  pathEvidence: Schema.Union([Schema.Array(Schema.String), Schema.String]),
  causalChain: Schema.Union([Schema.Array(Schema.String), Schema.String]),
  impact: Schema.String,
  protectionCounterevidence: Schema.String,
})

const Params = Schema.Struct({
  findings: Schema.Array(Finding),
})

export const EmbeddedReviewSubmitTool = Tool.define(
  "embedded_review_submit",
  Effect.succeed({
    description:
      "向薄 Embedded Review Runtime 一次性提交最终 P0/P1 finding。提交前可自行使用 Read、Grep、Glob 取证；只提交支持范围内、证据闭合的 blocker。",
    parameters: Params,
    execute: (params: Schema.Schema.Type<typeof Params>, ctx: Tool.Context) =>
      Effect.sync(() => {
        const result = EmbeddedReviewThinRuntime.submit(ctx.sessionID, {
          findings: params.findings.map((finding) => ({
            ...finding,
            pathEvidence: list(finding.pathEvidence),
            causalChain: chain(finding.causalChain),
          })),
        })
        return {
          title: "Embedded Review 最终提交",
          output: JSON.stringify(result),
          metadata: {
            complete: result.complete,
            received: "received" in result ? result.received : undefined,
          },
        }
      }),
  }),
)

function list(value: string | readonly string[]) {
  if (typeof value !== "string") return [...value]
  return value
    .split(/\s*(?:->|→|\r?\n)\s*/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function chain(value: string | readonly string[]) {
  if (typeof value !== "string") return [...value]
  return value
    .split(/\s*(?:->|→)\s*/)
    .map((item) => item.trim())
    .filter(Boolean)
}
