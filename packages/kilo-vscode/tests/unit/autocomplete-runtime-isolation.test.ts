import { afterEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { Coordinator } from "../../src/services/autocomplete"

type Target = { providerID: string; modelID: string }

const qwen = { providerID: "qwen", modelID: "qwen-coder-30b0" }
const builtin = { providerID: "kilo", modelID: "inception/mercury-next-edit" }
const original = vscode.workspace.getConfiguration
const execute = vscode.commands.executeCommand

afterEach(() => {
  ;(vscode.workspace as unknown as { getConfiguration: typeof original }).getConfiguration = original
  ;(vscode.commands as unknown as { executeCommand: typeof execute }).executeCommand = execute
})

describe("autocomplete coordinator", () => {
  it("keeps every autocomplete runtime stopped while official Kilo owns completion", async () => {
    config(builtin)
    const ctx = context()
    const runtime = manager()
    let enabled = false
    let calls = 0
    const coordinator = new Coordinator(ctx.value, {} as never, {
      gate: { autocomplete: () => enabled },
      qwen: async () => {
        calls++
        return undefined
      },
      manager: () => runtime.value,
    })

    coordinator.schedule()
    await coordinator.flush()
    expect(calls).toBe(0)
    expect(runtime.created()).toBe(0)

    enabled = true
    coordinator.schedule()
    await coordinator.flush()
    expect(runtime.created()).toBe(1)

    enabled = false
    coordinator.schedule()
    await coordinator.flush()
    expect(runtime.disposed()).toBe(1)
  })

  it("discards an in-flight provider lookup when official Kilo is installed", async () => {
    const cfg = config()
    const ctx = context()
    const runtime = manager()
    let enabled = true
    let start: (() => void) | undefined
    let release: (() => void) | undefined
    let fallback = 0
    const started = new Promise<void>((resolve) => {
      start = resolve
    })
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const coordinator = new Coordinator(ctx.value, {} as never, {
      gate: { autocomplete: () => enabled },
      qwen: async () => {
        start?.()
        await pending
        return qwen
      },
      manager: () => runtime.value,
      gateway: async () => {
        fallback++
        return true
      },
    })

    coordinator.schedule()
    await started
    enabled = false
    coordinator.gateChanged(false)
    release?.()
    await coordinator.flush()

    expect(cfg.updates).toEqual([])
    expect(runtime.created()).toBe(0)
    expect(fallback).toBe(0)
  })

  it("clears suggestion contexts and synchronously disposes the provider on handoff", async () => {
    config(builtin)
    const ctx = context()
    const runtime = manager()
    const calls: unknown[][] = []
    ;(vscode.commands as unknown as { executeCommand: (...args: unknown[]) => Promise<void> }).executeCommand = async (
      ...args
    ) => {
      calls.push(args)
    }
    const coordinator = new Coordinator(ctx.value, {} as never, {
      gate: { autocomplete: () => true },
      manager: () => runtime.value,
    })

    coordinator.schedule()
    await coordinator.flush()
    coordinator.gateChanged(false)
    expect(runtime.disposed()).toBe(1)
    await Promise.resolve()

    expect(calls).toEqual([
      ["setContext", "chipmate.v2.autocomplete.hasSuggestions", false],
      ["setContext", "chipmate.v2.autocomplete.enableSmartInlineTaskKeybinding", false],
      ["setContext", "chipmate.v2.nextEdit.hasPendingSuggestion", false],
    ])
  })

  it("selects Qwen from a clean config and publishes both settings in the same activation", async () => {
    const cfg = config()
    const ctx = context()
    let coordinator: Coordinator
    let calls = 0
    coordinator = new Coordinator(ctx.value, {} as never, {
      qwen: async () => {
        calls++
        return qwen
      },
      manager: () => manager().value,
    })
    cfg.onUpdate = () => coordinator.change()

    coordinator.schedule()
    await coordinator.flush()

    expect(cfg.values).toEqual({ model: qwen.modelID, provider: qwen.providerID })
    expect(cfg.updates).toEqual([
      ["provider", qwen.providerID],
      ["model", qwen.modelID],
    ])
    expect(calls).toBe(2)
  })

  it("keeps a persisted explicit Qwen target when the provider is temporarily disconnected", async () => {
    const cfg = config(qwen)
    const ctx = context([["chipmate.v2.autocomplete.qwenDefault", false]])
    const logs: string[] = []
    const coordinator = new Coordinator(ctx.value, {} as never, {
      qwen: async () => undefined,
      log: (message) => logs.push(message),
      manager: () => manager().value,
    })

    coordinator.schedule()
    await coordinator.flush()

    expect(cfg.values).toEqual({ model: qwen.modelID, provider: qwen.providerID })
    expect(cfg.updates).toEqual([])
    expect(logs).toContain("[Autocomplete] Selected Qwen Provider is temporarily unavailable")
  })

  it("migrates the incorrect 0.0.48 and 0.0.49 Qwen model without changing the provider", async () => {
    const cfg = config({ providerID: "qwen", modelID: "qwen3-coder-30b0" })
    const ctx = context([["chipmate.v2.autocomplete.qwenDefault", true]])
    let calls = 0
    let coordinator: Coordinator
    coordinator = new Coordinator(ctx.value, {} as never, {
      qwen: async (providerID) => {
        calls++
        expect(providerID).toBe("qwen")
        return qwen
      },
      manager: () => manager().value,
    })
    cfg.onUpdate = () => coordinator.change()

    coordinator.schedule()
    await coordinator.flush()

    expect(cfg.values).toEqual({ model: qwen.modelID, provider: qwen.providerID })
    expect(cfg.updates).toEqual([["model", qwen.modelID]])
    expect(calls).toBe(1)
  })

  it("switches between builtin and Qwen targets without keeping both runtimes active", async () => {
    const cfg = config(builtin)
    const ctx = context([["chipmate.v2.autocomplete.qwenDefault", false]])
    const first = manager()
    const second = manager()
    const pool = [first, second]
    const coordinator = new Coordinator(ctx.value, {} as never, {
      qwen: async () => qwen,
      manager: () => pool.shift()!.value,
    })

    coordinator.schedule()
    await coordinator.flush()
    expect(first.created()).toBe(1)

    Object.assign(cfg.values, { model: qwen.modelID, provider: qwen.providerID })
    coordinator.change()
    await coordinator.flush()
    expect(first.disposed()).toBe(1)

    Object.assign(cfg.values, { model: builtin.modelID, provider: builtin.providerID })
    coordinator.change()
    await coordinator.flush()
    expect(second.created()).toBe(1)
    expect(ctx.data.get("chipmate.v2.autocomplete.qwenDefault")).toBe(false)
  })

  it("waits through provider and model intermediate states without starting a fallback runtime", async () => {
    const cfg = config({ providerID: "qwen", modelID: undefined })
    const ctx = context()
    const fallback = manager()
    let calls = 0
    const coordinator = new Coordinator(ctx.value, {} as never, {
      qwen: async () => {
        calls++
        return qwen
      },
      manager: () => fallback.value,
    })

    coordinator.schedule()
    await coordinator.flush()
    expect(calls).toBe(0)
    expect(fallback.created()).toBe(0)

    cfg.values.model = qwen.modelID
    coordinator.change()
    await coordinator.flush()
    expect(calls).toBe(1)
    expect(fallback.created()).toBe(0)
  })

  it("serializes bursty config and connection events to one active provider lookup", async () => {
    config()
    const ctx = context()
    let active = 0
    let max = 0
    let calls = 0
    let enter: (() => void) | undefined
    let release: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      enter = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const coordinator = new Coordinator(ctx.value, {} as never, {
      qwen: async () => {
        calls++
        active++
        max = Math.max(max, active)
        enter?.()
        if (calls === 1) await gate
        active--
        return undefined
      },
      manager: () => manager().value,
      gateway: async () => false,
      notify: () => {},
    })

    coordinator.schedule()
    await started
    for (const _ of Array.from({ length: 25 })) coordinator.schedule()
    expect(active).toBe(1)

    release?.()
    await coordinator.flush()
    expect(max).toBe(1)
    expect(calls).toBe(2)
  })

  it("selects only a connected exact-model openai-compatible provider", async () => {
    const cfg = config()
    const ctx = context()
    let directory: string | undefined
    const connection = {
      getClientAsync: async () => ({
        provider: {
          list: async (input: { directory?: string }) => {
            directory = input.directory
            return {
              data: {
                all: [
                  provider("disconnected", "qwen-coder-30b0", "@ai-sdk/openai-compatible"),
                  provider("wrong-model", "qwen3-coder-30b0", "@ai-sdk/openai-compatible"),
                  provider("wrong-type", "qwen-coder-30b0", "@ai-sdk/openai"),
                  provider("ready", "qwen-coder-30b0", "@ai-sdk/openai-compatible"),
                ],
                connected: ["wrong-model", "wrong-type", "ready"],
              },
            }
          },
        },
      }),
    }
    const coordinator = new Coordinator(ctx.value, connection as never, {
      directory: () => "/repo",
      manager: () => manager().value,
    })

    coordinator.schedule()
    await coordinator.flush()

    expect(cfg.values).toEqual({ model: qwen.modelID, provider: "ready" })
    expect(directory).toBe("/repo")
  })

  it("starts the built-in model only when a public build has usable gateway authentication", async () => {
    const cfg = config()
    const ctx = context()
    const fallback = manager()
    const coordinator = new Coordinator(ctx.value, {} as never, {
      qwen: async () => undefined,
      gateway: async () => true,
      internal: false,
      manager: () => fallback.value,
    })

    coordinator.schedule()
    await coordinator.flush()

    expect(cfg.values).toEqual({ provider: builtin.providerID, model: builtin.modelID })
    expect(fallback.created()).toBe(1)
    expect(ctx.data.get("chipmate.v2.autocomplete.lastBuiltinTarget")).toEqual(builtin)
  })

  it("does not start the built-in model in an internal offline build without Qwen", async () => {
    const cfg = config()
    const ctx = context()
    const fallback = manager()
    const notices: string[] = []
    const coordinator = new Coordinator(ctx.value, {} as never, {
      qwen: async () => undefined,
      gateway: async () => true,
      internal: true,
      manager: () => fallback.value,
      notify: (message) => notices.push(message),
    })

    coordinator.schedule()
    await coordinator.flush()

    expect(cfg.values).toEqual({})
    expect(fallback.created()).toBe(0)
    expect(notices).toEqual(["No compatible Qwen Provider is currently available for autocomplete"])
  })

  it("logs a temporary provider query failure and leaves a clean target untouched", async () => {
    const cfg = config()
    const ctx = context()
    const logs: string[] = []
    const coordinator = new Coordinator(ctx.value, {} as never, {
      qwen: async () => {
        throw new Error("CLI unavailable")
      },
      log: (message) => logs.push(message),
      manager: () => manager().value,
    })

    coordinator.schedule()
    await coordinator.flush()

    expect(cfg.values).toEqual({})
    expect(cfg.updates).toEqual([])
    expect(logs).toContain("[Autocomplete] unable to resolve Qwen autocomplete target")
  })

  it("runs one pending retry when a failed lookup emits connection state changes", async () => {
    config()
    const ctx = context()
    let calls = 0
    let coordinator: Coordinator
    coordinator = new Coordinator(ctx.value, {} as never, {
      qwen: async () => {
        calls++
        coordinator.state()
        coordinator.state()
        throw new Error("CLI unavailable")
      },
      manager: () => manager().value,
    })

    coordinator.schedule()
    await coordinator.flush()

    expect(calls).toBe(2)
  })
})

function config(target: { providerID?: string; modelID?: string } = {}) {
  const values: { provider?: string; model?: string } = {}
  if (target.providerID) values.provider = target.providerID
  if (target.modelID) values.model = target.modelID
  const updates: Array<[string, unknown]> = []
  const cfg = {
    onUpdate: undefined as (() => void) | undefined,
    updates,
    values,
  }
  ;(vscode.workspace as unknown as { getConfiguration: typeof original }).getConfiguration = () =>
    ({
      get: (name: "provider" | "model") => values[name],
      update: async (name: "provider" | "model", value: string | undefined) => {
        updates.push([name, value])
        if (value === undefined) delete values[name]
        else values[name] = value
        cfg.onUpdate?.()
      },
    }) as unknown as vscode.WorkspaceConfiguration
  return cfg
}

function context(initial: Array<[string, unknown]> = []) {
  const data = new Map(initial)
  return {
    data,
    value: {
      globalState: {
        get: (name: string, fallback?: unknown) => data.get(name) ?? fallback,
        update: async (name: string, value: unknown) => {
          data.set(name, value)
        },
      },
    } as unknown as vscode.ExtensionContext,
  }
}

function manager() {
  let created = 0
  let disposed = 0
  let loaded = 0
  return {
    created: () => created,
    disposed: () => disposed,
    loaded: () => loaded,
    get value() {
      created++
      return {
        dispose: () => disposed++,
        load: async () => {
          loaded++
        },
      }
    },
  }
}

function provider(id: string, model: string, npm: string) {
  return {
    id,
    models: {
      [model]: {
        api: { npm },
        id: model,
      },
    },
  }
}
