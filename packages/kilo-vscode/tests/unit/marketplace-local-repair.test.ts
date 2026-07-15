import { createHash } from "crypto"
import { describe, expect, it } from "bun:test"
import { mkdtemp, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { planLocalRepairs } from "../../src/services/marketplace/local-repair"

describe("Marketplace deterministic local repair", () => {
  it("plans only exact-hash safe-path replacements and does not write local files", async () => {
    const root = await mkdtemp(join(tmpdir(), "chipmate-local-repair-"))
    try {
      const before = "# Before\n"
      const after = "# After\n"
      await writeFile(join(root, "SKILL.md"), before)
      const files = [
        {
          path: "SKILL.md",
          beforeSha256: createHash("sha256").update(before).digest("hex"),
          afterSha256: createHash("sha256").update(after).digest("hex"),
          patch: `replace-base64:${Buffer.from(after).toString("base64")}`,
        },
        {
          path: "../outside",
          beforeSha256: "0".repeat(64),
          afterSha256: "0".repeat(64),
          patch: "replace-base64:",
        },
      ]
      expect(await planLocalRepairs(root, files)).toEqual([{ path: "SKILL.md", before, after }])
      expect(await Bun.file(join(root, "SKILL.md")).text()).toBe(before)
      expect(await planLocalRepairs(root, [{ ...files[0]!, beforeSha256: "0".repeat(64) }])).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
