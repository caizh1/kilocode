import {
  For,
  Index,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type Component,
} from "solid-js"
import type {
  AssistantBlock,
  ChatConversationViewNode,
  PendingInteraction,
  ToolCallBlock,
} from "@deepseek-ai/dsh-client-runtime/client"
import { Button } from "@chipmate/chipmate-ui/button"
import { BasicTool } from "@chipmate/chipmate-ui/basic-tool"
import { Diff } from "@chipmate/chipmate-ui/diff"
import { Icon } from "@chipmate/chipmate-ui/icon"
import { Markdown } from "@chipmate/chipmate-ui/markdown"
import { ReasoningDisclosure } from "@chipmate/chipmate-ui/reasoning-disclosure"
import { createAutoScroll } from "@chipmate/chipmate-ui/hooks"
import { useDeepSeekHarness } from "../../context/deepseek-harness"
import { useDisplay } from "../../context/display"
import { useProvider } from "../../context/provider"
import { useVSCode } from "../../context/vscode"
import { useLanguage } from "../../context/language"
import { useSessionSurface } from "../../context/session-surface"
import { ModeSwitcher } from "../shared/ModeSwitcher"
import { ModelSelectorBase } from "../shared/ModelSelector"
import { ThinkingSelectorBase } from "../shared/ThinkingSelector"
import type { DeepSeekHarnessSnapshot, DeepSeekHarnessState } from "../../../../src/shared/deepseek-harness"
import { projectAssistantBlocks, type AssistantPresentationBlock } from "./deepseek-harness-presentation"
import { DeepSeekHarnessProviderSwitchDialog } from "./DeepSeekHarnessProviderSwitchDialog"
import "../../styles/deepseek-harness.css"

export const DeepSeekHarnessConversation: Component = () => {
  const harness = useDeepSeekHarness()
  const language = useLanguage()
  const surface = useSessionSurface()
  const snapshot = harness.snapshot
  const working = createMemo(() => Boolean(harness.conversation()?.snapshot.running))
  const autoScroll = createAutoScroll({
    working,
  })
  const nodes = createMemo(() => {
    const chat = harness.conversation()?.snapshot.chat
    if (!chat) return []
    return chat.order
      .map((key) => chat.nodes.get(key))
      .filter((node): node is ChatConversationViewNode => Boolean(node && node.visibility === "visible"))
  })
  const nodeKeys = createMemo(() => nodes().map((node) => node.key))
  const nodeMap = createMemo(() => new Map(nodes().map((node) => [node.key, node])))
  const resumeAutoScroll = () => autoScroll.resume()
  window.addEventListener("resumeAutoScroll", resumeAutoScroll)
  onCleanup(() => window.removeEventListener("resumeAutoScroll", resumeAutoScroll))

  let sessionId: string | undefined
  createEffect(() => {
    const next = snapshot().sessionId
    if (!next || next === sessionId) return
    sessionId = next
    autoScroll.resume()
  })

  return (
    <section
      class="dsh-conversation-source"
      aria-label={local(language.locale(), "ChipMate DeepSeek Harness 会话", "ChipMate DeepSeek Harness conversation")}
    >
      <div class="dsh-inline-status" role="status">
        <span class="codicon codicon-hubot" aria-hidden="true" />
        <div>
          <strong>ChipMate DeepSeek Harness</strong>
          <span class={`dsh-status dsh-status-${snapshot().state}`}>
            {modeStatus(snapshot(), language.locale())} · {statusText(snapshot().state, language.locale())}
          </span>
        </div>
        <div class="dsh-actions">
          <Show
            when={
              snapshot().state === "restart-required" ||
              snapshot().state === "preset-unavailable" ||
              snapshot().state === "crashed" ||
              snapshot().state === "reconnecting-events" ||
              snapshot().state === "resyncing-session"
            }
          >
            <Button
              variant="ghost"
              size="small"
              onClick={() => harness.post({ type: "chipmateDeepSeekHarness.restart" })}
            >
              {local(language.locale(), "重新启动", "Restart")}
            </Button>
          </Show>
          <Show when={snapshot().state === "runtime-unavailable"}>
            <Button
              variant="ghost"
              size="small"
              onClick={() => harness.post({ type: "chipmateDeepSeekHarness.retryRuntime" })}
            >
              {local(language.locale(), "重新下载", "Download again")}
            </Button>
          </Show>
          <Button variant="ghost" size="small" onClick={() => harness.post({ type: "chipmateDeepSeekHarness.stop" })}>
            {local(language.locale(), "停止", "Stop")}
          </Button>
        </div>
      </div>

      <div class="dsh-scroll-shell">
        <div
          ref={autoScroll.scrollRef}
          onScroll={autoScroll.handleScroll}
          class="message-list dsh-scroll-viewport"
          role="log"
          aria-live="polite"
          aria-busy={working()}
        >
          <div ref={autoScroll.contentRef} class="message-list-content dsh-scroll-content">
            <Show when={snapshot().error || harness.operationError()}>
              <div class="dsh-error">
                <strong>
                  {snapshot().launchStage
                    ? statusText(snapshot().launchStage!, language.locale())
                    : statusText(snapshot().state, language.locale())}
                </strong>
                <span>{snapshot().error ?? harness.operationError()}</span>
                <Show when={snapshot().logPath}>
                  <small>{snapshot().logPath}</small>
                </Show>
                <Show when={snapshot().transportLogPath}>
                  <small>{snapshot().transportLogPath}</small>
                </Show>
              </div>
            </Show>
            <Show when={snapshot().forcedTermination}>
              <div class="dsh-warning">
                {local(
                  language.locale(),
                  "上次关闭超过 15 秒，进程树已被强制终止；这不代表完成了正常 DSH 清理。",
                  "The last shutdown exceeded 15 seconds and the process tree was force-terminated; normal DSH cleanup was not confirmed.",
                )}
              </div>
            </Show>
            <ProviderSelectionStatus />

            <SessionMigration />

            <div class="dsh-transcript" data-conversation-source="official-dsh-snapshot">
              <Show
                when={nodeKeys().length > 0}
                fallback={
                  <div class="dsh-empty">
                    {local(
                      language.locale(),
                      `会话、上下文和工具全部由官方 DSH ${presetLabel(snapshot().expectedAgentPreset, language.locale())}管理。`,
                      `Sessions, context, and tools are managed entirely by official DSH ${presetLabel(snapshot().expectedAgentPreset, language.locale())}.`,
                    )}
                  </div>
                }
              >
                <For each={nodeKeys()}>{(key) => <OfficialConversationNode node={nodeMap().get(key)!} />}</For>
              </Show>
            </div>

            <For each={harness.pending()}>{(wait) => <PendingInteractionCard wait={wait} />}</For>
          </div>
        </div>
        <Show when={autoScroll.userScrolled()}>
          <button
            class="scroll-to-bottom-button"
            onClick={autoScroll.resume}
            aria-label={local(language.locale(), "回到底部", "Scroll to bottom")}
          >
            <Icon name="arrow-down-to-line" />
          </button>
        </Show>
      </div>
      <DeepSeekHarnessProviderSwitchDialog
        open={surface.canMutate() && snapshot().state === "provider-switch-confirmation-required"}
        source={providerLabel(snapshot().runningSelection?.providerID, snapshot())}
        target={providerLabel(snapshot().desiredSelection?.providerID, snapshot())}
        onConfirm={() => harness.post({ type: "chipmateDeepSeekHarness.confirmProviderSwitch" })}
        onCancel={() => harness.post({ type: "chipmateDeepSeekHarness.cancelProviderSwitch" })}
      />
    </section>
  )
}

