import * as path from "path"
import * as vscode from "vscode"
import type { ChipMateConnectionService } from "../cli-backend"
import { retry } from "../cli-backend/retry"
import type { MarketplaceService } from "."
import type {
  InstallMarketplaceItemOptions,
  InstallResult,
  LocalSkillImportItemResult,
  MarketplaceDataResponse,
  MarketplaceItem,
  MarketplaceItemRef,
  RemoveResult,
  SkillImportActivation,
} from "./types"
import { safeMarketplaceErrorText } from "./errors"
import { normalizeSkillKey } from "./skills"

export interface MarketplaceActionContext {
  connection: ChipMateConnectionService
  marketplace: MarketplaceService
  storage?: vscode.Uri
}

export interface MarketplaceRemoveContext {
  connection: ChipMateConnectionService
  storage?: vscode.Uri
  remove: (item: MarketplaceItemRef, scope: "project" | "global", project?: string) => Promise<RemoveResult>
}

export async function fetchMarketplaceData(
  ctx: MarketplaceActionContext,
  project: string | undefined,
  dir: string | undefined,
  auth?: string | readonly vscode.Uri[],
  details = true,
  extra: readonly vscode.Uri[] = [],
): Promise<MarketplaceDataResponse> {
  const skills = dir ? await fetchMarketplaceSkills(ctx, dir) : undefined
  const apiKey = typeof auth === "string" ? auth : undefined
  const roots = Array.isArray(auth) ? auth : extra
  return ctx.marketplace.fetchData(project, skills, roots, apiKey, details)
}

export async function installMarketplaceItem(
  ctx: MarketplaceActionContext,
  item: MarketplaceItem,
  opts: InstallMarketplaceItemOptions,
  project: string | undefined,
  dir: string,
): Promise<InstallResult> {
  const scope = opts.target ?? "project"
  if (scope === "project" && !project) {
    return { success: false, slug: item.id, error: "No workspace directory for project-scope install" }
  }

  try {
    const target = await instanceTarget(ctx, item, scope, project)
    if (target.error) return { success: false, slug: item.id, error: target.error }
    const result = await ctx.marketplace.install(item, opts, project)
    if (result.success && item.type === "skill") {
      const directory = scope === "project" ? project! : dir
      const activation = await activateMarketplaceSkills(
        ctx,
        scope,
        directory,
        [item.id],
        result.filePath ? { [normalizeSkillKey(item.id)]: result.filePath } : undefined,
      )
      const error = marketplaceActivationError(activation)
      if (error) return { success: false, slug: item.id, error }
    } else if (result.success) {
      await invalidate(ctx, item, scope, scope === "project" ? project! : dir)
    }
    return result
  } catch (err) {
    return { success: false, slug: item.id, error: String(err) }
  }
}

export async function removeMarketplaceItem(
  ctx: MarketplaceActionContext,
  item: MarketplaceItem,
  scope: "project" | "global",
  project: string | undefined,
  dir: string,
): Promise<RemoveResult> {
  if (scope === "project" && !project) {
    return { success: false, slug: item.id, error: "No workspace directory for project-scope removal" }
  }

  try {
    if (item.type === "mcp") await removeLegacyMcp(ctx, item.id, project, scope)
    const target = await removalTarget(ctx, item, scope, project, dir)
    if (target.error) return { success: false, slug: item.id, error: target.error }
    const result = await ctx.marketplace.remove(item, scope, project, target.location)
    if (result.success) await invalidate(ctx, item, scope, scope === "project" ? project! : dir)
    return result
  } catch (err) {
    return { success: false, slug: item.id, error: String(err) }
  }
}

async function removalTarget(
  ctx: MarketplaceActionContext,
  item: MarketplaceItem,
  scope: "project" | "global",
  project: string | undefined,
  dir: string,
): Promise<{ location?: string; error?: string }> {
  if (item.type !== "skill") return {}
  if (!item.instanceId) {
    const location = await discoveredSkillLocation(ctx, item, dir)
    return location ? { location } : { error: "Skill instance is not available" }
  }
  return instanceTarget(ctx, item, scope, project)
}

