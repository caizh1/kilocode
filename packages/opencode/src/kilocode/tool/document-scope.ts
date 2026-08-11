import { DocumentAgentScope } from "@/kilocode/document-agent/scope"
import { ConfigProtection } from "@/kilocode/permission/config-paths"
import { Session } from "@/session/session"
import * as Tool from "@/tool/tool"
import { Effect, Schema } from "effect"

const Parameters = Schema.Struct({
  action: Schema.Literals(["request_code_exploration", "document_only"]),
})

type Metadata = {
  scope: DocumentAgentScope.Scope
}

async function update(sessionID: Tool.Context["sessionID"], scope: DocumentAgentScope.Scope) {
  const { AppRuntime } = await import("@/effect/app-runtime")
  await AppRuntime.runPromise(Session.Service.use((sessions) => DocumentAgentScope.set({ sessions, sessionID, scope })))
}

export const DocumentScopeTool = Tool.define<typeof Parameters, Metadata, never, "document_scope">(
  "document_scope",
  Effect.succeed({
    description:
      "在 Document RAG Agent 中控制源码探索范围。只有用户明确要求查看代码时才能请求开启；用户要求只查文档时立即关闭。",
    parameters: Parameters,
    execute: (params, ctx): Effect.Effect<Tool.ExecuteResult<Metadata>> =>
      Effect.gen(function* () {
        if (ctx.agent !== DocumentAgentScope.AGENT) {
          throw new Error("document_scope is only available to the document agent")
        }

        if (params.action === "request_code_exploration") {
          yield* ctx.ask({
            permission: DocumentAgentScope.APPROVAL,
            patterns: ["workspace-read-only"],
            always: [],
            forceAsk: true,
            metadata: {
              [ConfigProtection.DISABLE_ALWAYS_KEY]: true,
              title: "开启只读代码探索",
              description: "允许当前 Document RAG 会话读取和检索工作区源码；不会开放 Shell、编辑、网络或子 Agent。",
            },
          })
          yield* Effect.promise(() => update(ctx.sessionID, "documents_and_code"))
          return {
            title: "已开启只读代码探索",
            output: "当前会话已进入“文档 + 只读代码”范围。现在可以使用只读代码检索工具回答用户明确提出的源码问题。",
            metadata: { scope: "documents_and_code" as const },
          }
        }

        yield* Effect.promise(() => update(ctx.sessionID, "documents"))
        return {
          title: "已恢复仅文档",
          output: "当前会话已恢复“仅文档”范围。后续不得再使用任何代码探索工具。",
          metadata: { scope: "documents" as const },
        }
      }).pipe(Effect.orDie),
  }),
)
