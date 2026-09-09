import * as vscode from "vscode"
import { join } from "node:path"
import { readFile } from "node:fs/promises"
import { createReadStream } from "node:fs"
import { randomUUID } from "node:crypto"
import type { ChipMateConnectionService } from "../cli-backend"
import { resolveChipmateServer } from "../chipmate-server"
import { sharedMarketplaceAuth } from "../marketplace/auth"
import { redactText } from "@opencode-ai/core/chipmate/diagnostics/redact"
import type { DiagnosticMode, DiagnosticOptions, DiagnosticRequest, DiagnosticResponse, DiagnosticState } from "../../shared/diagnostics"
import { collect } from "./collect"
import { buildBundle, verifyBundle, type Bundle } from "./bundle"
import { diagnostic } from "./record"

type Surface = { directory: string; sessionID?: string; post: (message: DiagnosticResponse) => void }
type Job = { options: DiagnosticOptions; surface: Surface; server: string; abort: AbortController; state: DiagnosticState; bundle?: Bundle; token?: string; running: boolean }
let service: DiagnosticsService | undefined
export function diagnosticsService() { return service }
export function initializeDiagnosticService(context: vscode.ExtensionContext, connection: ChipMateConnectionService) {
  service = new DiagnosticsService(context, connection)
  context.subscriptions.push(service)
  for (const mode of ["submit", "export"] as const) context.subscriptions.push(vscode.commands.registerCommand(`chipmate.v2.diagnostics.${mode}`, () => service?.native(mode)))
  return service
}
export class DiagnosticsService {
  private job?: Job
  private eventBudget = { time: 0, count: 0 }
  private readonly auth
  private readonly subscriptions: vscode.Disposable[]
  constructor(private readonly context: vscode.ExtensionContext, private readonly connection: ChipMateConnectionService) {
    this.auth = sharedMarketplaceAuth(context.secrets, () => resolveChipmateServer().baseUrl)
    this.subscriptions = [vscode.workspace.onDidChangeConfiguration(() => {
      if (this.job?.running && resolveChipmateServer().baseUrl !== this.job.server) this.job.abort.abort(new Error("Server 已切换，请重新收集；可保存已有日志包"))
    }), context.secrets.onDidChange((event) => {
      if (event.key.startsWith("chipmate.v2.marketplace.ldap.") && this.job?.running && this.job.token) this.job.abort.abort(new Error("登录状态已变化，请重新提交；已有日志包可保存"))
    })]
  }
  dispose() { this.job?.abort.abort(); this.subscriptions.forEach((item) => item.dispose()); if (service === this) service = undefined }
  async handle(message: DiagnosticRequest, surface: Surface): Promise<boolean> {
    if (!message || typeof message.type !== "string" || !message.type.startsWith("diagnostics.")) return false
    if (message.type === "diagnostics.event") {
      if (Date.now() - this.eventBudget.time > 60000) this.eventBudget = { time: Date.now(), count: 0 }
      if (++this.eventBudget.count <= 30 && ["error", "rejection", "message-error"].includes(message.event)) diagnostic(`Webview ${message.event}`, { message: String(message.message).slice(0, 8192), stack: String(message.stack ?? "").slice(0, 8192) }, "ERROR", "webview")
      return true
    }
    if (message.type === "diagnostics.context") {
      surface.post({ type: "diagnostics.context", requestId: message.requestId, server: resolveChipmateServer().baseUrl, hasSession: Boolean(surface.sessionID) })
      if (this.job?.running) { this.job.surface.post = surface.post; surface.post({ type: "diagnostics.state", state: this.job.state }) }
      return true
    }
    if (message.type === "diagnostics.start") {
      if (this.job?.running) { this.job.surface.post = surface.post; surface.post({ type: "diagnostics.state", state: this.job.state }); return true }
      const options = message.options
      if (!options || ![1, 24, 168].includes(options.hours) || !["submit", "export"].includes(options.mode) || typeof options.requestId !== "string" || options.requestId.length > 128 || typeof options.description !== "string" || [...options.description].length > 500 || typeof options.includeSession !== "boolean") return true
      const job: Job = { options: { ...options }, surface: { ...surface }, server: resolveChipmateServer().baseUrl, abort: new AbortController(), state: { requestId: options.requestId, phase: "collecting", message: "收集中" }, running: true }
      this.job = job
      await this.run(job)
      return true
    }
    const job = this.job
    if (!job || message.requestId !== job.options.requestId) return true
    job.surface.post = surface.post
    if (message.type === "diagnostics.cancel") { job.abort.abort(new Error("已取消；取消不会撤回服务端已完成的提交")); return true }
    if (message.type === "diagnostics.save" && job.bundle && !job.running) await this.save(job)
    if (message.type === "diagnostics.retry" && job.bundle && !job.running) { job.abort = new AbortController(); job.running = true; await this.run(job) }
    if (message.type === "diagnostics.copy" && job.state.phase === "submitted") await vscode.env.clipboard.writeText(job.bundle!.id)
    if (message.type === "diagnostics.open" && job.state.phase === "submitted") await vscode.env.openExternal(vscode.Uri.parse(`${job.server}/diagnostics?id=${encodeURIComponent(job.bundle!.id)}`))
    return true
  }
  private update(job: Job, phase: DiagnosticState["phase"], message: string, extra: Partial<DiagnosticState> = {}) {
    job.state = { requestId: job.options.requestId, phase, message, ...(job.bundle ? { id: job.bundle.id, partial: job.bundle.partial, canSave: true } : {}), ...extra }
    job.surface.post({ type: "diagnostics.state", state: job.state })
  }
  private guard(job: Job) {
    job.abort.signal.throwIfAborted()
    if (resolveChipmateServer().baseUrl !== job.server) throw new Error("Server 已切换，请重新收集")
  }
  private async run(job: Job) {
    try {
      if (!job.bundle) {
        this.update(job, "collecting", "收集中")
        const signal = AbortSignal.any([job.abort.signal, AbortSignal.timeout(90000)])
        const input = await collect(this.context, this.connection, job.options, job.surface.directory, job.surface.sessionID, signal)
        this.update(job, "packaging", "打包中")
        job.bundle = await buildBundle({ ...input, root: join(this.context.globalStorageUri.fsPath, "diagnostics", "bundles") }, signal)
      }
      if (job.options.mode === "export") { await this.save(job); return }
      this.guard(job)
      const capability = await this.request(job, "/api/v1/capabilities")
      const supported = capability.diagnostics as { enabled?: boolean; schemaVersion?: number } | undefined
      if (!supported?.enabled || supported.schemaVersion !== 1) throw new Error("当前 Server 不支持诊断提交，可保存本地日志包")
      this.update(job, "login", "正在确认登录；取消登录后可保存日志包")
      // 重试仅使用原登录凭据，防止将旧包交给另一个账号。
      if (!job.token) job.token = await this.auth.access(true)
      if (!job.token) throw new Error("未完成登录，可保存本地日志包")
      this.guard(job)
      const existing = await this.receipt(job)
      if (!existing) {
        await verifyBundle(job.bundle)
        this.update(job, "uploading", "上传中")
        const stream = createReadStream(job.bundle.path)
        try {
          await this.request(job, "/api/v1/diagnostics/bundles", { method: "POST", headers: { "content-type": "application/vnd.chipmate.diagnostics+zip", "content-length": String(job.bundle.size), "idempotency-key": job.bundle.id, "x-content-sha256": job.bundle.sha256 }, body: stream as unknown as BodyInit, duplex: "half" } as RequestInit)
        } catch (error) {
          this.guard(job)
          // 响应丢失时只查原编号，不自动重复上传。
          if (!await this.receipt(job)) throw error
        } finally { stream.destroy() }
      }
      this.update(job, "verifying", "服务端校验中")
      if (!await this.receipt(job)) throw new Error("尚未确认提交结果，请稍后按原编号重试查询")
      this.update(job, "submitted", "诊断已提交。仅本人和管理员可查看，7 天后自动清理。")
    } catch (error) {
      const reason = job.abort.signal.reason instanceof Error ? job.abort.signal.reason.message : error instanceof Error ? error.message : "诊断处理失败"
      this.update(job, job.abort.signal.aborted ? "cancelled" : "failed", redactText(reason))
    } finally { job.running = false }
  }
  private async request(job: Job, path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    this.guard(job)
    const response = await fetch(`${job.server}${path}`, { ...init, headers: { ...(job.token ? { authorization: `Bearer ${job.token}` } : {}), ...init.headers }, redirect: "error", signal: AbortSignal.any([job.abort.signal, AbortSignal.timeout(init.method === "POST" ? 300000 : 10000)]) })
    const text = await response.text()
    if (text.length > 256000) throw new Error("Server 响应超出预算")
    const data = text ? JSON.parse(text) as Record<string, unknown> : {}
    if (!response.ok) throw Object.assign(new Error(typeof data.message === "string" ? data.message : `Server 返回 HTTP ${response.status}`), { status: response.status })
    return data
  }
  private async receipt(job: Job) {
    try {
      const data = await this.request(job, `/api/v1/diagnostics/bundles/${job.bundle!.id}`)
      if (data.status !== "submitted") return false
      if (data.id !== job.bundle!.id || data.sha256 !== job.bundle!.sha256 || data.size !== job.bundle!.size) throw new Error("服务端收据与本地诊断包不一致")
      return true
    } catch (error) { if (error && typeof error === "object" && "status" in error && error.status === 404) return false; throw error }
  }
  private async save(job: Job) {
    if (!job.bundle) return
    await verifyBundle(job.bundle)
    const target = await vscode.window.showSaveDialog({ title: "保存 ChipMate 日志包", defaultUri: vscode.Uri.file(join(job.surface.directory || this.context.globalStorageUri.fsPath, `chipmate-diagnostics-${job.bundle.id}.zip`)), filters: { "诊断日志包": ["zip"] } })
    if (!target) { this.update(job, "cancelled", "已取消保存，完整日志包仍可另存"); return }
    const temporary = target.with({ path: `${target.path}.${randomUUID()}.part` })
    try {
      await vscode.workspace.fs.writeFile(temporary, await readFile(job.bundle.path))
      await vscode.workspace.fs.rename(temporary, target, { overwrite: true })
    } catch (error) { await vscode.workspace.fs.delete(temporary).catch(() => diagnostic("另存临时文件清理失败", undefined, "WARN")); throw error }
    this.update(job, "saved", "日志包已保存；该文件由你自行管理")
  }
  async native(mode: DiagnosticMode) {
    const description = await vscode.window.showInputBox({ title: mode === "submit" ? "提交诊断" : "保存日志包", prompt: "问题描述（选填，最多 500 字）", validateInput: (value) => [...value].length > 500 ? "最多 500 字" : undefined })
    if (description === undefined) return
    const range = await vscode.window.showQuickPick([{ label: "最近 24 小时", hours: 24 }, { label: "最近 1 小时", hours: 1 }, { label: "最近 7 天", hours: 168 }], { title: "诊断时间范围" })
    if (!range) return
    const server = resolveChipmateServer().baseUrl
    const proceed = await vscode.window.showInformationMessage(`自动收集脱敏运行日志和组件状态；原生入口不附加会话内容。${mode === "submit" ? `提交至 ${server}，仅本人和管理员可查看，保留 7 天。` : "无需登录。"}`, { modal: true }, mode === "submit" ? "收集并提交" : "收集并保存")
    if (!proceed) return
    const requestId = randomUUID()
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "ChipMate 诊断", cancellable: true }, async (progress, token) => {
      const cancel = token.onCancellationRequested(() => { if (this.job?.options.requestId === requestId) this.job.abort.abort(new Error("已取消诊断")) })
      try { await this.handle({ type: "diagnostics.start", options: { requestId, mode, description, hours: range.hours as 1 | 24 | 168, includeSession: false } }, { directory: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "", post: (message) => { if (message.type === "diagnostics.state") progress.report({ message: message.state.message }) } }) } finally { cancel.dispose() }
    })
    const job = this.job
    if (!job) return
    const choice = await vscode.window.showInformationMessage(job.state.message, ...(job.state.phase === "submitted" ? ["复制诊断编号", "查看记录"] : job.bundle ? ["保存日志包"] : []))
    if (choice === "保存日志包") await this.save(job)
    if (choice === "复制诊断编号") await vscode.env.clipboard.writeText(job.bundle!.id)
    if (choice === "查看记录") await vscode.env.openExternal(vscode.Uri.parse(`${job.server}/diagnostics?id=${job.bundle!.id}`))
  }
}
