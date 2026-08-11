import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { KiloSessionMessageInfo } from "@/kilocode/session/message-info"
import { SessionID } from "@/session/schema"

describe("持久化 Session 消息格式恢复", () => {
  test("把 SQLite JSON 中的结构化输出格式恢复为可供 HttpApi 编码的 Schema 实例", async () => {
    const plain = {
      id: SessionV1.MessageID.make("msg_user"),
      sessionID: SessionID.make("ses_test"),
      role: "user" as const,
      time: { created: 1 },
      agent: "design-doc-worker",
      model: {
        providerID: ProviderV2.ID.make("deepseek"),
        modelID: ModelV2.ID.make("deepseek-reasoner"),
      },
      system: "",
      tools: {},
      format: {
        type: "json_schema" as const,
        schema: { type: "object" },
        retryCount: 0,
      },
    }

    const hydrated = KiloSessionMessageInfo.hydrate(plain)

    expect(hydrated.role).toBe("user")
    if (hydrated.role !== "user") throw new Error("预期为用户消息")
    expect(hydrated.format).toBeInstanceOf(SessionV1.OutputFormatJsonSchema)
    const encoded = await Schema.encodeUnknownPromise(SessionV1.Info)(hydrated)
    expect(encoded).toBeDefined()
  })
})
