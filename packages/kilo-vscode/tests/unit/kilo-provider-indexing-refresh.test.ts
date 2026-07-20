import { describe, expect, it } from "bun:test"
import type { Config } from "@kilocode/sdk/v2/client"
import * as vscode from "vscode"

// vscode mock is provided by the shared preload (tests/setup/vscode-mock.ts)
const { KiloProvider } = await import("../../src/KiloProvider")

type Internals = {
  connectionState: "connecting" | "connected" | "disconnected" | "error"
  currentSession: { id: string; directory?: string } | null
  cachedIndexingStatusMessage: unknown
  webview: { postMessage: (message: unknown) => Promise<void> } | null
  memory: { fetch: (sessionId?: string, force?: boolean) => Promise<void> }
  handleEvent: (event: unknown, directory?: string) => void
  handleSyncSession: (sessionID: string, parentSessionID?: string) => Promise<void>
  recoverPendingPrompts: () => void
  getIndexingDirectory: () => string | undefined
  getRootDirectory: () => string
  setCurrentSession: (session: { id: string; directory?: string } | null) => void
  reloadAfterAuthChange: () => Promise<void>
  handleUpdateConfig: (
    partial: Partial<Config>,
    project?: Partial<Config>,
    requestId?: string,
    globalUnset?: string[][],
    projectUnset?: string[][],
  ) => Promise<void>
  fetchAndSendConfig: () => Promise<void>
  fetchAndSendProviders: () => Promise<void>
  fetchAndSendAgents: () => Promise<void>
  fetchAndSendSkills: () => Promise<void>
  fetchAndSendCommands: () => Promise<void>
  fetchAndSendNotifications: () => Promise<void>
  fetchAndSendIndexingStatus: () => Promise<void>
  fetchAndSendSandboxStatus: (sessionId: string) => Promise<void>
  pruneDeletedSession: (sessionId: string) => void
  selectDocumentRagFolder: () => Promise<void>
  rebuildDocumentRag: () => Promise<void>
}

