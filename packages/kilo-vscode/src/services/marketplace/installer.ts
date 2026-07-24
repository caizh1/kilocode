import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import { createHash, randomUUID } from "crypto"
import { isSkillId, validateSkillIdentity } from "@opencode-ai/core/kilocode/skill-identity"
import { readPortableMetadata } from "@chipmate/skill-spec"
import * as yaml from "yaml"
import { exec } from "../../util/process"
import type {
  MarketplaceItem,
  MarketplaceItemRef,
  SkillMarketplaceItem,
  McpMarketplaceItem,
  AgentMarketplaceItem,
  McpInstallationMethod,
  InstallMarketplaceItemOptions,
  InstallResult,
  RemoveResult,
} from "./types"
import { MarketplacePaths } from "./paths"

export class MarketplaceInstaller {
  constructor(private paths: MarketplacePaths) {}

  async install(
    item: MarketplaceItem,
    options: InstallMarketplaceItemOptions,
    workspace?: string,
  ): Promise<InstallResult> {
    const scope = options.target ?? "project"
    if (item.type === "skill") return this.installSkill(item, scope, workspace)
    if (item.type === "mcp") return this.installMcp(item, options, scope, workspace)
    return this.installAgent(item, scope, workspace)
  }

  // ── MCP ─────────────────────────────────────────────────────────────

  async installMcp(
    item: McpMarketplaceItem,
    options: InstallMarketplaceItemOptions,
    scope: "project" | "global",
    workspace?: string,
  ): Promise<InstallResult> {
    if (scope === "project" && !workspace) {
      return { success: false, slug: item.id, error: "No workspace directory for project-scope install" }
    }

    const config = await this.readConfig(scope, workspace)
    if (!config.mcp) config.mcp = {}

    if (config.mcp[item.id]) {
      return { success: false, slug: item.id, error: "MCP server already installed. Remove it first." }
    }

    const content = this.resolveMcpContent(item, options)
    if (!content) {
      return { success: false, slug: item.id, error: "No installation content for MCP server" }
    }

    try {
      config.mcp[item.id] = this.buildMcpEntry(content, options.parameters)
    } catch (err) {
      return { success: false, slug: item.id, error: `Invalid MCP config: ${err}` }
    }

    await this.writeConfig(scope, workspace, config)
    return { success: true, slug: item.id }
  }

  private resolveMcpContent(item: McpMarketplaceItem, options: InstallMarketplaceItemOptions): string | undefined {
    if (typeof item.content === "string") return item.content
    if (!Array.isArray(item.content) || item.content.length === 0) return undefined
    const name = options.parameters?.__method as string | undefined
    if (name) {
      const found = item.content.find((m: McpInstallationMethod) => m.name === name)
      if (found) return found.content
    }
    return item.content[0].content
  }

  private buildMcpEntry(content: string, params?: Record<string, unknown>): Record<string, unknown> {
    const filtered = Object.fromEntries(Object.entries(params ?? {}).filter(([k]) => k !== "__method"))
    const replaced = Object.keys(filtered).length > 0 ? substituteParams(content, filtered) : content
    const raw = JSON.parse(replaced) as Record<string, unknown>
    return normalizeMcpEntry(raw)
  }

  // ── Agent ───────────────────────────────────────────────────────────

