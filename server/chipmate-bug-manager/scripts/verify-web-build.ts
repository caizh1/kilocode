import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

const path = resolve("dist/web/index.html")
const html = await readFile(path, "utf8")
const assets = [...html.matchAll(/\b(?:src|href)="([^"]*assets\/[^"]+)"/g)].map((match) => match[1])

if (assets.length === 0) throw new Error("生产页面没有找到脚本或样式资源")

const invalid = assets.filter((asset) => !asset?.startsWith("/bugs/assets/"))
if (invalid.length > 0) {
  throw new Error(`生产页面资源没有使用 /bugs/ 基路径：${invalid.join("、")}`)
}

console.log("ChipMate Bug 生产页面资源基路径验证通过。")
