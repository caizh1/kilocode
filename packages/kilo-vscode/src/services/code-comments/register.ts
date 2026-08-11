import path from "node:path"
import * as vscode from "vscode"
import type { KiloConnectionService } from "../cli-backend"
import {
  applyCommentProposals,
  applyCommentProposalsForTargets,
  buildCommentedDocument,
  buildCommentedDocumentForTargets,
  validateCommentOnlyDocument,
  validateOnlyCommentInsertions,
  validateTargetSnapshot,
} from "./apply"
import { BATCH_COMMENT_CONCURRENCY, generateCommentBatch, MAX_BATCH_COMMENT_TARGETS } from "./batch"
import { isSupportedCodeCommentLanguage, resolveFunctionTarget, resolveFunctionTargetsInRange } from "./function-target"
import { CodeCommentOrchestrator } from "./orchestrator"
import { CodeCommentPreviewController } from "./preview-controller"
import { CodeCommentCancelledError, CodeCommentSessionRunner, formatError } from "./session-runner"
import { PRODUCTION_COMMENT_STRATEGY } from "./strategy"
import type {
  BatchCommentItemResult,
  BatchCommentProgress,
  BatchCommentTarget,
  CommentGenerationResult,
  FunctionTarget,
} from "./types"

export const GENERATE_CURRENT_FUNCTION_COMMENTS_COMMAND = "chipmate.v2.generateCommentsForCurrentFunction"
export const GENERATE_SELECTED_FUNCTION_COMMENTS_COMMAND = "chipmate.v2.generateCommentsForSelectedFunctions"

const SHOW_DETAILS = "查看详情"

type CommentCommandServices = {
  orchestrator: Pick<CodeCommentOrchestrator, "generate">
  output: vscode.OutputChannel
  log: (message: string) => void
  status: vscode.StatusBarItem
  preview: CodeCommentPreviewController
}

type CommentCommandActivity = {
  running: boolean
}

type ReadyBatchItem = BatchCommentItemResult & {
  result: Extract<CommentGenerationResult, { status: "ready" }>
}

type TargetPick = vscode.QuickPickItem & BatchCommentTarget
type ResultPick = vscode.QuickPickItem & { item: ReadyBatchItem }

export function registerHighConfidenceCodeComments(
  context: vscode.ExtensionContext,
  connection: KiloConnectionService,
): void {
  const output = vscode.window.createOutputChannel("ChipMate 代码注释")
  const log = (message: string) => output.appendLine(`[${new Date().toISOString()}] ${message}`)
  const runner = new CodeCommentSessionRunner(connection, log)
  const orchestrator = new CodeCommentOrchestrator(runner, log)
  const status = vscode.window.createStatusBarItem("chipmate.v2.codeCommentsProgress", vscode.StatusBarAlignment.Right, 90)
  status.name = "ChipMate 注释生成进度"
  status.command = "workbench.action.openNotifications"
  const preview = new CodeCommentPreviewController(undefined, log)
  const services = { orchestrator, output, log, status, preview }
  const activity: CommentCommandActivity = { running: false }

  context.subscriptions.push(
    output,
    status,
    preview,
    vscode.commands.registerCommand(
      "chipmate.v2.generateCommentsForCurrentFunction",
      commentCommandHandler(
        GENERATE_CURRENT_FUNCTION_COMMENTS_COMMAND,
        () => generateCurrentFunctionComments(services),
        services,
        activity,
      ),
    ),
    vscode.commands.registerCommand(
      "chipmate.v2.generateCommentsForSelectedFunctions",
      commentCommandHandler(
        GENERATE_SELECTED_FUNCTION_COMMENTS_COMMAND,
        () => generateSelectedFunctionComments(services),
        services,
        activity,
      ),
    ),
  )
}

