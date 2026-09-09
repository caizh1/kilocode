import assert from "node:assert/strict"
import { Window } from "happy-dom"

const scenario = process.argv[2]
assert(scenario, "缺少测试场景")

const window = new Window({ url: "http://localhost" })
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  SVGElement: window.SVGElement,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  CustomEvent: window.CustomEvent,
  Event: window.Event,
  MessageEvent: window.MessageEvent,
})

const { createSignal } = await import("solid-js")
const { render } = await import("solid-js/web")
const { LocalTabsProvider, useLocalTabs } = await import("../../webview-ui/src/context/local-tabs")
const { ServerContext } = await import("../../webview-ui/src/context/server")
const { SessionContext } = await import("../../webview-ui/src/context/session")
const { SessionSurfaceProvider, useSessionSurface } = await import("../../webview-ui/src/context/session-surface")
const { VSCodeProvider, useVSCode } = await import("../../webview-ui/src/context/vscode")

type Key = { kind: "session" | "draft"; id: string }
type Token = { generation: string; surfaceId: string; epoch: number }
type DraftContent = {
  boxId: string
  text: string
  reviewComments: unknown[]
  images: unknown[]
  references: string[]
  inputScrollTop: number
  selection?: { providerID: string; modelID: string; agent?: string; variant?: string; override?: boolean }
}
type Posted = {
  type: string
  key?: Key
  clientSeq?: number
  sessionSurfaceToken?: Token
  sessionID?: string
  content?: DraftContent
}

const draftSwitch = scenario.startsWith("draft-switch") || scenario === "rapid-switch-200"
const restored = scenario === "restored" || scenario === "sidebar-stale-pinned" || draftSwitch
const [connected, setConnected] = createSignal(scenario === "ready-first" || restored)
let state: Record<string, unknown> | undefined = restored
  ? { sidebarSessionTabIDs: ["session-a"], sidebarActiveSessionTabID: "session-a" }
  : undefined
const posted: Posted[] = []
const selected: string[] = []
const serverDrafts = new Map<string, { revision: number; content: DraftContent }>()
const empty = (id: string): DraftContent => ({
  boxId: `prompt:${id}`,
  text: "",
  reviewComments: [],
  images: [],
  references: [],
  inputScrollTop: 0,
})
if (draftSwitch) serverDrafts.set("session:session-a", { revision: 1, content: empty("session-a") })
let loaded = 0
let cleared = 0
let binding = 0

