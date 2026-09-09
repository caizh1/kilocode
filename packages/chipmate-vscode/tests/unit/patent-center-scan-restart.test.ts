import { describe, expect, it } from "bun:test"

const component = await Bun.file(
  new URL("../../webview-ui/src/components/settings/PatentCenterTab.tsx", import.meta.url),
).text()
const dialog = await Bun.file(
  new URL("../../webview-ui/src/components/settings/PatentRadarProgressDialog.tsx", import.meta.url),
).text()
const provider = await Bun.file(new URL("../../src/ChipMateProvider.ts", import.meta.url)).text()
const webviewMessages = await Bun.file(
  new URL("../../webview-ui/src/types/messages/webview-messages.ts", import.meta.url),
).text()
const extensionMessages = await Bun.file(
  new URL("../../webview-ui/src/types/messages/extension-messages.ts", import.meta.url),
).text()
const register = await Bun.file(new URL("../../src/patent-radar/register.ts", import.meta.url)).text()

describe("专利中心取消后重新扫描", () => {
  it("启动新扫描前清除旧运行，并立即展示准备状态", () => {
    const start = component.slice(component.indexOf("const startScan = () =>"), component.indexOf("const run = (action:"))
    expect(start).toContain("if (!analysisModel() || scanActionLoading()) return")
    expect(start).toContain("setActivity(null)")
    expect(start).toContain('action: "scan"')
    expect(start).toContain("poll()")
  })

  it("慢轮询不阻塞后续请求，且旧响应不能覆盖新状态", () => {
    expect(component).toContain("activityRequests.set(requestId, ++activitySequence)")
    expect(component).toContain("if (sequence <= appliedActivitySequence) return")
    expect(component).toContain("appliedActivitySequence = sequence")
    expect(component).toContain("appliedActivitySequence = Math.max(appliedActivitySequence, activitySequence)")
    expect(component).not.toContain("if (activityRequest()) return")
  })

  it("启动请求携带 requestId，并显示真实状态读取错误", () => {
    expect(component).toContain('type: "runPatentCenterAction"')
    expect(component).toContain("requestId,")
    expect(component).toContain("无法读取 Patent Radar 扫描状态")
    expect(component).toContain("重新读取")
  })

  it("弹窗重新开始复用同一启动流程", () => {
    expect(component).toContain("onRestart={() => startScan()}")
  })

  it("模块扫描沿用专利中心已选择的分析模型", () => {
    expect(component).toContain(
      '...(action === "scanModule" && analysisModel() ? { analysisModel: analysisModel()! } : {})',
    )
  })

  it("启动请求未完成时禁止重复发起全项目或模块扫描", () => {
    expect(component).toContain("if (!analysisModel() || scanActionLoading()) return")
    expect(component).toContain("setScanActionLoading(true)")
    expect(component).toContain("!analysisModel() || scanActionLoading()")
    expect(component).toContain('item.action === "scanModule" && activity()?.status === "SCANNING"')
    expect(register).not.toContain('find((run) => run.status === "SCANNING")\n    if (active) return client.resume')
  })

  it("并发动作只允许最新扫描响应更新界面", () => {
    expect(component).toContain("!requestGate.isLatestScan(request.sequence)")
    expect(component).toContain('actionRequests.set(requestId, { action: "scan", sequence: requestGate.beginScan() })')
    expect(component).toContain('const sequence = action === "scanModule" ? requestGate.beginScan() : undefined')
  })

  it("取消扫描具有请求标识、回执和重复点击保护", () => {
    expect(component).toContain('type: "cancelPatentRadarRun", requestId, runId')
    expect(component).toContain('message.type === "patentRadarCancelCompleted"')
    expect(dialog).toContain('props.cancelling() ? "正在取消…" : "取消扫描"')
    expect(provider).toContain('type: "patentRadarCancelCompleted"')
    expect(webviewMessages).toContain('type: "cancelPatentRadarRun"\n  requestId: string')
    expect(extensionMessages).toContain('type: "patentRadarCancelCompleted"\n  requestId: string')
  })
})
