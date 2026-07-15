import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import {
  migrateChipmateServer,
  promptChipmateServerReload,
  resolveChipmateServer,
  testChipmateServer,
} from "../../src/services/chipmate-server"
import { CHIPMATE_SERVER_DEFAULT, deriveChipmateServerEndpoints } from "../../src/shared/chipmate-server"
import { marketplaceApiOptions } from "../../src/services/marketplace"
import { mermaidEndpoint, renderEnv } from "../../src/services/cli-backend/server-manager"

type Scope = { globalValue?: unknown; workspaceValue?: unknown; defaultValue?: unknown }
type State = Map<string, Scope>

type Stub = {
  getConfiguration: (section?: string) => {
    get: (key: string, fallback?: unknown) => unknown
    inspect: (key: string) => Scope | undefined
    update: (key: string, value: unknown, target: unknown) => Promise<void>
  }
}

const original = vscode.workspace.getConfiguration

function id(section: string | undefined, key: string) {
  return `${section ?? ""}.${key}`
}

function set(state: State, section: string, key: string, scope: keyof Scope, value: unknown) {
  state.set(id(section, key), { ...state.get(id(section, key)), [scope]: value })
}

function stub(state: State) {
  ;(vscode.workspace as unknown as Stub).getConfiguration = (section?: string) => ({
    get: (key: string, fallback?: unknown) => {
      const item = state.get(id(section, key))
      return item?.workspaceValue ?? item?.globalValue ?? item?.defaultValue ?? fallback
    },
    inspect: (key: string) => state.get(id(section, key)) ?? {},
    update: async (key: string, value: unknown, target: unknown) => {
      if (target !== vscode.ConfigurationTarget.Global) throw new Error("expected global configuration target")
      set(state, section ?? "", key, "globalValue", value)
    },
  })
}

