import * as path from "path"

export class MarketplacePaths {
  constructor(private readonly global = path.join(process.env.HOME ?? "", ".chipmate-v2")) {}

  /** Project-scope config file: <workspace>/.chipmate-v2/kilo.json */
  configPath(scope: "project" | "global", workspace?: string): string {
    if (scope === "project") return path.join(workspace!, ".chipmate-v2", "kilo.json")
    return path.join(this.global, "kilo.json")
  }

  /** Agent install directory (where marketplace agents are written as .md files). */
  agentsDir(scope: "project" | "global", workspace?: string): string {
    if (scope === "project") return path.join(workspace!, ".chipmate-v2", "agents")
    return path.join(this.global, "agents")
  }

  /** Skill install directory (where the marketplace installer writes to). */
  skillsDir(scope: "project" | "global", workspace?: string): string {
    if (scope === "project") return path.join(workspace!, ".chipmate-v2", "skills")
    return path.join(this.global, "skills")
  }
}