  async installAgent(
    item: AgentMarketplaceItem,
    scope: "project" | "global",
    workspace?: string,
  ): Promise<InstallResult> {
    if (scope === "project" && !workspace) {
      return { success: false, slug: item.id, error: "No workspace directory for project-scope install" }
    }

    if (!isSafeId(item.id)) {
      return { success: false, slug: item.id, error: "Invalid agent id" }
    }

    const dir = this.paths.agentsDir(scope, workspace)
    await fs.mkdir(dir, { recursive: true })

    const filepath = path.join(dir, `${item.id}.md`)
    if (!contains(dir, filepath)) {
      return { success: false, slug: item.id, error: "Invalid agent id" }
    }

    try {
      await fs.access(filepath)
      return { success: false, slug: item.id, error: "Agent already installed. Remove it first." }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
    }

    const { prompt, ...front } = item.content
    const frontmatter = yaml.stringify(front).trimEnd()
    const content = `---\n${frontmatter}\n---\n\n${prompt}\n`
    await fs.writeFile(filepath, content, "utf-8")

    // Migration: remove stale kilo.json agent entry with same id if present
    const config = await this.readConfig(scope, workspace)
    if (config.agent?.[item.id]) {
      delete (config.agent as Record<string, unknown>)[item.id]
      if (Object.keys(config.agent as object).length === 0) delete config.agent
      await this.writeConfig(scope, workspace, config)
    }

    return { success: true, slug: item.id, filePath: filepath, line: 1 }
  }

  async removeAgent(
    item: Pick<AgentMarketplaceItem, "id">,
    scope: "project" | "global",
    workspace?: string,
  ): Promise<RemoveResult> {
    if (scope === "project" && !workspace) {
      return { success: false, slug: item.id, error: "No workspace directory for project-scope removal" }
    }

    if (!isSafeId(item.id)) {
      return { success: false, slug: item.id, error: "Invalid agent id" }
    }

    const dir = this.paths.agentsDir(scope, workspace)
    const filepath = path.join(dir, `${item.id}.md`)
    if (!contains(dir, filepath)) {
      return { success: false, slug: item.id, error: "Invalid agent id" }
    }

    try {
      await fs.unlink(filepath)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        return { success: false, slug: item.id, error: String(err) }
      }
    }

    // Also clean up any stale kilo.json agent entry
    const config = await this.readConfig(scope, workspace)
    if (config.agent?.[item.id]) {
      delete (config.agent as Record<string, unknown>)[item.id]
      if (Object.keys(config.agent as object).length === 0) delete config.agent
      await this.writeConfig(scope, workspace, config)
    }

