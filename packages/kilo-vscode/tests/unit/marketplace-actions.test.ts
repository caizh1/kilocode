import { afterEach, describe, expect, it, mock } from "bun:test"
import * as vscode from "vscode"
import {
  installMarketplaceItem,
  removeMarketplaceItem,
  removeMarketplaceItemFromAllScopes,
  type MarketplaceActionContext,
  type MarketplaceRemoveContext,
} from "../../src/services/marketplace/actions"
import type { McpMarketplaceItem, SkillMarketplaceItem } from "../../src/services/marketplace/types"
import {
  filterItems,
  hasRelevantItems,
  installedScopes,
  retain,
} from "../../webview-ui/src/components/marketplace/utils"
import type { MarketplaceItem } from "../../webview-ui/src/types/marketplace"

const project = "/repo"
const storage = vscode.Uri.file("/storage")
const local = `${project}/.chipmate-v2/mcp.json`
const legacy = `${project}/.kilo/mcp.json`
const global = `${storage.fsPath}/settings/mcp_settings.json`
const item: McpMarketplaceItem = {
  id: "memory",
  type: "mcp",
  name: "Memory",
  description: "",
  category: "development",
  url: "",
  content: "",
}
const skill: SkillMarketplaceItem = {
  id: "documents",
  type: "skill",
  name: "Documents",
  displayName: "Documents",
  description: "Document workflows",
  category: "productivity",
  displayCategory: "Productivity",
  content: "https://example.com/documents.tar.gz",
}
const fs = vscode.workspace.fs as unknown as {
  readFile: (uri: vscode.Uri) => Promise<Uint8Array>
  writeFile: (uri: vscode.Uri, data: Uint8Array) => Promise<void>
}
const original = { readFile: fs.readFile, writeFile: fs.writeFile }

function setup() {
  const files = new Map([
    [local, JSON.stringify({ mcpServers: { memory: {}, keep: {} } })],
    [legacy, JSON.stringify({ mcpServers: { memory: {}, keep: {} } })],
    [global, JSON.stringify({ mcpServers: { memory: {}, keep: {} } })],
  ])
  fs.readFile = async (uri) => {
    const body = files.get(uri.fsPath)
    if (!body) throw new Error("missing file")
    return Buffer.from(body)
  }
  fs.writeFile = async (uri, data) => {
    files.set(uri.fsPath, Buffer.from(data).toString("utf8"))
  }
  return files
}

function has(files: Map<string, string>, file: string) {
  return !!JSON.parse(files.get(file)!).mcpServers.memory
}

function connection() {
  return {
    getClientAsync: mock(async () => ({
      global: { config: { update: mock(async () => {}) } },
      instance: { dispose: mock(async () => {}) },
    })),
  } as unknown as MarketplaceActionContext["connection"]
}

afterEach(() => {
  fs.readFile = original.readFile
  fs.writeFile = original.writeFile
})

describe("Marketplace installation metadata", () => {
  it("tracks colliding IDs independently by item type", () => {
    const metadata = {
      project: {
        "mcp:dbt": { type: "mcp" },
        "skill:dbt": { type: "skill" },
      },
      global: {},
    }

    expect(installedScopes("dbt", "mcp", metadata)).toEqual(["project"])
    expect(installedScopes("dbt", "skill", metadata)).toEqual(["project"])
    expect(installedScopes("dbt", "agent", metadata)).toEqual([])
  })

  it("removes filters that are no longer available", () => {
    expect(retain(["agent", "mcp"], ["mcp", "skill"])).toEqual(["mcp"])
  })

  it("filters the mixed list by search, category, and status", () => {
    const items: MarketplaceItem[] = [
      {
        type: "agent",
        id: "reviewer",
        name: "Code Reviewer",
        description: "Reviews code",
        category: "development",
        content: { mode: "all", description: "Reviews code", prompt: "Review" },
      },
      {
        type: "mcp",
        id: "warehouse",
        name: "Warehouse",
        description: "Queries data",
        category: "web-automation",
        url: "https://example.com",
        content: "{}",
      },
      {
        type: "skill",
        id: "campaign-writer",
        name: "Campaign Writer",
        displayName: "Campaign Writer",
        description: "Writes campaigns",
        category: "business",
        displayCategory: "Business",
        githubUrl: "https://example.com",
        content: "https://example.com/skill.tar.gz",
      },
    ]
    const metadata = { project: { "mcp:warehouse": { type: "mcp" } }, global: {} }

    expect(filterItems(items, metadata, "reviewer", "all", [], []).map((item) => item.id)).toEqual(["reviewer"])
    expect(filterItems(items, metadata, "web automation", "all", [], []).map((item) => item.id)).toEqual(["warehouse"])
    expect(
      filterItems(items, metadata, "servidor mcp", "all", [], [], { mcp: "Servidor MCP" }).map((item) => item.id),
    ).toEqual(["warehouse"])
    expect(filterItems(items, metadata, "", "all", ["business"], []).map((item) => item.id)).toEqual([
      "campaign-writer",
    ])
    expect(filterItems(items, metadata, "", "installed", [], []).map((item) => item.id)).toEqual(["warehouse"])
    expect(filterItems(items, metadata, "", "all", [], ["mcp"]).map((item) => item.id)).toEqual(["warehouse"])
    expect(
      filterItems(items, metadata, "", "all", [], [], {}, true, {
        "agent:reviewer": { filename: ["*.review.ts"] },
        "mcp:warehouse": { vscodeExtension: ["data.warehouse"] },
      }).map((item) => item.id),
    ).toEqual(["reviewer", "warehouse"])
    const relevance = { "agent:reviewer": { filename: ["*.review.ts"] } }
    expect(filterItems(items, metadata, "warehouse", "all", [], [], {}, true, relevance)).toEqual([])
    expect(hasRelevantItems(items, relevance)).toBe(true)
    expect(hasRelevantItems(items, {})).toBe(false)
  })
})

