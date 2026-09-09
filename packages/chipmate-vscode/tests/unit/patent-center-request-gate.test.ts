import { describe, expect, it } from "bun:test"
import { PatentCenterRequestGate } from "../../webview-ui/src/components/settings/patent-center-request-gate"

describe("专利中心异常请求时序", () => {
  it("乱序返回时只接受最新扫描动作", () => {
    const gate = new PatentCenterRequestGate()
    const first = gate.beginScan()
    const second = gate.beginScan()

    expect(gate.isLatestScan(second)).toBeTrue()
    expect(gate.isLatestScan(first)).toBeFalse()
  })

  it("取消未回执前拒绝重复取消，并忽略过期回执", () => {
    const gate = new PatentCenterRequestGate()

    expect(gate.beginCancel("cancel-1")).toBeTrue()
    expect(gate.beginCancel("cancel-2")).toBeFalse()
    expect(gate.completeCancel("cancel-old")).toBeFalse()
    expect(gate.completeCancel("cancel-1")).toBeTrue()
    expect(gate.beginCancel("cancel-3")).toBeTrue()
  })
})