export const DeepSeekHarnessComposer: Component = () => {
  const harness = useDeepSeekHarness()
  const language = useLanguage()
  const provider = useProvider()
  const surface = useSessionSurface()
  const snapshot = harness.snapshot
  const [text, setText] = createSignal("")
  let appliedRevision = -1
  let published = ""
  createEffect(() => {
    const draft = surface.draft()
    if (!draft || draft.revision <= appliedRevision) return
    appliedRevision = draft.revision
    const value = draft.content.deepSeekHarness?.text ?? ""
    published = value
    if (text() !== value) setText(value)
  })
  createEffect(() => {
    const value = text()
    const draft = surface.draft()
    if (!draft || !surface.canMutate() || value === published) return
    published = value
    surface.updateDraft({
      ...draft.content,
      deepSeekHarness: {
        text: value,
        mode: harness.conversation()?.snapshot.running ? "steer" : "queue",
        answers: draft.content.deepSeekHarness?.answers ?? {},
      },
    })
  })
  const models = () => {
    const catalog = new Map(provider.models().map((model) => [`${model.providerID}/${model.id}`, model] as const))
    return snapshot()
      .providerOptions.filter((option) => option.available)
      .flatMap((option) =>
        option.models.map(
          (model) =>
            catalog.get(`${model.providerID}/${model.modelID}`) ?? {
              id: model.modelID,
              name: model.name,
              providerID: model.providerID,
              providerName: option.providerName,
            },
        ),
      )
  }
  const selection = () => snapshot().desiredSelection ?? snapshot().selectedModel ?? snapshot().runningSelection
  const reasoning = () => harness.conversation()?.reasoning
  const selectorDisabled = () =>
    ["resolving-provider", "reconnecting-events", "resyncing-session", "stopping", "switching-provider"].includes(
      snapshot().state,
    )
  const send = (mode: "queue" | "steer" = "queue") => {
    const value = text().trim()
    if (!value || !harness.readyForInput() || harness.pending().length > 0) return
    window.dispatchEvent(new CustomEvent("resumeAutoScroll"))
    void harness.send(value, mode)
    setText("")
  }
  return (
    <footer
      class="dsh-composer"
      aria-label={local(language.locale(), "ChipMate DeepSeek Harness 输入", "ChipMate DeepSeek Harness input")}
      data-ui="qa-composer"
    >
      <div class="dsh-composer-row">
        <textarea
          value={text()}
          disabled={!harness.readyForInput() || harness.pending().length > 0}
          placeholder={
            harness.pending().length > 0
              ? local(
                  language.locale(),
                  "请先完成官方 DSH 的待处理交互",
                  "Complete the pending official DSH interaction first",
                )
              : harness.readyForInput()
                ? local(language.locale(), "发送给官方 DSH…", "Send to official DSH…")
                : snapshot().state === "ready"
                  ? local(language.locale(), "正在恢复当前官方会话…", "Restoring the current official session…")
                  : statusText(snapshot().state, language.locale())
          }
          onInput={(event) => setText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.isComposing) {
              event.preventDefault()
              send(harness.conversation()?.snapshot.running ? "steer" : "queue")
              return
            }
            if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
              event.preventDefault()
              send()
            }
          }}
        />
        <Button
          disabled={!text().trim() || !harness.readyForInput() || harness.pending().length > 0}
          onClick={() => send()}
        >
          {local(language.locale(), "发送", "Send")}
        </Button>
        <Show when={harness.conversation()?.snapshot.running}>
          <Button variant="ghost" onClick={() => void harness.cancel()}>
            {local(language.locale(), "中断", "Stop")}
          </Button>
        </Show>
      </div>
      <div class="prompt-input-hint" data-ui="qa-composer-footer">
        <div class="prompt-input-hint-selectors" data-ui="qa-composer-selectors">
          <ModeSwitcher />
          <Show
            when={!snapshot().readOnlySession}
            fallback={<span class="dsh-readonly-model">{harness.selectedModel()?.name ?? "DeepSeek"}</span>}
          >
            <ModelSelectorBase
              value={
                selection()
                  ? {
                      providerID: selection()!.providerID,
                      modelID: selection()!.modelID,
                    }
                  : null
              }
              models={models()}
              disabled={selectorDisabled()}
              favorites={false}
              label="ChipMate DeepSeek Harness 模型"
              onSelect={(providerID, modelID) => {
                const model = snapshot()
                  .providerOptions.find((option) => option.available && option.providerID === providerID)
                  ?.models.find((item) => item.modelID === modelID)
                if (model) void harness.selectModel(model)
              }}
            />
            <Show when={!selectorDisabled() && reasoning()?.efforts.length}>
              <ThinkingSelectorBase
                variants={reasoning()!.efforts.map((effort) => effort.id)}
                value={reasoning()!.value}
                onSelect={(effort) => void harness.selectReasoningEffort(effort)}
                globalTrigger={false}
                cycleHint={false}
              />
            </Show>
          </Show>
        </div>
      </div>
    </footer>
  )
}

