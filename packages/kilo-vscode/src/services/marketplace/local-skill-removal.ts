import { randomUUID } from "crypto"
import * as path from "path"
import * as vscode from "vscode"
import type { KiloConnectionService } from "../cli-backend"
import { retry } from "../cli-backend/retry"
import type { CliSkill } from "./detection"
import { LocalImportRegistry } from "./local-import-registry"
import { normalizeSkillKey } from "./skills"

const TTL = 10 * 60 * 1000

export type SkillRemovePhase = "validating" | "removing" | "refreshing" | "reconciling"

export interface SkillRemoveTarget {
  skillId: string
  scope: "global" | "project"
  targetToken: string
}

export interface IssuedSkillRemoveTarget extends SkillRemoveTarget {
  location: string
}

export interface SkillRemoveRequest extends SkillRemoveTarget {
  requestId: string
}

export interface SkillRemoveResult {
  requestId: string
  skillId: string
  scope: "global" | "project"
  success: boolean
  error?: string
}

interface Target extends SkillRemoveTarget {
  location: string
  project?: string
  expires: number
}

export class LocalSkillRemoval {
  private targets = new Map<string, Target>()
  private pending = new Set<string>()
  private readonly registry: LocalImportRegistry

  constructor(
    private readonly connection: KiloConnectionService,
    context: vscode.ExtensionContext,
  ) {
    this.registry = new LocalImportRegistry(context)
  }

  issue(skills: CliSkill[], project?: string): IssuedSkillRemoveTarget[] {
    this.clean()
    const result: IssuedSkillRemoveTarget[] = []
    for (const skill of skills) {
      if (!removable(skill)) continue
      const id = normalizeSkillKey(skill.name)
      if (!id) continue
      const scope: "project" | "global" = project && contains(project, skill.location) ? "project" : "global"
      const token = randomUUID()
      const target = {
        skillId: id,
        scope,
        targetToken: token,
        location: path.resolve(skill.location),
        ...(scope === "project" && project ? { project } : {}),
        expires: Date.now() + TTL,
      }
      this.targets.set(token, target)
      result.push({ skillId: id, scope, targetToken: token, location: target.location })
    }
    return result
  }

  async remove(
    request: SkillRemoveRequest,
    directory: string,
    progress: (phase: SkillRemovePhase) => void,
  ): Promise<SkillRemoveResult> {
    const base = { requestId: request.requestId, skillId: request.skillId, scope: request.scope }
    try {
      progress("validating")
      this.clean()
      const target = this.targets.get(request.targetToken)
      if (!target || target.expires <= Date.now()) throw new Error("删除凭据已过期，请刷新 Skill 列表后重试。")
      if (this.pending.has(request.targetToken)) throw new Error("该 Skill 正在删除，请勿重复操作。")
      if (target.skillId !== request.skillId || target.scope !== request.scope) throw new Error("删除目标校验失败。")
      this.pending.add(request.targetToken)

      const client = await this.connection.getClientAsync(directory)
      const current = await list(client, directory)
      if (!current.some((skill) => same(skill, target))) throw new Error("该 Skill 已变化，请刷新后重试。")

      progress("removing")
      await client.kilocode.removeSkill({ location: target.location, directory }, { throwOnError: true })

      progress("refreshing")
      const first = await list(client, directory)
      if (first.some((skill) => same(skill, target))) {
        await client.instance.dispose({ directory }, { throwOnError: true })
      }
      const fresh = await list(client, directory)
      if (fresh.some((skill) => same(skill, target))) throw new Error("删除后 Skill 缓存仍未刷新。")
      if (await exists(path.dirname(target.location))) throw new Error("删除后 Skill 目录仍然存在。")

      progress("reconciling")
      const workspaceId = this.registry.workspaceId(target.scope === "project" ? target.project : undefined)
      await this.registry.remove(target.skillId, target.scope, workspaceId)
      await this.registry.reconcile(target.project)
      this.targets.delete(request.targetToken)
      return { ...base, success: true }
    } catch (err) {
      return { ...base, success: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      this.pending.delete(request.targetToken)
    }
  }

  reconcile(project?: string) {
    return this.registry.reconcile(project)
  }

  dispose() {
    this.targets.clear()
    this.pending.clear()
  }

  private clean() {
    const now = Date.now()
    for (const [token, target] of this.targets) if (target.expires <= now) this.targets.delete(token)
  }
}

async function list(client: Awaited<ReturnType<KiloConnectionService["getClientAsync"]>>, directory: string) {
  const { data } = await retry(() => client.app.skills({ directory }, { throwOnError: true }))
  return (data ?? []) as CliSkill[]
}

async function exists(dir: string) {
  return vscode.workspace.fs.stat(vscode.Uri.file(dir)).then(
    () => true,
    () => false,
  )
}

function same(skill: CliSkill, target: Target) {
  return normalizeSkillKey(skill.name) === target.skillId && path.resolve(skill.location) === target.location
}

function removable(skill: CliSkill) {
  const location = skill.location
  if (location === "builtin" || location === "<built-in>") return false
  if (path.basename(location) !== "SKILL.md") return false
  if (normalizeSkillKey(path.basename(path.dirname(location))) !== normalizeSkillKey(skill.name)) return false
  return !path.resolve(location).includes(`${path.sep}builtin-skills${path.sep}`)
}

function contains(root: string, location: string) {
  const relative = path.relative(path.resolve(root), path.resolve(location))
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}
