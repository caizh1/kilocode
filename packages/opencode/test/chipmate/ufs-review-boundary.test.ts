import { describe, expect, test } from "bun:test"
import path from "node:path"

const root = path.resolve(import.meta.dir, "../..")
const generic = ["src/session/prompt.ts", "src/session/tools.ts", "src/tool/task.ts", "src/tool/registry.ts"]
const marker = /UfsReview|ufsReview|ufs-review|ufs_review/

describe("Reviewer 对普通 QA 的静态隔离", () => {
  test("通用 Session、Task 和工具注册路径没有 Reviewer 专属逻辑", async () => {
    for (const file of generic) {
      const content = await Bun.file(path.join(root, file)).text()
      expect(content, file).not.toMatch(marker)
    }
  })
})
