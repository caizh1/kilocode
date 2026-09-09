import { expect, test } from "bun:test"
import { evaluate, type Acceptance } from "../../src/chipmate/spec/evaluation"
import type { z } from "zod"

function fixture(): z.infer<typeof Acceptance> {
  return {
    部署核对证据: "仅供统计程序测试的固定数据，并非生产验收",
    样本: Array.from({ length: 9 }, (_, index) => ({
      编号: String(index),
      类别: (["协议处理", "调度资源", "FTL/NAND"] as const)[Math.floor(index / 3)],
      已评审: true,
      正常路径: true,
      异常路径: true,
      任务材料: "固定测试材料",
      设计条款: ["R1"],
      映射: [{ 条款: "R1", 代码证据: "固定代码位置", 验证证据: "固定验证位置", 引用准确: true }],
      标注严重问题: ["P1"],
      检出严重问题: ["P1"],
      标注非阻塞问题: ["N1"],
      误报阻塞问题: [],
      人工基线分钟: 100,
      使用Spec人工分钟: { 阅读: 2, 答疑: 2, 纠错: 2, 审核: 2, 重复验证: 2, FPGA操作: 10 },
    })),
  }
}
test("验收统计计入 FPGA 人工时间，达到阈值才放行", () => {
  const data = fixture()
  expect(evaluate(data).结论).toBe("达到固定样本目标")
  data.样本[0].使用Spec人工分钟.FPGA操作 = 11
  expect(evaluate(data).结论).toBe("尚未达到固定样本目标")
})
test("漏检和缺失映射不能通过固定样本门槛", () => {
  const data = fixture()
  data.样本[0].检出严重问题 = []
  data.样本[0].映射 = []
  const result = evaluate(data)
  expect(result.结论).toBe("尚未达到固定样本目标")
  expect(result.指标.严重问题漏检).toBe(1)
  expect(result.指标.映射覆盖率).toBeLessThan(1)
})
test("拒绝用重复样本或空负样本分母充数", () => {
  const data = fixture()
  data.样本[1].编号 = data.样本[0].编号
  expect(() => evaluate(data)).toThrow("编号重复")
  data.样本[1].编号 = "1"
  data.样本.forEach((item) => {
    item.标注非阻塞问题 = []
  })
  expect(() => evaluate(data)).toThrow("空分母")
})