async function instanceTarget(
  ctx: MarketplaceActionContext,
  item: MarketplaceItem,
  scope: "project" | "global",
  project: string | undefined,
): Promise<{ location?: string; error?: string }> {
  if (item.type !== "skill" || !item.instanceId) return {}
  if (item.localScope !== scope) return { error: "Skill scope does not match the selected instance" }
  const instance = await ctx.marketplace.skillInstance(item.instanceId, project)
  if (!instance) return { error: "Skill instance is no longer installed" }
  if (instance.id !== item.id || instance.scope !== scope) {
    return { error: "Skill instance identity does not match the request" }
  }
  if (item.localSha256 !== instance.sha256) {
    return { error: "Skill changed after the Marketplace list was loaded" }
  }
  return { location: instance.location }
}

async function discoveredSkillLocation(
  ctx: MarketplaceActionContext,
  item: Extract<MarketplaceItem, { type: "skill" }>,
  dir: string,
): Promise<string | undefined> {
  const skills = await fetchMarketplaceSkills(ctx, dir)
  const keys = new Set([item.id, item.name, item.displayName].map(normalizeSkillKey).filter(Boolean))
  return skills?.find((skill) => keys.has(normalizeSkillKey(skill.name)))?.location
}

export async function removeMarketplaceItemFromAllScopes(
  ctx: MarketplaceRemoveContext,
  item: MarketplaceItemRef,
  project: string | undefined,
  dir: string,
): Promise<boolean> {
  try {
    if (item.type === "mcp") await removeLegacyMcp(ctx, item.id, project, "all")
    const local = project ? await ctx.remove(item, "project", project) : undefined
    const global = await ctx.remove(item, "global", project)
    if (!local?.success && !global.success) return false
    await invalidate(ctx, item, global.success ? "global" : "project", global.success ? dir : project!)
    return true
  } catch (err) {
    console.warn("[ChipMate New] Marketplace removal failed:", err)
    return false
  }
}

export async function fetchMarketplaceSkills(ctx: MarketplaceActionContext, dir: string) {
  try {
    const client = await ctx.connection.getClientAsync(dir)
    const { data } = await retry(() => client.app.skills({ directory: dir }, { throwOnError: true }))
    return data
  } catch (err) {
    console.warn("[ChipMate New] Failed to fetch CLI skills for marketplace:", err)
    return undefined
  }
}

async function invalidate(
  ctx: { connection: ChipMateConnectionService },
  item: MarketplaceItemRef,
  scope: "project" | "global",
  dir: string,
): Promise<void> {
  if (item.type === "skill") {
    await refresh(ctx, scope, dir)
    return
  }

  const client = await ctx.connection.getClientAsync(dir).catch((err: unknown) => {
    console.warn("[ChipMate New] Marketplace CLI invalidation deferred:", err)
    return null
  })
  if (!client) return

  if (scope === "global") {
    await client.global.config.update({ config: {} }).catch((err: unknown) => {
      console.warn("[ChipMate New] global.config.update after marketplace change failed:", err)
    })
  }
  await client.instance.dispose({ directory: dir }).catch((err: unknown) => {
    console.warn("[ChipMate New] instance.dispose() after marketplace change failed:", err)
  })
}

async function refresh(
  ctx: { connection: ChipMateConnectionService },
  scope: "project" | "global",
  dir: string,
): Promise<void> {
  const client = await ctx.connection.getClientAsync(dir).catch((err: unknown) => {
    console.warn("[ChipMate New] Marketplace CLI Skill refresh deferred:", err)
    return null
  })
  if (!client) return

  await client.chipmate.refreshSkills({ directory: dir, scope }).catch((err: unknown) => {
    console.warn("[ChipMate New] Skill cache refresh after marketplace change failed:", err)
  })
}