function commentCommandHandler(
  command: string,
  run: () => Promise<void>,
  services: Pick<CommentCommandServices, "log" | "output" | "status">,
  activity: CommentCommandActivity,
): () => Promise<void> {
  return async () => {
    if (activity.running) {
      void vscode.window.showInformationMessage("已有代码注释任务正在生成或等待确认，请先完成当前任务。")
      return
    }
    activity.running = true
    try {
      await run()
    } catch (error) {
      if (error instanceof CodeCommentCancelledError) {
        showCancelledStatus(services.status, activity)
        return
      }
      const detail = formatError(error)
      services.log(`command=${command} failed=${detail}`)
      const choice = await vscode.window.showErrorMessage(`代码注释生成失败：${detail}`, SHOW_DETAILS)
      if (choice === SHOW_DETAILS) services.output.show(true)
    } finally {
      activity.running = false
    }
  }
}

function showCancelledStatus(status: vscode.StatusBarItem, activity: CommentCommandActivity): void {
  const text = "$(circle-slash) 注释生成已取消"
  status.text = text
  status.tooltip = "ChipMate 已取消当前代码注释任务"
  status.show()
  setTimeout(() => {
    if (!activity.running && status.text === text) status.hide()
  }, 3_500)
}

async function generateCurrentFunctionComments(input: CommentCommandServices): Promise<void> {
  const target = await resolveCurrentFunctionTarget()
  if (!target) return
  const model = configuredModelOrReport()
  if (model instanceof Error) return
  input.log(
    `command start file=${target.relativePath} function=${target.functionHash.slice(0, 12)} strategy=${PRODUCTION_COMMENT_STRATEGY}`,
  )
  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "ChipMate 正在重新理解并核验当前函数",
      cancellable: true,
    },
    async (progress, token) => {
      progress.report({ message: "启动临时只读 Code 会话…" })
      return input.orchestrator.generate(
        { targets: [target], model, strategy: PRODUCTION_COMMENT_STRATEGY },
        token,
      )
    },
  )
  if (result.status === "unresolved") {
    await showUnresolvedResult(input, target, result)
    return
  }
  input.log(
    `command complete status=${result.status} provider=${result.providerID} model=${result.modelID} rounds=${result.rounds} recovered=${result.recovered}`,
  )
  await previewAndApply(input.preview, target, result)
}

async function generateSelectedFunctionComments(input: CommentCommandServices): Promise<void> {
  const context = activeCodeEditor()
  if (!context) return
  if (context.editor.selection.isEmpty) {
    void vscode.window.showInformationMessage("请先在当前 C/C++ 文件中选择包含一个或多个函数的代码范围。")
    return
  }
  const document = context.editor.document
  const targets = await resolveFunctionTargetsInRange({
    ...context.targetInput,
    selectionStartOffset: document.offsetAt(context.editor.selection.start),
    selectionEndOffset: document.offsetAt(context.editor.selection.end),
  })
  if (targets.length === 0) {
    void vscode.window.showInformationMessage("选区内没有可可靠识别的 C/C++ 函数定义。")
    return
  }
  if (targets.length > MAX_BATCH_COMMENT_TARGETS) {
    void vscode.window.showWarningMessage(
      `选区内识别到 ${targets.length} 个函数，V2 一次最多处理 ${MAX_BATCH_COMMENT_TARGETS} 个，请缩小选区。`,
    )
    return
  }
  const selectedTargets = await chooseBatchTargets(targets)
  if (!selectedTargets?.length) return
  const model = configuredModelOrReport()
  if (model instanceof Error) return
  input.log(
    `batch start file=${targets[0]!.relativePath} targets=${selectedTargets.length} concurrency=${BATCH_COMMENT_CONCURRENCY}`,
  )
  const startedAt = Date.now()
  const results = await runBatchWithProgress(input, selectedTargets, model, startedAt)
  const selectedResults = await chooseBatchResults(results)
  if (!selectedResults?.length) return
  await previewAndApplyBatch(input.preview, selectedResults)
  const failed = results.filter((item) => item.result.status === "unresolved").length
  input.log(
    `batch complete total=${results.length} selected=${selectedResults.length} failed=${failed} elapsedMs=${Date.now() - startedAt}`,
  )
}