const api = {
  postMessage(message: Posted) {
    posted.push(message)
    if (message.type === "sessionSurface.active" && message.key) {
      const key = message.key
      const epoch = ++binding
      queueMicrotask(() => {
        window.dispatchEvent(
          new window.MessageEvent("message", {
            data: {
              type: "sessionSurface.state",
              state: {
                key,
                phase: "sidebar",
                ownerSurfaceId: "sidebar-1",
                token: { generation: "test", surfaceId: "sidebar-1", epoch },
                draftRevision: 0,
                mode: "qa",
                dshLease: true,
              },
            },
          }),
        )
        const saved = serverDrafts.get(`${key.kind}:${key.id}`) ?? { revision: 0, content: empty(key.id) }
        window.dispatchEvent(
          new window.MessageEvent("message", {
            data: {
              type: "sessionSurface.draft.snapshot",
              draft: { schemaVersion: 1, key, revision: saved.revision, updatedAt: Date.now(), content: saved.content },
            },
          }),
        )
      })
      return
    }
    if (message.type === "sessionSurface.draft.flush" && message.key && message.clientSeq !== undefined) {
      if (scenario === "draft-switch-timeout") return
      const key = message.key
      const clientSeq = message.clientSeq
      queueMicrotask(() => {
        const saved = serverDrafts.get(`${key.kind}:${key.id}`) ?? { revision: 0, content: empty(key.id) }
        window.dispatchEvent(
          new window.MessageEvent("message", {
            data: {
              type: "sessionSurface.draft.ack",
              key,
              clientSeq,
              revision: saved.revision,
            },
          }),
        )
      })
      return
    }
    if (
      message.type !== "sessionSurface.draft.update" ||
      !message.key ||
      message.clientSeq === undefined ||
      !message.content
    )
      return
    if (scenario === "draft-switch-timeout") return
    const key = message.key
    const clientSeq = message.clientSeq
    queueMicrotask(() => {
      const rejected =
        scenario === "commit-rejected" || scenario === "draft-switch-rejected" || scenario === "draft-switch-late-ack"
      const id = `${key.kind}:${key.id}`
      const previous = serverDrafts.get(id) ?? { revision: 0, content: empty(key.id) }
      const saved = { revision: previous.revision + 1, content: message.content! }
      if (!rejected) serverDrafts.set(id, saved)
      window.dispatchEvent(
        new window.MessageEvent("message", {
          data: rejected
            ? {
                type: "sessionSurface.draft.rejected",
                key,
                clientSeq,
                state: {
                  key,
                  phase: "sidebar",
                  ownerSurfaceId: "sidebar-1",
                  token: { generation: "test", surfaceId: "sidebar-1", epoch: binding },
                  draftRevision: 0,
                  mode: "qa",
                  dshLease: true,
                },
              }
            : { type: "sessionSurface.draft.ack", key, clientSeq, revision: saved.revision },
        }),
      )
      if (scenario === "draft-switch-late-ack") {
        window.dispatchEvent(
          new window.MessageEvent("message", {
            data: { type: "sessionSurface.draft.ack", key, clientSeq, revision: 99 },
          }),
        )
      }
      if (scenario === "draft-switch-late-rejection") {
        window.dispatchEvent(
          new window.MessageEvent("message", {
            data: {
              type: "sessionSurface.draft.rejected",
              key,
              clientSeq,
              state: {
                key,
                phase: "sidebar",
                ownerSurfaceId: "sidebar-1",
                token: { generation: "stale", surfaceId: "sidebar-1", epoch: 99 },
                draftRevision: 0,
                mode: "qa",
                dshLease: true,
              },
            },
          }),
        )
      }
    })
  },
  getState() {
    return state
  },
  setState(value: Record<string, unknown>) {
    state = value
  },
}

;(globalThis as typeof globalThis & { acquireVsCodeApi: () => typeof api }).acquireVsCodeApi = () => api

const server = {
  connectionState: () => (connected() ? "connected" : "connecting"),
  serverInfo: () => undefined,
  extensionVersion: () => "1.2.6",
  errorMessage: () => undefined,
  errorDetails: () => undefined,
  isConnected: connected,
  profileData: () => null,
  deviceAuth: () => ({ status: "idle" }),
  startLogin: () => {},
  goToLogin: () => {},
  vscodeLanguage: () => "zh-cn",
  languageOverride: () => undefined,
  workspaceDirectory: () => "C:\\workspace",
  gitInstalled: () => true,
}

const session = {
  isSubmitting: () => false,
  clearCurrentSession: () => cleared++,
  loadSessions: () => loaded++,
  selectSession: (id: string) => selected.push(id),
}

