import { afterEach, describe, expect, it } from "bun:test"
import * as vscode from "vscode"
import {
  QWEN_DEFAULT_STATE,
  buildAutocompleteSettingsMessage,
  resetAutocompleteAfterProviderRemoval,
  updateAutocompleteSelection,
} from "../../src/services/autocomplete/settings"
import {
  autocompleteAutomaticLabel,
  autocompleteSelectionLabel,
  qwenAutocompleteModels,
} from "../../webview-ui/src/components/settings/autocomplete-model-selector"
import { buildAutocompleteSettingMessages } from "../../webview-ui/src/context/autocomplete-settings"
import { autocompleteDirectory } from "../../src/services/autocomplete/workspace"

const original = vscode.workspace.getConfiguration
const originalFolders = vscode.workspace.workspaceFolders
const originalFolder = vscode.workspace.getWorkspaceFolder

afterEach(() => {
  ;(vscode.workspace as unknown as { getConfiguration: typeof original }).getConfiguration = original
  ;(vscode.workspace as unknown as { workspaceFolders: typeof originalFolders }).workspaceFolders = originalFolders
  ;(vscode.workspace as unknown as { getWorkspaceFolder: typeof originalFolder }).getWorkspaceFolder = originalFolder
})

describe("autocomplete selection settings", () => {
  it("keeps Automatic distinct from real Qwen models", () => {
    const models = qwenAutocompleteModels([
      {
        id: "qwen-coder-30b0",
        name: "Raw model name",
        providerID: "completion",
        providerName: "completion",
      },
    ] as never)

    expect(models).toMatchObject([
      {
        id: "qwen-coder-30b0",
        name: "Qwen Coder FIM",
        providerID: "completion",
        providerName: "completion",
      },
    ])
    expect(autocompleteAutomaticLabel(true, "qwen-coder-30b0")).toBe("Automatic — Prefer Qwen → Qwen Coder FIM")
    expect(autocompleteAutomaticLabel(true, "mistralai/codestral-2508")).toBe("Automatic — Prefer Qwen → Codestral")
    expect(autocompleteAutomaticLabel(false, "qwen-coder-30b0")).toBe("Automatic — Prefer Qwen")
    expect(autocompleteSelectionLabel(true, "qwen-coder-30b0")).toBe("Automatic → Qwen Coder FIM")
    expect(autocompleteSelectionLabel(true, "mistralai/codestral-2508")).toBe("Automatic → Codestral")
    expect(autocompleteSelectionLabel(false, "qwen-coder-30b0")).toBe("Explicit → Qwen Coder FIM")
  })

  it("writes an explicit provider/model pair to the existing workspace-folder scope", async () => {
    const cfg = config("workspace-folder", { provider: "previous" })
    const ctx = context()

    await updateAutocompleteSelection(ctx.value, {
      providerID: "qwen",
      modelID: "qwen-coder-30b0",
      automatic: false,
    })

    expect(cfg.values).toEqual({ provider: "qwen", model: "qwen-coder-30b0" })
    expect(cfg.updates).toEqual([
      ["provider", "qwen", vscode.ConfigurationTarget.WorkspaceFolder],
      ["model", "qwen-coder-30b0", vscode.ConfigurationTarget.WorkspaceFolder],
    ])
    expect(ctx.data.get(QWEN_DEFAULT_STATE)).toBe(false)
  })

  it("keeps provider and model together at global, workspace, and workspace-folder scope", async () => {
    for (const scope of ["global", "workspace", "workspace-folder"] as const) {
      const cfg = config(scope, { provider: "old", model: "old-model" })
      const ctx = context()

      await updateAutocompleteSelection(ctx.value, {
        providerID: "qwen",
        modelID: "qwen-coder-30b0",
        automatic: false,
      })

      expect(cfg.values).toEqual({ provider: "qwen", model: "qwen-coder-30b0" })
      expect(new Set(cfg.updates.map((item) => item[2]))).toEqual(
        new Set([
          scope === "global"
            ? vscode.ConfigurationTarget.Global
            : scope === "workspace"
              ? vscode.ConfigurationTarget.Workspace
              : vscode.ConfigurationTarget.WorkspaceFolder,
        ]),
      )
    }
  })

  it("clears only the effective selection scope when switching to Automatic", async () => {
    const cfg = config("workspace", { provider: "qwen", model: "qwen-coder-30b0" })
    const ctx = context([[QWEN_DEFAULT_STATE, false]])

    await updateAutocompleteSelection(ctx.value, { automatic: true })

    expect(cfg.values).toEqual({})
    expect(cfg.updates).toEqual([
      ["provider", undefined, vscode.ConfigurationTarget.Workspace],
      ["model", undefined, vscode.ConfigurationTarget.Workspace],
    ])
    expect(ctx.data.get(QWEN_DEFAULT_STATE)).toBe(true)
  })

  it("switches to Automatic only when the removed Provider is selected", async () => {
    const cfg = config("global", { provider: "qwen", model: "qwen-coder-30b0" })
    const ctx = context([[QWEN_DEFAULT_STATE, false]])

    expect(await resetAutocompleteAfterProviderRemoval(ctx.value, "other")).toBe(false)
    expect(cfg.updates).toEqual([])
    expect(await resetAutocompleteAfterProviderRemoval(ctx.value, "qwen")).toBe(true)
    expect(cfg.values).toEqual({})
    expect(ctx.data.get(QWEN_DEFAULT_STATE)).toBe(true)
  })

  it("reports automatic origin and the effective configuration source", () => {
    config("global", { provider: "qwen", model: "qwen-coder-30b0" })
    const ctx = context([[QWEN_DEFAULT_STATE, true]])

    expect(buildAutocompleteSettingsMessage(ctx.value).settings).toMatchObject({
      provider: "qwen",
      model: "qwen-coder-30b0",
      automatic: true,
      scope: "global",
    })
  })

  it("rejects incomplete explicit and automatic target pairs", async () => {
    config("none")
    const ctx = context()

    await expect(
      updateAutocompleteSelection(ctx.value, {
        providerID: "qwen",
        automatic: false,
      }),
    ).rejects.toThrow("provider and model are required")
    await expect(
      updateAutocompleteSelection(ctx.value, {
        providerID: "qwen",
        automatic: true,
      }),
    ).rejects.toThrow("must contain both provider and model")
  })

  it("sends one request transaction for a complete autocomplete selection pair", () => {
    expect(
      buildAutocompleteSettingMessages(
        {
          "autocomplete.provider": "qwen",
          "autocomplete.model": "qwen-coder-30b0",
          "autocomplete.enableAutoTrigger": true,
        },
        {},
        "request-1",
      ),
    ).toEqual([
      {
        type: "updateAutocompleteSelection",
        providerID: "qwen",
        modelID: "qwen-coder-30b0",
        automatic: false,
        requestId: "request-1",
      },
      {
        type: "updateSetting",
        key: "autocomplete.enableAutoTrigger",
        value: true,
        requestId: "request-1",
      },
    ])
    expect(
      buildAutocompleteSettingMessages({ "autocomplete.provider": null, "autocomplete.model": null }, {}, "request-2"),
    ).toEqual([
      {
        type: "updateAutocompleteSelection",
        providerID: null,
        modelID: null,
        automatic: true,
        requestId: "request-2",
      },
    ])
  })

  it("routes multi-root autocomplete through the document folder and safely handles no workspace", () => {
    const first = { uri: { fsPath: "/first" } } as vscode.WorkspaceFolder
    const second = { uri: { fsPath: "/second" } } as vscode.WorkspaceFolder
    ;(vscode.workspace as unknown as { workspaceFolders: vscode.WorkspaceFolder[] }).workspaceFolders = [first, second]
    ;(vscode.workspace as unknown as { getWorkspaceFolder: typeof originalFolder }).getWorkspaceFolder = () => second

    expect(autocompleteDirectory({ uri: { fsPath: "/second/main.c" } } as vscode.TextDocument)).toBe("/second")
    ;(vscode.workspace as unknown as { getWorkspaceFolder: typeof originalFolder }).getWorkspaceFolder = () => undefined
    expect(autocompleteDirectory({ uri: { fsPath: "/outside/main.c" } } as vscode.TextDocument)).toBe("/first")
    ;(vscode.workspace as unknown as { workspaceFolders: vscode.WorkspaceFolder[] | undefined }).workspaceFolders =
      undefined
    expect(autocompleteDirectory()).toBeUndefined()
  })
})

