/** @jsxImportSource solid-js */
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { createSignal, onCleanup } from "solid-js"
import { StoryProviders } from "./StoryProviders"
import AboutChipMateTab from "../components/settings/AboutChipMateTab"
import { getVSCodeAPI } from "../context/vscode"
import type { DiagnosticResponse } from "../../../src/shared/diagnostics"

const meta: Meta = { title: "Settings/诊断提交", parameters: { layout: "fullscreen" } }
export default meta
function Fixture() {
  const api = getVSCodeAPI()
  const original = api.postMessage
  const [submitted, setSubmitted] = createSignal(false)
  const respond = (data: DiagnosticResponse) =>
    queueMicrotask(() => window.dispatchEvent(new MessageEvent("message", { data })))
  api.postMessage = (message) => {
    if (message.type === "diagnostics.context") {
      respond({
        type: "diagnostics.context",
        requestId: message.requestId,
        server: "https://chipmate.example.test",
        hasSession: true,
      })
      return
    }
    if (message.type === "diagnostics.start") {
      setSubmitted(true)
      respond({
        type: "diagnostics.state",
        state: {
          requestId: message.options.requestId,
          phase: "failed",
          message: "视觉夹具不上传日志。真实消息链由集成测试覆盖。",
          canSave: false,
        },
      })
      return
    }
    original(message)
  }
  onCleanup(() => {
    api.postMessage = original
  })
  return (
    <StoryProviders locale="zh">
      <div style={{ padding: "24px", "max-width": "700px" }}>
        <AboutChipMateTab port={null} connectionState="disconnected" extensionVersion="1.2.19" />
        <span hidden>{submitted() ? "已操作" : "未操作"}</span>
      </div>
    </StoryProviders>
  )
}
export const Default: StoryObj = { name: "关于 ChipMate 中的一键诊断", render: () => <Fixture /> }