const Probe = () => {
  const surface = useSessionSurface()
  const vscode = useVSCode()
  const tabs = useLocalTabs()
  return (
    <>
      <div
        id="probe"
        data-active={`${surface.activeKey()?.kind ?? ""}:${surface.activeKey()?.id ?? ""}`}
        data-can-mutate={String(surface.canMutate())}
        data-ids={tabs?.ids().join(",") ?? ""}
        data-tab={tabs?.active() ?? ""}
        data-draft-text={surface.draft()?.content.text ?? ""}
        data-draft-scroll={String(surface.draft()?.content.inputScrollTop ?? 0)}
        data-draft-images={String(surface.draft()?.content.images.length ?? 0)}
        data-draft-comments={String(surface.draft()?.content.reviewComments.length ?? 0)}
        data-draft-model={surface.draft()?.content.selection?.modelID ?? ""}
      />
      <button
        id="commit"
        onClick={() => {
          const current = surface.activeKey()
          if (!current) return
          void surface
            .commitDraft({
              boxId: "prompt:test",
              text: "待发送内容",
              reviewComments: [],
              images: [],
              references: [],
              inputScrollTop: 0,
            })
            .then((result) => root.setAttribute("data-commit", `ok:${result.revision}`))
            .catch((error: Error) => root.setAttribute("data-commit", `failed:${error.message}`))
        }}
      />
      <button id="switch" onClick={() => surface.setActive({ kind: "session", id: "session-b" })} />
      <button
        id="switch-with-draft"
        onClick={() => {
          const active = surface.activeKey()
          if (!active || !tabs) return
          const content = {
            boxId: "prompt:session-a",
            text: `中文草稿-${"字".repeat(2048)}`,
            reviewComments: [{ id: "comment-a", text: "审查意见" }],
            images: [
              {
                id: "image-a",
                filename: "证据.png",
                mime: "image/png",
                dataUrl: "data:image/png;base64,aGVsbG8=",
              },
            ],
            references: ["src/main.ts:10"],
            inputScrollTop: 96,
            selection: {
              providerID: "provider-a",
              modelID: "model-a",
              agent: "build",
              variant: "high",
              override: true,
            },
          }
          surface.stageDraft(content)
          surface.updateDraft(content)
          const saved = serverDrafts.get(`${active.kind}:${active.id}`) ?? { revision: 1, content: empty(active.id) }
          window.dispatchEvent(
            new window.MessageEvent("message", {
              data: {
                type: "sessionSurface.draft.snapshot",
                draft: {
                  schemaVersion: 1,
                  key: active,
                  revision: saved.revision,
                  updatedAt: 1,
                  content: saved.content,
                },
              },
            }),
          )
          void tabs.open("session-b").then((switched) => root.setAttribute("data-switched", String(switched)))
        }}
      />
      <button
        id="switch-back"
        onClick={() => {
          if (!tabs) return
          void tabs.open("session-a").then((switched) => root.setAttribute("data-switched-back", String(switched)))
        }}
      />
      <button
        id="rapid-switch"
        onClick={() => {
          if (!tabs) return
          void (async () => {
            for (let index = 0; index < 200; index++) {
              const target = index === 199 ? "session-a" : ["session-b", "session-c", "session-a"][index % 3]!
              assert.equal(await tabs.open(target), true, `第 ${index + 1} 次切换失败`)
            }
            root.setAttribute("data-rapid", "done")
          })()
        }}
      />
      <button
        id="send"
        onClick={() =>
          vscode.postMessage({
            type: "sendMessage",
            text: "验证 token",
            messageID: "message-test",
            sessionID: "session-b",
            providerID: "provider",
            modelID: "model",
          })
        }
      />
    </>
  )
}

const root = document.createElement("div")
document.body.append(root)
const dispose = render(
  () => (
    <VSCodeProvider>
      <ServerContext.Provider value={server as never}>
        <SessionContext.Provider value={session as never}>
          <SessionSurfaceProvider ackTimeoutMs={scenario === "draft-switch-timeout" ? 5 : undefined}>
            <LocalTabsProvider>
              <Probe />
            </LocalTabsProvider>
          </SessionSurfaceProvider>
        </SessionContext.Provider>
      </ServerContext.Provider>
    </VSCodeProvider>
  ),
  root,
)

const settle = async () => {
  for (let index = 0; index < 8; index++) await Promise.resolve()
}
const probe = () => {
  const value = root.querySelector<HTMLElement>("#probe")
  assert(value, "状态探针未渲染")
  return value
}
const activeMessages = () => posted.filter((message) => message.type === "sessionSurface.active")
const bootstrap = (kind: "sidebar" | "main-editor", pinnedKey?: Key) => {
  window.dispatchEvent(
    new window.MessageEvent("message", {
      data: { type: "sessionSurface.bootstrap", surfaceId: `${kind}-1`, kind, pinnedKey },
    }),
  )
}

if (scenario === "bootstrap-first" || scenario === "ready-first") {
  bootstrap("sidebar")
  await settle()

  const messages = activeMessages()
  assert.equal(messages.length, 1, "初始 draft 重复绑定")
  assert.equal(messages[0]?.key?.kind, "draft", "初始 pending 标签未按 draft 绑定")
  assert.match(messages[0]?.key?.id ?? "", /^sidebar-pending:/, "初始 draft ID 不正确")
  assert.equal(probe().dataset.canMutate, "true", "取得 owner token 后仍不可写")

  setConnected(true)
  await settle()
  assert.equal(activeMessages().length, 1, "连接时序变化导致重复绑定")
  assert.equal(loaded, 0, "空白侧栏不应加载已有会话")
  assert.deepEqual(selected, [], "空白侧栏不应选择已有会话")
}

