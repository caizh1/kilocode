import * as path from "path"
import type { CliSkill } from "./detection"
import type { MarketplaceInstalledMetadata, MarketplaceItem, SkillMarketplaceItem } from "./types"

interface MarketplaceSkillMerge {
  marketplaceItems: MarketplaceItem[]
  marketplaceInstalledMetadata: MarketplaceInstalledMetadata
}

export function normalizeSkillKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function isUploadableSkill(skill: CliSkill): boolean {
  if (skill.location === "builtin") return Boolean(skill.content?.trim())
  return path.basename(skill.location) === "SKILL.md"
}

export function isListedUploadableSkill(id: string, ids: ReadonlySet<string>): boolean {
  const key = normalizeSkillKey(id)
  return Boolean(key && ids.has(key))
}

export function mergeMarketplaceSkills(
  items: MarketplaceItem[],
  skills: CliSkill[] | undefined,
  metadata: MarketplaceInstalledMetadata,
  skillsFetched: boolean,
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
    const key = normalizeSkillKey(skill.name)
    if (key && !local.has(key)) local.set(key, skill)
  }

  const aliases = new Map<string, string>()
  for (const [key] of local) {
    const id = index.get(key)
    if (id) aliases.set(key, id)
  }

  const installed = {
    project: mapInstalledSkills(metadata.project, aliases),
    global: mapInstalledSkills(metadata.global, aliases),
  }
  const extras = Array.from(local.entries()).flatMap(([key, skill]) => {
    if (aliases.has(key)) return []
    return [localSkill(key, skill, skillsFetched)]
  })

  return {
    marketplaceItems: [...items, ...extras],
    marketplaceInstalledMetadata: installed,
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

function localSkill(id: string, skill: CliSkill, skillsFetched: boolean): SkillMarketplaceItem {
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
  }
}