async function chooseBatchTargets(targets: FunctionTarget[]): Promise<BatchCommentTarget[] | undefined> {
  const items: TargetPick[] = targets.map((target) => {
    const revising = target.existingFunctionHeader !== undefined
    return {
      label: `$(symbol-method) ${functionLabel(target)}`,
      description: revising ? "已有函数说明 · 选中后修订" : "新增函数说明",
      detail: `${target.relativePath}:${target.startLine + 1}-${target.endLine + 1}`,
      picked: !revising,
      target,
      mode: revising ? "revise" : "insert",
    }
  })
  const selected = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: `选择要生成或修订注释的函数（最多 ${MAX_BATCH_COMMENT_TARGETS} 个）`,
    placeHolder: "已有函数说明的项目默认不选；选中表示修订原说明",
    ignoreFocusOut: true,
  })
  return selected?.map(({ target, mode }) => ({ target, mode }))
}

async function runBatchWithProgress(
  input: CommentCommandServices,
  targets: BatchCommentTarget[],
  model: { providerID: string; modelID: string } | undefined,
  startedAt: number,
): Promise<BatchCommentItemResult[]> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "ChipMate 正在生成选区注释",
      cancellable: true,
    },
    async (progress, token) => {
      let state: BatchCommentProgress = {
        total: targets.length,
        queued: targets.length,
        running: 0,
        recovering: 0,
        completed: 0,
        ready: 0,
        failed: 0,
      }
      let reportedCompleted = 0
      const render = (next: BatchCommentProgress) => {
        state = next
        const increment = ((next.completed - reportedCompleted) / next.total) * 100
        reportedCompleted = next.completed
        const message = progressMessage(next, Date.now() - startedAt)
        progress.report({ message, ...(increment > 0 ? { increment } : {}) })
        input.status.text = `$(sync~spin) 注释 ${next.completed}/${next.total} · ${elapsedText(Date.now() - startedAt)}`
        input.status.tooltip = `ChipMate 正在生成选区注释\n${message}`
        input.status.show()
      }
      render(state)
      const heartbeat = setInterval(() => render(state), 1_000)
      try {
        return await generateCommentBatch({
          targets,
          token,
          concurrency: BATCH_COMMENT_CONCURRENCY,
          report: render,
          generate: (item, reportStage) =>
            input.orchestrator.generate(
              {
                targets: [item.target],
                mode: item.mode,
                model,
                strategy: PRODUCTION_COMMENT_STRATEGY,
              },
              token,
              reportStage,
            ),
        })
      } finally {
        clearInterval(heartbeat)
        input.status.hide()
      }
    },
  )
}

async function chooseBatchResults(results: BatchCommentItemResult[]): Promise<ReadyBatchItem[] | undefined> {
  const ready = results.filter(isReadyBatchItem)
  const failed = results.filter((item) => item.result.status === "unresolved")
  if (ready.length === 0) {
    const reasons = failed.flatMap((item) => (item.result.status === "unresolved" ? item.result.reasons : []))
    await vscode.window.showWarningMessage(`未能形成可靠注释：${reasons[0] ?? "所有候选均失败"}`)
    return
  }
  const items: ResultPick[] = ready.map((item) => ({
    label: `$(check) ${functionLabel(item.target)}`,
    description: item.mode === "revise" ? "修订函数说明" : "新增函数说明",
    detail: item.result.result.summary,
    picked: true,
    item,
  }))
  const selected = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: `选择要加入统一 Diff 的候选（成功 ${ready.length} · 失败 ${failed.length}）`,
    placeHolder: "取消勾选不希望应用的函数候选",
    ignoreFocusOut: true,
  })
  return selected?.map((entry) => entry.item)
}

