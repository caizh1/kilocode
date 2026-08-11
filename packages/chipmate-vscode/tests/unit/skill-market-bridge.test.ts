import { afterEach, describe, expect, it, mock } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import type { SkillMarketRequest, SkillMarketResult } from "@chipmate/sdk/v2/client"
import * as vscode from "vscode"
import { SkillMarketBridge } from "../../src/services/skill-market/bridge"
import type { SSEPayload } from "../../src/services/cli-backend/sdk-sse-adapter"

const roots: string[] = []
const restores: Array<() => void> = []

afterEach(async () => {
  for (const restore of restores.splice(0)) restore()
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

async function waitFor(check: () => boolean): Promise<void> {
  for (let index = 0; index < 100 && !check(); index++) {
    await Bun.sleep(10)
  }
}

describe("Skill Market Bridge", () => {
  it("把 CLI 的 Skill 创建事务交给当前插件并回传提交结果", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-market-bridge-"))
    roots.push(root)
    const dir = path.join(root, "workspace")
    const storage = path.join(root, "storage")
    await fs.mkdir(dir)
    await fs.mkdir(storage)
    const api = vscode.workspace.fs
    const original = { ...api }
    Object.assign(api, {
      createDirectory: async (uri: vscode.Uri) => fs.mkdir(uri.fsPath, { recursive: true }),
      writeFile: async (uri: vscode.Uri, content: Uint8Array) => fs.writeFile(uri.fsPath, content),
      readFile: async (uri: vscode.Uri) => new Uint8Array(await fs.readFile(uri.fsPath)),
      rename: async (source: vscode.Uri, target: vscode.Uri, options?: { overwrite?: boolean }) => {
        if (options?.overwrite) await fs.rm(target.fsPath, { force: true })
        await fs.rename(source.fsPath, target.fsPath)
      },
      stat: async (uri: vscode.Uri) => {
        const value = await fs.stat(uri.fsPath)
        return {
          type: value.isDirectory() ? vscode.FileType.Directory : vscode.FileType.File,
          ctime: value.ctimeMs,
          mtime: value.mtimeMs,
          size: value.size,
        }
      },
    })
    restores.push(() => Object.assign(api, original))

    const replies: Array<{ requestID: string; result: SkillMarketResult }> = []
    const rejections: unknown[] = []
    const handlers: {
      event?: (event: SSEPayload, directory?: string) => void
      state?: (state: "connecting" | "connected" | "disconnected" | "error") => void
    } = {}
    const refresh = mock(async () => ({ data: true }))
    const client = {
      config: { get: mock(async () => ({ data: {} })) },
      provider: { list: mock(async () => ({ data: { all: [] } })) },
      chipmate: {
        refreshSkills: refresh,
        skillMarket: {
          list: mock(async () => ({ data: [] })),
          reply: mock(async (input: { requestID: string; result: SkillMarketResult }) => {
            replies.push(input)
            return { data: true }
          }),
          reject: mock(async (input: unknown) => {
            rejections.push(input)
            return { data: true }
          }),
        },
      },
    }
    const connection = {
      onEvent: (listener: typeof handlers.event) => {
        handlers.event = listener
        return () => {
          handlers.event = undefined
        }
      },
      onStateChange: (listener: typeof handlers.state) => {
        handlers.state = listener
        return () => {
          handlers.state = undefined
        }
      },
      getClient: () => client,
      getKnownDirectories: () => [dir],
    }
    const context = {
      globalStorageUri: vscode.Uri.file(storage),
    } as vscode.ExtensionContext
    const bridge = new SkillMarketBridge(connection as never, context)
    const send = (request: SkillMarketRequest) =>
      handlers.event?.(
        {
          id: `event-${request.id}`,
          type: "chipmate.skill_market.requested",
          properties: request,
        } as SSEPayload,
        dir,
      )

    send(create())
    await waitFor(() => replies.length === 1 || rejections.length === 1)
    expect(rejections).toEqual([])
    const id = replies[0]?.result.transactionId
    expect(id).toBeDefined()

    send(action("approve", id!))
    await waitFor(() => replies.length === 2)
    send(action("commit", id!))
    await waitFor(() => replies.length === 3)

    expect(replies[2]?.result.state).toBe("COMMITTED")
    expect(await fs.readFile(path.join(dir, ".chipmate-v2", "skills", "demo-skill", "SKILL.md"), "utf8")).toContain(
      "Demo Skill",
    )
    expect(refresh).toHaveBeenCalledWith({ directory: dir, scope: "project" })
    bridge.dispose()
  })
})

function create(): SkillMarketRequest {
  return {
    id: "smr-create",
    sessionID: "ses_test",
    key: "0123456789abcdef-create",
    operation: "prepare_create",
    skillId: "demo-skill",
    name: "Demo Skill",
    description: "用于验证插件 Bridge 的 Skill",
    scope: "project",
    replace: false,
    files: [
      {
        path: "SKILL.md",
        encoding: "utf8",
        content:
          '---\nid: "demo-skill"\nname: "Demo Skill"\ndescription: "用于验证插件 Bridge 的 Skill"\n---\n\n# Demo Skill\n',
      },
    ],
  }
}

function action(operation: "approve" | "commit", transactionId: string): SkillMarketRequest {
  return {
    id: `smr-${operation}`,
    sessionID: "ses_test",
    key: `0123456789abcdef-${operation}`,
    operation,
    transactionId,
  }
}