function statusText(state: DeepSeekHarnessState, locale = "zh"): string {
  const zh: Record<string, string> = {
    stopped: "已停止",
    "installing-runtime": "正在准备运行时",
    "runtime-unavailable": "运行时不可用",
    "runtime-ready": "运行时已就绪",
    "acquiring-lock": "正在取得单航锁",
    "checking-process": "正在核对可信进程",
    "starting-supervisor": "正在启动生命周期管理器",
    "spawning-official-dsh": "正在启动官方 DSH",
    "waiting-listen-address": "正在等待官方监听地址",
    "describing-host": "正在验证官方 Host",
    "configuring-preset": "正在配置官方 Agent 模式",
    "configuring-provider": "正在配置官方模型容量",
    "resolving-provider": "正在检查可用于官方 DSH 的 Provider",
    "provider-selection-required": "请选择直连 NewAPI Provider",
    "switching-provider": "正在切换 Provider",
    "provider-switch-confirmation-required": "Provider 切换等待确认",
    "connecting-mux": "正在连接官方事件流",
    "connecting-host": "正在连接官方交互流",
    "reconnecting-events": "事件连接中断，正在恢复",
    "resyncing-session": "正在恢复官方会话状态",
    "projecting-session": "正在建立官方 ConversationSnapshot",
    ready: "已就绪",
    "restart-required": "需要重启",
    "preset-unavailable": "官方 Agent 模式不可用",
    stopping: "正在停止",
    crashed: "已崩溃",
  }
  const en: Record<string, string> = {
    stopped: "Stopped",
    "installing-runtime": "Preparing runtime",
    "runtime-unavailable": "Runtime unavailable",
    "runtime-ready": "Runtime ready",
    "acquiring-lock": "Acquiring single-flight lock",
    "checking-process": "Checking trusted process",
    "starting-supervisor": "Starting lifecycle supervisor",
    "spawning-official-dsh": "Starting official DSH",
    "waiting-listen-address": "Waiting for listen address",
    "describing-host": "Verifying official Host",
    "configuring-preset": "Configuring official Agent mode",
    "configuring-provider": "Configuring model capacity",
    "resolving-provider": "Checking Providers for official DSH",
    "provider-selection-required": "Select a direct NewAPI Provider",
    "switching-provider": "Switching Provider",
    "provider-switch-confirmation-required": "Provider switch confirmation required",
    "connecting-mux": "Connecting event stream",
    "connecting-host": "Connecting interaction stream",
    "reconnecting-events": "Event connection interrupted; recovering",
    "resyncing-session": "Restoring official session state",
    "projecting-session": "Building official ConversationSnapshot",
    ready: "Ready",
    "restart-required": "Restart required",
    "preset-unavailable": "Official Agent mode unavailable",
    stopping: "Stopping",
    crashed: "Crashed",
  }
  return (locale === "zh" ? zh : en)[String(state)] ?? String(state)
}

