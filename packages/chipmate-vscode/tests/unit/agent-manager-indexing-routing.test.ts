import { describe, expect, it } from "bun:test"

const { AgentManagerProvider } = await import("../../src/agent-manager/AgentManagerProvider")

type Internal = {
  panel: {
    sessions: {
      setSessionDirectory: (id: string, dir: string) => void
      markSessionLocal: (id: string) => void
      forgetSessionDirectory: (id: string) => void
      getSessionInfo: (id: string) => Promise<{ parentID?: string } | undefined>
      trackSession: (id: string) => void
      refreshSessions: () => void
      recoverPendingPrompts: () => void
    }
  }
  host: { refreshGit: () => void }
  getWorktreeManager: () => unknown
  getStateManager: () => unknown
  pushState: () => void
  postToWebview: () => void
  log: () => void
  initializeState: () => Promise<void>
}

describe("Agent Manager indexing routing recovery", () => {
  it("restores local and worktree routes while forgetting pruned child routes", async () => {
    const managed = [
      { id: "parent", worktreeId: "wt" },
      { id: "child", worktreeId: "wt" },
      { id: "local", worktreeId: null },
    ]
    const calls: string[] = []
    const state = {
      load: async () => ({ status: "loaded", refsFixed: 0 }),
      prepareRecovery: async () => true,
      flush: async () => undefined,
      getWorktrees: () => [{ id: "wt", path: "/repo/worktree" }],
      getSessions: (worktreeId?: string) =>
        managed.filter((session) => worktreeId === undefined || session.worktreeId === worktreeId),
      directoryFor: (id: string) =>
        managed.find((session) => session.id === id)?.worktreeId === "wt" ? "/repo/worktree" : undefined,
      removeSession: (id: string) => {
        const index = managed.findIndex((session) => session.id === id)
        if (index >= 0) managed.splice(index, 1)
      },
    }
    const manager = {
      ensureGitExclude: async () => undefined,
      cleanupOrphanedTempDirs: () => undefined,
      discoverWorktrees: async () => [],
    }
    const provider = Object.create(AgentManagerProvider.prototype) as Internal
    provider.getWorktreeManager = () => manager
    provider.getStateManager = () => state
    provider.host = { refreshGit: () => undefined }
    provider.pushState = () => undefined
    provider.postToWebview = () => undefined
    provider.log = () => undefined
    provider.panel = {
      sessions: {
        setSessionDirectory: (id, dir) => calls.push(`set:${id}:${dir}`),
        markSessionLocal: (id) => calls.push(`local:${id}`),
        forgetSessionDirectory: (id) => calls.push(`forget:${id}`),
        getSessionInfo: async (id) => (id === "child" ? { parentID: "parent" } : {}),
        trackSession: (id) => calls.push(`track:${id}`),
        refreshSessions: () => calls.push("refresh"),
        recoverPendingPrompts: () => calls.push("recover"),
      },
    }

    await provider.initializeState()

    expect(calls).toContain("set:parent:/repo/worktree")
    expect(calls).toContain("set:child:/repo/worktree")
    expect(calls).toContain("forget:child")
    expect(calls).toContain("local:local")
    expect(calls).toContain("track:parent")
    expect(calls).toContain("track:local")
    expect(calls).not.toContain("local:child")
    expect(calls).not.toContain("track:child")
  })
})
