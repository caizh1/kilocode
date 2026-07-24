import * as fs from "fs/promises"
import * as path from "path"
import type { MarketplaceInstalledMetadata } from "./types"
import { MarketplacePaths } from "./paths"
import { normalizeSkillKey } from "./skills"
import type { SkillInstance } from "./skill-instances"

type Entry = [string, { type: string }]

function entry(id: string, type: "agent" | "mcp" | "skill"): Entry {
  return [`${type}:${id}`, { type }]
}

export interface CliSkill {
  name: string
  description?: string
  location: string
  content?: string
}

export class InstallationDetector {
  constructor(private paths: MarketplacePaths) {}

  /**
   * Detect installed marketplace items.
   *
   * Agents are detected from .chipmate-v2/agents/*.md files.
   * MCP servers and modes are detected from kilo.json config files.
   * Skills come from the CLI backend (via GET /skill), which is the
   * authoritative source — it scans all skill directories.
   */
  async detect(
    workspace?: string,
    skills?: CliSkill[],
    instances: readonly SkillInstance[] = [],
  ): Promise<MarketplaceInstalledMetadata> {
    const root = workspace ? await this.canonical(workspace) : undefined
    const entries = await this.skillEntries(skills, root, instances)
    const project = workspace
      ? Object.fromEntries([
          ...(await this.detectAgentFiles("project", workspace)),
          ...(await this.detectFromConfig(this.paths.configPath("project", workspace))),
          ...entries.project,
        ])
      : {}

    const global = Object.fromEntries([
      ...(await this.detectAgentFiles("global")),
      ...(await this.detectFromConfig(this.paths.configPath("global"))),
      ...entries.global,
    ])

    return { project, global }
  }

  private async canonical(value: string): Promise<string> {
    try {
      return await fs.realpath(value)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return path.resolve(value)
      throw err
    }
  }

  private isProjectSkill(location: string, workspace: string): boolean {
    const relative = path.relative(workspace, location)
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  }

  private async skillEntries(
    skills: CliSkill[] | undefined,
    workspace: string | undefined,
    instances: readonly SkillInstance[],
  ): Promise<{ project: Entry[]; global: Entry[] }> {
    if (!skills) {
      return {
        project: instances.filter((item) => item.scope === "project").map((item) => [item.id, { type: "skill" }]),
        global: instances.filter((item) => item.scope === "global").map((item) => [item.id, { type: "skill" }]),
      }
    }
    const resolved = await Promise.all(
      skills
        .filter(
          (skill) =>
            instances.length === 0 || skill.location === "builtin" || skill.location === "<built-in>",
        )
        .map(async (skill) => ({
          skill,
          location: skill.location === "builtin" ? skill.location : await this.canonical(skill.location),
        })),
    )
    const map = (project: boolean) =>
      resolved
        .filter(({ location }) =>
          project
            ? location !== "builtin" && !!workspace && this.isProjectSkill(location, workspace)
            : location === "builtin" || !workspace || !this.isProjectSkill(location, workspace),
        )
        .map(({ skill }): Entry => [normalizeSkillKey(skill.name), { type: "skill" }])
        .filter(([id]) => Boolean(id))
    return {
      project: [
        ...map(true),
        ...instances.filter((item) => item.scope === "project").map((item): Entry => [item.id, { type: "skill" }]),
      ],
      global: [
        ...map(false),
        ...instances.filter((item) => item.scope === "global").map((item): Entry => [item.id, { type: "skill" }]),
      ],
    }
  }

  /** Scan .chipmate-v2/agents/*.md files to detect installed marketplace agents. */
  private async detectAgentFiles(scope: "project" | "global", workspace?: string): Promise<Entry[]> {
    const dir = this.paths.agentsDir(scope, workspace)
    try {
      const files = await fs.readdir(dir)
      return files.filter((file) => file.endsWith(".md")).map((file) => entry(path.basename(file, ".md"), "agent"))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`Failed to detect agent files from ${dir}:`, err)
      }
      return []
    }
  }

  /** Read mcp and agent entries from a kilo.json config file. */
  private async detectFromConfig(filepath: string): Promise<Entry[]> {
    try {
      const content = await fs.readFile(filepath, "utf-8")
      const parsed = JSON.parse(content)
      const entries: Entry[] = []

      if (parsed?.mcp && typeof parsed.mcp === "object") {
        for (const key of Object.keys(parsed.mcp)) {
          entries.push(entry(key, "mcp"))
        }
      }

      if (parsed?.agent && typeof parsed.agent === "object") {
        for (const key of Object.keys(parsed.agent)) {
          entries.push(entry(key, "agent"))
        }
      }

      return entries
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`Failed to detect items from ${filepath}:`, err)
      }
      return []
    }
  }
}