function config(
  scope: "global" | "workspace" | "workspace-folder" | "none",
  initial: { provider?: string; model?: string } = {},
) {
  const values = { ...initial }
  const updates: Array<[string, string | undefined, vscode.ConfigurationTarget]> = []
  const detail = (name: "provider" | "model") => ({
    key: `chipmate.v2.autocomplete.${name}`,
    globalValue: scope === "global" ? values[name] : undefined,
    workspaceValue: scope === "workspace" ? values[name] : undefined,
    workspaceFolderValue: scope === "workspace-folder" ? values[name] : undefined,
  })
  ;(vscode.workspace as unknown as { getConfiguration: typeof original }).getConfiguration = () =>
    ({
      get: (name: "provider" | "model", fallback?: unknown) => values[name] ?? fallback,
      inspect: (name: "provider" | "model") => detail(name),
      update: async (name: "provider" | "model", value: string | undefined, target: vscode.ConfigurationTarget) => {
        updates.push([name, value, target])
        if (value === undefined) delete values[name]
        else values[name] = value
      },
    }) as unknown as vscode.WorkspaceConfiguration
  return { values, updates }
}

function context(initial: Array<[string, unknown]> = []) {
  const data = new Map(initial)
  return {
    data,
    value: {
      globalState: {
        get: (name: string, fallback?: unknown) => data.get(name) ?? fallback,
        update: async (name: string, value: unknown) => {
          data.set(name, value)
        },
      },
    } as unknown as vscode.ExtensionContext,
  }
}
