import type { KiloClient, Message } from "@kilocode/sdk/v2/client"
import type * as vscode from "vscode"
import type { KiloConnectionService } from "../cli-backend"
import type { SSEPayload } from "../cli-backend/sdk-sse-adapter"
import { COMMENT_SYSTEM_PROMPT } from "./protocol"

type Model = {
  providerID: string
  modelID: string
}

export type CodeCommentSessionOutput = {
  output: string
  providerID: string
  modelID: string
  sessionID: string
}

type CompletionSource = "message-event" | "message-poll" | "session-status" | "session-idle"

export class CodeCommentCancelledError extends Error {
  constructor() {
    super("代码注释生成已取消")
    this.name = "CodeCommentCancelledError"
  }
}

export class CodeCommentSessionError extends Error {
  constructor(
    message: string,
    readonly nonRecoverable = false,
  ) {
    super(message)
    this.name = "CodeCommentSessionError"
  }
}

export const CODE_COMMENT_PERMISSION = [
  { permission: "*", pattern: "*", action: "deny" as const },
  { permission: "read", pattern: "*", action: "allow" as const },
  { permission: "grep", pattern: "*", action: "allow" as const },
  { permission: "glob", pattern: "*", action: "allow" as const },
  { permission: "list", pattern: "*", action: "allow" as const },
  { permission: "codebase_search", pattern: "*", action: "allow" as const },
  { permission: "codebase_analysis", pattern: "*", action: "allow" as const },
  { permission: "semantic_search", pattern: "*", action: "allow" as const },
  { permission: "document_search", pattern: "*", action: "allow" as const },
]

export const CODE_COMMENT_TOOL_TOGGLES: Record<string, boolean> = {
  read: true,
  grep: true,
  glob: true,
  list: true,
  codebase_search: true,
  codebase_analysis: true,
  semantic_search: true,
  document_search: true,
  agent_console_shell: false,
  agent_manager: false,
  apply_patch: false,
  background_process: false,
  bash: false,
  create_word_document: false,
  declare_artifact: false,
  edit: false,
  embedded_review_submit: false,
  export_artifact_diagnostics: false,
  generate_image: false,
  insert_mermaid_into_word: false,
  interactive_terminal: false,
  kilo_memory_save: false,
  materialize_word_fields: false,
  merge_word_documents: false,
  notebook_edit: false,
  notebook_execute: false,
  notify_user: false,
  plan_enter: false,
  plan_exit: false,
  question: false,
  render_mermaid_diagram: false,
  render_plantuml_diagram: false,
  render_word_document: false,
  repo_clone: false,
  save_mermaid_artifact: false,
  skill_create: false,
  skill_market_install: false,
  skill_market_publish: false,
  skill_transaction: false,
  suggest: false,
  task: false,
  todowrite: false,
  webfetch: false,
  websearch: false,
  write: false,
}

export class CodeCommentSessionRunner {
  constructor(
    private readonly connection: Pick<KiloConnectionService, "getClientAsync" | "onEventFiltered">,
    private readonly log: (message: string) => void,
  ) {}

  async run(input: {
    directory: string
    activeFile: string
    prompt: string
    stage: string
    functionHash: string
    model?: Model
    timeoutMs: number
    token: vscode.CancellationToken
  }): Promise<CodeCommentSessionOutput> {
    if (input.token.isCancellationRequested) throw new CodeCommentCancelledError()
    const client = await this.connection.getClientAsync(input.directory)
    const { data: session } = await client.session.create(
      {
        directory: input.directory,
        title: `代码注释 · ${input.stage}`,
        agent: "code",
        metadata: {
          ephemeral: true,
          feature: "high-confidence-code-comments",
          stage: input.stage,
          functionHash: input.functionHash,
        },
        permission: CODE_COMMENT_PERMISSION,
      },
      { throwOnError: true },
    )
    const completion = waitForCompletion({
      connection: this.connection,
      client,
      directory: input.directory,
      sessionID: session.id,
      timeoutMs: input.timeoutMs,
      token: input.token,
    })
    void completion.done.catch(() => undefined)
    try {
      this.log(
        `stage=${input.stage} session=${session.id} function=${input.functionHash.slice(0, 12)} model=${input.model ? `${input.model.providerID}/${input.model.modelID}` : "default-main"}`,
      )
      completion.arm()
      await client.session.promptAsync(
        {
          sessionID: session.id,
          directory: input.directory,
          agent: "code",
          ...(input.model ? { model: input.model } : {}),
          tools: CODE_COMMENT_TOOL_TOGGLES,
          system: COMMENT_SYSTEM_PROMPT,
          editorContext: {
            activeFile: input.activeFile,
          },
          parts: [{ type: "text", text: input.prompt }],
        },
        { throwOnError: true },
      )
      completion.startPolling()
      const completionSource = await completion.done
      const { data } = await client.session.messages(
        { sessionID: session.id, directory: input.directory },
        { throwOnError: true },
      )
      const assistant = [...data].reverse().find((message) => message.info.role === "assistant")
      if (!assistant || assistant.info.role !== "assistant") {
        throw new CodeCommentSessionError("Code agent 会话结束但没有 assistant 响应")
      }
      if (assistant.info.error) {
        throw sessionError(assistant.info.error)
      }
      const text = assistant.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
      const output = text.trim() ? text : typeof assistant.info.structured === "string" ? assistant.info.structured : ""
      this.log(
        `stage=${input.stage} complete session=${session.id} provider=${assistant.info.providerID} model=${assistant.info.modelID} structured=${assistant.info.structured !== undefined} completion=${completionSource}`,
      )
      return {
        output,
        providerID: assistant.info.providerID,
        modelID: assistant.info.modelID,
        sessionID: session.id,
      }
    } catch (error) {
      if (error instanceof CodeCommentCancelledError || error instanceof CodeCommentSessionError) throw error
      throw sessionError(error)
    } finally {
      completion.stop()
      await client.session.delete({ sessionID: session.id, directory: input.directory }).catch((error: unknown) => {
        this.log(`stage=${input.stage} 临时会话删除失败：${formatError(error)}`)
      })
    }
  }
}

