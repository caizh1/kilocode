import { Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import { wordToImages } from "@/chipmate/documents/word-to-images"

const Parameters = Schema.Struct({
  sourcePath: Schema.String,
  startPage: Schema.optional(Schema.Number),
  maxPages: Schema.optional(Schema.Number),
  timeoutMs: Schema.optional(Schema.Number),
})

export const WordToImagesTool = Tool.define(
  "word_to_images",
  Effect.succeed({
    description:
      "将已有 Word 转成页面图片供阅读公式、流程图和排版。仅在用户明确要求查看 Word 图文或 Spec 需要图页证据时使用；普通文字问答不自动转换。不修改原文、不刷新目录。返回本地图片路径和真实页码，请用 read 按页查看；转换完成不代表已经理解图片。仅使用已配置的 ChipMate Server。",
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
      Effect.gen(function* () {
        yield* ctx.ask({
          permission: "word_to_images",
          patterns: [params.sourcePath],
          always: ["*"],
          metadata: { sourcePath: params.sourcePath },
        })
        const result = yield* Effect.tryPromise({
          try: () => wordToImages(params, ctx.abort),
          catch: (error) => error,
        }).pipe(Effect.orDie)
        return { title: "Word 页面图片", metadata: result, output: JSON.stringify(result) }
      }),
  }),
)
