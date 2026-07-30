import { Effect, Schema } from "effect"
import { EmbeddedReviewRuntime } from "@/kilocode/embedded-review/runtime"
import * as Tool from "@/tool/tool"

const Standard = Schema.Struct({
  ruleId: Schema.String,
  path: Schema.String,
  line: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  violation: Schema.String,
  code: Schema.String,
  exceptionCounterevidence: Schema.String,
})

const Logic = Schema.Struct({
  obligationId: Schema.optional(Schema.String),
  category: Schema.Literals([
    "CONTROL_CONTRACT",
    "MEMORY_SECURITY",
    "REALTIME_CONCURRENCY",
    "RESOURCE_LIFECYCLE",
    "UPDATE_PERSISTENCE",
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

const Review = Schema.Struct({
  obligationId: Schema.String,
  disposition: Schema.Literals(["CONFIRMED", "REFUTED", "UNVERIFIED"]),
  reason: Schema.String,
  evidence: Schema.Array(Schema.String),
})

const Params = Schema.Struct({
  action: Schema.Literals(["start", "submit"]),
  packet: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  standardFindings: Schema.Array(Standard),
  logicFindings: Schema.Array(Logic),
  obligationReviews: Schema.Array(Review),
  unverifiedRisks: Schema.Array(Schema.String),
  nonBlockingFindings: Schema.Array(Schema.String),
})

export const EmbeddedReviewPacketTool = Tool.define(
  "embedded_review_packet",
  Effect.succeed({
    description:
      "按确定性顺序逐个处理 Embedded Review 证据包。启动时 packet=0；提交时原样回传当前响应的 packet 序号，再只提交当前证据包的候选和每个通用义务的处置，禁止合并多个证据包。",
    parameters: Params,
    execute: (params: Schema.Schema.Type<typeof Params>, ctx: Tool.Context) =>
      Effect.sync(() => {
        const input =
          params.action === "start"
            ? { action: "start" as const, packet: params.packet }
            : {
                action: "submit" as const,
                packet: params.packet,
                submission: {
                  standardFindings: [...params.standardFindings],
                  logicFindings: params.logicFindings.map((finding) => ({
                    ...finding,
                    pathEvidence: list(finding.pathEvidence),
                    causalChain: chain(finding.causalChain),
                  })),
                  obligationReviews: params.obligationReviews.map((review) => ({
                    ...review,
                    evidence: [...review.evidence],
                  })),
                  unverifiedRisks: [...params.unverifiedRisks],
                  nonBlockingFindings: [...params.nonBlockingFindings],
                },
              }
        const result = EmbeddedReviewRuntime.next(ctx.sessionID, input)
        return {
          title: result.complete ? "Embedded Review 证据包处理完成" : "Embedded Review 单个证据包",
          output: JSON.stringify(result),
          metadata: {
            complete: result.complete,
            packet: "packet" in result ? result.packet : undefined,
            total: "total" in result ? result.total : undefined,
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