    return { success: true, slug: item.id }
  }

  // ── Skill ───────────────────────────────────────────────────────────

  async installSkill(
    item: SkillMarketplaceItem,
    scope: "project" | "global",
    workspace?: string,
  ): Promise<InstallResult> {
    if (scope === "project" && !workspace) {
      return { success: false, slug: item.id, error: "No workspace directory for project-scope install" }
    }

    if (!item.content) {
      return { success: false, slug: item.id, error: "Skill has no tarball URL" }
    }

    if (!isSkillId(item.id)) {
      return { success: false, slug: item.id, error: "Invalid skill id" }
    }

    const base = this.paths.skillsDir(scope, workspace)
    const dir = path.join(base, item.id)
    if (!contains(base, dir)) {
      return { success: false, slug: item.id, error: "Invalid skill id" }
    }

    if (await exists(dir)) {
      return { success: false, slug: item.id, error: "Skill already installed. Uninstall it before installing again." }
    }

    // Stage under `base` (not os.tmpdir()) so fs.rename() never crosses filesystems (EXDEV).
    await fs.mkdir(base, { recursive: true })
    const staging = await fs.mkdtemp(path.join(base, `.staging-${item.id}-`))
    const tarball = path.join(os.tmpdir(), `kilo-skill-${item.id}-${randomUUID()}.tar.gz`)

    try {
      const response = await fetch(item.content)
      if (!response.ok) {
        return { success: false, slug: item.id, error: `Download failed: ${response.status}` }
      }

      const buffer = Buffer.from(await response.arrayBuffer())
      await fs.writeFile(tarball, buffer)
      await exec("tar", ["-xzf", tarball, "--strip-components=1", "-C", staging])

      const escaped = await findEscapedPaths(staging)
      if (escaped.length > 0) {
        console.warn(`Skill archive ${item.id} contains escaped paths:`, escaped)
        return { success: false, slug: item.id, error: "Skill archive contains unsafe paths" }
      }

      try {
        await fs.access(path.join(staging, "SKILL.md"))
      } catch {
        console.warn(`Extracted skill ${item.id} missing SKILL.md, rolling back`)
        return { success: false, slug: item.id, error: "Extracted archive missing SKILL.md" }
      }

      await validateSkillIdentityAt(staging, item.id)

      await fs.rename(staging, dir)

      return { success: true, slug: item.id, filePath: path.join(dir, "SKILL.md"), line: 1 }
    } catch (err) {
      if (await exists(dir)) {
        return {
          success: false,
          slug: item.id,
          error: "Skill already installed. Uninstall it before installing again.",
        }
      }
      console.warn(`Failed to install skill ${item.id}:`, err)
      return { success: false, slug: item.id, error: String(err) }
    } finally {
      await Promise.all([
        fs.rm(staging, { recursive: true, force: true }).catch((err) => {
          console.warn(`Failed to clean up staging directory ${staging}:`, err)
        }),
        fs.rm(tarball, { force: true }).catch((err) => {
          console.warn(`Failed to clean up temp file ${tarball}:`, err)
        }),
      ])
    }
  }

  async isSkillInstalled(id: string, scope: "project" | "global", workspace?: string): Promise<boolean> {
    if (!isSkillId(id)) return false
    return exists(path.join(this.paths.skillsDir(scope, workspace), id))
  }

  async installVerifiedSkill(
    item: { id: string; revision: number; sha256: string; url: string },
    scope: "project" | "global",
    workspace?: string,
  ): Promise<InstallResult> {
    if (scope === "project" && !workspace) {
      return { success: false, slug: item.id, error: "No workspace directory for project-scope install" }
    }
    if (
      !isSkillId(item.id) ||
      !/^[a-f0-9]{64}$/.test(item.sha256) ||
      !Number.isSafeInteger(item.revision) ||
      item.revision < 1
    ) {
      return { success: false, slug: item.id, error: "Invalid verified skill metadata" }
    }

    const base = this.paths.skillsDir(scope, workspace)
    const dir = path.join(base, item.id)
    if (!contains(base, dir)) return { success: false, slug: item.id, error: "Invalid skill id" }
    await fs.mkdir(base, { recursive: true })
    const staging = await fs.mkdtemp(path.join(base, `.staging-${item.id}-`))
    const backup = path.join(base, `.backup-${item.id}-${randomUUID()}`)
    const tarball = path.join(os.tmpdir(), `kilo-skill-${item.id}-${randomUUID()}.tar.gz`)
    const state = { backedUp: false, installed: false }

    try {
      const buffer = await download(item.url, 50 * 1024 * 1024)
      const actual = createHash("sha256").update(buffer).digest("hex")
      if (actual !== item.sha256) return { success: false, slug: item.id, error: "Skill archive SHA-256 mismatch" }
      await fs.writeFile(tarball, buffer)
      const listing = await exec("tar", ["-tzf", tarball])
      const entries = listing.stdout.split(/\r?\n/).filter(Boolean)
      if (!safeArchive(entries, item.id))
        return { success: false, slug: item.id, error: "Skill archive contains unsafe paths or an unexpected root" }
      await exec("tar", ["-xzf", tarball, "--strip-components=1", "-C", staging])
      const escaped = await findEscapedPaths(staging)
      if (escaped.length > 0) return { success: false, slug: item.id, error: "Skill archive contains unsafe links" }
      if (!(await exists(path.join(staging, "SKILL.md")))) {
        return { success: false, slug: item.id, error: "Extracted archive missing SKILL.md" }
      }
      await validateSkillIdentityAt(staging, item.id)
      if (await exists(dir)) {
        await fs.rename(dir, backup)
        state.backedUp = true
      }
      await fs.rename(staging, dir)
      state.installed = true
      if (state.backedUp) await fs.rm(backup, { recursive: true, force: true })
      return { success: true, slug: item.id, filePath: path.join(dir, "SKILL.md"), line: 1 }
    } catch (err) {
      if (state.backedUp && !state.installed && !(await exists(dir))) await fs.rename(backup, dir)
      console.warn(`Failed to install verified skill ${item.id}:`, err)
      return { success: false, slug: item.id, error: String(err) }
    } finally {
      await Promise.all([
        fs
          .rm(staging, { recursive: true, force: true })
          .catch((err) => console.warn(`Failed to clean ${staging}:`, err)),
        fs.rm(tarball, { force: true }).catch((err) => console.warn(`Failed to clean ${tarball}:`, err)),
        state.installed
          ? fs
              .rm(backup, { recursive: true, force: true })
              .catch((err) => console.warn(`Failed to clean ${backup}:`, err))
          : Promise.resolve(),
      ])
    }
  }

  // ── Remove ──────────────────────────────────────────────────────────

  async remove(
    item: MarketplaceItemRef,
    scope: "project" | "global",
    workspace?: string,
    location?: string,
  ): Promise<RemoveResult> {
    if (scope === "project" && !workspace) {
      return { success: false, slug: item.id, error: "No workspace directory for project-scope removal" }
    }
    if (item.type === "skill") return this.removeSkill(item, scope, workspace, location)
    if (item.type === "mcp") return this.removeMcp(item, scope, workspace)
    return this.removeAgent(item, scope, workspace)
  }

  async removeMcp(
    item: Pick<McpMarketplaceItem, "id">,
    scope: "project" | "global",
    workspace?: string,
  ): Promise<RemoveResult> {
    if (scope === "project" && !workspace) {
      return { success: false, slug: item.id, error: "No workspace directory for project-scope removal" }
    }

    const config = await this.readConfig(scope, workspace)
    if (!config.mcp?.[item.id]) {
      return { success: true, slug: item.id }
    }
    delete config.mcp[item.id]
    if (Object.keys(config.mcp).length === 0) delete config.mcp
    await this.writeConfig(scope, workspace, config)
    return { success: true, slug: item.id }
  }

  async removeSkill(
    item: Pick<SkillMarketplaceItem, "id">,
    scope: "project" | "global",
    workspace?: string,
    location?: string,
  ): Promise<RemoveResult> {
    if (scope === "project" && !workspace) {
      return { success: false, slug: item.id, error: "No workspace directory for project-scope removal" }
    }

    if (!isSkillId(item.id)) {
      return { success: false, slug: item.id, error: "Invalid skill id" }
    }
    const base = this.paths.skillsDir(scope, workspace)
    const dir = path.join(base, item.id)
    if (!contains(base, dir)) {
      return { success: false, slug: item.id, error: "Invalid skill id" }
    }
    if (!location || !(await same(location, path.join(dir, "SKILL.md")))) {
      return { success: false, slug: item.id, error: "Skill discovery location does not match the selected scope" }
    }
    const tomb = path.join(path.dirname(base), `.removing-skill-${item.id}-${randomUUID()}`)
    try {
      await validateRoot(base)
      await validateSkillDirectory(dir)
      await validateSkillIdentityAt(dir, item.id)
      await fs.rename(dir, tomb)
      try {
        await fs.rm(tomb, { recursive: true, force: false })
      } catch (err) {
        try {
          await fs.rename(tomb, dir)
        } catch (cause) {
          console.warn(`Failed to remove skill ${item.id} and restore ${dir}:`, err, cause)
          return {
            success: false,
            slug: item.id,
            error: `Skill cleanup failed and rollback failed: ${String(err)}; ${String(cause)}`,
          }
        }
        console.warn(`Failed to remove skill ${item.id}; restored original directory:`, err)
        return { success: false, slug: item.id, error: `Skill cleanup failed: ${String(err)}` }
      }
      if ((await exists(dir)) || (await exists(tomb))) {
        return { success: false, slug: item.id, error: "Skill directory still exists after removal" }
      }
      return { success: true, slug: item.id }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { success: false, slug: item.id, error: "Skill is not installed in the selected scope" }
      }
      console.warn(`Failed to remove skill ${item.id}:`, err)
      return { success: false, slug: item.id, error: String(err) }
    }
  }

  // ── Config helpers ──────────────────────────────────────────────────

  private async readConfig(
    scope: "project" | "global",
    workspace?: string,
  ): Promise<Record<string, Record<string, unknown>>> {
    const filepath = this.paths.configPath(scope, workspace)
    try {
      const content = await fs.readFile(filepath, "utf-8")
      return JSON.parse(content)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return {}
      throw err
    }
  }

  private async writeConfig(
    scope: "project" | "global",
    workspace: string | undefined,
    config: Record<string, unknown>,
  ): Promise<void> {
    const filepath = this.paths.configPath(scope, workspace)
    await fs.mkdir(path.dirname(filepath), { recursive: true })
    await fs.writeFile(filepath, JSON.stringify(config, null, 2) + "\n", "utf-8")
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

async function exists(filepath: string): Promise<boolean> {
  try {
    await fs.access(filepath)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false
    throw err
  }
}

async function validateSkillDirectory(dir: string): Promise<void> {
  const root = await fs.lstat(dir)
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error("Skill target must be a regular directory")
  const manifest = await fs.lstat(path.join(dir, "SKILL.md"))
  if (!manifest.isFile() || manifest.isSymbolicLink()) throw new Error("Skill manifest must be a regular file")

  const queue = [dir]
  for (const current of queue) {
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const file = path.join(current, entry.name)
      if (entry.isSymbolicLink()) throw new Error("Skill directory contains a symbolic link")
      if (!entry.isDirectory()) continue
      queue.push(file)
      if (file !== dir && (await exists(path.join(file, "SKILL.md")))) {
        throw new Error("Skill directory contains a nested Skill")
      }
    }
  }
}

