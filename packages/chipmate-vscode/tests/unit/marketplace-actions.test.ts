import { afterEach, describe, expect, it, mock } from "bun:test"
import * as path from "path"
import * as vscode from "vscode"
import {
  activatableSkillIds,
  activateMarketplaceSkills,
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
const legacy = `${project}/.chipmate/mcp.json`
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
  it("activates newly installed and unchanged local Skills", () => {
    expect(
      activatableSkillIds([
        { id: "new-skill", status: "installed" },
        { id: "existing-skill", status: "unchanged" },
        { id: "skipped-skill", status: "skipped" },
        { id: "failed-skill", status: "failed" },
      ]),
    ).toEqual(["new-skill", "existing-skill"])
  })

  it("verifies local Skills after a strict refresh", async () => {
    const refresh = mock(async () => ({ data: true }))
    const skills = mock(async () => ({
      data: [
        { name: "new-skill", location: "/repo/.chipmate-v2/skills/new-skill/SKILL.md" },
        { name: "Existing Skill", location: "/repo/.chipmate-v2/skills/existing-skill/SKILL.md" },
      ],
    }))
    const ctx = {
      connection: {
        getClientAsync: mock(async () => ({ app: { skills }, chipmate: { refreshSkills: refresh } })),
      },
    } as unknown as MarketplaceActionContext

    const result = await activateMarketplaceSkills(ctx, "project", project, ["new-skill", "existing-skill"])

    expect(result).toEqual({ status: "ready" })
    expect(refresh).toHaveBeenCalledWith({ directory: project, scope: "project" }, { throwOnError: true })
    expect(skills).toHaveBeenCalledWith({ directory: project }, { throwOnError: true })
  })

  it("reports the actual refresh request error safely", async () => {
    const ctx = {
      connection: {
        getClientAsync: mock(async () => ({
          app: { skills: mock(async () => ({ data: [] })) },
          chipmate: {
            refreshSkills: mock(async () => {
              throw new Error("HTTP 500 at https://internal.example/refresh using sk-secret123")
            }),
          },
        })),
      },
    } as unknown as MarketplaceActionContext

    const result = await activateMarketplaceSkills(ctx, "project", project, ["new-skill"])

    expect(result).toEqual({
      status: "failed",
      phase: "refresh-request",
      message: "HTTP 500 at <url> using sk-<redacted>",
    })
  })

  it("reports missing Skill IDs when refresh succeeds with stale discovery", async () => {
    const dispose = mock(async () => ({ data: true }))
    const ctx = {
      connection: {
        getClientAsync: mock(async () => ({
          app: {
            skills: mock(async () => ({
              data: [{ name: "new-skill", location: "/repo/.chipmate-v2/skills/new-skill/SKILL.md" }],
            })),
          },
          chipmate: { refreshSkills: mock(async () => ({ data: true })) },
          instance: { dispose },
        })),
      },
    } as unknown as MarketplaceActionContext

    const result = await activateMarketplaceSkills(ctx, "project", project, ["new-skill", "missing-skill"])

    expect(result).toEqual({
      status: "failed",
      phase: "post-refresh-verification",
      missingIds: ["missing-skill"],
    })
    expect(dispose).toHaveBeenCalledWith({ directory: project }, { throwOnError: true })
  })

  it("refreshes only Skill state after project installation", async () => {
    const refresh = mock(async () => ({ data: true }))
    const dispose = mock(async () => ({ data: true }))
    const ctx = {
      connection: {
        getClientAsync: mock(async () => ({
          app: {
            skills: mock(async () => ({
              data: [{ name: skill.id, location: `${project}/.chipmate-v2/skills/${skill.id}/SKILL.md` }],
            })),
          },
          global: { config: { update: mock(async () => {}) } },
          instance: { dispose },
          chipmate: { refreshSkills: refresh },
        })),
      },
      marketplace: {
        install: mock(async () => ({
          success: true,
          slug: skill.id,
          filePath: `${project}/.chipmate-v2/skills/${skill.id}/SKILL.md`,
        })),
      },
    } as unknown as MarketplaceActionContext

    const result = await installMarketplaceItem(ctx, skill, { target: "project" }, project, project)

    expect(result.success).toBe(true)
    expect(refresh).toHaveBeenCalledWith({ directory: project, scope: "project" }, { throwOnError: true })
    expect(dispose).not.toHaveBeenCalled()
  })

  it("returns installation success only after rebuilding a stale CLI instance and finding the exact location", async () => {
    const location = `${project}/.chipmate-v2/skills/${skill.id}/SKILL.md`
    const state = { calls: 0 }
    const dispose = mock(async () => ({ data: true }))
    const skills = mock(async () => {
      state.calls += 1
      return {
        data:
          state.calls === 1
            ? []
            : [{ name: skill.id, location }],
      }
    })
    const ctx = {
      connection: {
        getClientAsync: mock(async () => ({
          app: { skills },
          chipmate: { refreshSkills: mock(async () => ({ data: true })) },
          instance: { dispose },
        })),
      },
      marketplace: {
        install: mock(async () => ({ success: true, slug: skill.id, filePath: location })),
      },
    } as unknown as MarketplaceActionContext

    const result = await installMarketplaceItem(ctx, skill, { target: "project" }, project, project)

    expect(result.success).toBe(true)
    expect(dispose).toHaveBeenCalledWith({ directory: project }, { throwOnError: true })
    expect(skills).toHaveBeenCalledTimes(2)
  })

  it("revalidates the selected physical instance and scope before update", async () => {
    const install = mock(async () => ({ success: true, slug: skill.id }))
    const selected = {
      ...skill,
      instanceId: "project:documents",
      localScope: "project" as const,
      localLocation: "/repo/.chipmate-v2/skills/documents/SKILL.md",
      localSha256: "a".repeat(64),
    }
    const ctx = {
      connection: {
        getClientAsync: mock(async () => ({
          app: { skills: mock(async () => ({ data: [{ name: skill.id, location: selected.localLocation }] })) },
          chipmate: { refreshSkills: mock(async () => ({ data: true })) },
          instance: { dispose: mock(async () => ({ data: true })) },
        })),
      },
      marketplace: {
        skillInstance: mock(async () => ({
          instanceId: selected.instanceId,
          id: selected.id,
          name: selected.id,
          scope: selected.localScope,
          root: path.dirname(selected.localLocation),
          location: selected.localLocation,
          sha256: selected.localSha256,
          effective: true,
        })),
        install,
      },
    } as unknown as MarketplaceActionContext

    expect(await installMarketplaceItem(ctx, selected, { target: "project" }, project, project)).toMatchObject({
      success: true,
    })
    expect(install).toHaveBeenCalledWith(selected, { target: "project" }, project)

    expect(await installMarketplaceItem(ctx, selected, { target: "global" }, project, project)).toMatchObject({
      success: false,
      error: "Skill scope does not match the selected instance",
    })
    const stale = { ...selected, localSha256: "b".repeat(64) }
    expect(await installMarketplaceItem(ctx, stale, { target: "project" }, project, project)).toMatchObject({
      success: false,
      error: "Skill changed after the Marketplace list was loaded",
    })
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
          chipmate: { refreshSkills: refresh },
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

  it("revalidates the selected physical instance and hash before removal", async () => {
    const remove = mock(async () => ({ success: true, slug: skill.id }))
    const selected = {
      ...skill,
      instanceId: "global:documents",
      localScope: "global" as const,
      localLocation: "/storage/config/skills/documents/SKILL.md",
      localSha256: "a".repeat(64),
    }
    const ctx = {
      connection: {
        getClientAsync: mock(async () => ({ chipmate: { refreshSkills: mock(async () => ({ data: true })) } })),
      },
      marketplace: {
        skillInstance: mock(async () => ({
          instanceId: "global:documents",
          id: "documents",
          name: "documents",
          scope: "global",
          root: "/storage/config/skills/documents",
          location: selected.localLocation,
          sha256: selected.localSha256,
          effective: false,
        })),
        remove,
      },
    } as unknown as MarketplaceActionContext

    expect(await removeMarketplaceItem(ctx, selected, "global", project, project)).toMatchObject({ success: true })
    expect(remove).toHaveBeenCalledWith(selected, "global", project, selected.localLocation)

    const stale = { ...selected, localSha256: "b".repeat(64) }
    expect(await removeMarketplaceItem(ctx, stale, "global", project, project)).toMatchObject({
      success: false,
      error: "Skill changed after the Marketplace list was loaded",
    })
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

  it("removes ChipMate v2 project and global config without touching official ChipMate", async () => {
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
