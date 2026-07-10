import { describe, it, expect } from "bun:test"
import { deepEqual, deepMerge, stripNulls, ConfigState } from "../../webview-ui/src/utils/config-utils"
import type { Config } from "../../webview-ui/src/types/messages"

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("deepMerge", () => {
  it("overrides scalar values", () => {
    const target: Config = { snapshot: true }
    const source: Partial<Config> = { snapshot: false }
    expect(deepMerge(target, source)).toEqual({ snapshot: false })
  })

  it("merges nested objects recursively", () => {
    const target: Config = { agent: { code: { temperature: 0.5 } } }
    const source: Partial<Config> = { agent: { code: { steps: 10 } } }
    const result = deepMerge(target, source)
    expect(result.agent?.code?.temperature).toBe(0.5)
    expect(result.agent?.code?.steps).toBe(10)
  })

  it("preserves keys not present in source", () => {
    const target: Config = { snapshot: true, username: "alice" }
    const source: Partial<Config> = { snapshot: false }
    expect(deepMerge(target, source)).toEqual({ snapshot: false, username: "alice" })
  })

  it("replaces arrays instead of merging them", () => {
    const target: Config = { instructions: ["a", "b"] }
    const source: Partial<Config> = { instructions: ["c"] }
    expect(deepMerge(target, source)).toEqual({ instructions: ["c"] })
  })

  it("preserves explicit false values in nested agent config", () => {
    const target: Config = { agent: { code: { disable: true, hidden: true } } }
    const source: Partial<Config> = { agent: { code: { disable: false, hidden: false } } }
    const result = deepMerge(target, source)
    expect(result.agent?.code?.disable).toBe(false)
    expect(result.agent?.code?.hidden).toBe(false)
  })
})

describe("stripNulls", () => {
  it("removes null values", () => {
    const cfg = { snapshot: true, username: null } as unknown as Config
    expect(stripNulls(cfg)).toEqual({ snapshot: true })
  })

  it("removes undefined values", () => {
    const cfg = { snapshot: true, username: undefined } as unknown as Config
    expect(stripNulls(cfg)).toEqual({ snapshot: true })
  })

  it("strips nulls recursively in nested objects", () => {
    const cfg = { agent: { code: { temperature: 0.5, prompt: null } } } as unknown as Config
    expect(stripNulls(cfg)).toEqual({ agent: { code: { temperature: 0.5 } } })
  })
})