describe("ChipMate Server configuration", () => {
  const state: State = new Map()

  beforeEach(() => {
    state.clear()
    stub(state)
  })

  afterEach(() => {
    ;(vscode.workspace as unknown as Stub).getConfiguration = original as Stub["getConfiguration"]
  })

  it("uses the manifest default without writing it to the profile", () => {
    set(state, "kilo-code.new.chipmateServer", "baseUrl", "defaultValue", CHIPMATE_SERVER_DEFAULT)
    expect(resolveChipmateServer()).toEqual({ baseUrl: CHIPMATE_SERVER_DEFAULT, source: "default" })
    expect(state.get("kilo-code.new.chipmateServer.baseUrl")?.globalValue).toBeUndefined()
  })

  it("ignores a workspace override for the unified setting", () => {
    set(state, "kilo-code.new.chipmateServer", "baseUrl", "workspaceValue", "http://workspace.test:6001")
    expect(resolveChipmateServer()).toEqual({ baseUrl: CHIPMATE_SERVER_DEFAULT, source: "default" })
  })

  it("migrates one legacy endpoint and keeps the saved origin thereafter", async () => {
    set(state, "kilo.marketplace", "baseUrl", "globalValue", "http://legacy.test:6001/marketplace")
    expect(await migrateChipmateServer()).toMatchObject({ baseUrl: "http://legacy.test:6001", source: "migrated" })

    set(state, "kilo.marketplace", "baseUrl", "globalValue", "http://changed.test:6001/marketplace")
    expect(resolveChipmateServer()).toEqual({ baseUrl: "http://legacy.test:6001", source: "saved" })
  })

  it("migrates three legacy endpoints when they share one origin", async () => {
    set(state, "kilo.marketplace", "baseUrl", "globalValue", "http://legacy.test:6001/marketplace")
    set(state, "kilo.documents", "wordRender.remoteEndpoint", "globalValue", "http://legacy.test:6001/render/word")
    set(
      state,
      "kilo.documents",
      "mermaidRender.remoteEndpoint",
      "globalValue",
      "http://legacy.test:6001/render/mermaid",
    )
    expect(await migrateChipmateServer()).toMatchObject({ baseUrl: "http://legacy.test:6001", source: "migrated" })
  })

  it("reports conflicting legacy origins without migrating", async () => {
    set(state, "kilo.marketplace", "baseUrl", "globalValue", "http://market.test:6001/marketplace")
    set(state, "kilo.documents", "wordRender.remoteEndpoint", "globalValue", "http://render.test:6001/render/word")
    expect(await migrateChipmateServer()).toMatchObject({ source: "conflict" })
    expect(state.get("kilo-code.new.chipmateServer.baseUrl")?.globalValue).toBeUndefined()
  })

  it("never replaces a user-saved origin with a later default", () => {
    set(state, "kilo-code.new.chipmateServer", "baseUrl", "globalValue", "https://saved.test:7443")
    set(state, "kilo-code.new.chipmateServer", "baseUrl", "defaultValue", CHIPMATE_SERVER_DEFAULT)
    expect(resolveChipmateServer()).toEqual({ baseUrl: "https://saved.test:7443", source: "saved" })
  })

  it("surfaces an invalid manually written unified setting", () => {
    set(state, "kilo-code.new.chipmateServer", "baseUrl", "globalValue", "http://bad.test:6001/v1")
    expect(resolveChipmateServer()).toMatchObject({ source: "invalid", baseUrl: "http://bad.test:6001/v1" })
  })

  it("derives Marketplace and renderer runtime endpoints from the unified origin", () => {
    const word = process.env.KILO_WORD_RENDER_ENDPOINT
    const mermaid = process.env.KILO_MERMAID_RENDER_ENDPOINT
    delete process.env.KILO_WORD_RENDER_ENDPOINT
    delete process.env.KILO_MERMAID_RENDER_ENDPOINT
    set(state, "kilo-code.new.chipmateServer", "baseUrl", "globalValue", "https://runtime.test:7443")
    try {
      expect(marketplaceApiOptions()).toMatchObject({ baseUrl: "https://runtime.test:7443/marketplace" })
      expect(deriveChipmateServerEndpoints("https://runtime.test:7443").updates).toBe(
        "https://runtime.test:7443/packages/manifest.json",
      )
      expect(renderEnv()).toEqual({
        KILO_WORD_RENDER_ENDPOINT: "https://runtime.test:7443/render/word",
        KILO_MERMAID_RENDER_ENDPOINT: "https://runtime.test:7443/render/mermaid",
      })
    } finally {
      if (word === undefined) delete process.env.KILO_WORD_RENDER_ENDPOINT
      else process.env.KILO_WORD_RENDER_ENDPOINT = word
      if (mermaid === undefined) delete process.env.KILO_MERMAID_RENDER_ENDPOINT
      else process.env.KILO_MERMAID_RENDER_ENDPOINT = mermaid
    }
  })

  it("keeps explicit renderer environment overrides", () => {
    const word = process.env.KILO_WORD_RENDER_ENDPOINT
    const mermaid = process.env.KILO_MERMAID_RENDER_ENDPOINT
    process.env.KILO_WORD_RENDER_ENDPOINT = "https://override.test:7443/word"
    process.env.KILO_MERMAID_RENDER_ENDPOINT = "https://override.test:7443/mermaid"
    set(state, "kilo-code.new.chipmateServer", "baseUrl", "globalValue", "https://runtime.test:7443")
    try {
      expect(renderEnv()).toEqual({})
    } finally {
      if (word === undefined) delete process.env.KILO_WORD_RENDER_ENDPOINT
      else process.env.KILO_WORD_RENDER_ENDPOINT = word
      if (mermaid === undefined) delete process.env.KILO_MERMAID_RENDER_ENDPOINT
      else process.env.KILO_MERMAID_RENDER_ENDPOINT = mermaid
    }
  })

  it("reports injected, inherited, and absent Mermaid endpoint states without exposing credentials", () => {
    expect(
      mermaidEndpoint({
        KILO_MERMAID_RENDER_ENDPOINT: "https://user:secret@render.test:7443/render/mermaid?token=secret#hash",
      }),
    ).toEqual({ state: "injected", endpoint: "https://render.test:7443/render/mermaid" })
    expect(mermaidEndpoint({}, "https://user:secret@legacy.test:6001/render/mermaid?token=secret#hash")).toEqual({
      state: "inherited",
      endpoint: "https://legacy.test:6001/render/mermaid",
    })
    expect(mermaidEndpoint({}, "")).toEqual({ state: "absent" })
  })

  it("preserves legacy per-service runtime behavior when origins conflict", () => {
    set(state, "kilo.marketplace", "baseUrl", "globalValue", "http://market.test:6001/marketplace")
    set(state, "kilo.documents", "wordRender.remoteEndpoint", "globalValue", "http://render.test:6001/render/word")
    set(
      state,
      "kilo.documents",
      "mermaidRender.remoteEndpoint",
      "globalValue",
      "http://render.test:6001/render/mermaid",
    )
    expect(marketplaceApiOptions()).toMatchObject({ baseUrl: "http://market.test:6001/marketplace" })
  })

  it("disables Marketplace remote access for an invalid saved origin", () => {
    set(state, "kilo-code.new.chipmateServer", "baseUrl", "globalValue", "http://bad.test:6001/v1")
    expect(marketplaceApiOptions()).toMatchObject({ disabledReason: expect.any(String) })
  })

  it("offers and executes the VS Code reload action after saving", async () => {
    const show = vscode.window.showInformationMessage
    const execute = vscode.commands.executeCommand
    const commands: string[] = []
    ;(vscode.window as unknown as { showInformationMessage: () => Promise<string> }).showInformationMessage =
      async () => "Reload Window"
    ;(vscode.commands as unknown as { executeCommand: (command: string) => Promise<void> }).executeCommand = async (
      command,
    ) => {
      commands.push(command)
    }
    try {
      await promptChipmateServerReload()
      expect(commands).toEqual(["workbench.action.reloadWindow"])
    } finally {
      ;(vscode.window as unknown as { showInformationMessage: typeof show }).showInformationMessage = show
      ;(vscode.commands as unknown as { executeCommand: typeof execute }).executeCommand = execute
    }
  })
})