async function validateSkillIdentityAt(dir: string, expected: string): Promise<void> {
  const content = await fs.readFile(path.join(dir, "SKILL.md"), "utf8")
  const metadata = readPortableMetadata(content)
  if (!metadata.name) throw new Error("SKILL.md frontmatter must contain name")
  const file = path.join(dir, "skill.json")
  const saved = await fs.readFile(file, "utf8").catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return undefined
    throw err
  })
  const id = (() => {
    if (saved === undefined) return undefined
    const value = JSON.parse(saved) as unknown
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("skill.json must be an object")
    const id = (value as { id?: unknown }).id
    if (id === undefined) return undefined
    if (typeof id !== "string") throw new Error("skill.json id must be a string")
    return id
  })()
  const identity = validateSkillIdentity({ name: metadata.name, directory: expected, metadataId: id })
  if (!identity.valid) throw new Error(identity.message)
  if (identity.id !== expected) throw new Error(`Skill id "${identity.id}" does not match expected id "${expected}"`)
}

async function validateRoot(root: string): Promise<void> {
  for (const dir of [path.dirname(root), root]) {
    const stat = await fs.lstat(dir)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Skill root must be a regular directory")
  }
}

async function same(first: string, second: string): Promise<boolean> {
  const normalize = (value: string) => {
    const resolved = path.resolve(value)
    return process.platform === "win32" ? resolved.toLowerCase() : resolved
  }
  if (normalize(first) === normalize(second)) return true
  const paths = await Promise.all([fs.realpath(first), fs.realpath(second)]).catch(() => undefined)
  return Boolean(paths && normalize(paths[0]) === normalize(paths[1]))
}