describe("deepEqual", () => {
  it("matches nested plain objects and arrays", () => {
    expect(deepEqual({ indexing: { model: "qwen", tags: ["a"] } }, { indexing: { model: "qwen", tags: ["a"] } })).toBe(
      true,
    )
  })

  it("detects nested differences", () => {
    expect(deepEqual({ indexing: { dimension: 2048 } }, { indexing: { dimension: 4096 } })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Config state machine — reproduces the actual message-handler flow
// ---------------------------------------------------------------------------

describe("ConfigState", () => {
  it("configLoaded sets config when no draft is pending", () => {
    const s = new ConfigState()
    s.handleConfigLoaded({ snapshot: true, username: "alice" })
    expect(s.config).toEqual({ snapshot: true, username: "alice" })
    expect(s.loading).toBe(false)
  })

  describe("configLoaded while draft is pending (the reported bug)", () => {
    it("preserves the user's pending toggle change", () => {
      const s = new ConfigState()

      // 1. Server sends initial config
      s.handleConfigLoaded({ snapshot: true, username: "alice" })
      expect(s.config.snapshot).toBe(true)

      // 2. User toggles snapshot off (but hasn't saved yet)
      s.updateConfig({ snapshot: false })
      expect(s.config.snapshot).toBe(false)
      expect(s.dirty).toBe(true)

      // 3. A configLoaded push arrives from the extension (e.g. SSE event,
      //    tab switch, or another webview triggers a config reload).
      //    The server still has snapshot: true.
      s.handleConfigLoaded({ snapshot: true, username: "alice" })

      // BUG (old code): config.snapshot would be reset to true here
      // FIX: the draft is re-applied, so the user's toggle stays false
      expect(s.config.snapshot).toBe(false)
      expect(s.config.username).toBe("alice")
      expect(s.dirty).toBe(true)
    })

    it("preserves nested draft changes across configLoaded pushes", () => {
      const s = new ConfigState()
      s.handleConfigLoaded({ agent: { code: { temperature: 0.7 } } })
      s.updateConfig({ agent: { code: { steps: 5 } } })

      // Server pushes a reload — temperature may have changed server-side
      s.handleConfigLoaded({ agent: { code: { temperature: 0.9 } } })

      expect(s.config.agent?.code?.steps).toBe(5)
      expect(s.config.agent?.code?.temperature).toBe(0.9)
    })

    it("preserves explicit false agent flags across configLoaded pushes", () => {
      const s = new ConfigState()
      s.handleConfigLoaded({ agent: { code: { disable: true, hidden: true } } })
      s.updateConfig({ agent: { code: { disable: false, hidden: false } } })

      s.handleConfigLoaded({ agent: { code: { disable: true, hidden: true } } })

      expect(s.config.agent?.code?.disable).toBe(false)
      expect(s.config.agent?.code?.hidden).toBe(false)
    })

    it("preserves clearing default_agent when the current default is hidden", () => {
      const s = new ConfigState()
      s.handleConfigLoaded({ default_agent: "code", agent: { code: { hidden: false } } })

      s.updateConfig({ agent: { code: { hidden: true } } })
      s.updateConfig({ default_agent: null })

      s.handleConfigLoaded({ default_agent: "code", agent: { code: { hidden: false } } })

      expect(s.config.agent?.code?.hidden).toBe(true)
      expect(s.config.default_agent).toBeUndefined()
    })

    it("preserves clearing default_agent when the current default is disabled", () => {
      const s = new ConfigState()
      s.handleConfigLoaded({ default_agent: "code", agent: { code: { disable: false } } })

      s.updateConfig({ agent: { code: { disable: true } } })
      s.updateConfig({ default_agent: null })

      s.handleConfigLoaded({ default_agent: "code", agent: { code: { disable: false } } })

      expect(s.config.agent?.code?.disable).toBe(true)
      expect(s.config.default_agent).toBeUndefined()
    })
  })

  describe("configUpdated while draft is pending", () => {
    it("preserves draft when update comes from another source", () => {
      const s = new ConfigState()
      s.handleConfigLoaded({ snapshot: true, username: "alice" })
      s.updateConfig({ snapshot: false })

      // Another webview (e.g. PermissionDock) saves a different setting
      s.handleConfigUpdated({ snapshot: true, username: "bob" })

      expect(s.config.snapshot).toBe(false) // draft preserved
      expect(s.config.username).toBe("bob") // server update applied
    })

    it("clears draft when update confirms our save", () => {
      const s = new ConfigState()
      s.handleConfigLoaded({ snapshot: true })
      s.updateConfig({ snapshot: false })
      s.saveConfig("save")
      expect(s.saving).toBe(true)

      // Server confirms the write
      s.handleConfigUpdated({ snapshot: false }, "save")

      expect(s.config.snapshot).toBe(false)
      expect(s.dirty).toBe(false)
      expect(s.saving).toBe(false)
      expect(Object.keys(s.draft).length).toBe(0)
    })

    it("clears default_agent when update confirms a null-sentinel save", () => {
      const s = new ConfigState()
      s.handleConfigLoaded({ default_agent: "code" })
      s.updateConfig({ default_agent: null })
      s.saveConfig("save")

      // Server confirms the write by returning config without default_agent.
      s.handleConfigUpdated({}, "save")

      expect(s.config.default_agent).toBeUndefined()
      expect(s.dirty).toBe(false)
      expect(s.saving).toBe(false)
      expect(Object.keys(s.draft).length).toBe(0)
    })

    it("preserves the null delete sentinel in the pending save payload", () => {
      const s = new ConfigState()
      s.handleConfigLoaded({ default_agent: "code" })
      s.updateConfig({ default_agent: null })

      expect(s.draft.default_agent).toBeNull()

      s.saveConfig()

      expect(s.saving).toBe(true)
      expect(s.draft.default_agent).toBeNull()
    })

    it("does not mark dirty when a normalized patch leaves config unchanged", () => {
      const s = new ConfigState()
      s.handleConfigLoaded({ indexing: { provider: "openai-compatible" } })

      s.updateConfig({ indexing: { provider: "openai-compatible", model: null } })

      expect(s.config).toEqual({ indexing: { provider: "openai-compatible" } })
      expect(s.dirty).toBe(false)
      expect(s.draft).toEqual({})
    })

    it("preserves pending indexing model when a stale configLoaded arrives", () => {
      const s = new ConfigState()
      s.handleConfigLoaded({ indexing: { provider: "openai-compatible" } })
      s.updateConfig({ indexing: { provider: "openai-compatible", model: "custom-embedding" } })

      s.handleConfigLoaded({ indexing: { provider: "openai-compatible" } })

      expect(s.config).toEqual({ indexing: { provider: "openai-compatible", model: "custom-embedding" } })
      expect(s.dirty).toBe(true)
    })

    it("preserves confirmed indexing model when save refresh omits it", () => {
      const s = new ConfigState()
      s.handleConfigLoaded({ indexing: { provider: "openai-compatible" } })
      s.updateConfig({ indexing: { provider: "openai-compatible", model: "custom-embedding" } })
      s.saveConfig("save")

      s.handleConfigUpdated({ indexing: { provider: "openai-compatible" } }, "save")

      expect(s.config).toEqual({ indexing: { provider: "openai-compatible", model: "custom-embedding" } })
      expect(s.saved).toEqual({ indexing: { provider: "openai-compatible", model: "custom-embedding" } })
      expect(s.dirty).toBe(false)
    })

    it("does not clear draft for configUpdated without the active save request", () => {
      const s = new ConfigState()
      s.handleConfigLoaded({ snapshot: true, username: "alice" })
      s.updateConfig({ snapshot: false })
      s.saveConfig("save")

      // SSE-derived configUpdated can arrive while the explicit save is still
      // writing project/global config. It must not become the save ack.
      s.handleConfigUpdated({ snapshot: true, username: "bob" })

      expect(s.saving).toBe(true)
      expect(s.dirty).toBe(true)
      expect(s.config.snapshot).toBe(false)
      expect(s.request).toBe("save")

      s.handleConfigUpdated({ snapshot: false, username: "bob" }, "save")

      expect(s.saving).toBe(false)
      expect(s.dirty).toBe(false)
      expect(s.config.snapshot).toBe(false)
      expect(s.config.username).toBe("bob")
    })
  })

  describe("configSaved while a save is in-flight", () => {
    it("clears the draft after a confirmed write even if merged refresh is pending", () => {
      const s = new ConfigState()
      s.handleConfigLoaded({ agent: { code: { prompt: "Review" } } })
      s.updateConfig({ agent: { code: { prompt: null } } })
      s.saveConfig()

      s.handleConfigSaved()

      expect(s.saving).toBe(false)
      expect(s.dirty).toBe(false)
      expect(Object.keys(s.draft).length).toBe(0)
      expect(s.saved.agent?.code?.prompt).toBeUndefined()
      expect(s.config.agent?.code?.prompt).toBeUndefined()
    })
  })

  describe("configSaveFailed while a save is in-flight", () => {
    it("preserves pending null-sentinel clears so the user can retry", () => {
      const s = new ConfigState()
      s.handleConfigLoaded({ agent: { code: { prompt: "Review", temperature: 0.7 } }, default_agent: "code" })
      s.updateConfig({ agent: { code: { prompt: null, temperature: null } } })
      s.updateConfig({ default_agent: null })
      s.saveConfig("save")

      s.handleConfigSaveFailed(
        { agent: { code: { prompt: "Review", temperature: 0.7 } }, default_agent: "code" },
        "save",
      )

      expect(s.saving).toBe(false)
      expect(s.dirty).toBe(true)
      expect(s.draft.agent?.code?.prompt).toBeNull()
      expect(s.draft.agent?.code?.temperature).toBeNull()
      expect(s.draft.default_agent).toBeNull()
      expect(s.config.agent?.code?.prompt).toBeUndefined()
      expect(s.config.agent?.code?.temperature).toBeUndefined()
      expect(s.config.default_agent).toBeUndefined()
    })

    it("ignores save failures from a different request", () => {
      const s = new ConfigState()
      s.handleConfigLoaded({ snapshot: true })
      s.updateConfig({ snapshot: false })
      s.saveConfig("save")

      s.handleConfigSaveFailed({ snapshot: true }, "other")

      expect(s.saving).toBe(true)
      expect(s.dirty).toBe(true)
      expect(s.config.snapshot).toBe(false)
    })
  })

  it("ignores repeated save attempts while a save is already in-flight", () => {
    const s = new ConfigState()
    s.handleConfigLoaded({ snapshot: true })
    s.updateConfig({ snapshot: false })

    s.saveConfig("save")
    s.saveConfig("other")
    s.handleConfigUpdated({ snapshot: false }, "save")

    expect(s.saving).toBe(false)
    expect(s.dirty).toBe(false)
    expect(s.config.snapshot).toBe(false)
  })

  it("configLoaded is ignored while save is in-flight", () => {
    const s = new ConfigState()
    s.handleConfigLoaded({ snapshot: true })
    s.updateConfig({ snapshot: false })
    s.saveConfig("save")

    // A stale configLoaded arrives during the write round-trip
    s.handleConfigLoaded({ snapshot: true })

    // Config must not revert — the save is still in flight
    expect(s.config.snapshot).toBe(false)
  })

  it("discardConfig restores server state", () => {
    const s = new ConfigState()
    s.handleConfigLoaded({ snapshot: true, username: "alice" })
    s.updateConfig({ snapshot: false })
    expect(s.dirty).toBe(true)

    s.discardConfig()

    expect(s.config.snapshot).toBe(true)
    expect(s.dirty).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Issue #9527: clearing an agent model override must unset it, not repopulate
  // -------------------------------------------------------------------------
  describe("clearing an agent model override (issue #9527)", () => {
    it("keeps null in the draft so the backend receives a delete sentinel", () => {
      const s = new ConfigState()
      s.handleConfigLoaded({ agent: { explore: { model: "anthropic/claude-sonnet-4-20250514" } } })

      // User clears the Model Override field. ModeEditView now sends `null`
      // instead of `undefined` (the fix). null is the delete sentinel that
      // patchJsonc maps to jsonc-parser's remove operation.
      s.updateConfig({ agent: { explore: { model: null } } })

      // Optimistic UI: stripNulls removes the key so the field renders empty.
      expect(s.config.agent?.explore?.model).toBeUndefined()
      expect(s.dirty).toBe(true)

      // Draft must retain the null so it survives JSON.stringify on the wire
      // and reaches patchJsonc as an explicit delete.
      expect(s.draft.agent?.explore?.model).toBeNull()
      expect(JSON.parse(JSON.stringify(s.draft))).toEqual({
        agent: { explore: { model: null } },
      })
    })

    it("undefined (the old buggy behavior) is dropped by JSON.stringify", () => {
      // Reproduction of the pre-fix bug: sending `undefined` results in an
      // empty patch on the wire, so the backend never deletes the override
      // and the next configUpdated pushes the stale model back into the UI.
      const draft = { agent: { explore: { model: undefined } } }
      expect(JSON.parse(JSON.stringify(draft))).toEqual({ agent: { explore: {} } })
    })

    it("confirms the save and drops the draft once the backend acks", () => {
      const s = new ConfigState()
      s.handleConfigLoaded({ agent: { explore: { model: "anthropic/claude-sonnet-4-20250514" } } })
      s.updateConfig({ agent: { explore: { model: null } } })
      s.saveConfig("save")

      // Backend removed the override and pushes the stripped config back.
      s.handleConfigUpdated({ agent: { explore: {} } }, "save")

      expect(s.config.agent?.explore?.model).toBeUndefined()
      expect(s.dirty).toBe(false)
      expect(s.saving).toBe(false)
      expect(Object.keys(s.draft).length).toBe(0)
    })
  })

  describe("clearing an agent variant override", () => {
    it("keeps null in the draft so the backend receives a delete sentinel", () => {
      const s = new ConfigState()
      s.handleConfigLoaded({
        agent: {
          explore: {
            model: "kilo/anthropic/claude-sonnet-4-6",
            variant: "high",
          },
        },
      })

      s.updateConfig({ agent: { explore: { variant: null } } })

      expect(s.config.agent?.explore?.variant).toBeUndefined()
      expect(s.dirty).toBe(true)
      expect(s.draft.agent?.explore?.variant).toBeNull()
      expect(JSON.parse(JSON.stringify(s.draft))).toEqual({
        agent: { explore: { variant: null } },
      })
    })
  })

  describe("agent permission patches", () => {
    it("merges nested per-agent permission patches into existing rules", () => {
      const s = new ConfigState()
      s.handleConfigLoaded({
        agent: {
          reviewer: {
            permission: {
              read: "allow",
              edit: "deny",
            },
          },
        },
      })

      s.updateConfig({ agent: { reviewer: { permission: { bash: "ask" } } } })

      expect(s.config.agent?.reviewer?.permission).toEqual({
        read: "allow",
        edit: "deny",
        bash: "ask",
      })
      expect(s.draft.agent?.reviewer?.permission).toEqual({ bash: "ask" })
    })

    it("keeps nested permission delete sentinels in the draft", () => {
      const s = new ConfigState()
      s.handleConfigLoaded({
        agent: {
          docs: {
            permission: {
              edit: { "*": "deny", "**/*.md": "allow" },
            },
          },
        },
      })

      s.updateConfig({ agent: { docs: { permission: { edit: { "**/*.md": null } } } } })

      expect(s.config.agent?.docs?.permission).toEqual({ edit: { "*": "deny" } })
      expect(s.draft.agent?.docs?.permission).toEqual({ edit: { "**/*.md": null } })
      expect(JSON.parse(JSON.stringify(s.draft))).toEqual({
        agent: { docs: { permission: { edit: { "**/*.md": null } } } },
      })
    })

    it("keeps tool-level permission delete sentinels in the draft", () => {
      const s = new ConfigState()
      s.handleConfigLoaded({
        agent: {
          reviewer: {
            permission: {
              read: "allow",
              bash: "deny",
            },
          },
        },
      })

      s.updateConfig({ agent: { reviewer: { permission: { bash: null } } } })

      expect(s.config.agent?.reviewer?.permission).toEqual({ read: "allow" })
      expect(s.draft.agent?.reviewer?.permission).toEqual({ bash: null })
      expect(JSON.parse(JSON.stringify(s.draft))).toEqual({
        agent: { reviewer: { permission: { bash: null } } },
      })
    })
  })
})
