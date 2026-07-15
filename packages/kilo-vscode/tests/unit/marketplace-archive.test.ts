import { describe, expect, it } from "bun:test"
import { execFileSync } from "child_process"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { createSkillArchive } from "../../src/services/marketplace/archive"

describe("aligned Marketplace publication archive", () => {
  it("builds a deterministic root archive without reading or modifying local files", () => {
    const root = mkdtempSync(join(tmpdir(), "chipmate-kilo-archive-"))
    try {
      const archive = createSkillArchive("my-skill", [
        { path: "SKILL.md", contentBase64: Buffer.from("# My Skill\n").toString("base64") },
        { path: "references/guide.md", contentBase64: Buffer.from("Guide\n").toString("base64") },
      ])
      const file = join(root, "skill.tar.gz")
      const output = join(root, "output")
      writeFileSync(file, archive)
      mkdirSync(output)
      execFileSync("tar", ["-xzf", file, "-C", output])
      expect(readFileSync(join(output, "my-skill", "SKILL.md"), "utf8")).toBe("# My Skill\n")
      expect(readFileSync(join(output, "my-skill", "references", "guide.md"), "utf8")).toBe("Guide\n")
      expect(() => createSkillArchive("my-skill", [{ path: "../secret", contentBase64: "" }])).toThrow(
        "Unsafe Skill path",
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
