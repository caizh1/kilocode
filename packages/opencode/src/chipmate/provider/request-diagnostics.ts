import { AsyncLocalStorage } from "node:async_hooks"
import { randomUUID } from "node:crypto"
import type { LanguageModelV3Middleware } from "@ai-sdk/provider"
import { errorCategory, errorChain } from "@opencode-ai/core/chipmate/diagnostics/errors"
import { anonymous, diagnosticErrors, sanitize } from "@opencode-ai/core/chipmate/diagnostics/redact"
import * as Log from "@opencode-ai/core/util/log"
import type { LLMEvent } from "@opencode-ai/llm"

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
export type RequestIdentity = { operationId: string; attempt: number; limit: number; messageID?: string }
type Context = Partial<RequestIdentity> & {
  sessionID: string
  parentSessionID?: string
  rootSessionID?: string
  providerID: string
  modelID: string
  directory?: string
}
type Budget = { stage: string; budget?: number; enabled?: boolean }
const current = new AsyncLocalStorage<RequestTrace>()
const failures = new WeakMap<object, Record<string, string>>()
const log = Log.create({ service: "provider.chat" })

export function requestDiagnostic(
  event: string,
  data: Record<string, unknown>,
  level: "info" | "warn" | "error" = "info",
) {
  log[level](
    event,
    sanitize(
      {
        ...data,
        workspaceId:
          typeof data.directory === "string"
            ? anonymous(data.directory, process.env.CHIPMATE_DIAGNOSTICS_SALT)
            : data.workspaceId,
      },
      process.env.CHIPMATE_DIAGNOSTICS_SALT,
    ) as Record<string, unknown>,
  )
}

/** 诊断状态属于一次调用，不能写入多个会话共享的缓存 SDK。 */
export class RequestTrace {
  readonly requestId = randomUUID()
  private readonly started = performance.now()
  private changed = this.started
  private stage = "准备请求"
  private status?: number
  private gatewayRequestId?: string
  private secrets: string[] = []
  private bytes = 0
  private partial = false
  private streaming = false
  private finished = false
  private failed = false
  private closed = false

  constructor(readonly context: Context) {
    this.context = { ...context, operationId: context.operationId ?? this.requestId, attempt: context.attempt ?? 1 }
  }

  private record(event: string, data: Record<string, unknown> = {}, level: "info" | "warn" | "error" = "info") {
    if (this.closed) return
    const now = performance.now()
    // 日志和可导出的诊断记录使用同一份脱敏数据，禁止输出原始 fetch 参数。
    requestDiagnostic(
      event,
      {
        ...this.context,
        requestId: this.requestId,
        stage: this.stage,
        elapsed: Math.round(now - this.started),
        duration: Math.round(now - this.changed),
        httpStatus: this.status,
        gatewayRequestId: this.gatewayRequestId,
        bytes: this.bytes,
        partial: this.partial,
        ...data,
      },
      level,
    )
  }

  private phase(stage: string, event: string, data: Record<string, unknown> = {}) {
    this.record(event, { ...data, phase: stage })
    this.stage = stage
    this.changed = performance.now()
  }

  middleware(): LanguageModelV3Middleware {
    return {
      specificationVersion: "v3",
      wrapStream: ({ doStream }) => current.run(this, doStream),
      wrapGenerate: ({ doGenerate }) => current.run(this, doGenerate),
    }
  }

