const { writeFileSync } = require("node:fs")

const disposed = process.env.CHIPMATE_DSH_TEST_DISPOSED
console.log("dsh web: http://127.0.0.1:41234")
const close = () => {
  if (disposed) writeFileSync(disposed, "已执行正常清理\n")
  process.exit(0)
}
process.once("SIGINT", close)
process.once("SIGTERM", close)
setInterval(() => undefined, 1_000)
