import { readFile } from "node:fs/promises"
import { evaluateGoldSet, PatentRadarGoldSet } from "../src/chipmate/patent-radar/quality"

const file = process.argv[2]
if (!file) {
  console.error("用法：bun run patent-radar:evaluate <gold-set.json>")
  process.exit(2)
}

const input = PatentRadarGoldSet.parse(JSON.parse(await readFile(file, "utf8")))
const result = evaluateGoldSet(input)
const percent = (value: number) => `${(value * 100).toFixed(1)}%`

console.log(
  JSON.stringify(
    {
      状态: result.passed ? "质量门槛通过" : "保持实验性技术发现",
      样本规模合格: result.metrics.sampleReady,
      总体召回率: percent(result.metrics.recall),
      跨文件召回率: percent(result.metrics.crossFileRecall),
      主候选精度: percent(result.metrics.precision),
      冲突召回率前五十: percent(result.metrics.conflictRecallAt50),
      人工工作量减少: percent(result.metrics.workReduction),
      引用全部可解析: result.metrics.citationsResolved,
      固定冲突样本安全: result.metrics.fixedConflictSafe,
    },
    null,
    2,
  ),
)

if (!result.passed) process.exitCode = 1
