import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { runProgress } from "../web/src/run-progress.js"

describe("ChipMate 修复进度", () => {
  it("影子模式在等待确认时完成修复进度", () => {
    const progress = runProgress("approval_wait", "shadow")
    assert.equal(progress.percentage, 100)
    assert.equal(progress.activeIndex, 5)
    assert.equal(progress.stages.length, 6)
  })

  it("发布模式继续显示打包、验收和发布阶段", () => {
    const progress = runProgress("validating", "release")
    assert.equal(progress.label, "双平台验收")
    assert.equal(progress.activeIndex, 7)
    assert.equal(progress.stages.length, 10)
  })

  it("失败状态明确显示流程中断，不伪造具体失败阶段", () => {
    const progress = runProgress("failed", "shadow")
    assert.equal(progress.terminal, true)
    assert.equal(progress.activeIndex, -1)
    assert.equal(progress.label, "流程已失败")
  })
})
