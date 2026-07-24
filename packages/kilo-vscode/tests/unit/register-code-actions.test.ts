import { afterEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import { registerCodeActions } from "../../src/services/code-actions/register-code-actions"

type Command = (...args: unknown[]) => unknown

type Api = typeof vscode & {
  commands: {
    registerCommand: (command: string, callback: Command) => { dispose(): void }
    executeCommand: (...args: unknown[]) => Promise<void>
  }
  languages: {
    getDiagnostics: () => Array<{ range: { intersection: () => unknown } }>
  }
  window: typeof vscode.window & { activeTextEditor?: unknown }
  workspace: typeof vscode.workspace & {
    asRelativePath: (uri: vscode.Uri, includeWorkspaceFolder?: boolean) => string
    getWorkspaceFolder: (uri: vscode.Uri) => vscode.WorkspaceFolder | undefined
    fs: typeof vscode.workspace.fs & {
      stat: (uri: vscode.Uri) => Promise<vscode.FileStat>
    }
  }
}

const api = vscode as Api
const original = {
  register: api.commands.registerCommand,
  execute: api.commands.executeCommand,
  editor: api.window.activeTextEditor,
  diagnostics: api.languages.getDiagnostics,
  folder: api.workspace.getWorkspaceFolder,
  relative: api.workspace.asRelativePath,
  stat: api.workspace.fs.stat,
}

function setup(active = false, agentReady = true, tabActive = false) {
  const commands = new Map<string, Command>()
  const executed: unknown[][] = []
  const events: string[] = []
  const posts: unknown[] = []
  const waits: string[] = []
  const context = { subscriptions: [] as Array<{ dispose(): void }> } as vscode.ExtensionContext
  const provider = {
    postMessage: (msg: unknown) => {
      events.push("post")
      posts.push(msg)
    },
    waitForReady: async () => {
      events.push("wait")
      waits.push("provider")
    },
  }
  const agent = {
    isActive: () => active,
    postMessage: (msg: unknown) => {
      events.push("post")
      posts.push(msg)
    },
    waitForReady: async () => {
      events.push("wait")
      waits.push("agent")
      return agentReady
    },
  }
  const tab = {
    postMessage: (msg: unknown) => {
      events.push("post")
      posts.push(msg)
    },
    waitForReady: async () => {
      events.push("wait")
      waits.push("tab")
    },
  }

  api.commands.registerCommand = (command, callback) => {
    commands.set(command, callback)
    return { dispose: () => undefined }
  }
  api.commands.executeCommand = async (...args) => {
    events.push("focus")
    executed.push(args)
  }
  api.languages.getDiagnostics = () => []
  api.window.activeTextEditor = {
    selection: {
      isEmpty: false,
      start: { line: 2 },
      end: { line: 4 },
    },
    document: {
      uri: vscode.Uri.file("/repo/src/file.ts"),
      getText: () => "const value = 1",
    },
  }

  api.workspace.getWorkspaceFolder = (uri) =>
    uri.fsPath === "/repo" || uri.fsPath.startsWith("/repo/") || /^[A-Za-z]:[\\/]repo(?:[\\/]|$)/.test(uri.fsPath)
      ? ({ uri: vscode.Uri.file("/repo"), name: "repo", index: 0 } as vscode.WorkspaceFolder)
      : undefined
  api.workspace.asRelativePath = (uri) =>
    uri.fsPath.replace(/^\/repo\//, "").replace(/^[A-Za-z]:[\\/]repo[\\/]/, "")
  api.workspace.fs.stat = async (uri) => ({
    type: uri.fsPath === "/repo" || uri.fsPath.endsWith("/folder") ? vscode.FileType.Directory : vscode.FileType.File,
    ctime: 0,
    mtime: 0,
    size: 0,
  })

  registerCodeActions(context, provider as never, agent as never, () => (tabActive ? (tab as never) : undefined))

  return { commands, events, executed, posts, waits }
}

afterEach(() => {
  api.commands.registerCommand = original.register
  api.commands.executeCommand = original.execute
  api.window.activeTextEditor = original.editor
  api.languages.getDiagnostics = original.diagnostics
  api.workspace.getWorkspaceFolder = original.folder
  api.workspace.asRelativePath = original.relative
  api.workspace.fs.stat = original.stat
})

describe("registerCodeActions", () => {
  it("reveals the sidebar before adding selected code to context", async () => {
    const state = setup()

    await state.commands.get("chipmate.v2.addToContext")?.()

    expect(state.events).toEqual(["focus", "wait", "post"])
    expect(state.executed).toEqual([["chipmate.v2.SidebarProvider.focus"]])
    expect(state.waits).toEqual(["provider"])
    expect(state.posts).toEqual([
      {
        type: "appendChatBoxMessage",
        text: "src/file.ts:3-5\n```\nconst value = 1\n```",
      },
    ])
  })

  it("adds selected code to the active Agent Manager without revealing the sidebar", async () => {
    const state = setup(true)

    await state.commands.get("chipmate.v2.addToContext")?.()

    expect(state.events).toEqual(["wait", "post"])
    expect(state.executed).toEqual([])
    expect(state.waits).toEqual(["agent"])
    expect(state.posts).toEqual([
      {
        type: "appendChatBoxMessage",
        text: "src/file.ts:3-5\n```\nconst value = 1\n```",
      },
    ])
  })

  it("does not post to the Agent Manager when its readiness wait is cancelled", async () => {
    const state = setup(true, false)

    await state.commands.get("chipmate.v2.addToContext")?.()

    expect(state.events).toEqual(["wait"])
    expect(state.posts).toEqual([])
  })

  it("adds a file path to the sidebar QA draft without attaching or sending it", async () => {
    const state = setup()

    await state.commands.get("chipmate.v2.addExplorerPathsToQa")?.(vscode.Uri.file("/repo/src/my file.ts"))

    expect(state.events).toEqual(["focus", "wait", "post"])
    expect(state.posts).toEqual([{ type: "appendChatBoxMessage", text: "`src/my file.ts`" }])
  })

  it("adds a folder path with a trailing slash to the active Agent Manager", async () => {
    const state = setup(true)

    await state.commands.get("chipmate.v2.addExplorerPathsToQa")?.(vscode.Uri.file("/repo/src/folder"))

    expect(state.events).toEqual(["wait", "post"])
    expect(state.waits).toEqual(["agent"])
    expect(state.posts).toEqual([{ type: "appendChatBoxMessage", text: "`src/folder/`" }])
  })

  it("references a single-root workspace folder as the current directory", async () => {
    const state = setup()
    api.workspace.asRelativePath = () => ""

    await state.commands.get("chipmate.v2.addExplorerPathsToQa")?.(vscode.Uri.file("/repo"))

    expect(state.posts).toEqual([{ type: "appendChatBoxMessage", text: "`./`" }])
  })

  it("adds deduplicated multi-selected paths to the active chat tab", async () => {
    const state = setup(false, true, true)
    const file = vscode.Uri.file("/repo/src/main.ts")
    const folder = vscode.Uri.file("/repo/src/folder")

    await state.commands.get("chipmate.v2.addExplorerPathsToQa")?.(file, [file, folder, file])

    expect(state.events).toEqual(["wait", "post"])
    expect(state.waits).toEqual(["tab"])
    expect(state.posts).toEqual([
      {
        type: "appendChatBoxMessage",
        text: "`src/main.ts`\n`src/folder/`",
      },
    ])
  })

  it("normalizes Windows separators and preserves multi-root relative paths", async () => {
    const state = setup()
    api.workspace.asRelativePath = (_uri, include) => {
      expect(include).toBeUndefined()
      return "firmware\\src\\main.c"
    }
    const uri = vscode.Uri.file("C:\\repo\\firmware\\src\\main.c")

    await state.commands.get("chipmate.v2.addExplorerPathsToQa")?.(uri)

    expect(state.posts).toEqual([{ type: "appendChatBoxMessage", text: "`firmware/src/main.c`" }])
  })

  it("skips resources outside the workspace", async () => {
    const state = setup()

    await state.commands.get("chipmate.v2.addExplorerPathsToQa")?.(vscode.Uri.file("/outside/file.ts"))

    expect(state.events).toEqual([])
    expect(state.posts).toEqual([])
  })

  it("toggles chat search on the active Agent Manager once it is ready", async () => {
    const state = setup(true)

    await state.commands.get("chipmate.v2.toggleChatSearch")?.()

    expect(state.events).toEqual(["wait", "post"])
    expect(state.posts).toEqual([{ type: "action", action: "focusSearch" }])
  })

  it("does not toggle chat search when Agent Manager readiness is cancelled", async () => {
    const state = setup(true, false)

    await state.commands.get("chipmate.v2.toggleChatSearch")?.()

    expect(state.events).toEqual(["wait"])
    expect(state.posts).toEqual([])
  })
})
