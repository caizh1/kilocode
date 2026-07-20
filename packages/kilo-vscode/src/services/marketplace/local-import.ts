import { randomUUID } from "crypto"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import {
  SKILL_SPEC_VERSION,
  readPortableMetadata,
  readSkillArchive,
  repairPortableMetadata,
  validateSkillFiles,
} from "@chipmate/skill-spec"
import { discoverSkillCandidates, type SkillCandidate } from "@chipmate/skill-spec/node"
import type {
  SkillImportCandidate,
  LocalSkillConflict,
  SkillImportPreview,
  LocalSkillImportProgress,
  SkillImportResult,
  SkillImportSelection,
} from "./types"
import { LocalImportRegistry } from "./local-import-registry"

const TTL = 10 * 60 * 1_000

interface Run {
  expires: number
  candidates: SkillCandidate[]
  cancelled: boolean
  installing: boolean
}

interface Store {
  workspaceId(dir: string | undefined): string | undefined
  put(item: Parameters<LocalImportRegistry["put"]>[0]): Promise<void>
}

export class LocalSkillImporter {
  private readonly runs = new Map<string, Run>()

  constructor(
    private readonly registry: Store,
    private readonly managed?: (id: string, scope: "global" | "project", project?: string) => Promise<boolean>,
    private readonly progress?: (value: LocalSkillImportProgress) => void,
    home = os.homedir(),
    private readonly global = path.join(home, ".chipmate-v2"),
  ) {}

  async preview(source: string, project: string | undefined): Promise<SkillImportPreview> {
    this.clean()
    const candidates = await discoverSkillCandidates(source)
    const token = randomUUID()
    const expires = Date.now() + TTL
    this.runs.set(token, { expires, candidates, cancelled: false, installing: false })
    const items = await Promise.all(candidates.map((item) => this.item(item, project)))
    return {
      token,
      expiresAt: new Date(expires).toISOString(),
      projectAvailable: Boolean(project),
      candidates: items,
    }
  }

  async install(selection: SkillImportSelection, project: string | undefined): Promise<SkillImportResult> {
    this.clean()
    const run = this.runs.get(selection.token)
    if (!run || run.expires <= Date.now())
      throw new Error("Local Skill import preview expired; select the source again")
    if (selection.scope === "project" && !project) throw new Error("No workspace is available for project import")
    const selected = new Set(selection.candidateIds)
    const replace = new Set(selection.replaceIds)
    const items = [] as SkillImportResult["items"]
    const total = run.candidates.filter((item) => selected.has(item.key)).length
    run.installing = true
    try {
      for (const original of run.candidates) {
        if (!selected.has(original.key)) continue
        const candidate = repaired(original, selection.repairs?.[original.key])
        this.progress?.({ token: selection.token, current: candidate.id, completed: items.length, total })
        if (run.cancelled) {
          items.push({ id: candidate.id, status: "skipped", error: "Import cancelled" })
          continue
        }
        if (!candidate.snapshot.valid) {
          items.push({ id: candidate.id, status: "failed", error: "Skill validation failed" })
          continue
        }
        try {
          items.push(await this.write(candidate, selection.scope, project, replace.has(candidate.key)))
        } catch (err) {
          items.push({ id: candidate.id, status: "failed", error: message(err) })
        }
      }
      this.progress?.({ token: selection.token, current: "", completed: items.length, total })
      return { token: selection.token, items }
    } finally {
      this.runs.delete(selection.token)
    }
  }

  cancel(token: string) {
    const run = this.runs.get(token)
    if (!run) return
    if (run.installing) run.cancelled = true
    else this.runs.delete(token)
  }

  dispose() {
    this.runs.clear()
  }

  private async item(candidate: SkillCandidate, project: string | undefined): Promise<SkillImportCandidate> {
    const scopes: Array<"project" | "global"> = project ? ["project", "global"] : ["global"]
    const conflicts = await Promise.all(scopes.map((scope) => this.conflict(candidate, scope, project)))
    return {
      key: candidate.key,
      id: candidate.id,
      name: candidate.name,
      description: candidate.description,
      sourceKind: candidate.sourceKind,
      sourceLabel: candidate.sourceLabel,
      hints: candidate.hints,
      fileCount: candidate.fileCount,
      totalBytes: candidate.totalBytes,
      valid: candidate.snapshot.valid,
      snapshotSha256: candidate.snapshot.snapshotSha256,
      repairs: candidate.repairs,
      issues: candidate.snapshot.issues,
      conflicts,
    }
  }

