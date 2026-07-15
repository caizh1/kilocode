import { describe, expect, it } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { discoverSkillCandidates } from "@chipmate/skill-spec/node"
import { LocalSkillImporter } from "../../src/services/marketplace/local-import"
import type { LocalSkillRecord } from "../../src/services/marketplace/types"

class Records {
  readonly items: LocalSkillRecord[] = []

  workspaceId(dir: string | undefined) {
    return dir ? "workspace-test-hash" : undefined
  }

  async put(item: LocalSkillRecord) {
    this.items.push(structuredClone(item))
  }
}

describe("local Skill import transactions", () => {
  it("installs project and global snapshots without modifying or leaking the source", async () => {
    await fixture(async ({ root, source, project, home }) => {
      const records = new Records()
      const importer = new LocalSkillImporter(records, undefined, undefined, home)
      const before = await fs.readFile(path.join(source, "SKILL.md"))
      const preview = await importer.preview(source, project)
      expect(preview.projectAvailable).toBe(true)
      expect(preview.candidates).toHaveLength(1)
      expect(preview.candidates[0]?.conflicts.map((item) => item.scope)).toEqual(["project", "global"])

      const projectResult = await importer.install(
        {
          token: preview.token,
          candidateIds: [preview.candidates[0]!.key],
          scope: "project",
          replaceIds: [],
        },
        project,
      )
      expect(projectResult.items).toEqual([{ id: "portable-skill", status: "installed" }])
      const target = path.join(project, ".kilo", "skills", "portable-skill")
      expect((await discoverSkillCandidates(target))[0]?.snapshot.valid).toBe(true)
      expect(await fs.readFile(path.join(source, "SKILL.md"))).toEqual(before)
      await expect(fs.access(path.join(source, "skill.json"))).rejects.toThrow()

      const globalPreview = await importer.preview(source, project)
      const globalResult = await importer.install(
        {
          token: globalPreview.token,
          candidateIds: [globalPreview.candidates[0]!.key],
          scope: "global",
          replaceIds: [],
        },
        project,
      )
      expect(globalResult.items[0]?.status).toBe("installed")
      expect((await discoverSkillCandidates(path.join(home, ".kilo", "skills", "portable-skill")))[0]?.snapshot.valid).toBe(
        true,
      )
      expect(records.items).toHaveLength(2)
      expect(records.items[0]?.sourceSha256).toHaveLength(64)
      expect(records.items[0]?.installedSha256).toHaveLength(64)
      expect(records.items[0]?.sourceSha256).not.toBe(records.items[0]?.installedSha256)
      const serialized = JSON.stringify(records.items)
      expect(serialized).not.toContain(root)
      expect(serialized).not.toContain(project)
      expect(serialized).not.toContain(os.userInfo().username)
      expect(records.items[0]?.sourceLabel).toBe(path.basename(source))
    })
  })

  it("deduplicates equal content and requires explicit replacement for changed content", async () => {
    await fixture(async ({ source, project, home }) => {
      const importer = new LocalSkillImporter(new Records(), undefined, undefined, home)
      const first = await importer.preview(source, project)
      await importer.install(
        { token: first.token, candidateIds: [first.candidates[0]!.key], scope: "project", replaceIds: [] },
        project,
      )

      const same = await importer.preview(source, project)
      expect(same.candidates[0]?.conflicts.find((item) => item.scope === "project")?.state).toBe("same")
      const unchanged = await importer.install(
        { token: same.token, candidateIds: [same.candidates[0]!.key], scope: "project", replaceIds: [] },
        project,
      )
      expect(unchanged.items[0]?.status).toBe("unchanged")

      await fs.writeFile(path.join(source, "references", "guide.md"), "changed guide\n")
      const changed = await importer.preview(source, project)
      expect(changed.candidates[0]?.conflicts.find((item) => item.scope === "project")?.state).toBe("different")
      const skipped = await importer.install(
        { token: changed.token, candidateIds: [changed.candidates[0]!.key], scope: "project", replaceIds: [] },
        project,
      )
      expect(skipped.items[0]?.status).toBe("skipped")

      const replacement = await importer.preview(source, project)
      const installed = await importer.install(
        {
          token: replacement.token,
          candidateIds: [replacement.candidates[0]!.key],
          scope: "project",
          replaceIds: [replacement.candidates[0]!.key],
        },
        project,
      )
      expect(installed.items[0]?.status).toBe("installed")
      expect(await fs.readFile(path.join(project, ".kilo", "skills", "portable-skill", "references", "guide.md"), "utf8")).toBe(
        "changed guide\n",
      )
      expect((await fs.readdir(path.join(project, ".kilo", "skills"))).some((name) => name.startsWith(".backup-"))).toBe(
        false,
      )
    })
  })

  it("reports managed conflicts, rolls back a failed item, and continues the batch", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-local-import-batch-"))
    try {
      const source = path.join(root, "source")
      const project = path.join(root, "project")
      const home = path.join(root, "home")
      await skill(path.join(source, "bad"), "bad-skill", "Bad instructions")
      await skill(path.join(source, "good"), "good-skill", "Good instructions")
      await fs.mkdir(path.join(project, ".kilo", "skills", "bad-skill"), { recursive: true })
      await fs.writeFile(
        path.join(project, ".kilo", "skills", "bad-skill", "SKILL.md"),
        markdown("bad-skill", "Old managed instructions"),
      )
      const records = new Records()
      records.put = async (item) => {
        if (item.skillId === "bad-skill") throw new Error("registry unavailable")
        records.items.push(structuredClone(item))
      }
      const importer = new LocalSkillImporter(records, async (id) => id === "bad-skill", undefined, home)
      const preview = await importer.preview(source, project)
      const bad = preview.candidates.find((item) => item.id === "bad-skill")!
      expect(bad.conflicts.find((item) => item.scope === "project")?.state).toBe("managed")
      const result = await importer.install(
        {
          token: preview.token,
          candidateIds: preview.candidates.map((item) => item.key),
          scope: "project",
          replaceIds: [bad.key],
        },
        project,
      )
      expect(result.items.find((item) => item.id === "bad-skill")?.status).toBe("failed")
      expect(result.items.find((item) => item.id === "good-skill")?.status).toBe("installed")
      expect(await fs.readFile(path.join(project, ".kilo", "skills", "bad-skill", "SKILL.md"), "utf8")).toContain(
        "Old managed instructions",
      )
      expect((await discoverSkillCandidates(path.join(project, ".kilo", "skills", "good-skill")))[0]?.snapshot.valid).toBe(
        true,
      )
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("cancellation lets the active item finish and skips subsequent items", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-local-import-cancel-"))
    try {
      const source = path.join(root, "source")
      const project = path.join(root, "project")
      await skill(path.join(source, "one"), "one-skill", "One instructions")
      await skill(path.join(source, "two"), "two-skill", "Two instructions")
      let importer: LocalSkillImporter
      importer = new LocalSkillImporter(
        new Records(),
        undefined,
        (progress) => {
          if (progress.completed === 1) importer.cancel(progress.token)
        },
        path.join(root, "home"),
      )
      const preview = await importer.preview(source, project)
      const result = await importer.install(
        {
          token: preview.token,
          candidateIds: preview.candidates.map((item) => item.key),
          scope: "project",
          replaceIds: [],
        },
        project,
      )
      expect(result.items[0]?.status).toBe("installed")
      expect(result.items[1]?.status).toBe("skipped")
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})

async function fixture(
  run: (value: { root: string; source: string; project: string; home: string }) => Promise<void>,
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-local-import-"))
  const source = path.join(root, "source-skill")
  const project = path.join(root, "project")
  const home = path.join(root, "home")
  try {
    await skill(source, "portable-skill", "Portable instructions")
    await run({ root, source, project, home })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

async function skill(dir: string, name: string, description: string) {
  await fs.mkdir(path.join(dir, "references"), { recursive: true })
  await fs.writeFile(path.join(dir, "SKILL.md"), markdown(name, description))
  await fs.writeFile(path.join(dir, "references", "guide.md"), "source guide\n")
}

function markdown(name: string, description: string) {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nUse this Skill to produce actionable engineering output.\n`
}
