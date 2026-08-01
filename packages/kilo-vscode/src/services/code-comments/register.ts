import path from "node:path"
import * as vscode from "vscode"
import type { KiloConnectionService } from "../cli-backend"
import {
  applyCommentProposals,
  buildCommentedDocument,
  validateOnlyCommentInsertions,
  validateTargetSnapshot,
} from "./apply"
import { resolveFunctionTarget } from "./function-target"
import { CodeCommentOrchestrator } from "./orchestrator"
import { CodeCommentCancelledError, CodeCommentSessionRunner, formatError } from "./session-runner"
import { PRODUCTION_COMMENT_STRATEGY } from "./strategy"
import type { CommentGenerationResult, FunctionTarget } from "./types"

export const GENERATE_CURRENT_FUNCTION_COMMENTS_COMMAND = "chipmate.v2.generateCommentsForCurrentFunction"

const APPLY = "应用注释"
const CANCEL = "取消"
const SHOW_DETAILS = "查看详情"

export function registerHighConfidenceCodeComments(
  context: vscode.ExtensionContext,
  connection: KiloConnectionService,
): void {
  const output = vscode.window.createOutputChannel("ChipMate 代码注释")
  const log = (message: string) => output.appendLine(`[${new Date().toISOString()}] ${message}`)
  const runner = new CodeCommentSessionRunner(connection, log)
  const orchestrator = new CodeCommentOrchestrator(runner, log)

  context.subscriptions.push(
    output,
    vscode.commands.registerCommand(GENERATE_CURRENT_FUNCTION_COMMENTS_COMMAND, async () => {
      try {
        await generateCurrentFunctionComments({ orchestrator, output, log })
      } catch (error) {
        if (error instanceof CodeCommentCancelledError) {
          vscode.window.setStatusBarMessage("代码注释生成已取消。", 3500)
          return
        }
        const detail = formatError(error)
        log(`command failed=${detail}`)
        const choice = await vscode.window.showErrorMessage(`代码注释生成失败：${detail}`, SHOW_DETAILS)
        if (choice === SHOW_DETAILS) output.show(true)
      }
    }),
  )
}

async function generateCurrentFunctionComments(input: {
  orchestrator: Pick<CodeCommentOrchestrator, "generate">
  output: vscode.OutputChannel
  log: (message: string) => void
}): Promise<void> {
  const target = await resolveCurrentFunctionTarget()
  if (!target) return

  const model = readConfiguredModel()
  if (model instanceof Error) {
    void vscode.window.showErrorMessage(model.message)
    return
  }
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
        {
          targets: [target],
          model,
          strategy: PRODUCTION_COMMENT_STRATEGY,
        },
        token,
      )
    },
  )

  if (result.status === "unresolved") {
    input.log(
      `command unresolved function=${target.functionHash.slice(0, 12)} rounds=${result.rounds} reasons=${result.reasons.join("；")}`,
    )
    const choice = await vscode.window.showWarningMessage(
      `双轮核验未能形成可靠注释：${result.reasons[0] ?? "证据不足"}`,
      SHOW_DETAILS,
    )
    if (choice === SHOW_DETAILS) input.output.show(true)
    return
  }
  input.log(
    `command complete status=${result.status} provider=${result.providerID} model=${result.modelID} rounds=${result.rounds} recovered=${result.recovered}`,
  )
  if (result.status === "skip") {
    void vscode.window.showInformationMessage(`当前函数无需新增注释：${result.summary}`)
    return
  }
  await previewAndApply(target, result)
}

async function resolveCurrentFunctionTarget(): Promise<FunctionTarget | undefined> {
  const editor = vscode.window.activeTextEditor
  if (!editor || editor.document.uri.scheme !== "file") {
    void vscode.window.showInformationMessage("请先打开一个工作区内的 C/C++ 源文件。")
    return
  }
  if (editor.document.languageId !== "c" && editor.document.languageId !== "cpp") {
    void vscode.window.showInformationMessage("高可信代码注释 V1 仅支持 C/C++。")
    return
  }
  const workspace = vscode.workspace.getWorkspaceFolder(editor.document.uri)
  if (!workspace) {
    void vscode.window.showInformationMessage("当前文件不属于已打开的工作区。")
    return
  }
  const document = editor.document
  const target = await resolveFunctionTarget({
    uri: document.uri.toString(),
    filePath: document.uri.fsPath,
    relativePath: path.relative(workspace.uri.fsPath, document.uri.fsPath).replaceAll(path.sep, "/"),
    workspacePath: workspace.uri.fsPath,
    languageId: document.languageId,
    documentVersion: document.version,
    documentText: document.getText(),
    cursorOffset: document.offsetAt(editor.selection.active),
    eol: document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n",
  })
  if (!target) {
    void vscode.window.showInformationMessage(
      "光标不在可可靠识别的 C/C++ 函数定义内。V1 不支持仅声明、宏生成函数和匿名 lambda。",
    )
    return
  }
  return target
}

async function previewAndApply(
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
    throw new Error("候选内容未通过仅注释插入校验")
  }
  if (!(await confirmCommentDiff(target, candidate))) return

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

async function confirmCommentDiff(target: FunctionTarget, candidate: string): Promise<boolean> {
  const before = await vscode.workspace.openTextDocument({
    language: target.languageId,
    content: target.documentText,
  })
  const after = await vscode.workspace.openTextDocument({
    language: target.languageId,
    content: candidate,
  })
  await vscode.commands.executeCommand(
    "vscode.diff",
    before.uri,
    after.uri,
    `${path.basename(target.filePath)} · 高可信注释预览`,
  )
  const answer = await vscode.window.showWarningMessage(
    "请检查已打开的 Diff。确认后只会插入显示的注释，不会修改任何代码。",
    { modal: true },
    APPLY,
    CANCEL,
  )
  return answer === APPLY
}