export async function invalidateMarketplaceSkills(
  ctx: { connection: ChipMateConnectionService },
  scope: "project" | "global",
  dir: string,
) {
  await refresh(ctx, scope, dir)
}

export async function activateMarketplaceSkills(
  ctx: { connection: ChipMateConnectionService },
  scope: "project" | "global",
  dir: string,
  ids: readonly string[],
  locations?: Readonly<Record<string, string>>,
): Promise<SkillImportActivation> {
  const expected = [...new Set(ids.map(normalizeSkillKey).filter(Boolean))]
  if (expected.length === 0) return { status: "ready" }

  try {
    const inspect = async () => {
      const client = await retry(() => ctx.connection.getClientAsync(dir))
      await retry(() => client.chipmate.refreshSkills({ directory: dir, scope }, { throwOnError: true }))
      const { data } = await retry(() => client.app.skills({ directory: dir }, { throwOnError: true }))
      const missingIds = expected.filter((id) => {
        const location = locations?.[id]
        return !(data ?? []).some(
          (skill) => normalizeSkillKey(skill.name) === id && (!location || sameSkillLocation(skill.location, location)),
        )
      })
      return { client, missingIds }
    }

    const first = await inspect()
    if (first.missingIds.length === 0) return { status: "ready" }
    await retry(() => first.client.instance.dispose({ directory: dir }, { throwOnError: true }))
    const second = await inspect()
    const missingIds = second.missingIds
    if (missingIds.length === 0) return { status: "ready" }

    console.warn("[ChipMate New] Local Skill refresh completed with missing Skills:", {
      scope,
      directory: dir,
      missingIds,
    })
    return { status: "failed", phase: "post-refresh-verification", missingIds }
  } catch (err) {
    console.warn("[ChipMate New] Local Skill refresh request failed:", { scope, directory: dir, err })
    return {
      status: "failed",
      phase: "refresh-request",
      message: safeMarketplaceErrorText(err instanceof Error ? err.message : err) || "Unknown refresh error",
    }
  }
}

export function marketplaceActivationError(activation: SkillImportActivation): string | undefined {
  if (activation.status === "ready") return undefined
  const detail = activation.missingIds?.length
    ? `CLI 刷新后未发现 ${activation.missingIds.join(", ")}`
    : (activation.message ?? "CLI Skill 刷新失败")
  return `Skill 文件已完成校验，但尚未被 CLI 激活：${detail}`
}

function sameSkillLocation(first: string, second: string): boolean {
  const normalize = (value: string) => {
    const resolved = path.resolve(value)
    return process.platform === "win32" ? resolved.toLocaleLowerCase() : resolved
  }
  return normalize(first) === normalize(second)
}

export function activatableSkillIds(items: readonly LocalSkillImportItemResult[]): string[] {
  return items.filter((item) => item.status === "installed" || item.status === "unchanged").map((item) => item.id)
}

async function removeLegacyMcp(
  ctx: { storage?: vscode.Uri },
  name: string,
  project: string | undefined,
  scope: "project" | "global" | "all",
): Promise<boolean> {
  const files: vscode.Uri[] = []
  if (project && scope !== "global") {
    files.push(vscode.Uri.file(path.join(project, ".chipmate-v2", "mcp.json")))
  }

  if (ctx.storage && scope !== "project") files.push(vscode.Uri.joinPath(ctx.storage, "settings", "mcp_settings.json"))

  let removed = false
  for (const uri of files) {
    const bytes = await vscode.workspace.fs.readFile(uri).then(
      (data) => data,
      () => null,
    )
    if (!bytes) continue

    try {
      const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as Record<string, unknown>
      const servers = parsed.mcpServers as Record<string, unknown> | undefined
      if (!servers?.[name]) continue
      delete servers[name]
      await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(parsed, null, 2), "utf8"))
      removed = true
    } catch (err) {
      console.warn("[ChipMate New] Failed to remove legacy MCP from", uri.fsPath, err)
    }
  }
  return removed
}