function status(message: string, state: "Complete" | "Standby" = "Complete") {
  const complete = state === "Complete"
  return new Response(
    JSON.stringify({
      state,
      message,
      processedFiles: complete ? 1 : 0,
      totalFiles: complete ? 1 : 0,
      percent: complete ? 100 : 0,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  )
}

function event(message: string, state: "Complete" | "Standby" = "Complete") {
  const complete = state === "Complete"
  return {
    id: `evt-${message}`,
    type: "indexing.status",
    properties: {
      status: {
        state,
        message,
        processedFiles: complete ? 1 : 0,
        totalFiles: complete ? 1 : 0,
        percent: complete ? 100 : 0,
      },
    },
  }
}

function cached(internal: Internals): string | undefined {
  const message = internal.cachedIndexingStatusMessage as { status?: { message?: string } } | null
  return message?.status?.message
}

function createIndexingConnection() {
  let client: object | null = {}
  return {
    setClient: (next: object | null) => {
      client = next
    },
    service: {
      getClient: () => client,
      getServerConfig: () => ({ baseUrl: "http://127.0.0.1:9999", password: "secret" }),
      resolveEventSessionId: () => undefined,
      pruneSession: () => undefined,
      unregisterVisible: () => undefined,
      unregisterAttached: () => undefined,
    },
  }
}

function createConnection() {
  let drains = 0
  const patches: unknown[] = []
  const client = {
    global: {
      config: {
        get: async () => ({ data: {} }),
        update: async () => ({ data: {} }),
      },
    },
    config: {
      get: async () => ({ data: {} }),
      update: async () => ({ data: {} }),
      overlay: async () => ({ data: { project: {} } }),
      overlayUpdate: async (patch: unknown) => {
        patches.push(patch)
        return { data: {} }
      },
    },
  }

  return {
    drains: () => drains,
    patches: () => patches,
    service: {
      drainPendingPrompts: async () => {
        drains += 1
      },
      getClient: () => client,
    },
  }
}

describe("KiloProvider indexing refresh", () => {
  it("keeps indexing idle when no workspace folder is open", async () => {
    const workspace = vscode.workspace as { workspaceFolders?: readonly vscode.WorkspaceFolder[] }
    const folders = workspace.workspaceFolders
    const original = globalThis.fetch
    const messages: unknown[] = []
    let requests = 0
    workspace.workspaceFolders = undefined
    globalThis.fetch = (async () => {
      requests += 1
      return status("unexpected")
    }) as typeof fetch

    try {
      const conn = createIndexingConnection()
      const provider = new KiloProvider(
        {} as never,
        conn.service as never,
        {
          globalStorageUri: { fsPath: "/global-storage/v2" },
        } as never,
      )
      const internal = provider as unknown as Internals
      internal.connectionState = "connected"
      internal.webview = { postMessage: async (message) => void messages.push(message) }
      internal.currentSession = { id: "ses_home", directory: "/Users/archer" }

      await internal.fetchAndSendIndexingStatus()

      expect(internal.getIndexingDirectory()).toBeUndefined()
      expect(internal.getRootDirectory()).toBe("/global-storage/v2")
      expect(requests).toBe(0)
      expect(messages).toContainEqual({
        type: "indexingStatusLoaded",
        status: {
          state: "Standby",
          message: "Open a file in the target workspace to view indexing status.",
          processedFiles: 0,
          totalFiles: 0,
          percent: 0,
        },
      })
    } finally {
      globalThis.fetch = original
      workspace.workspaceFolders = folders
    }
  })

  it("reloadAfterAuthChange fetches config first, then indexing status", async () => {
    const provider = new KiloProvider({} as never, {} as never)
    const internal = provider as unknown as Internals
    const calls: string[] = []

    internal.fetchAndSendConfig = async () => {
      calls.push("config")
    }
    internal.fetchAndSendProviders = async () => {
      calls.push("providers")
    }
    internal.fetchAndSendAgents = async () => {
      calls.push("agents")
    }
    internal.fetchAndSendSkills = async () => {
      calls.push("skills")
    }
    internal.fetchAndSendCommands = async () => {
      calls.push("commands")
    }
    internal.fetchAndSendNotifications = async () => {
      calls.push("notifications")
    }
    internal.fetchAndSendIndexingStatus = async () => {
      calls.push("indexing")
    }

    await internal.reloadAfterAuthChange()

    expect(calls[0]).toBe("config")
    expect(calls.includes("indexing")).toBe(true)
  })

  it("handleUpdateConfig no longer eagerly fetches indexing status", async () => {
    const conn = createConnection()
    const provider = new KiloProvider({} as never, conn.service as never)
    const internal = provider as unknown as Internals

    let indexing = 0
    internal.connectionState = "connected"
    internal.fetchAndSendIndexingStatus = async () => {
      indexing += 1
    }

    await internal.handleUpdateConfig({})

    expect(conn.drains()).toBe(1)
    expect(indexing).toBe(0)
  })

  it("refreshes providers when prompt-training model visibility changes", async () => {
    const conn = createConnection()
    const provider = new KiloProvider({} as never, conn.service as never)
    const internal = provider as unknown as Internals
    let calls = 0
    internal.connectionState = "connected"
    internal.fetchAndSendProviders = async () => {
      calls += 1
    }

    await internal.handleUpdateConfig({ hide_prompt_training_models: true })

    expect(calls).toBe(1)
  })

  it("passes scoped unset paths to the config overlay endpoint", async () => {
    const conn = createConnection()
    const provider = new KiloProvider({} as never, conn.service as never)
    const internal = provider as unknown as Internals
    internal.connectionState = "connected"

    await internal.handleUpdateConfig(
      { indexing: { qdrant: { apiKey: undefined } } },
      { indexing: { searchMinScore: undefined } },
      "scoped-unset-test",
      [["indexing", "qdrant", "apiKey"]],
      [["indexing", "searchMinScore"]],
    )

    expect(conn.patches()).toEqual([
      expect.objectContaining({
        scope: "global",
        set: { indexing: { qdrant: { apiKey: undefined } } },
        unset: [["indexing", "qdrant", "apiKey"]],
      }),
      expect.objectContaining({
        scope: "project",
        set: { indexing: { searchMinScore: undefined } },
        unset: [["indexing", "searchMinScore"]],
      }),
    ])
  })

  it("fetchAndSendIndexingStatus uses current session directory header", async () => {
    const worktree = "/repo/.kilo/.kilocode/worktrees/feature"
    const calls: { input: RequestInfo | URL; init?: RequestInit }[] = []
    const original = globalThis.fetch

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init })
      return new Response(
        JSON.stringify({
          state: "Disabled",
          message: "Indexing is disabled in worktree sessions.",
          processedFiles: 0,
          totalFiles: 0,
          percent: 0,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )
    }) as typeof fetch

    try {
      const provider = new KiloProvider(
        {} as never,
        {
          getClient: () => ({}) as never,
          getServerConfig: () => ({ baseUrl: "http://127.0.0.1:9999", password: "secret" }),
        } as never,
      )
      const internal = provider as unknown as Internals
      provider.setSessionDirectory("ses_worktree", worktree)
      internal.currentSession = { id: "ses_worktree" }

      await internal.fetchAndSendIndexingStatus()

      expect(calls.length).toBe(1)
      const headers = new Headers(calls[0]?.init?.headers)
      const auth = Buffer.from("kilo:secret").toString("base64")
      expect(headers.get("Authorization")).toBe(`Basic ${auth}`)
      expect(headers.get("x-kilo-directory")).toBe(worktree)
    } finally {
      globalThis.fetch = original
    }
  })

  it("uses the panel project instead of the current session worktree", async () => {
    const calls: RequestInit[] = []
    const original = globalThis.fetch
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init ?? {})
      return status("panel")
    }) as typeof fetch

    try {
      const conn = createIndexingConnection()
      const provider = new KiloProvider({} as never, conn.service as never, undefined, {
        projectDirectory: "/repo-b",
      })
      const internal = provider as unknown as Internals
      provider.setSessionDirectory("ses_worktree", "/repo-a/worktree")
      internal.currentSession = { id: "ses_worktree" }

      await internal.fetchAndSendIndexingStatus()

      expect(calls).toHaveLength(1)
      expect(new Headers(calls[0]?.headers).get("x-kilo-directory")).toBe("/repo-b")
    } finally {
      globalThis.fetch = original
    }
  })

  it("only accepts indexing events for the panel project", () => {
    const conn = createIndexingConnection()
    const provider = new KiloProvider({} as never, conn.service as never, undefined, {
      projectDirectory: "/repo-b",
    })
    const internal = provider as unknown as Internals

    internal.handleEvent(event("wrong project"), "/repo-a/worktree")
    internal.handleEvent(event("missing directory"))
    expect(internal.cachedIndexingStatusMessage).toBeNull()

    internal.handleEvent(event("panel project"), "/repo-b")
    expect(cached(internal)).toBe("panel project")
  })

  it("keeps two project panels isolated on a shared event dispatcher", () => {
    const conn = createIndexingConnection()
    const a = new KiloProvider({} as never, conn.service as never, undefined, { projectDirectory: "/repo-a" })
    const b = new KiloProvider({} as never, conn.service as never, undefined, { projectDirectory: "/repo-b" })
    const first = a as unknown as Internals
    const second = b as unknown as Internals
    const emit = (payload: unknown, directory?: string) => {
      first.handleEvent(payload, directory)
      second.handleEvent(payload, directory)
    }

    emit(event("repo a"), "/repo-a")
    expect(cached(first)).toBe("repo a")
    expect(second.cachedIndexingStatusMessage).toBeNull()

    emit(event("missing"))
    expect(cached(first)).toBe("repo a")
    expect(second.cachedIndexingStatusMessage).toBeNull()

    emit(event("repo b"), "/repo-b")
    expect(cached(first)).toBe("repo a")
    expect(cached(second)).toBe("repo b")
  })

  it("does not let an old project response overwrite the new project", async () => {
    const pending = Promise.withResolvers<Response>()
    const original = globalThis.fetch
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const dir = new Headers(init?.headers).get("x-kilo-directory")
      if (dir === "/repo-a") return pending.promise
      return status("project b")
    }) as typeof fetch

    try {
      const conn = createIndexingConnection()
      const provider = new KiloProvider({} as never, conn.service as never, undefined, {
        projectDirectory: "/repo-a",
      })
      const internal = provider as unknown as Internals

      const old = internal.fetchAndSendIndexingStatus()
      provider.setProjectDirectory("/repo-b")
      await internal.fetchAndSendIndexingStatus()
      pending.resolve(status("project a"))
      await old

      expect(cached(internal)).toBe("project b")
    } finally {
      globalThis.fetch = original
    }
  })

  it("does not let an old HTTP response overwrite a newer SSE status", async () => {
    const pending = Promise.withResolvers<Response>()
    const original = globalThis.fetch
    globalThis.fetch = (() => pending.promise) as typeof fetch

    try {
      const conn = createIndexingConnection()
      const provider = new KiloProvider({} as never, conn.service as never, undefined, {
        projectDirectory: "/repo-b",
      })
      const internal = provider as unknown as Internals

      const old = internal.fetchAndSendIndexingStatus()
      internal.handleEvent(event("live"), "/repo-b")
      pending.resolve(status("stale", "Standby"))
      await old

      expect(cached(internal)).toBe("live")
    } finally {
      globalThis.fetch = original
    }
  })

  it("lets a protected A snapshot win after an A to B to A switch", async () => {
    const original = globalThis.fetch
    const pending: Array<{ dir: string; response: PromiseWithResolvers<Response> }> = []
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      const response = Promise.withResolvers<Response>()
      pending.push({ dir: new Headers(init?.headers).get("x-kilo-directory") ?? "", response })
      return response.promise
    }) as typeof fetch

    try {
      const conn = createIndexingConnection()
      const provider = new KiloProvider({} as never, conn.service as never, undefined, {
        projectDirectory: "/repo-a",
      })
      const internal = provider as unknown as Internals
      internal.connectionState = "connected"

      provider.setProjectDirectory("/repo-b")
      provider.setProjectDirectory("/repo-a")
      internal.handleEvent(event("stale a"), "/repo-a")

      const current = pending.findLast((item) => item.dir === "/repo-a")
      expect(current).toBeDefined()
      current!.response.resolve(status("fresh a"))
      await current!.response.promise
      await Promise.resolve()

      expect(cached(internal)).toBe("fresh a")
      for (const item of pending) {
        if (item === current) continue
        item.response.resolve(status("stale b"))
      }
    } finally {
      globalThis.fetch = original
    }
  })

  it("does not let a stalled newer request block an earlier status response", async () => {
    const first = Promise.withResolvers<Response>()
    const second = Promise.withResolvers<Response>()
    const original = globalThis.fetch
    let calls = 0
    globalThis.fetch = (() => {
      calls += 1
      return calls === 1 ? first.promise : second.promise
    }) as typeof fetch

    try {
      const conn = createIndexingConnection()
      const provider = new KiloProvider({} as never, conn.service as never, undefined, {
        projectDirectory: "/repo-b",
      })
      const internal = provider as unknown as Internals

      const earlier = internal.fetchAndSendIndexingStatus()
      const later = internal.fetchAndSendIndexingStatus()
      expect(calls).toBe(2)

      first.resolve(status("first"))
      await earlier
      expect(cached(internal)).toBe("first")

      second.resolve(status("second"))
      await later
      expect(cached(internal)).toBe("second")
    } finally {
      globalThis.fetch = original
    }
  })

  it("does not let an older same-project request overwrite a newer response", async () => {
    const first = Promise.withResolvers<Response>()
    const second = Promise.withResolvers<Response>()
    const original = globalThis.fetch
    let calls = 0
    globalThis.fetch = (() => {
      calls += 1
      return calls === 1 ? first.promise : second.promise
    }) as typeof fetch

    try {
      const conn = createIndexingConnection()
      const provider = new KiloProvider({} as never, conn.service as never, undefined, {
        projectDirectory: "/repo-b",
      })
      const internal = provider as unknown as Internals

      const earlier = internal.fetchAndSendIndexingStatus()
      const later = internal.fetchAndSendIndexingStatus()
      second.resolve(status("newer"))
      await later
      first.resolve(status("older"))
      await earlier

      expect(cached(internal)).toBe("newer")
    } finally {
      globalThis.fetch = original
    }
  })

  it("refreshes once when the effective panel project changes", async () => {
    const original = globalThis.fetch
    const calls: string[] = []
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(new Headers(init?.headers).get("x-kilo-directory") ?? "")
      return Promise.resolve(status("project b"))
    }) as typeof fetch

    try {
      const conn = createIndexingConnection()
      const provider = new KiloProvider({} as never, conn.service as never, undefined, {
        projectDirectory: "/repo-a",
      })
      const internal = provider as unknown as Internals
      internal.connectionState = "connected"

      provider.setProjectDirectory("/repo-b")
      provider.setProjectDirectory("/repo-b")
      await Promise.resolve()
      expect(calls).toEqual(["/repo-b"])
    } finally {
      globalThis.fetch = original
    }
  })

  it("does not send a headerless status request for an ambiguous panel", async () => {
    const original = globalThis.fetch
    const messages: unknown[] = []
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      return status("wrong")
    }) as typeof fetch

    try {
      const conn = createIndexingConnection()
      const provider = new KiloProvider({} as never, conn.service as never, undefined, {
        projectDirectory: null,
      })
      const internal = provider as unknown as Internals
      internal.webview = {
        postMessage: async (message) => {
          messages.push(message)
        },
      }

      await internal.fetchAndSendIndexingStatus()

      expect(calls).toBe(0)
      expect(messages).toEqual([
        expect.objectContaining({
          type: "indexingStatusLoaded",
          status: expect.objectContaining({ state: "Standby" }),
        }),
      ])
    } finally {
      globalThis.fetch = original
    }
  })

  it("replays an offline cache only for the same project", async () => {
    const conn = createIndexingConnection()
    const provider = new KiloProvider({} as never, conn.service as never, undefined, {
      projectDirectory: "/repo-a",
    })
    const internal = provider as unknown as Internals
    const messages: unknown[] = []
    internal.webview = {
      postMessage: async (message) => {
        messages.push(message)
      },
    }

    internal.handleEvent(event("project a"), "/repo-a")
    conn.setClient(null)
    messages.length = 0
    await internal.fetchAndSendIndexingStatus()
    expect(messages).toEqual([
      expect.objectContaining({
        type: "indexingStatusLoaded",
        status: expect.objectContaining({ message: "project a" }),
      }),
    ])

    provider.setProjectDirectory("/repo-b")
    messages.length = 0
    await internal.fetchAndSendIndexingStatus()
    expect(messages).toEqual([])
  })

  it("refreshes once when the active session moves to a worktree", async () => {
    const original = globalThis.fetch
    const calls: string[] = []
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(new Headers(init?.headers).get("x-kilo-directory") ?? "")
      return Promise.resolve(status("worktree"))
    }) as typeof fetch

    try {
      const conn = createIndexingConnection()
      const provider = new KiloProvider({} as never, conn.service as never)
      const internal = provider as unknown as Internals
      internal.setCurrentSession({ id: "ses_worktree" })
      internal.connectionState = "connected"
      internal.fetchAndSendSandboxStatus = async () => undefined

      provider.setSessionDirectory("ses_worktree", "/repo/worktree")
      provider.setSessionDirectory("ses_worktree", "/repo/worktree")
      await Promise.resolve()
      expect(calls).toEqual(["/repo/worktree"])
    } finally {
      globalThis.fetch = original
    }
  })

  it("refreshes the root once when the active worktree override is cleared", async () => {
    const pending = Promise.withResolvers<Response>()
    const original = globalThis.fetch
    const calls: string[] = []
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(new Headers(init?.headers).get("x-kilo-directory") ?? "")
      return pending.promise
    }) as typeof fetch

    try {
      const conn = createIndexingConnection()
      const provider = new KiloProvider({} as never, conn.service as never)
      const internal = provider as unknown as Internals
      provider.setSessionDirectory("ses_worktree", "/repo/worktree")
      internal.currentSession = { id: "ses_worktree", directory: "/repo/worktree" }
      internal.handleEvent(event("worktree"), "/repo/worktree")
      internal.connectionState = "connected"
      internal.fetchAndSendSandboxStatus = async () => undefined

      provider.markSessionLocal("ses_worktree")

      expect(calls).toEqual(["/repo"])
      expect(internal.cachedIndexingStatusMessage).toBeNull()
      pending.resolve(status("root"))
      await Promise.resolve()
    } finally {
      globalThis.fetch = original
    }
  })

  it("does not let a late worktree memory event override an explicit local target", async () => {
    const original = globalThis.fetch
    const calls: string[] = []
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(new Headers(init?.headers).get("x-kilo-directory") ?? "")
      return status("done")
    }) as typeof fetch

    try {
      const conn = createIndexingConnection()
      const provider = new KiloProvider({} as never, conn.service as never)
      const internal = provider as unknown as Internals
      provider.setSessionDirectory("ses_worktree", "/repo/worktree")
      provider.trackSession("ses_worktree")
      internal.currentSession = { id: "ses_worktree", directory: "/repo/worktree" }
      internal.connectionState = "connected"
      internal.fetchAndSendSandboxStatus = async () => undefined
      internal.memory.fetch = async () => undefined

      provider.markSessionLocal("ses_worktree")
      internal.handleEvent(
        {
          type: "memory.updated",
          properties: { sessionID: "ses_worktree" },
        },
        "/repo/worktree",
      )

      expect(internal.getIndexingDirectory()).toBe("/repo")
      expect(calls).toEqual(["/repo"])

      provider.setSessionDirectory("ses_worktree", "/repo/worktree")
      expect(internal.getIndexingDirectory()).toBe("/repo/worktree")
      expect(calls).toEqual(["/repo", "/repo/worktree"])
    } finally {
      globalThis.fetch = original
    }
  })

  it("does not let a late root memory event override an explicit worktree target", async () => {
    const original = globalThis.fetch
    const calls: string[] = []
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(new Headers(init?.headers).get("x-kilo-directory") ?? "")
      return status("done")
    }) as typeof fetch

    try {
      const conn = createIndexingConnection()
      const provider = new KiloProvider({} as never, conn.service as never)
      const internal = provider as unknown as Internals
      provider.trackSession("ses_local")
      internal.currentSession = { id: "ses_local", directory: "/repo" }
      internal.connectionState = "connected"
      internal.fetchAndSendSandboxStatus = async () => undefined
      internal.memory.fetch = async () => undefined
      internal.handleEvent({ type: "memory.updated", properties: { sessionID: "ses_local" } }, "/repo")

      provider.setSessionDirectory("ses_local", "/repo/worktree")
      internal.handleEvent({ type: "memory.updated", properties: { sessionID: "ses_local" } }, "/repo")

      expect(internal.getIndexingDirectory()).toBe("/repo/worktree")
      expect(calls).toEqual(["/repo/worktree"])

      provider.markSessionLocal("ses_local")
      expect(internal.getIndexingDirectory()).toBe("/repo")
      expect(calls).toEqual(["/repo/worktree", "/repo"])
    } finally {
      globalThis.fetch = original
    }
  })

  it("does not let the first inferred event override the current session directory", () => {
    const conn = createIndexingConnection()
    const provider = new KiloProvider({} as never, conn.service as never)
    const internal = provider as unknown as Internals
    provider.trackSession("ses_worktree")
    internal.currentSession = { id: "ses_worktree", directory: "/repo/worktree" }
    internal.memory.fetch = async () => undefined

    internal.handleEvent(
      { id: "evt-memory", type: "memory.updated", properties: { sessionID: "ses_worktree" } },
      "/repo",
    )

    expect(provider.getSessionDirectories().get("ses_worktree")).toBe("/repo/worktree")
    expect(internal.getIndexingDirectory()).toBe("/repo/worktree")
  })

  it("lets a forgotten child inherit its parent worktree again", async () => {
    const conn = createIndexingConnection()
    conn.setClient({
      session: {
        get: async () => ({
          data: {
            id: "ses_child",
            slug: "child",
            projectID: "project",
            directory: "/repo/worktree",
            parentID: "ses_parent",
            title: "child",
            time: { created: 1, updated: 1 },
          },
        }),
        messages: async () => ({ data: [] }),
      },
    })
    const provider = new KiloProvider({} as never, conn.service as never)
    const internal = provider as unknown as Internals
    internal.recoverPendingPrompts = () => undefined
    provider.setSessionDirectory("ses_parent", "/repo/worktree")
    provider.setSessionDirectory("ses_child", "/repo/worktree")
    provider.forgetSessionDirectory("ses_child")

    await internal.handleSyncSession("ses_child", "ses_parent")

    expect(provider.getSessionDirectories().get("ses_child")).toBe("/repo/worktree")
  })

  it("restores a persisted local target after provider recreation", async () => {
    const original = globalThis.fetch
    const calls: string[] = []
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(new Headers(init?.headers).get("x-kilo-directory") ?? "")
      return status("local")
    }) as typeof fetch

    try {
      const old = createIndexingConnection()
      const first = new KiloProvider({} as never, old.service as never)
      const before = first as unknown as Internals
      first.setSessionDirectory("ses_local", "/repo/worktree")
      before.currentSession = { id: "ses_local", directory: "/repo/worktree" }
      first.markSessionLocal("ses_local")
      first.dispose()

      const next = createIndexingConnection()
      const second = new KiloProvider({} as never, next.service as never)
      const after = second as unknown as Internals
      second.markSessionLocal("ses_local")
      after.setCurrentSession({ id: "ses_local", directory: "/repo/worktree" })

      await after.fetchAndSendIndexingStatus()

      expect(calls).toEqual(["/repo"])
      second.dispose()
    } finally {
      globalThis.fetch = original
    }
  })

  it("refreshes the root exactly once when the active worktree session is deleted", async () => {
    const original = globalThis.fetch
    const calls: string[] = []
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(new Headers(init?.headers).get("x-kilo-directory") ?? "")
      return status("root")
    }) as typeof fetch

    try {
      const conn = createIndexingConnection()
      const provider = new KiloProvider({} as never, conn.service as never)
      const internal = provider as unknown as Internals
      provider.setSessionDirectory("ses_worktree", "/repo/worktree")
      internal.currentSession = { id: "ses_worktree", directory: "/repo/worktree" }
      internal.connectionState = "connected"

      internal.pruneDeletedSession("ses_worktree")
      await Promise.resolve()

      expect(calls).toEqual(["/repo"])
    } finally {
      globalThis.fetch = original
    }
  })

  it("uses the session directory before a worktree override is registered", async () => {
    const original = globalThis.fetch
    const calls: RequestInit[] = []
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init ?? {})
      return status("worktree")
    }) as typeof fetch

    try {
      const conn = createIndexingConnection()
      const provider = new KiloProvider({} as never, conn.service as never)
      const internal = provider as unknown as Internals
      internal.currentSession = { id: "ses_worktree", directory: "/repo/worktree" }

      await internal.fetchAndSendIndexingStatus()

      expect(new Headers(calls[0]?.headers).get("x-kilo-directory")).toBe("/repo/worktree")
    } finally {
      globalThis.fetch = original
    }
  })

  it("selects Document RAG folders relative to the panel project", async () => {
    const original = vscode.window.showOpenDialog
    const messages: unknown[] = []
    Object.assign(vscode.window, {
      showOpenDialog: async (options: vscode.OpenDialogOptions) => {
        expect(options.defaultUri?.fsPath).toBe("/repo-b")
        return [vscode.Uri.file("/repo-b/docs")]
      },
    })

    try {
      const conn = createIndexingConnection()
      const provider = new KiloProvider({} as never, conn.service as never, undefined, {
        projectDirectory: "/repo-b",
      })
      const internal = provider as unknown as Internals
      provider.setSessionDirectory("ses_worktree", "/repo-a/worktree")
      internal.currentSession = { id: "ses_worktree" }
      internal.webview = {
        postMessage: async (message) => {
          messages.push(message)
        },
      }

      await internal.selectDocumentRagFolder()

      expect(messages).toContainEqual({ type: "documentRagFoldersSelected", paths: ["docs"] })
    } finally {
      Object.assign(vscode.window, { showOpenDialog: original })
    }
  })

  it("drops Document RAG folder picks after an A to B to A project switch", async () => {
    const original = vscode.window.showOpenDialog
    const pending = Promise.withResolvers<vscode.Uri[] | undefined>()
    const messages: unknown[] = []
    Object.assign(vscode.window, { showOpenDialog: () => pending.promise })

    try {
      const conn = createIndexingConnection()
      const provider = new KiloProvider({} as never, conn.service as never, undefined, {
        projectDirectory: "/repo-a",
      })
      const internal = provider as unknown as Internals
      internal.webview = {
        postMessage: async (message) => {
          messages.push(message)
        },
      }

      const task = internal.selectDocumentRagFolder()
      provider.setProjectDirectory("/repo-b")
      provider.setProjectDirectory("/repo-a")
      pending.resolve([vscode.Uri.file("/repo-a/docs")])
      await task

      expect(messages.some((message) => (message as { type?: string }).type === "documentRagFoldersSelected")).toBe(
        false,
      )
    } finally {
      Object.assign(vscode.window, { showOpenDialog: original })
    }
  })

  it("drops Document RAG folder picks after provider disposal", async () => {
    const original = vscode.window.showOpenDialog
    const pending = Promise.withResolvers<vscode.Uri[] | undefined>()
    const messages: unknown[] = []
    Object.assign(vscode.window, { showOpenDialog: () => pending.promise })

    try {
      const conn = createIndexingConnection()
      const provider = new KiloProvider({} as never, conn.service as never, undefined, {
        projectDirectory: "/repo-a",
      })
      const internal = provider as unknown as Internals
      internal.webview = {
        postMessage: async (message) => {
          messages.push(message)
        },
      }

      const task = internal.selectDocumentRagFolder()
      provider.dispose()
      pending.resolve([vscode.Uri.file("/repo-a/docs")])
      await task

      expect(messages.some((message) => (message as { type?: string }).type === "documentRagFoldersSelected")).toBe(
        false,
      )
    } finally {
      Object.assign(vscode.window, { showOpenDialog: original })
    }
  })

  it("rebuilds documents and accepts the returned status for the panel project", async () => {
    const calls: { input: string; init?: RequestInit }[] = []
    const original = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input: input.toString(), init })
      return status("rebuilt")
    }) as typeof fetch

    try {
      const conn = createIndexingConnection()
      const provider = new KiloProvider({} as never, conn.service as never, undefined, {
        projectDirectory: "/repo-b",
      })
      const internal = provider as unknown as Internals

      await internal.rebuildDocumentRag()

      expect(calls).toHaveLength(1)
      expect(calls[0]?.input.endsWith("/indexing/documents/rebuild")).toBe(true)
      expect(calls[0]?.init?.method).toBe("POST")
      expect(new Headers(calls[0]?.init?.headers).get("x-kilo-directory")).toBe("/repo-b")
      expect(cached(internal)).toBe("rebuilt")
    } finally {
      globalThis.fetch = original
    }
  })

  it("drops a rebuild response after the panel project changes", async () => {
    const pending = Promise.withResolvers<Response>()
    const original = globalThis.fetch
    globalThis.fetch = (() => pending.promise) as typeof fetch

    try {
      const conn = createIndexingConnection()
      const provider = new KiloProvider({} as never, conn.service as never, undefined, {
        projectDirectory: "/repo-a",
      })
      const internal = provider as unknown as Internals

      const task = internal.rebuildDocumentRag()
      provider.setProjectDirectory("/repo-b")
      pending.resolve(status("old rebuild"))
      await task

      expect(internal.cachedIndexingStatusMessage).toBeNull()
    } finally {
      globalThis.fetch = original
    }
  })

  it("drops a status response that arrives after provider disposal", async () => {
    const pending = Promise.withResolvers<Response>()
    const original = globalThis.fetch
    globalThis.fetch = (() => pending.promise) as typeof fetch

    try {
      const conn = createIndexingConnection()
      const provider = new KiloProvider({} as never, conn.service as never, undefined, {
        projectDirectory: "/repo-b",
      })
      const internal = provider as unknown as Internals

      const task = internal.fetchAndSendIndexingStatus()
      provider.dispose()
      pending.resolve(status("late"))
      await task

      expect(internal.cachedIndexingStatusMessage).toBeNull()
    } finally {
      globalThis.fetch = original
    }
  })

  it("drops a status response from a replaced client", async () => {
    const original = globalThis.fetch
    const pending = Promise.withResolvers<Response>()
    globalThis.fetch = (() => pending.promise) as typeof fetch

    try {
      const conn = createIndexingConnection()
      const provider = new KiloProvider({} as never, conn.service as never, undefined, {
        projectDirectory: "/repo-a",
      })
      const internal = provider as unknown as Internals
      const request = internal.fetchAndSendIndexingStatus()

      conn.setClient({})
      pending.resolve(status("old client"))
      await request

      expect(internal.cachedIndexingStatusMessage).toBeNull()
    } finally {
      globalThis.fetch = original
    }
  })

  it("forwards indexing.status when directory only differs by Windows drive casing", () => {
    const provider = new KiloProvider(
      {} as never,
      {
        resolveEventSessionId: () => undefined,
      } as never,
    )
    const internal = provider as unknown as Internals
    provider.setSessionDirectory("ses_worktree", "C:/Repo/Work")
    internal.currentSession = { id: "ses_worktree" }

    const desc = Object.getOwnPropertyDescriptor(process, "platform")
    Object.defineProperty(process, "platform", { value: "win32", configurable: true })
    try {
      internal.handleEvent(
        {
          type: "indexing.status",
          properties: {
            status: {
              state: "Complete",
              message: "Done",
              processedFiles: 10,
              totalFiles: 10,
              percent: 100,
            },
          },
        },
        "c:/repo/work",
      )
    } finally {
      if (desc) Object.defineProperty(process, "platform", desc)
    }

    const msg = internal.cachedIndexingStatusMessage as { type?: string; status?: { state?: string } } | undefined
    expect(msg?.type).toBe("indexingStatusLoaded")
    expect(msg?.status?.state).toBe("Complete")
  })
})
