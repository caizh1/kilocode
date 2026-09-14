import { createSignal, onCleanup, onMount, Show } from "solid-js"
import type { Meta, StoryObj } from "storybook-solidjs-vite"
import { StoryProviders } from "./StoryProviders"
import { TurnChangesProvider } from "../context/turn-changes"
import { TurnChangesCard } from "../components/chat/TurnChangesCard"
import { getVSCodeAPI } from "../context/vscode"
import type { ExtensionMessage, WebviewMessage } from "../types/messages"

const meta = { title: "Chat/审阅自动恢复", parameters: { layout: "fullscreen" } } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

function Fixture() {
  const [session, setSession] = createSignal("会话甲")
  const [shown, setShown] = createSignal(true)
  const [requests, setRequests] = createSignal(0)
  const revisions = new Map([
    ["会话甲", 1],
    ["会话乙", 1],
  ])
  const deliver = (data: ExtensionMessage) => window.dispatchEvent(new MessageEvent("message", { data }))
  let holding = false
  const pending: (() => void)[] = []
  const api = getVSCodeAPI()
  const previous = api.postMessage
  api.postMessage = (message: WebviewMessage) => {
    if (message.type !== "turnChangesRequest") {
      previous(message)
      return
    }
    setRequests((n) => n + 1)
    const reply = () => {
      const revision = revisions.get(message.sessionID) ?? 1
      const fileID = `${message.sessionID}-文件`
      const result = message.fileID
        ? {
            ok: true,
            detail: {
              fileID,
              revision,
              patch: "",
              hunks: [
                {
                  id: "修改块",
                  line: 1,
                  undone: false,
                  patch: `--- a/${message.sessionID}.c\n+++ b/${message.sessionID}.c\n@@ -1 +1 @@\n-// 原始内容\n+// ${message.sessionID} 第 ${revision} 版\n`,
                },
              ],
            },
          }
        : {
            ok: true,
            summary: {
              sessionID: message.sessionID,
              messageID: message.messageID,
              directory: `/验收/${message.sessionID}`,
              revision,
              phase: "ready" as const,
              outcome: "completed" as const,
              canRevert: true,
              canRestore: false,
              files: [
                {
                  id: fileID,
                  file: `${message.sessionID}-较长的文件名称用于窄宽度验收.c`,
                  status: "modified" as const,
                  additions: 1,
                  deletions: 1,
                  binary: false,
                  undone: [],
                  state: "kept" as const,
                },
              ],
            },
          }
      deliver({
        type: "turnChangesResult",
        sessionID: message.sessionID,
        messageID: message.messageID,
        requestID: message.requestID,
        result,
      })
    }
    if (holding) pending.push(reply)
    else queueMicrotask(reply)
  }
  const control = (event: Event) => {
    const input = (event as CustomEvent<{ type: string; sessionID?: string }>).detail
    const id = input.sessionID ?? session()
    if (input.type === "延迟读取") holding = true
    if (input.type === "释放读取") {
      holding = false
      pending.splice(0).forEach((reply) => reply())
    }
    if (input.type === "后台更新") {
      revisions.set(id, (revisions.get(id) ?? 1) + 1)
      deliver({ type: "turnChangesUpdated", sessionID: id, messageID: `轮次-${id}` })
    }
    if (input.type === "断线" || input.type === "重连")
      deliver({ type: "connectionState", state: input.type === "断线" ? "disconnected" : "connected" })
    if (input.type === "历史页面") setShown(false)
    if (input.type === "删除轮次") {
      setShown(false)
      deliver({ type: "messageRemoved", sessionID: id, messageID: `轮次-${id}` })
    }
    if (input.type === "重新挂载") setShown(true)
  }
  window.addEventListener("审阅验收", control)
  onMount(() => queueMicrotask(() => deliver({ type: "connectionState", state: "connected" })))
  onCleanup(() => {
    api.postMessage = previous
    pending.length = 0
    window.removeEventListener("审阅验收", control)
  })
  return (
    <StoryProviders locale="zh" noPadding sessionID={session()} session={{ currentSessionID: session }}>
      <div
        data-recovery-fixture
        data-requests={requests()}
        style={{ display: "grid", gap: "12px", padding: "8px", "min-width": "0" }}
      >
        <nav style={{ display: "flex", gap: "8px" }}>
          <button onClick={() => setSession("会话甲")}>会话甲</button>
          <button onClick={() => setSession("会话乙")}>会话乙</button>
        </nav>
        <TurnChangesProvider>
          <Show when={shown()}>
            <Show when={session()} keyed>
              {(id) => (
                <TurnChangesProvider>
                  <TurnChangesCard sessionID={id} messageID={`轮次-${id}`} />
                </TurnChangesProvider>
              )}
            </Show>
          </Show>
        </TurnChangesProvider>
        <textarea aria-label="验收草稿" style={{ "min-width": "0", width: "100%" }} />
      </div>
    </StoryProviders>
  )
}

export const Switching: Story = { render: () => <Fixture /> }
