import { describe, expect, it } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  buildMarketplaceBuiltinSkillUploadPayload,
  buildMarketplaceSkillUploadPayload,
} from "../../src/services/marketplace/upload"

async function withTempSkill<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-skill-"))
  try {
    return await fn(dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
}

describe("marketplace skill upload scanner", () => {
  it("accepts a standard skill with references and scripts", async () => {
    await withTempSkill(async (dir) => {
      await fs.writeFile(
        path.join(dir, "SKILL.md"),
        "---\nname: Fancy Skill\ndescription: Useful skill\ncategory: docs\n---\n# Fancy Skill\n",
      )
      await fs.mkdir(path.join(dir, "references"))
      await fs.mkdir(path.join(dir, "scripts"))
      await fs.mkdir(path.join(dir, "agents"))
      await fs.mkdir(path.join(dir, "custom"))
      await fs.writeFile(path.join(dir, "references", "guide.md"), "guide")
      await fs.writeFile(path.join(dir, "scripts", "run.sh"), "echo ok\n")
      await fs.writeFile(path.join(dir, "agents", "openai.yaml"), "interface:\n  display_name: Fancy\n")
      await fs.writeFile(path.join(dir, "custom", "portable.json"), '{"preserved":true}\n')

      const payload = await buildMarketplaceSkillUploadPayload(dir)

      expect(payload.id).toBe("fancy-skill")
      expect(payload.name).toBe("fancy-skill")
      expect(payload.description).toBe("Useful skill")
      expect(payload.category).toBe("docs")
      expect(payload.files.map((file) => file.path).toSorted()).toEqual([
        "SKILL.md",
        "agents/openai.yaml",
        "custom/portable.json",
        "references/guide.md",
        "scripts/run.sh",
        "skill.json",
      ])
      expect(await fs.readFile(path.join(dir, "SKILL.md"), "utf8")).toContain("name: Fancy Skill")
      await expect(fs.access(path.join(dir, "skill.json"))).rejects.toThrow()
    })
  })

  it("requires SKILL.md at the skill root", async () => {
    await withTempSkill(async (dir) => {
      await fs.writeFile(path.join(dir, "README.md"), "# Missing")

      await expect(buildMarketplaceSkillUploadPayload(dir)).rejects.toThrow("No SKILL.md")
    })
  })

  it("rejects symlinked files", async () => {
    await withTempSkill(async (dir) => {
      await fs.writeFile(path.join(dir, "SKILL.md"), "# Linked")
      await fs.mkdir(path.join(dir, "references"))
      await fs.writeFile(path.join(dir, "target.md"), "secret")
      await fs.symlink(path.join(dir, "target.md"), path.join(dir, "references", "target.md"))

      await expect(buildMarketplaceSkillUploadPayload(dir)).rejects.toThrow("symlink")
    })
  })

  it("packages a plugin-built-in Skill without asking for a local directory", () => {
    const payload = buildMarketplaceBuiltinSkillUploadPayload({
      name: "Kilo Config",
      description: "Configure Kilo",
      content: "---\ncategory: configuration\n---\n# Kilo Config\n",
    })

    expect(payload).toEqual({
      id: "kilo-config",
      name: "Kilo Config",
      description: "Configure Kilo",
      category: "configuration",
      files: [
        {
          path: "SKILL.md",
          contentBase64: Buffer.from("---\ncategory: configuration\n---\n# Kilo Config\n").toString("base64"),
          sizeBytes: Buffer.byteLength("---\ncategory: configuration\n---\n# Kilo Config\n"),
        },
      ],
    })
  })

  it("rejects a plugin-built-in Skill that was rendered to HTML", () => {
    expect(() =>
      buildMarketplaceBuiltinSkillUploadPayload({
        name: "Documents",
        description: "Create documents",
        content: "<hr />\n<p>name: documents</p>\n<h1>Kilo Documents Skill</h1>\n",
      }),
    ).toThrow("内置 Skill 内容已被渲染为 HTML")
  })
})
