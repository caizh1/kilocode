import { afterEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import {
  migrateLegacyProductState,
  migrateModelRef,
  migrateVariantKeys,
} from "../../src/migration/legacy-product-state"

const configuration = vscode.workspace.getConfiguration
const folders = vscode.workspace.workspaceFolders

afterEach(() => {
  ;(vscode.workspace as unknown as { getConfiguration: typeof configuration }).getConfiguration = configuration
  ;(vscode.workspace as unknown as { workspaceFolders: typeof folders }).workspaceFolders = folders
})

describe("旧产品状态迁移", () => {
  it("只迁移结构化模型引用，不修改无关值", () => {
    expect(migrateModelRef({ providerID: "kilo", modelID: "m", label: "keep kilo in text" })).toEqual({
      providerID: "chipmate",
      modelID: "m",
      label: "keep kilo in text",
    })
    expect(migrateVariantKeys({ "kilo/m": "high", "agent/code/kilo/m": "max" })).toEqual({
      "chipmate/m": "high",
      "agent/code/chipmate/m": "max",
    })
  })

  it("在索引初始化前迁移各设置层级和 globalState", async () => {
    const updates: Array<[string, string, unknown, vscode.ConfigurationTarget]> = []
    const values = new Map<string, unknown>([
      ["recentModels", [{ providerID: "kilo", modelID: "m" }]],
      ["favoriteModels", [{ providerID: "chipmate", modelID: "n" }]],
      ["variantSelections", { "kilo/m": "high" }],
      ["kilo.legacyMigrationStatus", "completed"],
    ])
    const inspections = new Map<string, Record<string, unknown>>([
      [
        "chipmate.v2.model:providerID",
        { globalValue: "kilo", workspaceValue: "chipmate", workspaceFolderValue: "kilo" },
      ],
      [
        "chipmate.v2.autocomplete:provider",
        { globalValue: "kilo", workspaceValue: "kilo", workspaceFolderValue: "kilo" },
      ],
      [
        "chipmate.v2.comments:model",
        { globalValue: "kilo/m", workspaceValue: "chipmate/n", workspaceFolderValue: "kilo/m" },
      ],
    ])
    const folder = { uri: vscode.Uri.file("/tmp/workspace") } as vscode.WorkspaceFolder
    ;(vscode.workspace as unknown as { workspaceFolders: vscode.WorkspaceFolder[] }).workspaceFolders = [folder]
    ;(vscode.workspace as unknown as { getConfiguration: typeof configuration }).getConfiguration = ((
      section: string,
      scope?: vscode.Uri,
    ) => ({
      inspect(key: string) {
        const info = inspections.get(`${section}:${key}`)
        if (!info) return undefined
        return scope ? { workspaceFolderValue: info.workspaceFolderValue } : info
      },
      async update(key: string, value: unknown, target: vscode.ConfigurationTarget) {
        updates.push([section, key, value, target])
      },
    })) as typeof configuration

    const context = {
      globalState: {
        get: (key: string) => values.get(key),
        update: async (key: string, value: unknown) => void values.set(key, value),
      },
    } as unknown as vscode.ExtensionContext

    await migrateLegacyProductState(context)

    expect(updates).toEqual([
      ["chipmate.v2.model", "providerID", "chipmate", vscode.ConfigurationTarget.Global],
      ["chipmate.v2.autocomplete", "provider", "chipmate", vscode.ConfigurationTarget.Global],
      ["chipmate.v2.autocomplete", "provider", "chipmate", vscode.ConfigurationTarget.Workspace],
      ["chipmate.v2.comments", "model", "chipmate/m", vscode.ConfigurationTarget.Global],
      ["chipmate.v2.model", "providerID", "chipmate", vscode.ConfigurationTarget.WorkspaceFolder],
      ["chipmate.v2.autocomplete", "provider", "chipmate", vscode.ConfigurationTarget.WorkspaceFolder],
      ["chipmate.v2.comments", "model", "chipmate/m", vscode.ConfigurationTarget.WorkspaceFolder],
    ])
    expect(values.get("recentModels")).toEqual([{ providerID: "chipmate", modelID: "m" }])
    expect(values.get("favoriteModels")).toEqual([{ providerID: "chipmate", modelID: "n" }])
    expect(values.get("variantSelections")).toEqual({ "chipmate/m": "high" })
    expect(values.get("chipmate.legacyMigrationStatus")).toBe("completed")
  })

  it("设置迁移失败不会阻塞扩展激活并继续迁移 globalState", async () => {
    const values = new Map<string, unknown>([["recentModels", [{ providerID: "kilo", modelID: "m" }]]])
    ;(vscode.workspace as unknown as { workspaceFolders: vscode.WorkspaceFolder[] }).workspaceFolders = []
    ;(vscode.workspace as unknown as { getConfiguration: typeof configuration }).getConfiguration = (() => ({
      inspect: () => ({ globalValue: "kilo" }),
      update: async () => {
        throw new Error("read-only")
      },
    })) as typeof configuration
    const context = {
      globalState: {
        get: (key: string) => values.get(key),
        update: async (key: string, value: unknown) => void values.set(key, value),
      },
    } as unknown as vscode.ExtensionContext

    await expect(migrateLegacyProductState(context)).resolves.toBeUndefined()

    expect(values.get("recentModels")).toEqual([{ providerID: "chipmate", modelID: "m" }])
  })
})
