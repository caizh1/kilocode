import * as vscode from "vscode"
import { anonymous, redactText } from "@opencode-ai/core/chipmate/diagnostics/redact"
import { snapshot } from "@opencode-ai/core/chipmate/diagnostics/store"
import type { ChipMateConnectionService } from "../cli-backend"
import type { DiagnosticOptions } from "../../shared/diagnostics"
import { diagnosticStore } from "./record"
import type { DiagnosticSource, BundleInput } from "./bundle"

export async function collect(context: vscode.ExtensionContext, connection: ChipMateConnectionService, options: DiagnosticOptions, directory: string, sessionID: string | undefined, signal: AbortSignal): Promise<Omit<BundleInput, "root">> {
  const store = diagnosticStore()
  if (!store) throw new Error("诊断记录尚未初始化")
  const to = new Date().toISOString()
  const from = new Date(Date.parse(to) - options.hours * 3600_000).toISOString()
  const status = await store.flush()
  const captured = await snapshot(store.context.root, anonymous(directory, store.context.salt), Date.parse(from), Date.parse(to), signal)
  const sources: DiagnosticSource[] = [{ name: "持久诊断记录", status: captured.malformed || status.dropped || !captured.records.length ? "partial" : "ok", message: `记录 ${captured.records.length} 条，损坏或跳过 ${captured.malformed} 条，写入丢弃 ${status.dropped} 条${status.error ? `；${status.error}` : ""}` }]
  for (const [name, match] of [["扩展运行", /^extension/], ["CLI 主日志", /^cli/], ["Webview", /^webview/], ["索引", /index/], ["更新", /update/], ["技能", /market/], ["运行时", /runtime/]] as const) {
    sources.push({ name, status: captured.records.some((record) => match.test(record.source)) ? "ok" : "missing", message: "仅包含所选时间内实际记录的事件" })
  }
  const supplements: Record<string, unknown> = {}
  const server = connection.getServerConfig()
  const read = async (route: string, query: Record<string, string> = {}) => {
    if (!server) throw new Error("CLI 未连接，保留已有日志")
    const url = new URL(route, server.baseUrl)
    url.searchParams.set("directory", directory)
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
    const response = await fetch(url, { headers: { authorization: `Basic ${Buffer.from(`chipmate:${server.password}`).toString("base64")}` }, signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]), redirect: "error" })
    if (!response.ok) throw new Error(`状态采集返回 HTTP ${response.status}`)
    const reader = response.body?.getReader()
    if (!reader) throw new Error("状态响应为空")
    const chunks: Uint8Array[] = []; let size = 0
    try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 8 * 1024 * 1024) throw new Error("状态响应超过采集预算"); chunks.push(next.value) } } finally { await reader.cancel() }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
  }
  async function source(name: string, task: () => Promise<unknown>) {
    try { const data = await task(); supplements[name] = data; sources.push({ name, status: "ok" }); return data }
    catch (error) { signal.throwIfAborted(); sources.push({ name, status: "missing", message: redactText(error instanceof Error ? error.message : String(error), store!.context.salt) }); return undefined }
  }
  const indexing = await source("indexing", () => read("/indexing/status"))
  const runs = new Set<string>()
  function findRuns(value: unknown, depth = 0) {
    if (!value || typeof value !== "object" || depth > 8) return
    for (const [key, item] of Object.entries(value)) {
      if (/runid$/i.test(key) && typeof item === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(item)) runs.add(item)
      if (typeof item === "object") findRuns(item, depth + 1)
    }
  }
  findRuns(indexing)
  for (const run of [...runs].slice(0, 8)) await source(`documents-${run}`, () => read(`/indexing/documents/diagnostics/${encodeURIComponent(run)}`))
  if (runs.size === 0) sources.push({ name: "文档完整诊断", status: "missing", message: "当前状态没有可读取的文档运行编号" })
  let attachment: unknown
  if (options.includeSession) {
    if (!sessionID) sources.push({ name: "会话附件", status: "missing", message: "未选择当前会话" })
    else {
      const entries: unknown[] = []; const pending = [sessionID]; const seen = new Set<string>(); let bytes = 0
      try {
        while (pending.length && seen.size < 32) {
          signal.throwIfAborted()
          const id = pending.shift()!
          if (seen.has(id)) continue
          seen.add(id)
          const messages = await read(`/session/${encodeURIComponent(id)}/message`, { limit: "200" })
          const clean = attachmentData(messages, store.context.salt)
          bytes += Buffer.byteLength(JSON.stringify(clean))
          if (bytes > 10 * 1024 * 1024) { pending.unshift(id); break }
          entries.push({ sessionID: id, messages: clean, partial: Array.isArray(messages) && messages.length >= 200 })
          const children = await read(`/session/${encodeURIComponent(id)}/children`)
          if (Array.isArray(children)) for (const child of children) if (child && typeof child.id === "string" && child.parentID === id) pending.push(child.id)
        }
        attachment = { time: to, partial: true, description: "活动会话的有限快照；每个会话最多最近 200 条消息，最多 32 个关联会话；不包含文件附件", sessions: entries }
        sources.push({ name: "会话附件", status: "partial", message: "有限时间点快照，任务可能仍在运行；仅含已有文本记录" })
      } catch (error) { signal.throwIfAborted(); attachment = { partial: true, sessions: entries }; sources.push({ name: "会话附件", status: "partial", message: redactText(error instanceof Error ? error.message : String(error), store.context.salt) }) }
    }
  }
  const config = vscode.workspace.getConfiguration("chipmate.v2")
  return { salt: store.context.salt, version: context.extension.packageJSON.version, platform: `${process.platform}-${process.arch}`, from, to, description: options.description,
    environment: { extensionVersion: context.extension.packageJSON.version, vscodeVersion: vscode.version, platform: process.platform, arch: process.arch, remoteName: vscode.env.remoteName ?? "local", packageTarget: context.extension.packageJSON.chipmatePackageTarget ?? "development", workspaceId: anonymous(directory, store.context.salt), profileId: store.context.salt, connectionState: connection.getConnectionState(), hasProxy: Boolean(vscode.workspace.getConfiguration("http").get("proxy")), strictSSL: vscode.workspace.getConfiguration("http").get("proxyStrictSSL", true), extraCaConfigured: Boolean(config.get("extraCaCerts")) },
    records: captured.records, sources, supplements, ...(attachment === undefined ? {} : { attachment }),
  }
}
function attachmentData(value: unknown, salt: string, depth = 0): unknown {
  if (depth > 12) return "[层级已截断]"
  if (typeof value === "string") return redactText(value, salt, 64000)
  if (value === null || typeof value === "boolean" || typeof value === "number") return value
  if (Array.isArray(value)) return value.slice(0, 2000).filter((item) => !item || typeof item !== "object" || !["file", "image", "audio"].includes(String(item.type))).map((item) => attachmentData(item, salt, depth + 1))
  if (!value || typeof value !== "object") return undefined
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/(api.?key|authorization|cookie|password|secret|token|credentials|headers|url|base64)/i.test(key)).map(([key, item]) => [key, attachmentData(item, salt, depth + 1)]))
}