function contains(dir: string, filepath: string): boolean {
  return path.resolve(filepath).startsWith(path.resolve(dir) + path.sep)
}

/**
 * Normalize a marketplace MCP entry from the old Kilocode format to the CLI's expected format.
 *
 * Old format (from marketplace API):
 *   { "command": "npx", "args": [...], "env": {...} }
 *   { "type": "sse"|"streamable-http", "url": "...", "headers": {...} }
 *
 * New format (CLI Config.Mcp schema):
 *   { "type": "local", "command": ["npx", ...], "environment": {...} }
 *   { "type": "remote", "url": "...", "headers": {...} }
 */
function normalizeMcpEntry(raw: Record<string, unknown>): Record<string, unknown> {
  // Already in new format
  if (raw.type === "local" || raw.type === "remote") return raw

  // Remote MCP (sse / streamable-http) → type: "remote"
  if (typeof raw.url === "string") {
    const { type: _type, url, headers, ...rest } = raw
    const entry: Record<string, unknown> = { type: "remote", url }
    if (headers && typeof headers === "object") entry.headers = headers
    // Carry through any other recognized fields (enabled, timeout, oauth)
    for (const key of ["enabled", "timeout", "oauth"] as const) {
      if (key in rest) entry[key] = rest[key]
    }
    return entry
  }

  // Local MCP (command string + args array) → type: "local", command array
  if (typeof raw.command === "string") {
    const args = (raw.args as string[] | undefined) ?? []
    const env = raw.env
    const entry: Record<string, unknown> = { type: "local", command: [raw.command, ...args] }
    if (env && typeof env === "object" && Object.keys(env as object).length > 0) entry.environment = env
    for (const key of ["enabled", "timeout"] as const) {
      if (key in raw) entry[key] = raw[key]
    }
    return entry
  }

  return raw
}

