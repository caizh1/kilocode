import * as path from "path"
import { normalizeSkillId } from "@opencode-ai/core/chipmate/skill-identity"
import type { CliSkill } from "./detection"
import type { SkillInstance } from "./skill-instances"
import type { MarketplaceInstalledMetadata, MarketplaceItem, SkillMarketplaceItem } from "./types"

interface MarketplaceSkillMerge {
  marketplaceItems: MarketplaceItem[]
  marketplaceInstalledMetadata: MarketplaceInstalledMetadata
}

export type SkillOrigin = "market" | "local" | "builtin"

export interface SkillRoots {
  global: readonly string[]
  project?: readonly string[]
}

export function normalizeSkillKey(value: string): string {
  return normalizeSkillId(value)
}

function isUploadableSkill(skill: CliSkill): boolean {
  if (skill.location === "builtin") return Boolean(skill.content?.trim())
  return path.basename(skill.location) === "SKILL.md"
}

export function isListedUploadableSkill(id: string, ids: ReadonlySet<string>): boolean {
  const key = /^(?:project|global):[a-z0-9-]+$/.test(id) ? id : normalizeSkillKey(id)
  return Boolean(key && ids.has(key))
}

export function skillOrigin(skill: CliSkill, roots?: SkillRoots): SkillOrigin {
  if (
    skill.location === "builtin" ||
    skill.location === "<built-in>" ||
    path.resolve(skill.location).includes(`${path.sep}builtin-skills${path.sep}`)
  ) {
    return "builtin"
  }
  if (roots?.project?.some((root) => contains(root, skill.location))) return "market"
  if (roots?.global.some((root) => contains(root, skill.location))) return "market"
  return "local"
}

export function mergeMarketplaceSkills(
  items: MarketplaceItem[],
  skills: CliSkill[] | undefined,
  metadata: MarketplaceInstalledMetadata,
  skillsFetched: boolean,
  roots?: SkillRoots,
  instances: readonly SkillInstance[] = [],
): MarketplaceSkillMerge {
  const remote = items.filter((item): item is SkillMarketplaceItem => item.type === "skill")
  const index = new Map<string, string>()
  for (const item of remote) {
    for (const value of [item.id, item.name, item.displayName]) {
      const key = normalizeSkillKey(value)
      if (key) index.set(key, item.id)
    }
  }

  const local = new Map<string, CliSkill>()
  for (const skill of skills ?? []) {
    if (instances.length > 0 && skill.location !== "builtin" && skill.location !== "<built-in>") continue
    const key = normalizeSkillKey(skill.name)
    if (key && !local.has(key)) local.set(key, skill)
  }

  const aliases = new Map<string, string>()
  for (const [key] of local) {
    const id = index.get(key)
    if (!id) continue
    aliases.set(key, id)
    const item = remote.find((skill) => skill.id === id)
    const source = local.get(key)
    if (item && source) {
      item.uploadable = skillsFetched && isUploadableSkill(source)
      item.origin = skillOrigin(source, roots)
    }
  }

  const mapped = {
    project: mapInstalledSkills(metadata.project, aliases),
    global: mapInstalledSkills(metadata.global, aliases),
  }
  const extras = Array.from(local.entries()).flatMap(([key, skill]) => {
    if (aliases.has(key)) return []
    return [localSkill(key, skill, skillsFetched, roots)]
  })
  const physical = instances.map((instance) => instanceSkill(instance, remote, skillsFetched))
  const ids = new Set(instances.map((instance) => instance.id))
  const catalog = items.filter((item) => item.type !== "skill" || !ids.has(item.id))

  return {
    marketplaceItems: [...catalog, ...physical, ...extras],
    marketplaceInstalledMetadata: mapped,
  }
}

function instanceSkill(
  instance: SkillInstance,
  remote: readonly SkillMarketplaceItem[],
  skillsFetched: boolean,
): SkillMarketplaceItem {
  const source = remote.find((item) => item.id === instance.id)
  const description = instance.description?.trim() || source?.description || "本地已安装的 Skill"
  return {
    ...(source ?? {
      type: "skill" as const,
      id: instance.id,
      name: instance.name,
      displayName: instance.name,
      description,
      category: "local",
      displayCategory: "本地",
      content: "",
      localOnly: true,
    }),
    description,
    instanceId: instance.instanceId,
    localScope: instance.scope,
    localLocation: instance.location,
    localSha256: instance.sha256,
    effective: instance.effective,
    ...(instance.shadowedBy ? { shadowedBy: instance.shadowedBy } : {}),
    uploadable: skillsFetched,
    origin: "local",
  }
}

function mapInstalledSkills(
  values: MarketplaceInstalledMetadata["project"],
  aliases: ReadonlyMap<string, string>,
): MarketplaceInstalledMetadata["project"] {
  const result = { ...values }
  for (const [key, value] of Object.entries(values)) {
    if (value.type !== "skill") continue
    const id = aliases.get(normalizeSkillKey(key))
    if (id) result[id] = value
  }
  return result
}

function localSkill(id: string, skill: CliSkill, skillsFetched: boolean, roots?: SkillRoots): SkillMarketplaceItem {
  const description = skill.description?.trim() || "本地已安装的 Skill"
  return {
    type: "skill",
    id,
    name: skill.name,
    displayName: skill.name,
    description,
    category: "local",
    displayCategory: "本地",
    content: "",
    localOnly: true,
    uploadable: skillsFetched && isUploadableSkill(skill),
    origin: skillOrigin(skill, roots),
  }
}

function contains(root: string, location: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(location))
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}