  private async conflict(
    candidate: SkillCandidate,
    scope: "global" | "project",
    project: string | undefined,
  ): Promise<LocalSkillConflict> {
    const target = this.target(candidate.id, scope, project)
    if (!(await exists(target))) return { scope, state: "none" }
    const installed = await discoverSkillCandidates(target).catch(() => [])
    const sha = installed[0]?.snapshot.snapshotSha256
    if (sha === candidate.snapshot.snapshotSha256) return { scope, state: "same", installedSha256: sha }
    const managed = await this.managed?.(candidate.id, scope, scope === "project" ? project : undefined)
    return {
      scope,
      state: managed ? "managed" : "different",
      ...(sha ? { installedSha256: sha } : {}),
    }
  }

  private async write(
    candidate: SkillCandidate,
    scope: "global" | "project",
    project: string | undefined,
    replace: boolean,
  ): Promise<SkillImportResult["items"][number]> {
    const base = this.base(scope, project)
    const target = this.target(candidate.id, scope, project)
    await fs.mkdir(base, { recursive: true })
    const current = await this.conflict(candidate, scope, project)
    if (current.state === "same") return { id: candidate.id, status: "unchanged" }
    if (current.state !== "none" && !replace)
      return { id: candidate.id, status: "skipped", error: "Replace was not confirmed" }

    const stage = await fs.mkdtemp(path.join(base, `.import-${candidate.id}-`))
    const backup = path.join(base, `.backup-${candidate.id}-${randomUUID()}`)
    const state = { backup: false, installed: false }
    try {
      for (const file of candidate.files) {
        const output = path.join(stage, ...file.path.split("/"))
        await fs.mkdir(path.dirname(output), { recursive: true })
        await fs.writeFile(output, file.data, { mode: file.mode ?? 0o644 })
      }
      const verified = await discoverSkillCandidates(stage)
      if (verified.length !== 1 || !verified[0]?.snapshot.valid)
        throw new Error("Installed snapshot failed final validation")
      if (verified[0].snapshot.snapshotSha256 !== candidate.snapshot.snapshotSha256)
        throw new Error("Installed snapshot hash changed during staging")
      if (await exists(target)) {
        await fs.rename(target, backup)
        state.backup = true
      }
      await fs.rename(stage, target)
      state.installed = true
      const workspaceId = this.registry.workspaceId(scope === "project" ? project : undefined)
      await this.registry.put({
        version: 1,
        skillId: candidate.id,
        scope,
        ...(workspaceId ? { workspaceId } : {}),
        sourceKind: candidate.sourceKind,
        sourceLabel: candidate.sourceLabel,
        sourceSha256: candidate.sourceSha256,
        installedSha256: candidate.snapshot.snapshotSha256,
        specVersion: SKILL_SPEC_VERSION,
        hints: candidate.hints,
        importedAt: new Date().toISOString(),
      })
      if (state.backup)
        await fs.rm(backup, { recursive: true, force: true }).catch((err) => {
          console.warn("[Kilo New] Local Skill backup cleanup failed:", err)
        })
      return { id: candidate.id, status: "installed" }
    } catch (err) {
      if (state.installed) await fs.rm(target, { recursive: true, force: true })
      if (state.backup) await fs.rename(backup, target)
      throw err
    } finally {
      await fs.rm(stage, { recursive: true, force: true }).catch((err) => {
        console.warn("[Kilo New] Local Skill staging cleanup failed:", err)
      })
    }
  }

  private target(id: string, scope: "global" | "project", project: string | undefined) {
    return path.join(this.base(scope, project), id)
  }

  private base(scope: "global" | "project", project: string | undefined) {
    if (scope === "global") return path.join(this.global, "skills")
    if (!project) throw new Error("No workspace is available for project import")
    return path.join(project, ".chipmate-v2", "skills")
  }

  private clean() {
    const now = Date.now()
    for (const [token, run] of this.runs) if (run.expires <= now) this.runs.delete(token)
  }
}

function repaired(candidate: SkillCandidate, values: { name?: string; description?: string } | undefined) {
  if (!values?.name && !values?.description) return candidate
  const file = candidate.files.find((item) => item.path === "SKILL.md")
  if (!file) return candidate
  const current = readPortableMetadata(file.data.toString("utf8"))
  const name = portable(values.name?.trim() || current.name || candidate.name)
  const description = values.description?.trim() || current.description || candidate.description
  const files = candidate.files.map((item) =>
    item.path === "SKILL.md"
      ? { ...item, data: Buffer.from(repairPortableMetadata(item.data.toString("utf8"), { name, description })) }
      : item,
  )
  const snapshot = validateSkillFiles(name, files)
  return {
    ...candidate,
    id: snapshot.spec.id,
    name,
    description,
    files: readSkillArchive(snapshot.archive),
    snapshot,
  }
}

function portable(value: string) {
  return (
    value
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-")
      .slice(0, 64) || "skill"
  )
}

async function exists(file: string) {
  try {
    await fs.access(file)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false
    throw err
  }
}

function message(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}
