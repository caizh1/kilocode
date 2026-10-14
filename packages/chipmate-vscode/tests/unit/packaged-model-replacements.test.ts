import { afterEach, expect, test } from "bun:test"
import {
  parseModelReplacements,
  replaceConfigModels,
  replaceModelReference,
  replaceVariantKeys,
} from "@opencode-ai/core/chipmate/model-replacements"
import {
  computeDefaultSelection,
  validateFavorites,
  validateModelSelections,
  validateRecents,
} from "../../src/provider-actions"
import { resolveModelSelection } from "../../webview-ui/src/context/model-selection"
import { internalOfflineEnv } from "../../src/shared/internal-offline"
import { handleMessage } from "../../src/chipmate-provider/model-state"
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { ChipMateClient } from "@chipmate/sdk/v2/client"
import * as vscode from "vscode"
import { migratePackagedModelState } from "../../src/migration/packaged-model-state"

const policy = { providerID: "qa-internal", models: { "retired-chat": "current-chat" } }
const keys = ["__CHIPMATE_INTERNAL_OFFLINE__", "__CHIPMATE_INTERNAL_PROVIDER_MODEL_REPLACEMENTS__"]
const previous = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key))
function enabled() {
  Object.defineProperty(globalThis, keys[0]!, { configurable: true, value: true })
  Object.defineProperty(globalThis, keys[1]!, { configurable: true, value: JSON.stringify(policy) })
}
afterEach(() =>
  keys.forEach((key, index) => {
    if (previous[index]) Object.defineProperty(globalThis, key, previous[index]!)
    else Reflect.deleteProperty(globalThis, key)
  }),
)

test("替换配置拒绝自引用和链路，只对指定提供商的精确模型生效", () => {
  expect(parseModelReplacements(JSON.stringify(policy))).toEqual(policy)
  for (const models of [{ a: "a" }, { a: "b", b: "c" }, { a: "" }])
    expect(() => parseModelReplacements(JSON.stringify({ ...policy, models }))).toThrow()
  expect(replaceModelReference({ providerID: "其他提供商", modelID: "retired-chat" }, policy).modelID).toBe(
    "retired-chat",
  )
  expect(replaceModelReference({ providerID: policy.providerID, modelID: "retired-chat-extra" }, policy).modelID).toBe(
    "retired-chat-extra",
  )
})

test("全局、模式、最近使用、收藏与旧会话覆盖均恢复到新模型", () => {
  enabled()
  const old = { providerID: policy.providerID, modelID: "retired-chat" }
  const current = { ...old, modelID: "current-chat" }
  expect(computeDefaultSelection({ config: { model: `${old.providerID}/${old.modelID}` } }, "", "")).toEqual(current)
  expect(computeDefaultSelection(null, old.providerID, old.modelID)).toEqual(current)
  expect(validateRecents([old])).toEqual([current])
  expect(validateFavorites([old])).toEqual([current])
  expect(validateModelSelections({ code: old })).toEqual({ code: current })
  expect(resolveModelSelection({ providers: {}, connected: [], override: old })).toEqual(current)
  expect(JSON.parse(internalOfflineEnv(true).CHIPMATE_INTERNAL_PROVIDER_MODEL_REPLACEMENTS!)).toEqual(policy)
})

test("升级不改写可被其他提供商继承的 VS Code 全局模型设置", async () => {
  enabled()
  const configuration = vscode.workspace.getConfiguration
  const workspace = vscode.workspace as unknown as { getConfiguration: typeof configuration }
  let writes = 0
  workspace.getConfiguration = (() => ({
    inspect: (key: string) => key === "providerID"
      ? { globalValue: policy.providerID, workspaceValue: "another" }
      : { globalValue: "retired-chat" },
    update: async () => { writes++ },
  })) as typeof configuration
  try {
    const old = { providerID: policy.providerID, modelID: "retired-chat" }
    const data: Record<string, unknown> = { recentModels: [old], favoriteModels: [old] }
    await migratePackagedModelState({ globalState: { get: (key: string) => data[key], update: async (key: string, value: unknown) => { data[key] = value } } } as unknown as vscode.ExtensionContext)
    expect(data.recentModels).toEqual([{ ...old, modelID: "current-chat" }])
    expect(data.favoriteModels).toEqual([{ ...old, modelID: "current-chat" }])
    expect(writes).toBe(0)
    expect(computeDefaultSelection(null, "another", "retired-chat")).toEqual({ providerID: "another", modelID: "retired-chat" })
    expect(computeDefaultSelection(null, policy.providerID, "retired-chat")?.modelID).toBe("current-chat")
  } finally {
    workspace.getConfiguration = configuration
  }
})

