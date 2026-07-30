import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import {
  promptChipmateServerReload,
  resolveChipmateServer,
  testChipmateServer,
} from "../../src/services/chipmate-server"
import { CHIPMATE_SERVER_DEFAULT, deriveChipmateServerEndpoints } from "../../src/shared/chipmate-server"
import { marketplaceApiOptions } from "../../src/services/marketplace"
import { mermaidEndpoint, plantumlEndpoint, renderEnv } from "../../src/services/cli-backend/server-manager"
import { renderPlantUml } from "../../src/kilo-provider/render-plantuml"

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
    set(state, "chipmate.v2.chipmateServer", "baseUrl", "defaultValue", "http://package.test:6001")
    expect(resolveChipmateServer()).toEqual({ baseUrl: "http://package.test:6001", source: "default" })
    expect(state.get("chipmate.v2.chipmateServer.baseUrl")?.globalValue).toBeUndefined()
  })

  it("falls back to the public default when the manifest default is unavailable", () => {
    expect(resolveChipmateServer()).toEqual({ baseUrl: CHIPMATE_SERVER_DEFAULT, source: "default" })
  })

  it("ignores a workspace override for the unified setting", () => {
    set(state, "chipmate.v2.chipmateServer", "baseUrl", "workspaceValue", "http://workspace.test:6001")
    set(state, "chipmate.v2.chipmateServer", "baseUrl", "defaultValue", "http://package.test:6001")
    expect(resolveChipmateServer()).toEqual({ baseUrl: "http://package.test:6001", source: "default" })
  })

  it("does not read a legacy marketplace endpoint", () => {
    set(state, "kilo.marketplace", "baseUrl", "globalValue", "http://legacy.test:6001/marketplace")
    expect(resolveChipmateServer()).toEqual({ baseUrl: CHIPMATE_SERVER_DEFAULT, source: "default" })
  })

  it("never replaces a user-saved origin with a later default", () => {
    set(state, "chipmate.v2.chipmateServer", "baseUrl", "globalValue", "https://saved.test:7443")
    set(state, "chipmate.v2.chipmateServer", "baseUrl", "defaultValue", "http://package.test:6001")
    expect(resolveChipmateServer()).toEqual({ baseUrl: "https://saved.test:7443", source: "saved" })
  })

  it("surfaces an invalid manually written unified setting", () => {
    set(state, "chipmate.v2.chipmateServer", "baseUrl", "globalValue", "http://bad.test:6001/v1")
    expect(resolveChipmateServer()).toMatchObject({ source: "invalid", baseUrl: "http://bad.test:6001/v1" })
  })

  it("surfaces an invalid manifest default", () => {
    set(state, "chipmate.v2.chipmateServer", "baseUrl", "defaultValue", "http://bad.test:6001/v1")
    expect(resolveChipmateServer()).toMatchObject({ source: "invalid", baseUrl: "http://bad.test:6001/v1" })
  })

  it("derives Marketplace and renderer runtime endpoints from the unified origin", () => {
    const word = process.env.KILO_WORD_RENDER_ENDPOINT
    const mermaid = process.env.KILO_MERMAID_RENDER_ENDPOINT
    const plantuml = process.env.KILO_PLANTUML_RENDER_ENDPOINT
    const review = process.env.KILO_REVIEW_RULES_ENDPOINT
    delete process.env.KILO_WORD_RENDER_ENDPOINT
    delete process.env.KILO_MERMAID_RENDER_ENDPOINT
    delete process.env.KILO_PLANTUML_RENDER_ENDPOINT
    delete process.env.KILO_REVIEW_RULES_ENDPOINT
    set(state, "chipmate.v2.chipmateServer", "baseUrl", "globalValue", "https://runtime.test:7443")
    try {
      expect(marketplaceApiOptions()).toMatchObject({ baseUrl: "https://runtime.test:7443/marketplace" })
      expect(deriveChipmateServerEndpoints("https://runtime.test:7443").updates).toBe(
        "https://runtime.test:7443/packages/manifest.json",
      )
      expect(renderEnv()).toEqual({
        KILO_WORD_RENDER_ENDPOINT: "https://runtime.test:7443/render/word",
        KILO_MERMAID_RENDER_ENDPOINT: "https://runtime.test:7443/render/mermaid",
        KILO_PLANTUML_RENDER_ENDPOINT: "https://runtime.test:7443/render/plantuml",
        KILO_REVIEW_RULES_ENDPOINT: "https://runtime.test:7443/api/v1/review-rule-packs/latest",
      })
    } finally {
      if (word === undefined) delete process.env.KILO_WORD_RENDER_ENDPOINT
      else process.env.KILO_WORD_RENDER_ENDPOINT = word
      if (mermaid === undefined) delete process.env.KILO_MERMAID_RENDER_ENDPOINT
      else process.env.KILO_MERMAID_RENDER_ENDPOINT = mermaid
      if (plantuml === undefined) delete process.env.KILO_PLANTUML_RENDER_ENDPOINT
      else process.env.KILO_PLANTUML_RENDER_ENDPOINT = plantuml
      if (review === undefined) delete process.env.KILO_REVIEW_RULES_ENDPOINT
      else process.env.KILO_REVIEW_RULES_ENDPOINT = review
    }
  })

  it("keeps explicit renderer environment overrides", () => {
    const word = process.env.KILO_WORD_RENDER_ENDPOINT
    const mermaid = process.env.KILO_MERMAID_RENDER_ENDPOINT
    const plantuml = process.env.KILO_PLANTUML_RENDER_ENDPOINT
    const review = process.env.KILO_REVIEW_RULES_ENDPOINT
    process.env.KILO_WORD_RENDER_ENDPOINT = "https://override.test:7443/word"
    process.env.KILO_MERMAID_RENDER_ENDPOINT = "https://override.test:7443/mermaid"
    process.env.KILO_PLANTUML_RENDER_ENDPOINT = "https://override.test:7443/plantuml"
    process.env.KILO_REVIEW_RULES_ENDPOINT = "https://override.test:7443/rules"
    set(state, "chipmate.v2.chipmateServer", "baseUrl", "globalValue", "https://runtime.test:7443")
    try {
      expect(renderEnv()).toEqual({})
    } finally {
      if (word === undefined) delete process.env.KILO_WORD_RENDER_ENDPOINT
      else process.env.KILO_WORD_RENDER_ENDPOINT = word
      if (mermaid === undefined) delete process.env.KILO_MERMAID_RENDER_ENDPOINT
      else process.env.KILO_MERMAID_RENDER_ENDPOINT = mermaid
      if (plantuml === undefined) delete process.env.KILO_PLANTUML_RENDER_ENDPOINT
      else process.env.KILO_PLANTUML_RENDER_ENDPOINT = plantuml
      if (review === undefined) delete process.env.KILO_REVIEW_RULES_ENDPOINT
      else process.env.KILO_REVIEW_RULES_ENDPOINT = review
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

  it("reports injected, inherited, and absent PlantUML endpoint states without exposing credentials", () => {
    expect(
      plantumlEndpoint({
        KILO_PLANTUML_RENDER_ENDPOINT: "https://user:secret@render.test:7443/render/plantuml?token=secret#hash",
      }),
    ).toEqual({ state: "injected", endpoint: "https://render.test:7443/render/plantuml" })
    expect(plantumlEndpoint({}, "https://user:secret@legacy.test:6001/render/plantuml?token=secret#hash")).toEqual({
      state: "inherited",
      endpoint: "https://legacy.test:6001/render/plantuml",
    })
    expect(plantumlEndpoint({}, "")).toEqual({ state: "absent" })
  })

  it("ignores legacy per-service settings", () => {
    set(state, "kilo.marketplace", "baseUrl", "globalValue", "http://market.test:6001/marketplace")
    set(
      state,
      "chipmate.v2.documents",
      "wordRender.remoteEndpoint",
      "globalValue",
      "http://render.test:6001/render/word",
    )
    set(
      state,
      "chipmate.v2.documents",
      "mermaidRender.remoteEndpoint",
      "globalValue",
      "http://render.test:6001/render/mermaid",
    )
    expect(marketplaceApiOptions()).toMatchObject({ baseUrl: `${CHIPMATE_SERVER_DEFAULT}/marketplace` })
  })

  it("disables Marketplace remote access for an invalid saved origin", () => {
    set(state, "chipmate.v2.chipmateServer", "baseUrl", "globalValue", "http://bad.test:6001/v1")
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

  it("posts the server's original PlantUML PNG bytes back to the webview", async () => {
    set(state, "chipmate.v2.chipmateServer", "baseUrl", "globalValue", "https://runtime.test:7443")
    const requests: Array<{ url: string; body: unknown }> = []
    const replies: unknown[] = []
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) })
      return Response.json({
        ok: true,
        png: { contentType: "image/png", base64: "iVBORw0KGgo=" },
        width: 320,
        height: 180,
        issues: [],
        metadata: { verified: true },
      })
    }) as typeof fetch

    await renderPlantUml(
      { requestId: "uml-1", source: "@startuml\nA -> B\n@enduml" },
      (reply) => replies.push(reply),
      fetcher,
    )

    expect(requests).toEqual([
      {
        url: "https://runtime.test:7443/render/plantuml",
        body: {
          source: "@startuml\nA -> B\n@enduml",
          filename: "diagram.puml",
          timeoutMs: 60_000,
        },
      },
    ])
    expect(replies).toEqual([
      {
        type: "plantUmlRendered",
        requestId: "uml-1",
        ok: true,
        dataUrl: "data:image/png;base64,iVBORw0KGgo=",
        width: 320,
        height: 180,
        issues: [],
      },
    ])
  })

  it("preserves structured PlantUML server diagnostics", async () => {
    set(state, "chipmate.v2.chipmateServer", "baseUrl", "globalValue", "https://runtime.test:7443")
    const replies: unknown[] = []
    const fetcher = (async () =>
      Response.json({
        ok: false,
        issues: [
          { severity: "error", code: "plantuml-syntax-error", message: "Syntax error on line 3" },
          { severity: "warning", code: "plantuml-source-warning", message: "Check the participant name" },
        ],
      })) as typeof fetch

    await renderPlantUml(
      { requestId: "uml-error", source: "@startuml\nBroken ->\n@enduml" },
      (reply) => replies.push(reply),
      fetcher,
    )

    expect(replies).toEqual([
      {
        type: "plantUmlRendered",
        requestId: "uml-error",
        ok: false,
        issues: ["Syntax error on line 3", "Check the participant name"],
      },
    ])
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
        java: "17",
        plantuml: "1.2026.6",
        graphviz: "12",
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
      tools: {
        chromium: "1",
        mermaid: "1",
        soffice: "",
        pdftoppm: "1",
        pdfinfo: "1",
        java: "17",
        plantuml: "1.2026.6",
        graphviz: "12",
      },
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
