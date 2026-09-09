import { describe, expect, test } from "bun:test"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import type { Provider } from "../../src/provider/provider"
import { ChipMatePartLifecycle } from "../../src/chipmate/session/part-lifecycle"
import { ChipMateCompactionStatus } from "../../src/chipmate/session/compaction-status"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"

const sid = SessionID.make("session")
const pid = ProviderV2.ID.make("test")
const mid = ModelV2.ID.make("test-model")
const model: Provider.Model = {
  id: mid,
  providerID: pid,
  api: {
    id: mid,
    url: "https://example.com",
    npm: "@ai-sdk/openai",
  },
  name: "Test Model",
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 0, input: 0, output: 0 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

function user(id: string): SessionV1.User {
  return {
    id: MessageID.make(id),
    sessionID: sid,
    role: "user",
    time: { created: 0 },
    agent: "user",
    model: { providerID: pid, modelID: mid },
    tools: {},
    mode: "",
  } as unknown as SessionV1.User
}

function assistant(id: string, parentID: string): SessionV1.Assistant {
  return {
    id: MessageID.make(id),
    sessionID: sid,
    role: "assistant",
    time: { created: 0 },
    parentID: MessageID.make(parentID),
    modelID: mid,
    providerID: pid,
    mode: "",
    agent: "agent",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  } as unknown as SessionV1.Assistant
}

function text(messageID: string, id: string, value: string, transient = false): SessionV1.TextPart {
  return {
    id: PartID.make(id),
    messageID: MessageID.make(messageID),
    sessionID: sid,
    type: "text",
    text: value,
    synthetic: transient,
    ...(transient ? { metadata: { [ChipMatePartLifecycle.key]: "transient" } } : {}),
  }
}

describe("transient session parts", () => {
  test("keeps UI progress out of resumed model messages", async () => {
    const input: SessionV1.WithParts[] = [
      {
        info: user("msg_user"),
        parts: [
          text("msg_user", "prt_user_transient", "Preparing context…", true),
          text("msg_user", "prt_user", "continue"),
        ],
      },
      {
        info: assistant("msg_assistant", "msg_user"),
        parts: [
          text("msg_assistant", "prt_assistant", "durable result"),
          text("msg_assistant", "prt_assistant_transient", "Initializing snapshot…", true),
        ],
      },
    ]

    expect(await MessageV2.toModelMessages(input, model)).toStrictEqual([
      { role: "user", content: [{ type: "text", text: "continue" }] },
      { role: "assistant", content: [{ type: "text", text: "durable result" }] },
    ])
  })

  test("keeps durable compaction lifecycle metadata out of model messages", async () => {
    const message = user("msg_compaction")
    const status = ChipMateCompactionStatus.create({
      sessionID: sid,
      messageID: message.id,
      source: "manual",
      now: 1_000,
    })
    const input: SessionV1.WithParts[] = [
      {
        info: message,
        parts: [
          status,
          {
            id: PartID.make("prt_compaction"),
            messageID: message.id,
            sessionID: sid,
            type: "compaction",
            auto: false,
          },
        ],
      },
    ]

    expect(await MessageV2.toModelMessages(input, model)).toStrictEqual([
      { role: "user", content: [{ type: "text", text: "What did we do so far?" }] },
    ])
  })
})