async function previewAndApplyBatch(preview: CodeCommentPreviewController, items: ReadyBatchItem[]): Promise<void> {
  const first = items[0]!
  const current = currentDocument(first.target)
  const beforeReasons = current ? batchSnapshotReasons(items, current) : ["目标文档已经关闭"]
  if (beforeReasons.length > 0 || !current) {
    void vscode.window.showWarningMessage(`无法预览注释：${beforeReasons.join("；")}。请重新生成。`)
    return
  }
  const changes = items.map((item) => ({ target: item.target, proposals: item.result.result.proposals }))
  const candidate = buildCommentedDocumentForTargets(first.target.documentText, first.target.eol, changes)
  if (!(await validateCommentOnlyDocument(first.target.filePath, first.target.documentText, candidate))) {
    throw new Error("批量候选未通过非注释 token 完全一致校验")
  }
  if (!(await preview.confirm(first.target, candidate, items.length))) return
  const latest = currentDocument(first.target)
  const applyReasons = latest ? batchSnapshotReasons(items, latest) : ["目标文档已经关闭"]
  if (applyReasons.length > 0 || !latest) {
    void vscode.window.showWarningMessage(`无法应用注释：${applyReasons.join("；")}。请重新生成。`)
    return
  }
  if (!(await applyCommentProposalsForTargets(latest, changes))) {
    throw new Error("VS Code 拒绝原子应用批量注释 WorkspaceEdit")
  }
  const proposals = changes.reduce((count, change) => count + change.proposals.length, 0)
  void vscode.window.showInformationMessage(`已为 ${items.length} 个函数应用 ${proposals} 条高可信注释。`)
}

async function resolveCurrentFunctionTarget(): Promise<FunctionTarget | undefined> {
  const context = activeCodeEditor()
  if (!context) return
  const target = await resolveFunctionTarget({
    ...context.targetInput,
    cursorOffset: context.editor.document.offsetAt(context.editor.selection.active),
  })
  if (!target) {
    void vscode.window.showInformationMessage(
      "光标不在可可靠识别的 C/C++ 函数定义内。V1 不支持仅声明、宏生成函数和匿名 lambda。",
    )
    return
  }
  return target
}

function activeCodeEditor():
  | {
      editor: vscode.TextEditor
      targetInput: Omit<Parameters<typeof resolveFunctionTarget>[0], "cursorOffset">
    }
  | undefined {
  const editor = vscode.window.activeTextEditor
  if (!editor || editor.document.uri.scheme !== "file") {
    void vscode.window.showInformationMessage("请先打开一个工作区内的 C/C++ 源文件。")
    return
  }
  if (!isSupportedCodeCommentLanguage(editor.document.languageId)) {
    void vscode.window.showInformationMessage("高可信代码注释仅支持 C/C++。")
    return
  }
  const workspace = vscode.workspace.getWorkspaceFolder(editor.document.uri)
  if (!workspace) {
    void vscode.window.showInformationMessage("当前文件不属于已打开的工作区。")
    return
  }
  const document = editor.document
  return {
    editor,
    targetInput: {
      uri: document.uri.toString(),
      filePath: document.uri.fsPath,
      relativePath: path.relative(workspace.uri.fsPath, document.uri.fsPath).replaceAll(path.sep, "/"),
      workspacePath: workspace.uri.fsPath,
      languageId: document.languageId,
      documentVersion: document.version,
      documentText: document.getText(),
      eol: document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n",
    },
  }
}

async function showUnresolvedResult(
  input: Pick<CommentCommandServices, "log" | "output">,
  target: FunctionTarget,
  result: Extract<CommentGenerationResult, { status: "unresolved" }>,
): Promise<void> {
  input.log(
    `command unresolved function=${target.functionHash.slice(0, 12)} rounds=${result.rounds} reasons=${result.reasons.join("；")}`,
  )
  const choice = await vscode.window.showWarningMessage(
    `未能形成可靠注释：${result.reasons[0] ?? "证据不足"}`,
    SHOW_DETAILS,
  )
  if (choice === SHOW_DETAILS) input.output.show(true)
}