const OfficialConversationNode: Component<{ node: ChatConversationViewNode }> = (props) => {
  const display = useDisplay()
  const language = useLanguage()
  const data = () => asRecord(props.node.data)
  const kind = () => props.node.kind
  const blocks = (): AssistantBlock[] => {
    const value = data().blocks
    return Array.isArray(value) ? (value as AssistantBlock[]) : []
  }
  const assistant = createMemo(() => projectAssistantBlocks(props.node.id, blocks(), data().status === "running"))
  return (
    <Switch fallback={<UnknownOfficialNode kind={kind()} data={data()} />}>
      <Match when={kind() === "user" || kind() === "steering"}>
        <article class="vscode-session-turn-user dsh-qa-user" data-official-node-kind={kind()}>
          <div data-component="user-message">
            <div data-slot="user-message-body">
              <div data-slot="user-message-text">
                <ConversationContent content={data().content} />
              </div>
            </div>
          </div>
        </article>
      </Match>
      <Match when={kind() === "context"}>
        <details class="dsh-context-disclosure" data-official-node-kind="context">
          <summary>{local(language.locale(), "官方运行上下文", "Official runtime context")}</summary>
          <ConversationContent content={data().content} />
        </details>
      </Match>
      <Match when={kind() === "assistant-step"}>
        <article class="vscode-session-turn-assistant dsh-qa-assistant" data-official-node-kind="assistant-step">
          <Index each={assistant()}>
            {(item) => (
              <AssistantPresentation
                item={item()}
                autoCollapse={display.reasoningAutoCollapse()}
                streaming={data().status === "running"}
              />
            )}
          </Index>
        </article>
      </Match>
      <Match when={kind() === "tool-call"}>
        <ToolTree block={data().root as ToolCallBlock} />
      </Match>
      <Match when={kind() === "turn-tail"}>
        <TurnMetadata data={data()} />
      </Match>
      <Match when={kind() === "model-retry"}>
        <StatusCard
          title={local(language.locale(), "模型正在重试", "Model retry")}
          detail={retryDetail(data(), language.locale())}
        />
      </Match>
      <Match when={kind() === "turn-error"}>
        <StatusCard
          title={local(language.locale(), "任务错误", "Task error")}
          detail={errorDetail(data(), language.locale())}
          error
        />
      </Match>
      <Match when={kind() === "turn-max-tokens"}>
        <StatusCard title={local(language.locale(), "已达到最大输出长度", "Maximum output length reached")} />
      </Match>
      <Match when={kind() === "compaction" || kind() === "manual-compaction"}>
        <StatusCard
          title={local(language.locale(), "上下文压缩", "Context compaction")}
          detail={stringValue(data().summary)}
        />
      </Match>
      <Match when={kind() === "command" || kind() === "command-input"}>
        <StatusCard title={local(language.locale(), "命令", "Command")} detail={commandDetail(data())} />
      </Match>
      <Match when={kind() === "workflow-run"}>
        <StatusCard
          title={`${local(language.locale(), "工作流", "Workflow")}：${stringValue(data().name) || local(language.locale(), "未命名", "Untitled")}`}
          detail={stringValue(data().status)}
        />
      </Match>
      <Match when={kind() === "unknown"}>
        <UnknownOfficialNode kind={stringValue(data().type) || "unknown"} data={data().data} />
      </Match>
    </Switch>
  )
}

const StatusCard: Component<{ title: string; detail?: string; error?: boolean }> = (props) => (
  <div class="dsh-semantic-card" data-error={props.error ? "true" : undefined}>
    <strong>{props.title}</strong>
    <Show when={props.detail}>
      <span>{props.detail}</span>
    </Show>
  </div>
)

const TurnMetadata: Component<{ data: Record<string, unknown> }> = (props) => {
  const language = useLanguage()
  const values = createMemo(() => {
    const items: string[] = []
    const time = numberValue(props.data.time)
    const ttft = numberValue(props.data.ttftMs)
    const speed = numberValue(props.data.tokensPerSecond)
    if (time) items.push(new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))
    if (ttft !== undefined) items.push(`${local(language.locale(), "首字延迟", "TTFT")} ${formatDuration(ttft)}`)
    if (speed !== undefined) items.push(`${speed.toFixed(1)} tokens/s`)
    return items
  })
  return (
    <Show when={values().length}>
      <div class="dsh-turn-meta">{values().join(" · ")}</div>
    </Show>
  )
}

const UnknownOfficialNode: Component<{ kind: string; data: unknown }> = (props) => (
  <UnknownOfficialNodeBody kind={props.kind} data={props.data} />
)

const UnknownOfficialNodeBody: Component<{ kind: string; data: unknown }> = (props) => {
  const language = useLanguage()
  return (
    <div class="dsh-semantic-card dsh-unknown-card" data-official-node-kind={props.kind}>
      <strong>
        {local(language.locale(), "官方未识别节点", "Unknown official node")}：{props.kind}
      </strong>
      <Show when={redactedSummary(props.data)}>{(detail) => <span>{detail()}</span>}</Show>
    </div>
  )
}

const AssistantPresentation: Component<{
  item: AssistantPresentationBlock
  autoCollapse: boolean
  streaming: boolean
}> = (props) => (
  <Show
    when={props.item.kind === "reasoning"}
    fallback={<AssistantContent item={props.item} streaming={props.streaming} />}
  >
    <ReasoningDisclosure
      id={props.item.key}
      text={props.item.kind === "reasoning" ? props.item.text : ""}
      running={props.item.kind === "reasoning" && props.item.running}
      autoCollapse={props.autoCollapse}
    />
  </Show>
)

const AssistantContent: Component<{ item: AssistantPresentationBlock; streaming: boolean }> = (props) => {
  const block = () => (props.item.kind === "content" ? props.item.block : undefined)
  const text = () => {
    const item = block()
    return item?.kind === "text" ? item : undefined
  }
  return (
    <Show when={block()}>
      {(item) => (
        <Show when={text()} fallback={<div class="dsh-assistant-text">{blockText(asRecord(item()))}</div>}>
          {(content) => (
            <div class="dsh-assistant-text">
              <Markdown text={content().text} cacheKey={props.item.key} streaming={props.streaming} />
            </div>
          )}
        </Show>
      )}
    </Show>
  )
}

const ToolTree: Component<{ block?: ToolCallBlock }> = (props) => {
  const block = () => asRecord(props.block)
  const call = () => asRecord(block().call)
  const name = () => stringValue(block().name) || stringValue(call().name) || stringValue(block().callId) || "工具"
  const children = () => (Array.isArray(block().subCalls) ? (block().subCalls as ToolCallBlock[]) : [])
  const state = () => (block().kind === "tool-result" ? (block().isError ? "error" : "completed") : "running")
  const callView = () => asRecord(block().callView)
  const resultView = () => asRecord(block().resultView)
  const view = () => (Object.keys(resultView()).length > 0 ? resultView() : callView())
  const subtitle = () => toolSubtitle(callView())
  return (
    <div class="dsh-tool-tree" data-official-tool-view={stringValue(view().card) || "content"}>
      <BasicTool
        icon={toolIcon()}
        status={state()}
        trigger={{ title: toolTitle(resultView(), toolTitle(callView(), name())), subtitle: subtitle() }}
        tool={name()}
        callID={stringValue(block().callId)}
      >
        <ToolView call={callView()} result={resultView()} content={block().content} />
        <For each={children()}>{(child) => <ToolTree block={child} />}</For>
      </BasicTool>
    </div>
  )
}

