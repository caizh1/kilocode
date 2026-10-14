/**
 * Fetch available models from an OpenAI-compatible /models endpoint.
 * Runs in the extension host — no CLI backend dependency.
 */

import { modelFetchErrors, type ModelFetchDiagnostic } from "./fetch-models-diagnostics"

type Options = {
  baseURL: string
  apiKey?: string
  headers?: Record<string, string>
  timeout?: number
  diagnostic?: (event: ModelFetchDiagnostic) => void
  salt?: string
}

type ModelEntry = {
  id: string
  name: string
}

export class FetchModelsError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message)
    this.name = "FetchModelsError"
  }

  get auth() {
    return this.status === 401 || this.status === 403
  }
}

export async function fetchOpenAIModels(opts: Options): Promise<ModelEntry[]> {
  const started = performance.now()
  const budget = opts.timeout ?? 15_000
  let stage: ModelFetchDiagnostic["stage"] = "连接与响应头"
  let status: number | undefined
  const report = (phase: ModelFetchDiagnostic["phase"], extra: Partial<ModelFetchDiagnostic> = {}) => {
    if (!opts.diagnostic) return
    try {
      opts.diagnostic({
        phase,
        stage,
        elapsed: Math.round(performance.now() - started),
        budget,
        httpStatus: status,
        ...extra,
      })
    } catch {
      // 诊断输出不能让原本成功的模型请求失败，也不能泄漏诊断回调抛出的内容。
      console.warn("[ChipMate New] 模型列表诊断记录失败，原请求继续处理")
    }
  }
  const url = opts.baseURL.replace(/\/+$/, "") + "/models"
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...opts.headers,
  }
  if (opts.apiKey) {
    headers["Authorization"] = `Bearer ${opts.apiKey}`
  }

  report("开始")
  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(budget),
    })
    status = response.status
    report("收到响应")
    stage = "响应正文"

    if (!response.ok) {
      const text = await response.text().catch(() => "")
      throw new FetchModelsError(`HTTP ${response.status}: ${text.slice(0, 200)}`, response.status)
    }

    const body = (await response.json()) as { data?: Array<{ id?: string; name?: string }> }
    stage = "解析模型"
    const items = body?.data
    if (!Array.isArray(items)) {
      report("成功", { count: 0 })
      return []
    }

    const seen = new Set<string>()
    const result: ModelEntry[] = []
    for (const item of items) {
      const id = typeof item.id === "string" ? item.id.trim() : ""
      if (!id || seen.has(id)) continue
      seen.add(id)
      result.push({ id, name: typeof item.name === "string" ? item.name.trim() : id })
    }
    result.sort((a, b) => a.id.localeCompare(b.id))
    report("成功", { count: result.length })
    return result
  } catch (error) {
    const diagnosticError =
      stage === "响应正文" && error instanceof SyntaxError ? new SyntaxError("模型列表响应不是有效 JSON") : error
    try {
      if (opts.diagnostic)
        report("失败", {
          details: modelFetchErrors(
            diagnosticError,
            [opts.apiKey ?? "", ...Object.values(opts.headers ?? {})],
            opts.salt,
          ),
        })
    } catch {
      report("失败", { details: [{ message: "异常诊断字段读取失败" }] })
    }
    throw error
  }
}
