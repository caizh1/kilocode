import { readFile } from "node:fs/promises"
import { Acceptance, evaluate } from "../src/chipmate/spec/evaluation"

const file = process.argv[2]
if (!file) {
  process.stderr.write("请传入内网实际验收记录 JSON 路径；字段定义见 Spec 使用说明。\n")
  process.exit(2)
}
const result = evaluate(Acceptance.parse(JSON.parse(await readFile(file, "utf8"))))
process.stdout.write(`# Spec 固定样本验收\n\n${JSON.stringify(result, null, 2)}\n`)
if (result.结论 !== "达到固定样本目标") process.exitCode = 1