const ToolView: Component<{
  call: Record<string, unknown>
  result: Record<string, unknown>
  content: unknown
}> = (props) => {
  const language = useLanguage()
  const view = () => (Object.keys(props.result).length > 0 ? props.result : props.call)
  const card = () => stringValue(view().card)
  const content = () => firstString(view(), ["output", "text", "summary", "snippet", "message"])
  const diffs = () => records(view().diffs)
  const viewContent = () => (Array.isArray(view().content) ? view().content : undefined)
  return (
    <div class="dsh-tool-details">
      <Show when={card() === "terminal"}>
        <Show when={stringValue(props.call.description)}>{(value) => <span>{value()}</span>}</Show>
        <Show when={stringValue(props.call.cwd)}>
          {(value) => (
            <small>
              {local(language.locale(), "工作目录", "Working directory")}：{value()}
            </small>
          )}
        </Show>
        <Show when={content()}>{(value) => <pre>{value()}</pre>}</Show>
        <Show when={numberValue(props.result.exitCode) !== undefined}>
          <small>
            {local(language.locale(), "退出状态", "Exit status")}：{String(numberValue(props.result.exitCode))}
          </small>
        </Show>
        <Show when={stringValue(props.result.signal)}>
          {(value) => (
            <small>
              {local(language.locale(), "终止信号", "Signal")}：{value()}
            </small>
          )}
        </Show>
      </Show>
      <Show when={card() === "diff"}>
        <For each={diffs()}>
          {(diff) => {
            const path = stringValue(diff.path) || "未命名文件"
            return (
              <div class="dsh-tool-diff">
                <small>{path}</small>
                <Diff
                  before={{ name: path, contents: typeof diff.oldText === "string" ? diff.oldText : "" }}
                  after={{ name: path, contents: stringValue(diff.newText) }}
                  virtualized={false}
                />
              </div>
            )
          }}
        </For>
      </Show>
      <Show when={card() === "search"}>
        <SearchToolView view={view()} />
      </Show>
      <Show when={card() === "read"}>
        <ReadToolView view={view()} />
      </Show>
      <Show when={card() === "web"}>
        <WebToolView view={view()} />
      </Show>
      <Show when={card() === "generic"}>
        <Show when={props.call.rawInput !== undefined}>
          <pre>{presentationValue(props.call.rawInput)}</pre>
        </Show>
        <Show when={viewContent()}>{(blocks) => <ConversationContent content={blocks()} />}</Show>
        <Show when={!viewContent() && Boolean(props.content)}>
          <ConversationContent content={props.content} />
        </Show>
      </Show>
      <Show when={!card() && Boolean(props.content)}>
        <ConversationContent content={props.content} />
      </Show>
      <Show when={card() && !["terminal", "diff", "search", "read", "web", "generic"].includes(card())}>
        <span>
          {local(language.locale(), "官方工具视图", "Official tool view")}：{card()}
        </span>
        <Show when={Boolean(props.content)}>
          <ConversationContent content={props.content} />
        </Show>
      </Show>
    </div>
  )
}

const SearchToolView: Component<{ view: Record<string, unknown> }> = (props) => (
  <div class="dsh-structured-result">
    <Show
      when={props.view.shape === "paths"}
      fallback={
        <For each={records(props.view.files)}>
          {(file) => (
            <details>
              <summary>{stringValue(file.path) || "搜索结果"}</summary>
              <pre>
                {records(file.matches)
                  .map((match) => `${numberValue(match.lineNumber) ?? ""} │ ${stringValue(match.line)}`)
                  .join("\n")}
              </pre>
            </details>
          )}
        </For>
      }
    >
      <pre>{strings(props.view.paths).join("\n")}</pre>
    </Show>
    <SearchResultMeta view={props.view} />
  </div>
)

const ReadToolView: Component<{ view: Record<string, unknown> }> = (props) => (
  <div class="dsh-structured-result">
    <small>{stringValue(props.view.path)}</small>
    <pre>
      {records(props.view.lines)
        .map((line) => `${numberValue(line.number) ?? ""} │ ${stringValue(line.text)}`)
        .join("\n")}
    </pre>
    <ReadResultMeta view={props.view} />
  </div>
)

const SearchResultMeta: Component<{ view: Record<string, unknown> }> = (props) => {
  const language = useLanguage()
  return (
    <small>
      {numberValue(props.view.total) ?? 0} {local(language.locale(), "项", "items")}
      {props.view.truncated === true ? local(language.locale(), " · 结果已截断", " · results truncated") : ""}
    </small>
  )
}

const ReadResultMeta: Component<{ view: Record<string, unknown> }> = (props) => {
  const language = useLanguage()
  return (
    <small>
      {local(language.locale(), "共", "Total")} {numberValue(props.view.totalLines) ?? 0}{" "}
      {local(language.locale(), "行", "lines")}
    </small>
  )
}

const WebToolView: Component<{ view: Record<string, unknown> }> = (props) => (
  <div class="dsh-structured-result">
    <Show when={props.view.kind === "search"}>
      <Show when={stringValue(props.view.answer)}>
        {(answer) => <Markdown text={answer()} cacheKey={`dsh-web-${answer().length}`} />}
      </Show>
      <For each={records(props.view.sources)}>
        {(source) => (
          <div class="dsh-web-source">
            <strong>{stringValue(source.title) || stringValue(source.url)}</strong>
            <small>{stringValue(source.url)}</small>
            <Show when={stringValue(source.snippet)}>{(snippet) => <span>{snippet()}</span>}</Show>
          </div>
        )}
      </For>
    </Show>
    <Show when={props.view.kind === "fetch"}>
      <span>{stringValue(props.view.url)}</span>
      <small>
        HTTP {numberValue(props.view.statusCode) ?? "未知"}
        {props.view.truncated === true ? " · 内容已截断" : ""}
      </small>
    </Show>
  </div>
)

