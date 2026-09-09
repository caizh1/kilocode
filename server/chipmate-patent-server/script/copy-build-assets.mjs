import fs from "node:fs/promises"
import path from "node:path"

const source = path.resolve("src/sql")
const destination = path.resolve("dist/src/sql")
const entries = (await fs.readdir(source, { withFileTypes: true })).filter(
  (entry) => entry.isFile() && entry.name.endsWith(".sql"),
)

if (entries.length === 0) throw new Error("构建失败：src/sql 中没有数据库迁移文件")

await fs.mkdir(destination, { recursive: true })
await Promise.all(entries.map((entry) => fs.copyFile(path.join(source, entry.name), path.join(destination, entry.name))))