if (scenario === "restored" || scenario === "sidebar-stale-pinned") {
  bootstrap("sidebar", scenario === "sidebar-stale-pinned" ? { kind: "session", id: "session-stale" } : undefined)
  await settle()

  const messages = activeMessages()
  assert.deepEqual(
    messages.map((message) => message.key),
    [{ kind: "session", id: "session-a" }],
  )
  assert.equal(probe().dataset.canMutate, "true", "恢复会话取得 token 后仍不可写")
  assert.equal(loaded, 1, "恢复标签未加载会话列表")
  assert.deepEqual(selected, ["session-a"], "恢复标签未加载正确会话")
}

if (scenario === "main-session" || scenario === "main-draft") {
  const key: Key =
    scenario === "main-session"
      ? { kind: "session", id: "session-main" }
      : { kind: "draft", id: "main-pending:draft-main" }
  bootstrap("main-editor", key)
  window.dispatchEvent(
    new window.MessageEvent("message", {
      data: {
        type: "sessionSurface.state",
        state: {
          key,
          phase: "main",
          ownerSurfaceId: "main-editor-1",
          token: { generation: "test", surfaceId: "main-editor-1", epoch: 1 },
          draftRevision: 0,
          mode: "qa",
          dshLease: true,
        },
      },
    }),
  )
  await settle()

  window.dispatchEvent(new window.MessageEvent("message", { data: { type: "sessionsLoaded", sessions: [] } }))
  await settle()

  assert.equal(probe().dataset.active, `${key.kind}:${key.id}`, "主编辑区未保留 pinnedKey")
  assert.equal(probe().dataset.tab, key.id, "主编辑区标签未对齐 pinnedKey")
  assert.equal(probe().dataset.ids, key.id, "主编辑区保留了非 pinnedKey 标签")
  assert.equal(
    activeMessages().some((message) => message.key?.id.startsWith("sidebar-pending:")),
    false,
    "主编辑区被随机 sidebar pending key 覆盖",
  )
  assert.equal(
    posted.some((message) => message.type === "sessionSurface.openMain"),
    false,
    "主编辑区为自身 pinnedKey 重复打开面板",
  )
  if (scenario === "main-draft") assert(cleared > 0, "主编辑区 draft 未清空旧会话内容")
}

if (scenario === "sidebar-explicit-draft") {
  bootstrap("sidebar")
  await settle()
  const key: Key = { kind: "draft", id: "host-explicit-draft" }
  window.dispatchEvent(
    new window.MessageEvent("message", {
      data: { type: "sessionSurface.select", key },
    }),
  )
  await settle()

  assert.equal(probe().dataset.active, "draft:host-explicit-draft", "显式 draft key 被错误转换成 session")
  assert.equal(probe().dataset.tab, "host-explicit-draft", "显式 draft 未成为侧栏当前标签")
  assert.equal(
    activeMessages().findLast((message) => message.key?.id === key.id)?.key?.kind,
    "draft",
    "侧栏回传了错误的 session key",
  )
}

if (scenario === "commit-ack" || scenario === "commit-rejected") {
  bootstrap("sidebar")
  await settle()
  root.querySelector<HTMLButtonElement>("#commit")?.click()
  await settle()
  if (scenario === "commit-ack") assert.equal(root.dataset.commit, "ok:1", "草稿 ack 未完成提交")
  else assert.match(root.dataset.commit ?? "", /^failed:/, "草稿拒绝后提交 Promise 未失败")
}

if (scenario === "old-key-rejection") {
  bootstrap("sidebar")
  await settle()
  const old = surfaceKeyFromProbe(probe())
  root.querySelector<HTMLButtonElement>("#switch")?.click()
  await settle()
  window.dispatchEvent(
    new window.MessageEvent("message", {
      data: {
        type: "sessionSurface.mutationRejected",
        key: old,
        mutationType: "sendMessage",
        messageID: "old-message",
        reason: "invalid-token",
        state: {
          key: old,
          phase: "sidebar",
          ownerSurfaceId: "sidebar-1",
          token: { generation: "stale", surfaceId: "sidebar-1", epoch: 99 },
          draftRevision: 0,
          mode: "qa",
          dshLease: true,
        },
      },
    }),
  )
  await settle()
  assert.equal(probe().dataset.active, "session:session-b", "旧 key 拒绝消息污染当前绑定")
  root.querySelector<HTMLButtonElement>("#send")?.click()
  const sent = posted.findLast((message) => message.type === "sendMessage")
  assert.equal(sent?.sessionSurfaceToken?.generation, "test", "旧 key token 覆盖当前凭证")
  assert.equal(sent?.sessionSurfaceToken?.epoch, 2, "发送未使用当前 key 的 token")
}

