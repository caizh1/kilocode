import os from "os"
import path from "path"
import { unique } from "remeda"
import z from "zod"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { Auth } from "@/auth"
import { ConfigManaged } from "@/config/managed"
import { Filesystem } from "@/util/filesystem"
import { ChipMateConfig } from "./config"
import { ProductProfile } from "../product-profile"

export namespace ChipMateConfigSources {
  export const Scope = z.enum(["global", "project", "env", "managed", "cloud"])
  export type Scope = z.infer<typeof Scope>

  export const Kind = z.enum([
    "remote-wellknown",
    "global-file",
    "env-file",
    "project-file",
    "config-dir",
    "config-dir-file",
    "env-content",
    "cloud-org",
    "managed-dir",
    "managed-file",
    "managed-preferences",
    "runtime-env",
  ])
  export type Kind = z.infer<typeof Kind>

  export const Source = z.object({
    order: z.number().int().nonnegative(),
    kind: Kind,
    scope: Scope,
    label: z.string(),
    source: z.string(),
    path: z.string().optional(),
    exists: z.boolean(),
    editable: z.boolean(),
    reason: z.string().optional(),
  })
  export type Source = z.infer<typeof Source>

  export const Result = z.object({
    sources: Source.array(),
  })
  export type Result = z.infer<typeof Result>

  type Input = {
    directory: string
    worktree?: string
    auth?: Record<string, Auth.Info>
    account?: { url: string; active_org_id?: string | null }
  }

  type Pending = Omit<Source, "order">

  const roots = ProductProfile.dirs
  const global = ProductProfile.chipmate
    ? (["chipmate.jsonc"] as const)
    : (["config.json", "chipmate.json", "chipmate.jsonc", "opencode.json", "opencode.jsonc"] as const)

  export async function list(input: Input): Promise<Result> {
    const project = Flag.CHIPMATE_DISABLE_PROJECT_CONFIG ? [] : await projectSources(input)
    const dirs = Flag.CHIPMATE_DISABLE_PROJECT_CONFIG ? [] : await configDirSources(input)
    const sources = [
      ...wellknownSources(input.auth ?? {}),
      ...(await globalSources()),
      ...(await envFileSources()),
      ...project,
      ...dirs,
      ...envContentSources(),
      ...cloudSources(input.account),
      ...(await managedSources()),
      ...runtimeSources(),
    ]

    return {
      sources: sources.map((item, order) => ({ order, ...item })),
    }
  }

  function wellknownSources(auth: Record<string, Auth.Info>): Pending[] {
    return Object.entries(auth)
      .filter(([, value]) => value.type === "wellknown")
      .map(([key]) => {
        const url = key.replace(/\/+$/, "")
        return {
          kind: "remote-wellknown",
          scope: "cloud",
          label: "Remote well-known config",
          source: `${url}/.well-known/opencode`,
          exists: true,
          editable: false,
          reason: "Configured through auth storage; token values are not exposed.",
        }
      })
  }

  async function globalSources(): Promise<Pending[]> {
    const root = ProductProfile.config() ?? Global.Path.config
    return Promise.all(
      global.map(async (name) => {
        const file = path.join(root, name)
        return fileSource({ kind: "global-file", scope: "global", label: `Global ${name}`, file })
      }),
    )
  }

  async function envFileSources(): Promise<Pending[]> {
    if (!Flag.CHIPMATE_CONFIG) return []
    return [
      await fileSource({
        kind: "env-file",
        scope: "env",
        label: "CHIPMATE_CONFIG",
        file: Flag.CHIPMATE_CONFIG,
        reason: "Explicit config file from CHIPMATE_CONFIG.",
      }),
    ]
  }

  async function projectSources(input: Input): Promise<Pending[]> {
    if (ProductProfile.chipmate) return []
    const chipmate = await projectFiles("chipmate", input)
    const opencode = await projectFiles("opencode", input)
    return Promise.all(
      [...chipmate, ...opencode].map((file) =>
        fileSource({ kind: "project-file", scope: "project", label: "Project config", file }),
      ),
    )
  }

  async function projectFiles(name: string, input: Input) {
    return (await Filesystem.findUp([`${name}.jsonc`, `${name}.json`], input.directory, input.worktree)).toReversed()
  }

  async function configDirSources(input: Input): Promise<Pending[]> {
    const project = await Filesystem.findUp([...roots], input.directory, input.worktree)
    const home = ProductProfile.chipmate ? [] : await Filesystem.findUp([...roots], Global.Path.home, Global.Path.home)
    const env = Flag.CHIPMATE_CONFIG_DIR ? [Flag.CHIPMATE_CONFIG_DIR] : []
    const dirs = unique([ProductProfile.config() ?? Global.Path.config, ...project, ...home, ...env]).filter((dir) =>
      ChipMateConfig.isConfigDir(dir, Flag.CHIPMATE_CONFIG_DIR),
    )

    const result: Pending[] = []
    for (const dir of dirs) {
      const scope = dirScope(dir, { project, home })
      result.push({
        kind: "config-dir",
        scope,
        label: "Config directory",
        source: dir,
        path: dir,
        exists: await Bun.file(dir).exists(),
        editable: scope !== "managed" && scope !== "cloud",
      })

      for (const name of ChipMateConfig.ACTIVE_CONFIG_FILES) {
        const file = path.join(dir, name)
        result.push(await fileSource({ kind: "config-dir-file", scope, label: `Config directory ${name}`, file }))
      }
    }
    return result
  }