describe("Marketplace Skill cache refresh", () => {
  it("refreshes only Skill state after project installation", async () => {
    const refresh = mock(async () => ({ data: true }))
    const dispose = mock(async () => ({ data: true }))
    const ctx = {
      connection: {
        getClientAsync: mock(async () => ({
          global: { config: { update: mock(async () => {}) } },
          instance: { dispose },
          kilocode: { refreshSkills: refresh },
        })),
      },
      marketplace: { install: mock(async () => ({ success: true, slug: skill.id })) },
    } as unknown as MarketplaceActionContext

    await installMarketplaceItem(ctx, skill, { target: "project" }, project, project)

    expect(refresh).toHaveBeenCalledWith({ directory: project, scope: "project" })
    expect(dispose).not.toHaveBeenCalled()
  })

  it("refreshes all Skill caches after global removal", async () => {
    const refresh = mock(async () => ({ data: true }))
    const dispose = mock(async () => ({ data: true }))
    const update = mock(async () => ({ data: {} }))
    const remove = mock(async () => ({ success: true, slug: skill.id }))
    const ctx = {
      connection: {
        getClientAsync: mock(async () => ({
          app: {
            skills: mock(async () => ({
              data: [
                {
                  name: skill.name,
                  location: `/storage/config/skills/${skill.id}/SKILL.md`,
                },
              ],
            })),
          },
          global: { config: { update } },
          instance: { dispose },
          kilocode: { refreshSkills: refresh },
        })),
      },
      marketplace: { remove },
    } as unknown as MarketplaceActionContext

    await removeMarketplaceItem(ctx, skill, "global", project, project)

    expect(refresh).toHaveBeenCalledWith({ directory: project, scope: "global" })
    expect(remove).toHaveBeenCalledWith(skill, "global", project, `/storage/config/skills/${skill.id}/SKILL.md`)
    expect(update).not.toHaveBeenCalled()
    expect(dispose).not.toHaveBeenCalled()
  })

  it("passes the active local path so managed removal can reject a same-name Skill", async () => {
    const remove = mock(async (...args: unknown[]) => ({
      success: false,
      slug: skill.id,
      error: `rejected ${String(args[3])}`,
    }))
    const ctx = {
      connection: {
        getClientAsync: mock(async () => ({
          app: {
            skills: mock(async () => ({
              data: [{ name: skill.name, location: `/home/caizh/.agent/skills/${skill.id}/SKILL.md` }],
            })),
          },
        })),
      },
      marketplace: { remove },
    } as unknown as MarketplaceActionContext

    const result = await removeMarketplaceItem(ctx, skill, "project", project, project)

    expect(result.success).toBe(false)
    expect(remove).toHaveBeenCalledWith(skill, "project", project, `/home/caizh/.agent/skills/${skill.id}/SKILL.md`)
  })
})

describe("Marketplace legacy MCP cleanup", () => {
  it("preserves global legacy config during project removal", async () => {
    const files = setup()
    const ctx = {
      connection: connection(),
      marketplace: { remove: mock(async () => ({ success: true, slug: item.id })) },
      storage,
    } as unknown as MarketplaceActionContext

    await removeMarketplaceItem(ctx, item, "project", project, project)

    expect(has(files, local)).toBe(false)
    expect(has(files, legacy)).toBe(true)
    expect(has(files, global)).toBe(true)
  })

  it("preserves project legacy config during global removal", async () => {
    const files = setup()
    const ctx = {
      connection: connection(),
      marketplace: { remove: mock(async () => ({ success: true, slug: item.id })) },
      storage,
    } as unknown as MarketplaceActionContext

    await removeMarketplaceItem(ctx, item, "global", project, project)

    expect(has(files, local)).toBe(true)
    expect(has(files, legacy)).toBe(true)
    expect(has(files, global)).toBe(false)
  })

  it("removes ChipMate v2 project and global config without touching official Kilo", async () => {
    const files = setup()
    const ctx = {
      connection: connection(),
      remove: mock(async () => ({ success: true, slug: item.id })),
      storage,
    } as MarketplaceRemoveContext

    await removeMarketplaceItemFromAllScopes(ctx, item, project, project)

    expect(has(files, local)).toBe(false)
    expect(has(files, legacy)).toBe(true)
    expect(has(files, global)).toBe(false)
  })
})