const ConversationContent: Component<{ content: unknown }> = (props) => (
  <div class="dsh-message-content">
    <For each={Array.isArray(props.content) ? props.content : []}>
      {(block) => <span>{contentBlockText(asRecord(block))}</span>}
    </For>
  </div>
)

const SessionMigration: Component = () => {
  const harness = useDeepSeekHarness()
  const language = useLanguage()
  const surface = useSessionSurface()
  const snapshot = harness.snapshot
  const mismatched = createMemo(() =>
    snapshot().sessions.filter((session) => session.agentPreset !== snapshot().expectedAgentPreset),
  )
  const current = createMemo(() => snapshot().sessions.find((session) => session.sessionId === snapshot().sessionId))
  const activeMismatch = createMemo(() => snapshot().presetState === "legacy-mismatch" && current()?.readOnly === false)
  const viewingHistory = createMemo(() => snapshot().readOnlySession === true && current()?.readOnly === true)
  const expected = () => presetLabel(snapshot().expectedAgentPreset, language.locale())
  const actual = () => presetLabel(current()?.agentPreset, language.locale())
  return (
    <>
      <Show when={activeMismatch()}>
        <div class="dsh-migration-card">
          <div>
            <strong>{local(language.locale(), `历史${actual()}会话`, `Historical ${actual()} session`)}</strong>
            <span>
              {local(
                language.locale(),
                `已有上下文不会被改写。新建${expected()}会话将从空上下文开始，并保留此会话供只读查看。`,
                `Existing context will not be rewritten. A new ${expected()} session starts empty, and this session remains available read-only.`,
              )}
            </span>
          </div>
          <Button
            size="small"
            disabled={
              !surface.canMutate() || Boolean(harness.conversation()?.snapshot.running) || harness.pending().length > 0
            }
            onClick={() => harness.post({ type: "chipmateDeepSeekHarness.createPreferredSession" })}
          >
            {local(language.locale(), `新建${expected()}会话`, `Create ${expected()} session`)}
          </Button>
        </div>
      </Show>
      <Show when={viewingHistory()}>
        <div class="dsh-migration-card">
          <div>
            <strong>
              {local(language.locale(), `正在查看历史${actual()}会话`, `Viewing a historical ${actual()} session`)}
            </strong>
            <span>
              {local(
                language.locale(),
                "此会话只读，不会接收新的问题或交互。",
                "This session is read-only and cannot receive new prompts or interactions.",
              )}
            </span>
          </div>
          <Button
            disabled={!surface.canMutate()}
            size="small"
            onClick={() => harness.post({ type: "chipmateDeepSeekHarness.returnToActiveSession" })}
          >
            {local(language.locale(), `返回当前${expected()}会话`, `Return to current ${expected()} session`)}
          </Button>
        </div>
      </Show>
      <Show when={snapshot().presetState === "ready" && !snapshot().readOnlySession && mismatched().length > 0}>
        <div
          class="dsh-history-sessions"
          aria-label={local(language.locale(), "当前任务的历史模式会话", "Historical mode sessions for this task")}
        >
          <span>{local(language.locale(), "历史模式", "Historical mode")}</span>
          <For each={mismatched()}>
            {(session) => (
              <Button
                variant="ghost"
                size="small"
                disabled={!surface.canMutate()}
                onClick={() =>
                  harness.post({ type: "chipmateDeepSeekHarness.openMappedSession", mappingKey: session.mappingKey! })
                }
              >
                {local(language.locale(), "只读查看", "View read-only")}
              </Button>
            )}
          </For>
        </div>
      </Show>
    </>
  )
}

const ProviderSelectionStatus: Component = () => {
  const harness = useDeepSeekHarness()
  const language = useLanguage()
  const vscode = useVSCode()
  const snapshot = harness.snapshot
  const visible = () =>
    [
      "resolving-provider",
      "provider-selection-required",
      "switching-provider",
      "provider-switch-confirmation-required",
    ].includes(snapshot().state)
  const hasAvailableProvider = () => snapshot().providerOptions.some((option) => option.available)
  const title = () => {
    if (snapshot().state === "resolving-provider")
      return local(language.locale(), "正在检查可用于官方 DSH 的 Provider", "Checking Providers for official DSH")
    if (snapshot().state === "switching-provider")
      return local(
        language.locale(),
        `正在从 ${providerLabel(snapshot().runningSelection?.providerID, snapshot())} 切换到 ${providerLabel(snapshot().desiredSelection?.providerID, snapshot())}`,
        `Switching from ${providerLabel(snapshot().runningSelection?.providerID, snapshot())} to ${providerLabel(snapshot().desiredSelection?.providerID, snapshot())}`,
      )
    if (snapshot().state === "provider-switch-confirmation-required")
      return local(
        language.locale(),
        "Provider 切换需要停止正在运行的官方任务",
        "Provider switching requires stopping active official work",
      )
    if (!hasAvailableProvider())
      return local(
        language.locale(),
        "未找到已配置直连 NewAPI 凭据的 Provider",
        "No Provider with direct NewAPI credentials was found",
      )
    return local(
      language.locale(),
      "请选择已配置直连 NewAPI 凭据的 Provider",
      "Select a Provider configured with direct NewAPI credentials",
    )
  }
  const detail = () => {
    if (snapshot().state !== "provider-selection-required") return snapshot().error
    return hasAvailableProvider() ? snapshot().error : undefined
  }
  return (
    <Show when={visible()}>
      <div class="dsh-provider-selection-status" role="status">
        <strong>{title()}</strong>
        <Show when={detail()}>{(value) => <span>{value()}</span>}</Show>
        <Show when={snapshot().state === "provider-selection-required"}>
          <Button
            variant="secondary"
            size="small"
            onClick={() => vscode.postMessage({ type: "openSettingsPanel", tab: "providers" })}
          >
            {local(language.locale(), "打开 Provider 设置", "Open Provider settings")}
          </Button>
        </Show>
      </div>
    </Show>
  )
}

