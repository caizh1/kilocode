import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

test("生产构建包含数据库迁移文件", async () => {
  const source = await fs.readFile(new URL("../src/sql/001-initial.sql", import.meta.url), "utf8")
  const built = await fs.readFile(new URL("../dist/src/sql/001-initial.sql", import.meta.url), "utf8")
  assert.equal(built, source)
})

test("只读 API 启动路径不初始化本地导入目录", async () => {
  const source = await fs.readFile(new URL("../src/start.ts", import.meta.url), "utf8")
  assert.match(source, /runtime\(\{ initializeRawStore: false \}\)/)
})
