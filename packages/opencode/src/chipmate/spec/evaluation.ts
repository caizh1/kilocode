import { z } from "zod"
// 仅统计人工验收记录，不参与 Agent 调度或批准。
function requireValue(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

const names = z.array(z.string().min(1))
export const Acceptance = z.object({
  部署核对证据: z.string().min(1),
  样本: z
    .array(
      z.object({
        编号: z.string().min(1),
        类别: z.enum(["协议处理", "调度资源", "FTL/NAND"]),
        已评审: z.literal(true),
        正常路径: z.boolean(),
        异常路径: z.boolean(),
        任务材料: z.string().min(1),
        设计条款: names.min(1),
        映射: z.array(
          z.object({
            条款: z.string().min(1),
            代码证据: z.string().min(1),
            验证证据: z.string().min(1),
            引用准确: z.boolean(),
          }),
        ),
        标注严重问题: names,
        检出严重问题: names,
        标注非阻塞问题: names,
        误报阻塞问题: names,
        人工基线分钟: z.number().positive(),
        使用Spec人工分钟: z.object({
          阅读: z.number().nonnegative(),
          答疑: z.number().nonnegative(),
          纠错: z.number().nonnegative(),
          审核: z.number().nonnegative(),
          重复验证: z.number().nonnegative(),
          FPGA操作: z.number().nonnegative(),
        }),
      }),
    )
    .min(9),
})

export function evaluate(input: z.infer<typeof Acceptance>) {
  const data = Acceptance.parse(input)
  requireValue(new Set(data.样本.map((item) => item.编号)).size === data.样本.length, "验收样本编号重复")
  for (const category of ["协议处理", "调度资源", "FTL/NAND"]) {
    const samples = data.样本.filter((item) => item.类别 === category)
    requireValue(
      samples.length >= 3 && samples.some((item) => item.正常路径) && samples.some((item) => item.异常路径),
      `${category} 需要至少三个真实样本并覆盖正常、异常路径`,
    )
  }
  let requirements = 0
  let covered = 0
  let links = 0
  let correct = 0
  let missed = 0
  let positives = 0
  let negatives = 0
  let baseline = 0
  let assisted = 0
  for (const item of data.样本) {
    for (const values of [item.设计条款, item.标注严重问题, item.检出严重问题, item.标注非阻塞问题, item.误报阻塞问题])
      requireValue(new Set(values).size === values.length, `样本 ${item.编号} 含重复条款或问题编号`)
    requireValue(
      item.检出严重问题.every((id) => item.标注严重问题.includes(id)),
      "检出严重问题必须与人工标注对应",
    )
    requireValue(
      item.误报阻塞问题.every((id) => item.标注非阻塞问题.includes(id)),
      "误报必须与人工非阻塞标注对应",
    )
    requireValue(
      item.映射.every((mapping) => item.设计条款.includes(mapping.条款)),
      "映射包含未知设计条款",
    )
    requirements += item.设计条款.length
    covered += new Set(item.映射.map((mapping) => mapping.条款)).size
    links += item.映射.length
    correct += item.映射.filter((mapping) => mapping.引用准确).length
    missed += item.标注严重问题.filter((id) => !item.检出严重问题.includes(id)).length
    positives += item.误报阻塞问题.length
    negatives += item.标注非阻塞问题.length
    baseline += item.人工基线分钟
    assisted += Object.values(item.使用Spec人工分钟).reduce((sum, value) => sum + value, 0)
  }
  requireValue(
    negatives > 0 && data.样本.some((item) => item.标注严重问题.length),
    "必须包含已标注的严重问题和非阻塞样本，不能以空分母宣称通过",
  )
  const metrics = {
    映射覆盖率: covered / requirements,
    证据准确率: links ? correct / links : 0,
    严重问题漏检: missed,
    阻塞误报率: positives / negatives,
    人工耗时减少比例: 1 - assisted / baseline,
    人工基线分钟: baseline,
    实际人工分钟: assisted,
  }
  return {
    结论:
      metrics.映射覆盖率 === 1 &&
      metrics.证据准确率 >= 0.95 &&
      missed === 0 &&
      metrics.阻塞误报率 <= 0.05 &&
      metrics.人工耗时减少比例 >= 0.8
        ? "达到固定样本目标"
        : "尚未达到固定样本目标",
    指标: metrics,
    边界: "仅依据已评审的实际样本记录计算；程序不能替代人工核对证据真实性，结果不外推为所有项目零漏检。",
  }
}