test("模型配置保留新模型显式配置，清除旧项并转换 API 别名，历史与提示词不变", () => {
  const old = `${policy.providerID}/retired-chat`
  const current = `${policy.providerID}/current-chat`
  const config = {
    model: old,
    small_model: old,
    agent: { code: { model: old, prompt: old }, other: { model: "other/retired-chat" } },
    command: { inspect: { model: old } },
    instructions: [old],
    provider: {
      [policy.providerID]: {
        whitelist: ["retired-chat", "current-chat"],
        models: {
          "retired-chat": { name: "旧配置", reasoning: true },
          "current-chat": { name: "新配置", reasoning: false },
          alias: { id: "retired-chat", name: "用户别名" },
        },
      },
    },
  }
  const snapshot = JSON.stringify(config)
  const result = replaceConfigModels(config, policy)
  expect(result.model).toBe(current)
  expect(result.small_model).toBe(current)
  expect(result.agent.code).toEqual({ model: current, prompt: old })
  expect(result.command.inspect.model).toBe(current)
  expect(result.instructions).toEqual([old])
  expect(result.provider[policy.providerID]!.models).toEqual({
    "current-chat": { name: "新配置", reasoning: false },
    alias: { id: "current-chat", name: "用户别名" },
  })
  expect(result.provider[policy.providerID]!.whitelist).toEqual(["current-chat"])
  expect(replaceConfigModels(result, policy)).toEqual(result)
  expect(JSON.stringify(config)).toBe(snapshot)
})

test("变体键只替换合法作用域的精确引用并保留新模型的显式选择", () => {
  const source = {
    "qa-internal/retired-chat": "low",
    "agent/code/qa-internal/retired-chat": "high",
    "agent/code/qa-internal/current-chat": "low",
    "session/甲/qa-internal/retired-chat": "medium",
    "other/retired-chat": "none",
  }
  expect(replaceVariantKeys(source, policy)).toEqual({
    "qa-internal/current-chat": "low",
    "agent/code/qa-internal/current-chat": "low",
    "session/甲/qa-internal/current-chat": "medium",
    "other/retired-chat": "none",
  })
})

test("模式选择从真实旧文件恢复并在下一次保存使用新 ID，其他模式和历史字段不变", async () => {
  enabled()
  const root = await mkdtemp(join(tmpdir(), "chipmate-model-upgrade-"))
  try {
    const old = { providerID: policy.providerID, modelID: "retired-chat" }
    const other = { providerID: "another", modelID: "retired-chat" }
    const original = { model: { code: old, ask: other }, history: [old] }
    const file = join(root, "model.json")
    await writeFile(file, JSON.stringify(original))
    const client = { path: { get: async () => ({ data: { state: root } }) } } as unknown as ChipMateClient
    const messages: unknown[] = []
    await handleMessage("requestModelSelections", {}, client, (message) => messages.push(message))
    expect(messages).toEqual([
      { type: "modelSelectionsLoaded", selections: { code: { ...old, modelID: "current-chat" }, ask: other } },
    ])
    await handleMessage("persistModelSelection", { agent: "plan", ...old }, client, () => {})
    const saved = JSON.parse(await readFile(file, "utf8"))
    expect(saved.model.code.modelID).toBe("current-chat")
    expect(saved.model.plan.modelID).toBe("current-chat")
    expect(saved.model.ask).toEqual(other)
    expect(saved.history).toEqual(original.history)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