function isSafeId(id: string): boolean {
  if (!id || id === "." || id.includes("..") || id.includes("/") || id.includes("\\") || id.endsWith(".")) return false
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(id)) return false
  return /^[\w\-@.]+$/.test(id)
}

function escapeJsonValue(raw: string): string {
  return raw
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
}

function substituteParams(template: string, params: Record<string, unknown>): string {
  let result = template
  for (const [key, value] of Object.entries(params)) {
    const escaped = escapeJsonValue(String(value ?? ""))
    result = result.replaceAll(`{{${key}}}`, escaped)
    result = result.replaceAll(`\${${key}}`, escaped)
  }
  return result
}

async function findEscapedPaths(dir: string): Promise<string[]> {
  const resolved = path.resolve(dir)
  const escaped: string[] = []

  async function walk(current: string) {
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.resolve(current, entry.name)
      if (!full.startsWith(resolved + path.sep) && full !== resolved) {
        escaped.push(full)
        continue
      }
      if (entry.isSymbolicLink()) {
        escaped.push(full)
        continue
      }
      if (entry.isDirectory()) {
        await walk(full)
      }
    }
  }

  await walk(dir)
  return escaped
}

async function download(url: string, limit: number): Promise<Buffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Download failed: ${response.status}`)
  const length = Number(response.headers.get("content-length"))
  if (Number.isFinite(length) && length > limit) throw new Error("Skill archive exceeds the response size limit")
  if (!response.body) throw new Error("Skill archive response has no body")
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  const size = { value: 0 }
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    size.value += chunk.value.byteLength
    if (size.value > limit) {
      await reader.cancel()
      throw new Error("Skill archive exceeds the response size limit")
    }
    chunks.push(chunk.value)
  }
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    size.value,
  )
}

function safeArchive(entries: string[], id: string): boolean {
  if (entries.length === 0 || entries.length > 2000) return false
  return entries.every((entry) => {
    const normalized = entry.replace(/\/+$/, "")
    if (!normalized || normalized.startsWith("/") || normalized.includes("\\")) return false
    const parts = normalized.split("/")
    if (parts[0] !== id || parts.some((part) => !part || part === "." || part === "..")) return false
    return Buffer.byteLength(normalized) <= 1024
  })
}
