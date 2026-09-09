import path from "node:path"
import { runtime } from "./runtime.js"
import { watch } from "./importer.js"

const command = process.argv[2] || "help"
const app = await runtime()

try {
  if (command === "scan") {
    const results = await app.importer.scan()
    console.log(JSON.stringify({ 状态: "完成", 结果: results }, null, 2))
  } else if (command === "import") {
    const file = process.argv[3]
    if (!file) throw new Error("用法：patentctl import <数据包路径>")
    const result = await app.importer.import(path.resolve(file))
    console.log(JSON.stringify({ 状态: "完成", 结果: result }, null, 2))
  } else if (command === "verify") {
    const status = await app.database.status(await app.search.health())
    console.log(JSON.stringify({ 状态: status.state === "READY" ? "通过" : "未通过", 语料: status }, null, 2))
    if (status.state !== "READY") process.exitCode = 2
  } else if (command === "requeue-raw") {
    const files = await app.importer.raw.requeueRaw(process.argv[3])
    console.log(JSON.stringify({ 状态: "完成", 重排队数量: files.length, 文件: files }, null, 2))
  } else if (command === "watch") {
    const interval = Number(process.env.PATENT_DROP_SCAN_MS || 30_000)
    console.log(`[Patent Server] 正在监视 ${app.importer.raw.paths.drop}，周期 ${interval}ms`)
    await watch(app.importer, Number.isFinite(interval) && interval >= 5_000 ? interval : 30_000)
  } else {
    console.log(
      "ChipMate Patent Server 管理命令\n\n  scan                         扫描 drop 目录\n  import <数据包路径>           导入单个包\n  verify                       检查在线语料完整性状态\n  requeue-raw [SHA-256]        从原始区重建 drop 队列\n  watch                        持续监视 drop 目录",
    )
  }
} finally {
  if (command !== "watch") await app.database.close()
}