async function previewAndApply(
  preview: CodeCommentPreviewController,
  target: FunctionTarget,
  result: Extract<CommentGenerationResult, { status: "ready" }>,
): Promise<void> {
  const current = currentDocument(target)
  const staleBeforePreview = current ? validateTargetSnapshot(target, current) : ["目标文档已经关闭"]
  if (staleBeforePreview.length > 0) {
    void vscode.window.showWarningMessage(`无法预览注释：${staleBeforePreview.join("；")}。请重新生成。`)
    return
  }
  const candidate = buildCommentedDocument(target, result.result.proposals)
  if (!(await validateOnlyCommentInsertions(target, result.result.proposals, candidate))) {
    throw new Error("候选内容未通过仅注释修改校验")
  }
  if (!(await preview.confirm(target, candidate, 1))) return
  const latest = currentDocument(target)
  const staleBeforeApply = latest ? validateTargetSnapshot(target, latest) : ["目标文档已经关闭"]
  if (staleBeforeApply.length > 0 || !latest) {
    void vscode.window.showWarningMessage(`无法应用注释：${staleBeforeApply.join("；")}。请重新生成。`)
    return
  }
  if (!(await applyCommentProposals(latest, target, result.result.proposals))) {
    throw new Error("VS Code 拒绝应用注释 WorkspaceEdit")
  }
  void vscode.window.showInformationMessage(
    `已应用 ${result.result.proposals.length} 条高可信注释（${result.providerID}/${result.modelID}）。`,
  )
}

function configuredModelOrReport(): { providerID: string; modelID: string } | undefined | Error {
  const model = readConfiguredModel()
  if (model instanceof Error) void vscode.window.showErrorMessage(model.message)
  return model
}

function readConfiguredModel(): { providerID: string; modelID: string } | undefined | Error {
  const value = vscode.workspace.getConfiguration("chipmate.v2.comments").get<string>("model", "").trim()
  if (!value) return
  const slash = value.indexOf("/")
  const providerID = value.slice(0, slash).trim()
  const modelID = value.slice(slash + 1).trim()
  if (slash <= 0 || !providerID || !modelID || /\s/.test(providerID) || /\s/.test(modelID)) {
    return new Error("chipmate.v2.comments.model 必须使用 providerID/modelID 格式，或留空以使用当前主模型。")
  }
  return { providerID, modelID }
}

function currentDocument(target: FunctionTarget): vscode.TextDocument | undefined {
  return vscode.workspace.textDocuments.find((document) => document.uri.toString() === target.uri)
}

function functionLabel(target: FunctionTarget): string {
  const signature = target.anchors[0]?.targetLineText.trim() || target.functionSource.split(/\r?\n/, 1)[0]!.trim()
  return signature.length > 72 ? `${signature.slice(0, 69)}…` : signature
}

function batchSnapshotReasons(items: ReadyBatchItem[], document: vscode.TextDocument): string[] {
  return [...new Set(items.flatMap((item) => validateTargetSnapshot(item.target, document)))]
}

function isReadyBatchItem(item: BatchCommentItemResult): item is ReadyBatchItem {
  return item.result.status === "ready"
}

function progressMessage(progress: BatchCommentProgress, elapsedMs: number): string {
  const base = `已完成 ${progress.completed}/${progress.total} · 运行中 ${progress.running} · 排队 ${progress.queued} · 失败 ${progress.failed}`
  const recovery = progress.recovering > 0 ? ` · 正在恢复 ${progress.recovering} 个候选` : ""
  return `${base} · 已运行 ${elapsedText(elapsedMs)}${recovery}`
}

function elapsedText(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1_000))
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
}