if (draftSwitch) {
  bootstrap("sidebar")
  await settle()
  assert.equal(probe().dataset.active, "session:session-a", "草稿切换场景未恢复 A 会话")
  assert.equal(probe().dataset.draftText, "", "A 会话初始空草稿异常")

  root.querySelector<HTMLButtonElement>("#switch-with-draft")?.click()
  if (scenario === "draft-switch-timeout") await new Promise((resolve) => setTimeout(resolve, 20))
  for (let index = 0; index < 30 && root.dataset.switched === undefined; index++) await Promise.resolve()

  if (
    scenario === "draft-switch-rejected" ||
    scenario === "draft-switch-timeout" ||
    scenario === "draft-switch-late-ack"
  ) {
    assert.equal(root.dataset.switched, "false", "持久化拒绝后仍报告切换成功")
    assert.equal(probe().dataset.active, "session:session-a", "持久化拒绝后离开了原会话")
    assert.equal(probe().dataset.tab, "session-a", "持久化拒绝后选中标签发生变化")
    assert.match(probe().dataset.draftText ?? "", /^中文草稿-字+$/, "迟到旧快照覆盖了本地 staged 草稿")
  } else {
    assert.equal(root.dataset.switched, "true", "草稿 ACK 后未完成切换")
    assert.equal(probe().dataset.active, "session:session-b", "草稿 ACK 后未绑定 B 会话")
    assert.equal(probe().dataset.tab, "session-b", "草稿 ACK 前后标签状态错误")
    const saved = serverDrafts.get("session:session-a")
    assert(saved, "A 会话草稿未持久化")
    assert.equal(saved.content.text.length, "中文草稿-".length + 2048, "2KB 中文草稿被截断")
    assert.equal(saved.content.reviewComments.length, 1, "Review Comments 丢失")
    assert.equal(saved.content.images.length, 1, "图片附件丢失")
    assert.equal(saved.content.inputScrollTop, 96, "滚动位置丢失")
    assert.equal(saved.content.selection?.modelID, "model-a", "模型选择丢失")

    root.querySelector<HTMLButtonElement>("#switch-back")?.click()
    for (let index = 0; index < 30 && root.dataset.switchedBack === undefined; index++) await Promise.resolve()
    assert.equal(root.dataset.switchedBack, "true", "B→A 返回失败")
    assert.equal(probe().dataset.active, "session:session-a", "返回后未绑定 A 会话")
    assert.equal(probe().dataset.draftText, saved.content.text, "A→B→A 后草稿未完整恢复")
    assert.equal(probe().dataset.draftScroll, "96", "A→B→A 后滚动位置未恢复")
    assert.equal(probe().dataset.draftImages, "1", "A→B→A 后图片未恢复")
    assert.equal(probe().dataset.draftComments, "1", "A→B→A 后评论未恢复")
    assert.equal(probe().dataset.draftModel, "model-a", "A→B→A 后模型选择未恢复")

    if (scenario === "rapid-switch-200") {
      root.querySelector<HTMLButtonElement>("#rapid-switch")?.click()
      for (let index = 0; index < 5000 && root.dataset.rapid !== "done"; index++) await Promise.resolve()
      assert.equal(root.dataset.rapid, "done", "200 次串行快速切换未完成")
      assert.equal(probe().dataset.active, "session:session-a", "200 次切换后的最终会话错误")
      assert.equal(
        serverDrafts.get("session:session-a")?.content.text,
        saved.content.text,
        "200 次切换后草稿串会话或丢失",
      )
    }
  }
}

function surfaceKeyFromProbe(value: HTMLElement): Key {
  const [kind, ...id] = (value.dataset.active ?? "").split(":")
  assert(kind === "session" || kind === "draft", "探针缺少 surface key")
  return { kind, id: id.join(":") }
}

dispose()
