import { Button } from "@kilocode/kilo-ui/button"
import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import type { DesignDocInMessage, DesignDocOutMessage, DesignDocPanelState } from "../../src/design-doc/types"

interface VSCodeAPI {
  postMessage(message: DesignDocInMessage): void
  getState(): unknown
  setState(state: unknown): void
}

declare function acquireVsCodeApi(): VSCodeAPI

const vscode = acquireVsCodeApi()
const types = [
  ["overview", "模块说明"],
  ["business-flow", "业务流程"],
  ["structure", "组件结构"],
  ["code-structure", "代码结构"],
  ["execution-flow", "执行流程"],
  ["sequence", "调用时序"],
  ["data-flow", "数据流"],
  ["lifecycle", "生命周期"],
  ["error-flow", "异常流程"],
  ["review", "质量审查"],
] as const

const initialTypes = new Set(types.map(([type]) => type))

export function DesignDocApp() {
  const [state, setState] = createSignal<DesignDocPanelState>({ jobs: [], modules: [], artifacts: [], loading: true })
  const [selectedTypes, setSelectedTypes] = createSignal(new Set(initialTypes))
  const [recursive, setRecursive] = createSignal(false)
  const [fullWord, setFullWord] = createSignal(true)
  const [providerID, setProviderID] = createSignal("deepseek")
  const [modelID, setModelID] = createSignal("deepseek-v4-flash")
  const [maxAttempts, setMaxAttempts] = createSignal(3)
  const [concurrency, setConcurrency] = createSignal(1)
  const selected = createMemo(() => state().selectedJob)
  const modules = createMemo(() => {
    const index = new Map(state().modules.map((module) => [module.id, module]))
    return state().modules.map((module) => {
      let depth = 0
      let parent = module.parentID
      while (parent && depth < 20) {
        depth += 1
        parent = index.get(parent)?.parentID
      }
      return { ...module, depth }
    })
  })

  const listener = (event: MessageEvent<DesignDocOutMessage>) => {
    if (event.data.type === "designDoc.state") setState(event.data.state)
    if (event.data.type === "designDoc.error") {
      const message = event.data.message
      setState((current) => ({ ...current, error: message }))
    }
  }
  onMount(() => {
    window.addEventListener("message", listener)
    vscode.postMessage({ type: "designDoc.ready" })
  })
  onCleanup(() => window.removeEventListener("message", listener))

  const toggleType = (type: (typeof types)[number][0], checked: boolean) => {
    setSelectedTypes((current) => {
      const next = new Set(current)
      if (checked) next.add(type)
      else next.delete(type)
      return next
    })
  }
  const create = () => {
    const current = state()
    if (!current.workspace || !current.targetPath || !selectedTypes().size) return
    vscode.postMessage({
      type: "designDoc.create",
      workspace: current.workspace,
      targetPath: current.targetPath,
      artifactTypes: [...selectedTypes()],
      documentProfile: fullWord() ? "source-backed-full" : "artifact-set",
      outputFormats: fullWord() ? ["markdown", "docx"] : ["markdown"],
      recursive: fullWord() ? true : recursive(),
      concurrency: concurrency(),
      model: { providerID: providerID().trim(), modelID: modelID().trim() },
      maxAttempts: maxAttempts(),
    })
  }
  const previewSource = () => {
    const preview = state().preview
    if (!preview || preview.encoding !== "base64" || !preview.artifact.mediaType.startsWith("image/")) return undefined
    return `data:${preview.artifact.mediaType};base64,${preview.content}`
  }
  const openArtifact = (artifactID: string) => {
    const jobID = state().selectedJobID
    if (jobID) vscode.postMessage({ type: "designDoc.openArtifact", jobID, artifactID })
  }

  return (
    <main class="design-doc-shell">
      <header class="design-doc-header glass-surface">
        <div class="title-cluster">
          <span class="codicon codicon-symbol-structure" aria-hidden="true" />
          <div>
            <h1>源码详细设计</h1>
            <p>程序拆分任务、验证证据并确定性发布文档</p>
          </div>
        </div>
        <Button variant="ghost" size="small" icon="reset" disabled={state().loading} onClick={() => vscode.postMessage({ type: "designDoc.refresh" })}>
          刷新
        </Button>
      </header>

      <Show when={state().error}>
        <div class="notice error" role="alert"><span class="codicon codicon-error" />{state().error}</div>
      </Show>

      <section class="design-doc-grid">
        <aside class="control-column glass-surface">
          <h2>新建任务</h2>
          <label class="field-label">源码模块</label>
          <div class="path-picker">
            <code title={state().targetPath}>{state().targetPath ?? "尚未选择"}</code>
            <Button variant="secondary" size="small" icon="folder" onClick={() => vscode.postMessage({ type: "designDoc.chooseTarget" })}>
              选择
            </Button>
          </div>

          <fieldset>
            <legend>输出模式</legend>
            <label class="profile-option">
              <input type="checkbox" checked={fullWord()} onChange={(event) => setFullWord(event.currentTarget.checked)} />
              <span><strong>完整源码支撑 Word</strong><small>每个 DesignUnit 固定生成 14 个主题与 5D 图，完成页面视觉验收后发布 DOCX。</small></span>
            </label>
          </fieldset>

          <fieldset classList={{ "artifact-fieldset": true, muted: fullWord() }} disabled={fullWord()}>
            <legend>设计视角</legend>
            <div class="artifact-options">
              <For each={types}>{([type, label]) => (
                <label class="check-row">
                  <input type="checkbox" checked={selectedTypes().has(type)} onChange={(event) => toggleType(type, event.currentTarget.checked)} />
                  <span>{label}</span>
                </label>
              )}</For>
            </div>
          </fieldset>

          <label class="check-row recursive-row">
            <input type="checkbox" checked={fullWord() || recursive()} disabled={fullWord()} onChange={(event) => setRecursive(event.currentTarget.checked)} />
            <span>递归分析子目录模块</span>
          </label>

          <div class="model-grid">
            <label><span>Provider</span><input value={providerID()} onInput={(event) => setProviderID(event.currentTarget.value)} /></label>
            <label><span>模型</span><input value={modelID()} onInput={(event) => setModelID(event.currentTarget.value)} /></label>
            <label><span>最多尝试</span><input type="number" min="1" max="3" value={maxAttempts()} onInput={(event) => setMaxAttempts(Number(event.currentTarget.value))} /></label>
            <label><span>并发 Session</span><input type="number" min="1" max="4" value={concurrency()} onInput={(event) => setConcurrency(Number(event.currentTarget.value))} /></label>
          </div>
          <Button variant="primary" size="large" icon="play" disabled={!state().targetPath || !selectedTypes().size || state().loading} onClick={create}>
            启动详细设计任务
          </Button>

          <h2 class="history-title">历史任务</h2>
          <div class="job-list">
            <For each={state().jobs}>{(job) => (
              <button classList={{ "job-row": true, selected: state().selectedJobID === job.id }} onClick={() => vscode.postMessage({ type: "designDoc.selectJob", jobID: job.id })}>
                <span class={`status-dot ${job.status}`} />
                <span class="job-copy"><strong>{job.config.targetPath}</strong><small>{statusLabel(job.status)} · {job.progress.passed}/{job.progress.total}</small></span>
              </button>
            )}</For>
          </div>
        </aside>

        <section class="work-column glass-surface">
          <Show when={selected()} fallback={<div class="empty-state"><span class="codicon codicon-list-tree" /><p>选择或创建任务后查看模块与原子产物。</p></div>}>
            {(job) => <>
              <div class="section-heading">
                <div><h2>{job().config.targetPath}</h2><p>{statusLabel(job().status)} · revision {job().revision}</p></div>
                <div class="job-actions">
                  <Show when={["created", "discovering", "extracting", "running", "validating", "assembling"].includes(job().status)}>
                    <Button variant="secondary" size="small" icon="stop" onClick={() => vscode.postMessage({ type: "designDoc.pause", jobID: job().id })}>暂停</Button>
                  </Show>
                  <Show when={job().status === "paused"}>
                    <Button variant="primary" size="small" icon="play" onClick={() => vscode.postMessage({ type: "designDoc.resume", jobID: job().id })}>恢复</Button>
                  </Show>
                  <Show when={!['completed', 'cancelled'].includes(job().status)}>
                    <Button variant="ghost" size="small" icon="close" onClick={() => vscode.postMessage({ type: "designDoc.cancel", jobID: job().id })}>取消</Button>
                  </Show>
                </div>
              </div>
              <div class="progress-track"><span style={{ width: `${job().progress.total ? (job().progress.passed / job().progress.total) * 100 : 0}%` }} /></div>

              <div class="module-list">
                <For each={modules()}>{(module) => (
                  <article class="module-card" style={{ "margin-left": `${Math.min(module.depth, 4) * 12}px` }}>
                    <div class="module-heading"><span class="codicon codicon-package" /><div><strong>{module.name}</strong><small>{module.path}</small></div></div>
                    <div class="work-items">
                      <For each={job().workItems.filter((item) => item.moduleID === module.id)}>{(item) => (
                        <div class={`work-item ${item.status}`}>
                          <span class={`codicon ${workIcon(item.status)}`} aria-hidden="true" />
                          <div class="work-copy"><strong>{workItemLabel(item)}{item.evidenceScope ? ` / ${item.evidenceScope.label}` : ""}</strong><small>{statusLabel(item.status)} · {item.attempts.length} 次尝试</small>
                            <Show when={item.failure}><span class="failure">{item.failure?.code}：{item.failure?.message}</span></Show>
                          </div>
                          <Show when={["failed", "blocked"].includes(item.status)}>
                            <Button variant="ghost" size="small" icon="reset" onClick={() => vscode.postMessage({ type: "designDoc.retry", jobID: job().id, workItemID: item.id })}>重试</Button>
                          </Show>
                        </div>
                      )}</For>
                    </div>
                  </article>
                )}</For>
              </div>
            </>}
          </Show>
        </section>

        <aside class="artifact-column glass-surface">
          <h2>产物与预览</h2>
          <div class="artifact-list">
            <For each={state().artifacts}>{(artifact) => (
              <button classList={{ "artifact-row": true, selected: state().preview?.artifact.id === artifact.id }} onClick={() => openArtifact(artifact.id)}>
                <span class={`codicon ${artifactIcon(artifact.mediaType)}`} /><span><strong>{artifact.kind}</strong><small>{artifact.path}</small></span>
              </button>
            )}</For>
          </div>
          <Show when={state().preview}>
            {(preview) => <div class="preview-pane">
              <div class="preview-title"><strong>{preview().artifact.kind}</strong><small>{preview().artifact.mediaType}</small></div>
              <Show when={previewSource()} fallback={<pre>{preview().encoding === "utf8" ? preview().content : "当前二进制产物不支持文本预览"}</pre>}>
                {(source) => <img src={source() ?? ""} alt="设计图预览" />}
              </Show>
            </div>}
          </Show>
        </aside>
      </section>
    </main>
  )
}