const PendingInteractionCard: Component<{ wait: PendingInteraction }> = (props) => {
  const surface = useSessionSurface()
  const [answers, setAnswers] = createSignal<Record<string, QuestionDraft>>({})
  const answerKey = (id: string) => `${props.wait.key}:${id}`
  const payload = () => asRecord(props.wait.payload)
  const questions = () => (Array.isArray(payload().questions) ? (payload().questions as QuestionItem[]) : [])
  let pendingAnswers = ""
  createEffect(() => {
    const stored = surface.draft()?.content.deepSeekHarness?.answers ?? {}
    const next = Object.fromEntries(
      questions().flatMap((item) => {
        const value = stored[answerKey(item.id)]
        return value ? [[item.id, value] as const] : []
      }),
    )
    const serialized = answersFingerprint(next)
    if (pendingAnswers && serialized !== pendingAnswers) return
    if (serialized === pendingAnswers) pendingAnswers = ""
    if (serialized !== answersFingerprint(answers())) setAnswers(next)
  })
  const updateAnswers = (update: (current: Record<string, QuestionDraft>) => Record<string, QuestionDraft>) => {
    setAnswers((current) => {
      const next = update(current)
      const draft = surface.draft()
      if (!draft || !surface.canMutate()) return next
      pendingAnswers = answersFingerprint(next)
      const stored = { ...(draft.content.deepSeekHarness?.answers ?? {}) }
      for (const item of questions()) delete stored[answerKey(item.id)]
      for (const [id, value] of Object.entries(next)) stored[answerKey(id)] = value
      surface.updateDraft({
        ...draft.content,
        deepSeekHarness: {
          text: draft.content.deepSeekHarness?.text ?? "",
          mode: draft.content.deepSeekHarness?.mode ?? "queue",
          answers: stored,
        },
      })
      return next
    })
  }
  const answerQuestion = () => {
    if (!surface.canMutate()) return
    const answer = {
      answers: questions().map((item) => {
        const value = answers()[item.id] ?? emptyDraft(true)
        if (value.skipped) return { id: item.id, selected: [] }
        const custom = value.custom.trim()
        return {
          id: item.id,
          selected: custom === "" || item.multiSelect === true ? value.selected : [],
          ...(custom === "" ? {} : { custom }),
        }
      }),
    }
    updateAnswers(() => ({}))
    void props.wait.respond({ ok: true, value: { sessionId: props.wait.sessionId, answer } } as never)
  }
  const answerApproval = (outcome: "allowed-once" | "rejected") =>
    surface.canMutate()
      ? props.wait.respond({
          ok: true,
          value: { sessionId: props.wait.sessionId, approvalId: payload().approvalId, outcome },
        } as never)
      : undefined
  return (
    <div class="dsh-request" data-pending-kind={props.wait.kind}>
      <strong>
        {props.wait.kind === "approval"
          ? "官方 DSH 审批"
          : planReview(questions())
            ? "官方 DSH 计划审阅"
            : "官方 DSH 提问"}
      </strong>
      <Show
        when={props.wait.kind === "question"}
        fallback={
          <>
            <span>{stringValue(payload().reason) || stringValue(payload().toolName) || "工具请求需要授权"}</span>
            <div class="dsh-actions">
              <Button disabled={!surface.canMutate()} size="small" onClick={() => void answerApproval("allowed-once")}>
                允许一次
              </Button>
              <Button
                disabled={!surface.canMutate()}
                variant="ghost"
                size="small"
                onClick={() => void answerApproval("rejected")}
              >
                拒绝
              </Button>
            </div>
          </>
        }
      >
        <For each={questions()}>
          {(item) => (
            <div class="dsh-question">
              <span>{item.header ?? item.question ?? item.id}</span>
              <Show when={item.detail}>
                <small>{item.detail}</small>
              </Show>
              <div class="dsh-question-options">
                <For each={item.options ?? []}>
                  {(option) => {
                    const selected = () => answers()[item.id]?.selected.includes(option.label) ?? false
                    return (
                      <label class="dsh-question-option">
                        <input
                          type={item.multiSelect ? "checkbox" : "radio"}
                          name={`dsh-option-${props.wait.key}-${item.id}`}
                          checked={selected()}
                          disabled={!surface.canMutate()}
                          onChange={() =>
                            updateAnswers((current) => {
                              const prior = current[item.id] ?? emptyDraft()
                              const choices = item.multiSelect
                                ? selected()
                                  ? prior.selected.filter((label) => label !== option.label)
                                  : [...prior.selected, option.label]
                                : [option.label]
                              return { ...current, [item.id]: { selected: choices, custom: "", skipped: false } }
                            })
                          }
                        />
                        <span>{option.label}</span>
                        <Show when={option.description}>
                          <small>{option.description}</small>
                        </Show>
                      </label>
                    )
                  }}
                </For>
              </div>
              <input
                value={answers()[item.id]?.custom ?? ""}
                disabled={!surface.canMutate()}
                placeholder="自定义回答"
                onInput={(event) =>
                  updateAnswers((current) => ({
                    ...current,
                    [item.id]: {
                      selected: item.multiSelect ? (current[item.id]?.selected ?? []) : [],
                      custom: event.currentTarget.value,
                      skipped: false,
                    },
                  }))
                }
              />
            </div>
          )}
        </For>
        <div class="dsh-actions">
          <Button disabled={!surface.canMutate()} size="small" onClick={answerQuestion}>
            提交回答
          </Button>
          <Button
            variant="ghost"
            size="small"
            disabled={!surface.canMutate()}
            onClick={() => {
              if (!surface.canMutate()) return
              updateAnswers(() => ({}))
              void props.wait.respond({
                ok: false,
                error: { code: "cancelled", message: "the user closed this question request", details: {} },
              } as never)
            }}
          >
            取消提问
          </Button>
        </div>
      </Show>
    </div>
  )
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function blockText(block: Record<string, unknown>): string {
  if (typeof block.text === "string") return block.text
  if (block.type === "image" || block.kind === "image") return "[图片]"
  return "[官方内容块]"
}

function contentBlockText(block: Record<string, unknown>): string {
  if (typeof block.text === "string") return block.text
  if (block.type === "image" || block.kind === "image") return "[图片]"
  return "[官方内容块]"
}

function redactedSummary(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value.slice(0, 320)
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) return value.slice(0, 4).map(redactedSummary).filter(Boolean).join(" · ").slice(0, 400)
  const entries = Object.entries(asRecord(value))
    .filter(([key]) => !/(api[_-]?key|authorization|credential|token|prompt|content|input|output|path|cwd)/iu.test(key))
    .slice(0, 4)
  return entries
    .map(([key, item]) => `${key}: ${redactedSummary(item)}`)
    .join(" · ")
    .slice(0, 400)
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function firstString(value: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const result = stringValue(value[key])
    if (result) return result
  }
  return ""
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    : []
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function presentationValue(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value.slice(0, 20_000)
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) return value.slice(0, 100).map(presentationValue).join("\n").slice(0, 20_000)
  if (typeof value !== "object") return "[无法显示的官方工具输入]"
  return Object.entries(value as Record<string, unknown>)
    .slice(0, 100)
    .map(([key, item]) => `${key}: ${presentationValue(item)}`)
    .join("\n")
    .slice(0, 20_000)
}

