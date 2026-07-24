import { afterEach, describe, expect, it } from "bun:test"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import {
  findSkillInstance,
  listSkillInstances,
  reconcileSkillInstances,
} from "../../src/services/marketplace/skill-instances"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe("Marketplace Skill instances", () => {
  it("keeps project and global copies while marking the CLI-selected copy active", async () => {
    const root = await temp()
    const global = path.join(root, "global", "skills")
    const project = path.join(root, "project", ".chipmate-v2", "skills")
    const globalFile = await skill(global, "shared", "Global v2")
    const projectFile = await skill(project, "shared", "Project v1")

    const found = await listSkillInstances({ global, project })
    const items = reconcileSkillInstances(found.items, [
      { name: "shared", location: projectFile },
    ])

    expect(found.errors).toEqual([])
    expect(items.map((item) => item.instanceId)).toEqual(["project:shared", "global:shared"])
    expect(items[0]).toMatchObject({ scope: "project", effective: true })
    expect(items[1]).toMatchObject({ scope: "global", effective: false, shadowedBy: "project:shared" })
    expect(items[0].sha256).not.toBe(items[1].sha256)
    expect(globalFile).not.toBe(projectFile)

    await fs.rm(path.dirname(projectFile), { recursive: true })
    const refreshed = await listSkillInstances({ global, project })
    expect(refreshed.items).toHaveLength(1)
    expect(refreshed.items[0]).toMatchObject({ instanceId: "global:shared", effective: true })
  })

  it("rejects noncanonical names, directory mismatches, metadata mismatches, and symlinks", async () => {
    const root = await temp()
    const global = path.join(root, "global", "skills")
    await skill(global, "valid-skill", "Valid")
    await skill(global, "bad-name", "Bad", { name: "Bad Name" })
    await skill(global, "wrong-folder", "Wrong", { name: "other" })
    await skill(global, "bad-metadata", "Metadata", { metadataId: "other" })
    if (process.platform !== "win32") {
      const linked = path.join(global, "linked")
      await fs.symlink(path.join(global, "valid-skill"), linked)
    }

    const found = await listSkillInstances({ global })

    expect(found.items.map((item) => item.id)).toEqual(["valid-skill"])
    expect(found.errors).toHaveLength(process.platform === "win32" ? 3 : 4)
    expect(found.errors.join("\n")).toContain("lowercase hyphenated id")
    expect(found.errors.join("\n")).toContain("must match name")
    expect(found.errors.join("\n")).toContain("skill.json id")
    if (process.platform !== "win32") expect(found.errors.join("\n")).toContain("regular directory")
  })

  it("re-resolves an operation by stable scope-qualified instance id", async () => {
    const root = await temp()
    const global = path.join(root, "global", "skills")
    const project = path.join(root, "project", ".chipmate-v2", "skills")
    await skill(global, "shared", "Global")
    await skill(project, "shared", "Project")

    const found = await findSkillInstance({ global, project }, "global:shared")

    expect(found).toMatchObject({ id: "shared", scope: "global", effective: false })
    expect(found?.location).toBe(path.join(global, "shared", "SKILL.md"))
  })

  it("treats a renamed v2 id as an independent active Skill", async () => {
    const root = await temp()
    const global = path.join(root, "global", "skills")
    const project = path.join(root, "project", ".chipmate-v2", "skills")
    const globalFile = await skill(global, "shared", "Global v1")
    const projectFile = await skill(project, "shared-v2", "Project v2")

    const found = await listSkillInstances({ global, project })
    const items = reconcileSkillInstances(found.items, [
      { name: "shared", location: globalFile },
      { name: "shared-v2", location: projectFile },
    ])

    expect(items.map((item) => [item.instanceId, item.effective])).toEqual([
      ["global:shared", true],
      ["project:shared-v2", true],
    ])
  })
})

async function temp() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chipmate-skill-instances-"))
  roots.push(root)
  return root
}

async function skill(
  root: string,
  id: string,
  description: string,
  opts: { name?: string; metadataId?: string } = {},
) {
  const dir = path.join(root, id)
  const file = path.join(dir, "SKILL.md")
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    file,
    `---\nname: ${opts.name ?? id}\ndescription: ${description}\n---\n\n# ${id}\n\nUse this Skill for deterministic tests.\n`,
  )
  if (opts.metadataId) await fs.writeFile(path.join(dir, "skill.json"), JSON.stringify({ id: opts.metadataId }))
  return file
}
