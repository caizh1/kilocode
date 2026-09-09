import { describe, expect, test } from "bun:test"
import type { DeepSeekHarnessModel, DeepSeekHarnessWebviewMessage } from "../../src/shared/deepseek-harness"
import type { DeepSeekHarnessConfig } from "../../src/services/deepseek-harness/runtime"

const { ChipMateProvider } = await import("../../src/ChipMateProvider")

type Resolved = {
  workspace: string
  config: DeepSeekHarnessConfig
  models: DeepSeekHarnessModel[]
  selected: DeepSeekHarnessModel
}

type Internals = {
  deepSeekHarness: {
    activate: (...args: unknown[]) => Promise<void>
    requestSelection: (...args: unknown[]) => Promise<void>
    setActive: (active: boolean) => void
    beginProviderResolution: (taskId?: string) => void
    lastSuccessfulSelection: () => undefined
    setProviderOptions: (...args: unknown[]) => void
    requireProviderSelection: (...args: unknown[]) => void
    rejectProviderSelection: (...args: unknown[]) => void
    currentTaskId: () => string
  }
  fetchAndSendProviders: (coordinate?: boolean) => Promise<void>
  inspectDeepSeekHarnessProviders: () => Promise<Inspected>
  resolveInspectedDeepSeekHarnessConfig: (...args: unknown[]) => Resolved
  handleDeepSeekHarnessMessage: (message: DeepSeekHarnessWebviewMessage) => Promise<void>
}

type Inspected = {
  workspace: string
  options: Array<{
    providerID: string
    providerName: string
    available: boolean
    models: DeepSeekHarnessModel[]
  }>
  resolved: Map<string, { credential: { baseURL: string; apiKey: string }; models: DeepSeekHarnessModel[] }>
}

describe("ChipMate DeepSeek Harness Agent 模式竞态", () => {
  test("离开期间完成的冷启动不会把前台切回 Harness", async () => {
    const provider = new ChipMateProvider({} as never, {} as never)
    const internal = provider as unknown as Internals
    const active: boolean[] = []
    let release!: () => void
    const coldStart = new Promise<void>((resolve) => (release = resolve))
    let started = false
    internal.deepSeekHarness = {
      activate: async () => {
        started = true
        await coldStart
      },
      requestSelection: async () => undefined,
      setActive: (value) => active.push(value),
      beginProviderResolution: () => undefined,
      lastSuccessfulSelection: () => undefined,
      setProviderOptions: () => undefined,
      requireProviderSelection: () => undefined,
      rejectProviderSelection: () => undefined,
      currentTaskId: () => "task-1",
    }
    internal.fetchAndSendProviders = async (coordinate = true) => {
      expect(coordinate).toBe(false)
    }
    internal.inspectDeepSeekHarnessProviders = async () => inspected()
    internal.resolveInspectedDeepSeekHarnessConfig = () => resolved()

    const activating = internal.handleDeepSeekHarnessMessage({
      type: "chipmateDeepSeekHarness.activate",
      taskId: "task-1",
      providerID: "newapi",
      modelID: "deepseek-v4-flash",
    })
    await eventually(() => started)
    await internal.handleDeepSeekHarnessMessage({ type: "chipmateDeepSeekHarness.deactivate" })
    release()
    await activating

    expect(active).toEqual([true, false])
  })

  test("迟到的 Provider 凭据结果在新模式代次中失效", async () => {
    const provider = new ChipMateProvider({} as never, {} as never)
    const internal = provider as unknown as Internals
    const active: boolean[] = []
    let release!: (value: Inspected) => void
    const credentials = new Promise<Inspected>((resolve) => (release = resolve))
    let resolving = false
    let activations = 0
    internal.deepSeekHarness = {
      activate: async () => {
        activations += 1
      },
      requestSelection: async () => undefined,
      setActive: (value) => active.push(value),
      beginProviderResolution: () => undefined,
      lastSuccessfulSelection: () => undefined,
      setProviderOptions: () => undefined,
      requireProviderSelection: () => undefined,
      rejectProviderSelection: () => undefined,
      currentTaskId: () => "task-1",
    }
    internal.fetchAndSendProviders = async () => undefined
    internal.inspectDeepSeekHarnessProviders = async () => {
      resolving = true
      return credentials
    }
    internal.resolveInspectedDeepSeekHarnessConfig = () => resolved()

    const activating = internal.handleDeepSeekHarnessMessage({
      type: "chipmateDeepSeekHarness.activate",
      taskId: "task-1",
      providerID: "newapi",
      modelID: "deepseek-v4-flash",
    })
    await eventually(() => resolving)
    await internal.handleDeepSeekHarnessMessage({ type: "chipmateDeepSeekHarness.deactivate" })
    release(inspected())
    await activating

    expect(activations).toBe(0)
    expect(active).toEqual([true, false])
  })

  test("快速连续选择时迟到的 Provider 预检不能覆盖最新选择", async () => {
    const provider = new ChipMateProvider({} as never, {} as never)
    const internal = provider as unknown as Internals
    let release!: (value: Inspected) => void
    const firstInspection = new Promise<Inspected>((resolve) => (release = resolve))
    let inspections = 0
    const selections: string[] = []
    internal.deepSeekHarness = {
      activate: async () => undefined,
      requestSelection: async (...args) => {
        selections.push((args[4] as DeepSeekHarnessModel).modelID)
      },
      setActive: () => undefined,
      beginProviderResolution: () => undefined,
      lastSuccessfulSelection: () => undefined,
      setProviderOptions: () => undefined,
      requireProviderSelection: () => undefined,
      rejectProviderSelection: () => undefined,
      currentTaskId: () => "task-1",
    }
    internal.fetchAndSendProviders = async () => undefined
    internal.inspectDeepSeekHarnessProviders = async () => {
      inspections += 1
      return inspections === 1 ? firstInspection : inspected()
    }
    internal.resolveInspectedDeepSeekHarnessConfig = () => resolved()

    const earlier = internal.handleDeepSeekHarnessMessage({
      type: "chipmateDeepSeekHarness.selectionRequested",
      providerID: "newapi",
      modelID: "deepseek-v4-flash",
    })
    await eventually(() => inspections === 1)
    await internal.handleDeepSeekHarnessMessage({
      type: "chipmateDeepSeekHarness.selectionRequested",
      providerID: "newapi",
      modelID: "deepseek-v4-flash",
    })
    release(inspected())
    await earlier

    expect(selections).toEqual(["deepseek-v4-flash"])
  })
})

function resolved(): Resolved {
  const selected = { providerID: "newapi", modelID: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }
  return {
    workspace: "/repo",
    config: {
      baseURL: "https://example.test/v1",
      apiKey: "secret",
      models: [{ id: selected.modelID, name: selected.name }],
    },
    models: [selected],
    selected,
  }
}

function inspected(): Inspected {
  const value = resolved()
  return {
    workspace: value.workspace,
    options: [
      {
        providerID: value.selected.providerID,
        providerName: "NewAPI",
        available: true,
        models: value.models,
      },
    ],
    resolved: new Map([
      [
        value.selected.providerID,
        {
          credential: { baseURL: value.config.baseURL, apiKey: value.config.apiKey },
          models: value.models,
        },
      ],
    ]),
  }
}

async function eventually(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  throw new Error("等待测试状态超时")
}