describe("ChipMate Server health test", () => {
  const servers: Array<{ stop: (close?: boolean) => void }> = []

  afterEach(() => {
    for (const server of servers) server.stop(true)
    servers.length = 0
  })

  function serve(handler: (request: Request) => Response | Promise<Response>) {
    const server = Bun.serve({ port: 0, fetch: handler })
    servers.push(server)
    return `http://127.0.0.1:${server.port}`
  }

  function payload(patch: Record<string, unknown> = {}) {
    return {
      ok: true,
      service: "chipmate-word-render",
      tools: {
        chromium: "1",
        mermaid: "1",
        soffice: "1",
        pdftoppm: "1",
        pdfinfo: "1",
      },
      capabilities: { skillMarket: { catalogExists: true, skillsCount: 2, warnings: [] } },
      ...patch,
    }
  }

  it("reports success for a complete real health response", async () => {
    const base = serve(() => Response.json(payload()))
    expect(await testChipmateServer(base)).toMatchObject({ status: "success", code: "ok", skillsCount: 2 })
  })

  it("reports a capability warning without treating the server as unreachable", async () => {
    const body = payload({
      tools: { chromium: "1", mermaid: "1", soffice: "", pdftoppm: "1", pdfinfo: "1" },
      capabilities: { skillMarket: { catalogExists: false, skillsCount: 0, warnings: ["catalog missing"] } },
    })
    const base = serve(() => Response.json(body))
    expect(await testChipmateServer(base)).toMatchObject({
      status: "warning",
      code: "degraded",
      missing: ["soffice"],
      warnings: ["catalog missing"],
    })
  })

  it.each([
    ["identity", () => Response.json(payload({ service: "other" }))],
    ["http", () => new Response("unavailable", { status: 503 })],
    ["invalid-json", () => new Response("not-json", { headers: { "content-type": "application/json" } })],
  ])("reports %s failures", async (code, handler) => {
    const base = serve(handler)
    expect(await testChipmateServer(base)).toMatchObject({ status: "error", code })
  })

  it("reports a timeout", async () => {
    const base = serve(async () => {
      await Bun.sleep(100)
      return Response.json(payload())
    })
    expect(await testChipmateServer(base, 20)).toMatchObject({ status: "error", code: "timeout" })
  })
})