function artifactLabel(type: string) {
  return types.find(([value]) => value === type)?.[1] ?? type
}

function workItemLabel(item: NonNullable<DesignDocPanelState["selectedJob"]>["workItems"][number]) {
  if (item.purpose?.kind === "topic") return `主题：${topicLabel(item.purpose.topic)}`
  if (item.purpose?.kind === "diagram") return `5D：${viewLabel(item.purpose.view)}`
  return artifactLabel(item.artifactType)
}

function topicLabel(topic: string) {
  return ({
    positioning: "业务定位",
    responsibilities: "职责",
    boundaries: "边界",
    "inputs-outputs": "输入与输出",
    "business-process": "业务流程",
    "core-models": "核心模型",
    algorithms: "关键算法",
    concurrency: "并发与同步",
    "state-lifecycle": "状态与生命周期",
    "error-recovery": "异常与恢复",
    "data-persistence": "数据与持久化",
    "configuration-startup": "配置、构建与启动",
    "observability-debugging": "可观测性与调试",
    "constraints-risks": "约束、风险与待确认项",
  } as Record<string, string>)[topic] ?? topic
}

function viewLabel(view: string) {
  return ({
    architecture: "架构图",
    "business-flow": "业务流程图",
    "code-flow": "代码执行流图",
    "state-machine": "状态机图",
    "data-lifecycle": "数据与生命周期图",
  } as Record<string, string>)[view] ?? view
}

function statusLabel(status: string) {
  return ({ created: "已创建", discovering: "发现模块", extracting: "提取证据", pending: "等待", ready: "就绪", running: "生成中", validating: "校验中", retryable: "可重试", passed: "通过", paused: "已暂停", failed: "失败", blocked: "已阻塞", assembling: "组装中", completed: "已完成", cancelled: "已取消" } as Record<string, string>)[status] ?? status
}

function workIcon(status: string) {
  if (status === "passed") return "codicon-pass-filled"
  if (status === "running" || status === "validating") return "codicon-loading codicon-modifier-spin"
  if (status === "failed" || status === "blocked") return "codicon-error"
  if (status === "cancelled") return "codicon-circle-slash"
  return "codicon-circle-outline"
}

function artifactIcon(mediaType: string) {
  if (mediaType.startsWith("image/")) return "codicon-file-media"
  if (mediaType === "application/json") return "codicon-json"
  if (mediaType.includes("wordprocessingml")) return "codicon-file"
  return "codicon-markdown"
}