function toolTitle(view: Record<string, unknown>, fallback: string): string {
  return firstString(view, ["title", "name", "label"]) || fallback
}

function toolSubtitle(view: Record<string, unknown>): string | undefined {
  return firstString(view, ["path", "cwd", "query", "url", "description"]) || undefined
}

function toolIcon(): "code" {
  return "code"
}

function retryDetail(data: Record<string, unknown>, locale = "zh"): string {
  const current = asRecord(data.current)
  const attempt = numberValue(current.attempt) ?? numberValue(data.attempt)
  const delay = numberValue(current.delayMs) ?? numberValue(data.delayMs)
  return [
    attempt === undefined ? "" : local(locale, `第 ${attempt} 次`, `Attempt ${attempt}`),
    delay === undefined ? "" : local(locale, `${formatDuration(delay)} 后继续`, `retrying in ${formatDuration(delay)}`),
  ]
    .filter(Boolean)
    .join(" · ")
}

function errorDetail(data: Record<string, unknown>, locale = "zh"): string {
  return (
    firstString(data, ["message", "error", "reason"]) ||
    local(locale, "官方 DSH 返回了任务错误", "Official DSH returned a task error")
  )
}

function commandDetail(data: Record<string, unknown>): string {
  return (
    firstString(data, ["text", "command"]) || [stringValue(data.name), stringValue(data.args)].filter(Boolean).join(" ")
  )
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${Math.round(milliseconds)}ms`
  return `${(milliseconds / 1_000).toFixed(1)}s`
}

function planReview(questions: QuestionItem[]): boolean {
  return questions.length === 1 && questions[0]?.intent?.kind === "plan-review"
}

type QuestionItem = {
  id: string
  question?: string
  header?: string
  detail?: string
  multiSelect?: boolean
  options?: Array<{ label: string; description?: string }>
  intent?: { kind?: string }
}

type QuestionDraft = { selected: string[]; custom: string; skipped: boolean }
const emptyDraft = (skipped = false): QuestionDraft => ({ selected: [], custom: "", skipped })

function answersFingerprint(answers: Record<string, QuestionDraft>): string {
  return Object.entries(answers)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, answer]) =>
      [id, answer.selected.join("\u0000"), answer.custom, answer.skipped ? "1" : "0"].map(encodeURIComponent).join(":"),
    )
    .join("|")
}

function local(locale: string, zh: string, en: string): string {
  return locale === "zh" ? zh : en
}

function presetLabel(preset: string | undefined, locale: string): string {
  if (preset === "standard") return local(locale, "标准模式", "standard mode")
  if (preset === "minimal") return local(locale, "极简模式", "minimal mode")
  return local(locale, "平台首选模式", "platform-preferred mode")
}

function modeStatus(snapshot: DeepSeekHarnessSnapshot, locale: string): string {
  if (snapshot.presetState === "legacy-mismatch")
    return local(
      locale,
      `历史模式（${presetLabel(snapshot.agentPreset, locale)}）`,
      `Historical mode (${presetLabel(snapshot.agentPreset, locale)})`,
    )
  return presetLabel(snapshot.agentPreset ?? snapshot.expectedAgentPreset, locale)
}

function providerLabel(providerID: string | undefined, snapshot: DeepSeekHarnessSnapshot): string {
  if (!providerID) return "Provider"
  return snapshot.providerOptions.find((option) => option.providerID === providerID)?.providerName ?? providerID
}