  async transport(fetcher: Fetch, input: RequestInfo | URL, init?: RequestInit, budgets: Budget[] = []) {
    const url = input instanceof Request ? input.url : String(input)
    const target = URL.canParse(url) ? new URL(url) : undefined
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    for (const [key, value] of headers) {
      if (!/authorization|api.?key|cookie|token|secret/i.test(key)) continue
      this.secrets.push(value, value.replace(/^(?:Bearer|Basic)\s+/i, ""))
    }
    this.phase("连接与响应头", "模型请求开始", {
      hostname: target?.hostname,
      port: target ? Number(target.port || (target.protocol === "https:" ? 443 : 80)) : undefined,
      diagnostics: budgets,
      platform: process.platform,
      arch: process.arch,
      version: process.versions.bun ?? process.versions.node,
      hasProxy: Boolean(
        process.env.HTTPS_PROXY ||
          process.env.https_proxy ||
          process.env.HTTP_PROXY ||
          process.env.http_proxy ||
          process.env.ALL_PROXY ||
          process.env.all_proxy,
      ),
      strictSSL: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0",
      extraCaConfigured: Boolean(process.env.NODE_EXTRA_CA_CERTS),
    })
    try {
      const response = await fetcher(input, init)
      if (this.closed) {
        await response.body?.cancel()
        throw new DOMException("请求已结束，忽略迟到响应", "AbortError")
      }
      this.status = response.status
      this.gatewayRequestId =
        ["x-request-id", "x-oneapi-request-id", "x-new-api-request-id", "request-id", "x-correlation-id"]
          .map((name) => response.headers.get(name))
          .find(
            (value) =>
              value &&
              /^[\w.:/-]{1,200}$/.test(value) &&
              !this.secrets.some((secret) => secret && value.includes(secret)),
          ) ?? undefined
      this.phase("等待首字节", "模型请求收到响应头")
      if (!response.body) return response
      const reader = response.body.getReader()
      let released = false
      const release = () => {
        if (released) return
        released = true
        reader.releaseLock()
      }
      const trace = this
      const body = new ReadableStream<Uint8Array>(
        {
          async pull(controller) {
            try {
              const result = await reader.read()
              if (result.done) {
                release()
                trace.record("模型响应字节流结束")
                controller.close()
                return
              }
              if (result.value.byteLength && trace.bytes === 0) trace.phase("响应流", "模型请求收到首个响应字节")
              trace.bytes += result.value.byteLength
              controller.enqueue(result.value)
            } catch (error) {
              release()
              controller.error(trace.failure(error))
            }
          },
          async cancel(reason) {
            try {
              await reader.cancel(reason)
            } finally {
              release()
            }
          },
        },
        { highWaterMark: 0 },
      )
      const observed = new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
      Object.defineProperties(observed, {
        url: { value: response.url },
        redirected: { value: response.redirected },
        type: { value: response.type },
      })
      return observed
    } catch (error) {
      throw this.failure(error)
    }
  }

  observe(event: LLMEvent) {
    if (this.closed) return
    // step-start 是客户端事件，在发起网络请求之前就可能出现。
    if (event.type === "step-start") return
    if (!this.streaming) {
      this.streaming = true
      this.record("模型事件流开始")
    }
    if ((event.type === "text-delta" || event.type === "reasoning-delta") && event.text.length) this.partial = true
    if (event.type === "tool-call" || event.type === "tool-result" || event.type === "tool-error") this.partial = true
    if (event.type === "finish" || event.type === "step-finish") {
      this.partial ||= Object.values(event.usage ?? {}).some((value) => typeof value === "number" && value > 0)
    }
    if (event.type === "finish") {
      this.finished = true
      this.record("模型请求流结束", {
        finishReason: event.reason,
        result: event.reason === "error" ? "异常结束" : this.partial || event.reason !== "unknown" ? "完成" : "空响应",
      })
    }
  }

  failure(value: unknown): unknown {
    const error = value && typeof value === "object" ? value : new Error(String(value))
    const category =
      this.stage === "等待首字节" && /no response data within/i.test(String((error as Error).message))
        ? "请求超时"
        : errorCategory(error)
    const code = errorChain(error).find((entry) => typeof entry.code === "string")?.code
    failures.set(error, {
      requestId: this.requestId,
      operationId: this.context.operationId ?? this.requestId,
      stage: this.stage,
      category,
      ...(code ? { code: String(code) } : {}),
      ...(this.gatewayRequestId ? { gatewayRequestId: this.gatewayRequestId } : {}),
      attempt: String(this.context.attempt ?? 1),
      limit: String(this.context.limit ?? 3),
      elapsed: String(Math.round(performance.now() - this.started)),
    })
    if (!this.failed) {
      this.failed = true
      this.record(
        category === "用户取消" ? "模型请求已取消" : "模型请求失败",
        {
          category,
          details: diagnosticErrors(error, this.secrets, process.env.CHIPMATE_DIAGNOSTICS_SALT),
        },
        category === "用户取消" ? "info" : "error",
      )
    }
    return error
  }

  close() {
    if (this.closed) return
    if (!this.finished && !this.failed) this.failure(new DOMException("请求已取消或消费方已结束", "AbortError"))
    this.closed = true
    this.secrets = []
  }
}

export function observeFetch(fetcher: Fetch, budgets: Budget[] | ((init?: RequestInit) => Budget[]) = []): Fetch {
  return (input, init) => {
    const trace = current.getStore()
    return trace
      ? trace.transport(fetcher, input, init, typeof budgets === "function" ? budgets(init) : budgets)
      : fetcher(input, init)
  }
}

export function requestErrorMetadata(error: unknown) {
  return error && typeof error === "object" ? failures.get(error) : undefined
}
