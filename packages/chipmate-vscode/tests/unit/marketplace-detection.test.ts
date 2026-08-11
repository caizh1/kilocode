import { afterEach, describe, expect, it } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { InstallationDetector } from "../../src/services/marketplace/detection"
import { MarketplacePaths } from "../../src/services/marketplace/paths"

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe("Marketplace Skill installation detection", () => {
  it("classifies a built-in grill-me Skill as globally installed", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "marketplace-detection-"))
    dirs.push(root)
    const workspace = path.join(root, "repo")
    await fs.mkdir(workspace, { recursive: true })

    const detector = new InstallationDetector(new MarketplacePaths(path.join(root, "global")))
    const result = await detector.detect(workspace, [{ name: "grill-me", location: "builtin" }])

    expect(result.project["grill-me"]).toBeUndefined()
    expect(result.global["grill-me"]).toEqual({ type: "skill" })
  })

  it("classifies a project Skill through a canonical workspace alias", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "marketplace-detection-"))
    dirs.push(root)
    const actual = path.join(root, "actual")
    const alias = path.join(root, "alias")
    const skill = path.join(actual, ".chipmate-v2", "skills", "qa-skill", "SKILL.md")
    await fs.mkdir(path.dirname(skill), { recursive: true })
    await fs.writeFile(skill, "# QA Skill\n")
    await fs.symlink(actual, alias)

    const detector = new InstallationDetector(new MarketplacePaths(path.join(root, "global")))
    const result = await detector.detect(alias, [{ name: "qa-skill", location: skill }])

    expect(result.project["qa-skill"]).toEqual({ type: "skill" })
    expect(result.global["qa-skill"]).toBeUndefined()
  })

  it("does not classify a sibling path with the same prefix as project scope", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "marketplace-detection-"))
    dirs.push(root)
    const workspace = path.join(root, "repo")
    const skill = path.join(root, "repo-other", "SKILL.md")
    await fs.mkdir(workspace, { recursive: true })
    await fs.mkdir(path.dirname(skill), { recursive: true })
    await fs.writeFile(skill, "# QA Skill\n")

    const detector = new InstallationDetector(new MarketplacePaths(path.join(root, "global")))
    const result = await detector.detect(workspace, [{ name: "qa-skill", location: skill }])

    expect(result.project["qa-skill"]).toBeUndefined()
    expect(result.global["qa-skill"]).toEqual({ type: "skill" })
  })
})
