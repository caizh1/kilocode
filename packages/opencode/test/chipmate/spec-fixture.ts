import path from "node:path"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { SessionPrompt } from "../../src/session/prompt"
import { Session } from "../../src/session/session"
import { Question } from "../../src/question"
import { Permission } from "../../src/permission"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { TestLLMServer } from "../lib/llm-server"

const server = LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] })
const services = LayerNode.group([
  SessionPrompt.node,
  Session.node,
  SessionProjector.node,
  Question.node,
  EventV2Bridge.node,
  server,
])
export const specLayer = LayerNode.compile(services)
// 读图测试额外消费真实权限与文件锁服务，普通命令夹具保持原服务集合。
export const specImageLayer = LayerNode.compile(LayerNode.group([services, Permission.node, EffectFlock.node]))

export const specOptions = {
  git: true,
  init: (directory: string) =>
    Effect.gen(function* () {
      const llm = yield* TestLLMServer
      yield* Effect.promise(() =>
        Bun.write(
          path.join(directory, "opencode.json"),
          JSON.stringify({
            model: "test/test-model",
            enabled_providers: ["test"],
            provider: {
              test: {
                name: "本地脚本化协议夹具",
                npm: "@ai-sdk/openai-compatible",
                env: [],
                options: { baseURL: llm.url, apiKey: "test-placeholder" },
                models: {
                  "test-model": { name: "本地测试", tool_call: true, limit: { context: 100000, output: 10000 } },
                },
              },
            },
            permission: { "*": "allow" },
          }),
        ),
      )
    }),
}
