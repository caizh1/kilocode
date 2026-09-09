import { describe, expect, it } from "bun:test"

const component = await Bun.file(
  new URL("../../webview-ui/src/components/settings/PatentRadarProgressDialog.tsx", import.meta.url),
).text()
const styles = await Bun.file(new URL("../../webview-ui/src/styles/settings.css", import.meta.url)).text()

describe("专利扫描进度窄宽布局", () => {
  it("将四项统计与进度条分成独立布局区", () => {
    expect(component).toContain("<small>证据批次</small>")
    expect(component).toContain("<small>当前阶段</small>")
    expect(component).toMatch(/<\/div>\s*\n\s*<div class="patent-radar-dialog-progress-value">/)
  })

  it("窄宽使用两列统计、纵向详情和独立滚动正文", () => {
    const narrow = styles.slice(
      styles.indexOf("@media (max-width: 800px)"),
      styles.indexOf("@media (max-width: 460px)"),
    )
    expect(narrow).toContain("grid-template-columns: repeat(2, minmax(0, 1fr));")
    expect(narrow).toContain(".patent-radar-dialog-grid")
    expect(narrow).toContain("grid-template-columns: 1fr;")
    expect(styles).toMatch(/\.patent-radar-dialog-grid \{[\s\S]*?min-height: 0;[\s\S]*?overflow-y: auto;/)
  })

  it("不再让窄宽进度项通过 flex basis 撑高主体", () => {
    expect(styles).not.toContain(".patent-radar-dialog-progress-value {\n  flex: 1 1 160px;")
    expect(styles).toContain(".patent-radar-dialog-progress-value {\n  display: block;")
  })

  it("超窄宽度不超过弹窗容器", () => {
    const compact = styles.slice(styles.indexOf("@media (max-width: 460px)"))
    expect(compact).toMatch(/\.patent-radar-dialog \{\s*width: 100%;/)
  })

  it("取消或失败后允许在弹窗内重新开始", () => {
    expect(component).toContain('props.run()?.status === "CANCELLED" || props.run()?.status === "FAILED"')
    expect(component).toContain("重新开始扫描")
    expect(component).toContain("onClick={props.onRestart}")
  })

  it("未取得 Run 时区分启动中、状态错误和空闲状态", () => {
    expect(component).toContain("正在连接 ChipMate 后台并确认扫描任务")
    expect(component).toContain("无法读取扫描状态")
    expect(component).toContain("当前没有正在运行的扫描")
    expect(component).not.toContain("正在建立工作区证据清单")
  })
})