function waitForCompletion(input: {
  connection: Pick<KiloConnectionService, "onEventFiltered">
  client: KiloClient
  directory: string
  sessionID: string
  timeoutMs: number
  token: vscode.CancellationToken
}) {
  let armed = false
  let busy = false
  let settled = false
  let stopped = false
  let polling = false
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let rejectDone: (reason: unknown) => void = () => {}
  let resolveDone: (source: CompletionSource) => void = () => {}
  const done = new Promise<CompletionSource>((resolve, reject) => {
    resolveDone = resolve
    rejectDone = reject
  })
  const settle = (source: CompletionSource, error?: unknown) => {
    if (settled) return
    settled = true
    stop()
    if (error) rejectDone(error)
    else resolveDone(source)
  }
  const abort = (error: unknown) => {
    void input.client.session.abort({ sessionID: input.sessionID, directory: input.directory }).catch(() => undefined)
    settle("session-status", error)
  }
  const timer = setTimeout(
    () => abort(new CodeCommentSessionError(`Code agent 会话超过 ${Math.ceil(input.timeoutMs / 1000)} 秒未完成`)),
    input.timeoutMs,
  )
  const cancellation = input.token.onCancellationRequested(() => abort(new CodeCommentCancelledError()))
  const unsubscribe = input.connection.onEventFiltered(
    (event) => sessionEvent(event, input.sessionID),
    (event) => {
      if (event.type === "session.error") {
        settle("session-status", sessionError(event.properties.error))
        return
      }
      if (event.type === "message.updated") {
        const info = event.properties.info
        if (!terminalAssistant(info)) return
        if (info.error) settle("message-event", sessionError(info.error))
        else settle("message-event")
        return
      }
      if (event.type === "session.status") {
        if (event.properties.status.type === "busy") busy = true
        if (armed && busy && event.properties.status.type === "idle") settle("session-status")
        return
      }
      if (event.type === "session.idle" && armed && busy) settle("session-idle")
    },
  )
  const poll = async () => {
    if (!armed || settled || stopped || polling) return
    polling = true
    try {
      const { data } = await input.client.session.messages(
        { sessionID: input.sessionID, directory: input.directory },
        { throwOnError: true },
      )
      const assistant = [...data].reverse().find((message) => message.info.role === "assistant")
      if (!assistant || !terminalAssistant(assistant.info)) return
      if (assistant.info.error) settle("message-poll", sessionError(assistant.info.error))
      else settle("message-poll")
    } catch {
      // SSE 仍是主完成信号；轮询失败时等待下一次，最终由原始超时给出明确结果。
    } finally {
      polling = false
      if (!settled && !stopped) pollTimer = setTimeout(() => void poll(), 2_000)
    }
  }
  function stop() {
    if (stopped) return
    stopped = true
    clearTimeout(timer)
    if (pollTimer) clearTimeout(pollTimer)
    cancellation.dispose()
    unsubscribe()
  }
  return {
    done,
    arm() {
      armed = true
    },
    startPolling() {
      void poll()
    },
    stop,
  }
}

function sessionEvent(event: SSEPayload, sessionID: string): boolean {
  if (event.type === "session.status" || event.type === "session.idle") {
    return event.properties.sessionID === sessionID
  }
  if (event.type === "session.error") return event.properties.sessionID === sessionID
  if (event.type === "message.updated") return event.properties.info.sessionID === sessionID
  return false
}

function terminalAssistant(info: Message): info is Extract<Message, { role: "assistant" }> {
  if (info.role !== "assistant" || info.time.completed === undefined || info.summary) return false
  if (info.error) return true
  return Boolean(info.finish && !["tool-calls", "unknown"].includes(info.finish))
}

function sessionError(error: unknown): CodeCommentSessionError {
  const message = formatError(error)
  const nonRecoverable =
    /(?:ProviderAuthError|400|401|403|404|authentication|unauthorized|unknown model|model not found|invalid_request_error|tool_choice)/i.test(
      message,
    )
  return new CodeCommentSessionError(message, nonRecoverable)
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    const cause = "cause" in error ? formatError((error as Error & { cause?: unknown }).cause) : ""
    return redact(`${error.name}: ${error.message}${cause ? `；cause=${cause}` : ""}`)
  }
  if (!error || typeof error !== "object") return redact(String(error ?? "未知错误"))
  const value = error as Record<string, unknown>
  const name = typeof value.name === "string" ? value.name : typeof value._tag === "string" ? value._tag : "Error"
  const data = value.data && typeof value.data === "object" ? (value.data as Record<string, unknown>) : value
  const fields = ["message", "statusCode", "code", "isRetryable", "responseBody"]
    .flatMap((key) => {
      const item = data[key]
      if (item === undefined) return []
      return [`${key}=${typeof item === "string" ? item : JSON.stringify(item)}`]
    })
    .join("；")
  return redact(`${name}${fields ? `：${fields}` : ""}`)
}

function redact(input: string): string {
  return input
    .replace(/((?:api[-_ ]?key|authorization|cookie|token|password))\s*[=:]\s*[^\s；,}]+/gi, "$1=<redacted>")
    .slice(0, 1200)
}
