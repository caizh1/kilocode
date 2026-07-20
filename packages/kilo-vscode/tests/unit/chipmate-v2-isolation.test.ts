import { describe, expect, it, mock } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import * as vscode from "vscode"
import { isolate } from "../../src/chipmate/storage"
import { resolveManagedServerEnv } from "../../src/services/cli-backend/server-manager"

const root = path.resolve(import.meta.dir, "../..")

function state(values: Record<string, unknown> = {}) {
  return {
    keys: () => Object.keys(values),
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
    update: async (key: string, value: unknown) => {
      if (value === undefined) delete values[key]
      else values[key] = value
    },
    setKeysForSync: mock(() => {}),
  }
}

describe("ChipMate v2 coexistence boundary", () => {
  it("gives official Kilo exclusive ownership of autocomplete at runtime", () => {
    const coexistence = fs.readFileSync(path.join(root, "src/chipmate/coexistence.ts"), "utf8")
    const extension = fs.readFileSync(path.join(root, "src/extension.ts"), "utf8")
    const autocomplete = fs.readFileSync(path.join(root, "src/services/autocomplete/index.ts"), "utf8")

    expect(coexistence).toContain('const OFFICIAL = "kilocode.kilo-code"')
    expect(coexistence).toContain("onDidChangeAutocomplete")
    expect(extension).toContain("if (coexistence.autocomplete()) ensureBackendForAutocomplete")
    expect(extension).toContain("registerAutocompleteProvider(context, connectionService, coexistence)")
    expect(autocomplete).toContain("if (!this.gate.autocomplete())")
    expect(autocomplete.match(/if \(gate && !gate\.autocomplete\(\)\) return/g)).toHaveLength(3)
  })

  it("does not expose legacy migration UI or legacy marketplace paths", () => {
    const app = fs.readFileSync(path.join(root, "webview-ui/src/App.tsx"), "utf8")
    const about = fs.readFileSync(path.join(root, "webview-ui/src/components/settings/AboutKiloCodeTab.tsx"), "utf8")
    const install = fs.readFileSync(path.join(root, "webview-ui/src/components/marketplace/InstallModal.tsx"), "utf8")

    expect(app).not.toContain("MigrationWizard")
    expect(about).not.toContain("onMigrationClick")
    expect(install).toContain('target === "project" ? ".chipmate-v2" : "ChipMate global storage"')
    expect(install).toContain("msg.filePath ?? request.path")
    expect(install).not.toContain('target === "project" ? ".kilo"')
  })

  it("keeps all contributed public IDs in the chipmate.v2 namespace", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
    const commands = (pkg.contributes.commands ?? []).map((item: { command: string }) => item.command)
    const configs = Object.keys(pkg.contributes.configuration.properties ?? {})
    const tasks = (pkg.contributes.taskDefinitions ?? []).map((item: { type: string }) => item.type)

    expect(commands.every((id: string) => id.startsWith("chipmate.v2."))).toBe(true)
    expect(configs.every((id) => id.startsWith("chipmate.v2."))).toBe(true)
    expect(tasks).toEqual(["chipmate-v2-worktree-setup"])
    expect(fs.readFileSync(path.join(root, "src/agent-manager/run/task.ts"), "utf8")).toContain(
      'type: "chipmate-v2-worktree-run"',
    )
    expect(pkg.contributes.icons["chipmate-v2-logo"]).toBeDefined()
    expect(pkg.contributes.viewsContainers.activitybar[0].id).toBe("chipmate-v2-activitybar")
    expect(pkg.contributes.views["chipmate-v2-activitybar"][0].id).toBe("chipmate.v2.SidebarProvider")

    const bindings = (pkg.contributes.keybindings ?? []).filter((item: { command: string }) =>
      item.command.startsWith("chipmate.v2.autocomplete."),
    )
    expect(bindings).toHaveLength(5)
    expect(bindings.every((item: { when?: string }) => item.when?.includes("chipmate.v2.globalShortcutsActive"))).toBe(
      true,
    )
  })

  it("isolates extension state, secrets, and storage under v2", async () => {
    const global = state({ "chipmate.v2.saved": 1, official: 2 })
    const workspace = state()
    const secrets = new Map<string, string>()
    const context = Object.defineProperties(
      {},
      {
        globalState: { enumerable: true, value: global },
        workspaceState: { enumerable: true, value: workspace },
        secrets: {
          enumerable: true,
          value: {
            get: async (key: string) => secrets.get(key),
            store: async (key: string, value: string) => void secrets.set(key, value),
            delete: async (key: string) => void secrets.delete(key),
            onDidChange: () => ({ dispose() {} }),
          },
        },
        globalStorageUri: { enumerable: true, value: vscode.Uri.file("/tmp/chipmate-storage") },
        storageUri: { enumerable: true, value: vscode.Uri.file("/tmp/chipmate-workspace") },
      },
    ) as vscode.ExtensionContext

    const scoped = isolate(context)
    expect(scoped.globalStorageUri.fsPath).toBe(path.join("/tmp/chipmate-storage", "v2"))
    expect(scoped.storageUri?.fsPath).toBe(path.join("/tmp/chipmate-workspace", "v2"))
    expect(scoped.globalState.keys()).toEqual(["saved"])
    expect(scoped.globalState.get("saved")).toBe(1)
    expect(scoped.globalState.get("official")).toBeUndefined()
    await scoped.workspaceState.update("panel", "open")
    expect(workspace.get("chipmate.v2.panel")).toBe("open")
    await scoped.secrets.store("token", "secret")
    expect(secrets.get("chipmate.v2.token")).toBe("secret")
  })

  it("drops inherited state/config paths before spawning the CLI", () => {
    const env = resolveManagedServerEnv(
      {
        KILO_CONFIG: "/official/kilo.jsonc",
        KILO_CONFIG_CONTENT: "{}",
        KILO_CONFIG_DIR: "/official/config",
        KILO_DB: "/official/kilo.db",
        KILO_TUI_CONFIG: "/official/tui.json",
        KILO_ZED_DB: "/official/zed.db",
        PATH: "/usr/bin",
      },
      "/tmp/chipmate-storage/v2",
    )

    expect(env).toMatchObject({
      KILO_PRODUCT_PROFILE: "chipmate-v2",
      KILO_STORAGE_ROOT: "/tmp/chipmate-storage/v2",
      KILO_VSCODE_GLOBAL_STORAGE: "/tmp/chipmate-storage/v2",
      PATH: "/usr/bin",
    })
    for (const key of [
      "KILO_CONFIG",
      "KILO_CONFIG_CONTENT",
      "KILO_CONFIG_DIR",
      "KILO_DB",
      "KILO_TUI_CONFIG",
      "KILO_ZED_DB",
    ])
      expect(env[key]).toBeUndefined()
  })
})