  function dirScope(dir: string, input: { project: string[]; home: string[] }): Scope {
    if (dir === Flag.CHIPMATE_CONFIG_DIR) return "env"
    if (input.project.includes(dir)) return "project"
    if (input.home.includes(dir)) return "global"
    return "global"
  }

  function envContentSources(): Pending[] {
    const sources: Pending[] = []
    if (process.env.CHIPMATE_CONFIG_CONTENT) {
      sources.push({
        kind: "env-content",
        scope: "env",
        label: "CHIPMATE_CONFIG_CONTENT",
        source: "CHIPMATE_CONFIG_CONTENT",
        exists: true,
        editable: false,
        reason: "Inline config content from the process environment; value is not exposed.",
      })
    }
    if (Flag.CHIPMATE_CONFIG_DIR) {
      sources.push({
        kind: "runtime-env",
        scope: "env",
        label: "CHIPMATE_CONFIG_DIR",
        source: "CHIPMATE_CONFIG_DIR",
        path: Flag.CHIPMATE_CONFIG_DIR,
        exists: true,
        editable: false,
        reason: "Adds an extra config directory to the load chain.",
      })
    }
    if (Flag.CHIPMATE_DISABLE_PROJECT_CONFIG) {
      sources.push({
        kind: "runtime-env",
        scope: "env",
        label: "CHIPMATE_DISABLE_PROJECT_CONFIG",
        source: "CHIPMATE_DISABLE_PROJECT_CONFIG",
        exists: true,
        editable: false,
        reason: "Project-level config files and directories are disabled for this process.",
      })
    }
    return sources
  }

  function cloudSources(account: Input["account"]): Pending[] {
    if (!account?.active_org_id) return []
    return [
      {
        kind: "cloud-org",
        scope: "cloud",
        label: "ChipMate Cloud organization config",
        source: `${account.url}/api/config`,
        exists: true,
        editable: false,
        reason: "Active organization config is managed by ChipMate Cloud; values are not exposed here.",
      },
    ]
  }

  async function managedSources(): Promise<Pending[]> {
    if (ProductProfile.chipmate) return []
    const dir = ConfigManaged.managedConfigDir()
    const files = await Promise.all(
      ChipMateConfig.ALL_CONFIG_FILES.map((name) =>
        fileSource({
          kind: "managed-file",
          scope: "managed",
          label: `Managed ${name}`,
          file: path.join(dir, name),
          editable: false,
          reason: "Managed config has higher precedence and is read-only in the dashboard.",
        }),
      ),
    )
    return [
      {
        kind: "managed-dir",
        scope: "managed",
        label: "Managed config directory",
        source: dir,
        path: dir,
        exists: await Bun.file(dir).exists(),
        editable: false,
      },
      ...files,
      ...(await managedPreferenceSources()),
    ]
  }

  async function managedPreferenceSources(): Promise<Pending[]> {
    if (process.platform !== "darwin") return []
    const user = os.userInfo().username
    const files = [
      path.join("/Library/Managed Preferences", user, "ai.opencode.managed.plist"),
      path.join("/Library/Managed Preferences", "ai.opencode.managed.plist"),
    ]
    return Promise.all(
      files.map(async (file) => ({
        kind: "managed-preferences" as const,
        scope: "managed" as const,
        label: "macOS managed preferences",
        source: `mobileconfig:${file}`,
        path: file,
        exists: await Bun.file(file).exists(),
        editable: false,
        reason: "Managed preferences are deployed by MDM and override local config.",
      })),
    )
  }

  function runtimeSources(): Pending[] {
    return [
      runtimeSource("CHIPMATE_PERMISSION", Flag.CHIPMATE_PERMISSION, "Runtime permission overlay."),
      runtimeSource("CHIPMATE_DISABLE_AUTOCOMPACT", process.env.CHIPMATE_DISABLE_AUTOCOMPACT, "Disables automatic compaction."),
      runtimeSource("CHIPMATE_DISABLE_PRUNE", process.env.CHIPMATE_DISABLE_PRUNE, "Disables tool-output pruning."),
    ].filter((item): item is Pending => item !== undefined)
  }

  function runtimeSource(label: string, value: string | undefined, reason: string): Pending | undefined {
    if (!value) return undefined
    return {
      kind: "runtime-env",
      scope: "env",
      label,
      source: label,
      exists: true,
      editable: false,
      reason,
    }
  }

  async function fileSource(input: {
    kind: Kind
    scope: Scope
    label: string
    file: string
    editable?: boolean
    reason?: string
  }): Promise<Pending> {
    return {
      kind: input.kind,
      scope: input.scope,
      label: input.label,
      source: input.file,
      path: input.file,
      exists: await Bun.file(input.file).exists(),
      editable: input.editable ?? true,
      reason: input.reason,
    }
  }
}
