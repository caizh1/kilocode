import { createHash } from "node:crypto"
import path from "node:path"
import * as vscode from "vscode"
import type { ChipMateConnectionService } from "../services/cli-backend"
import { getWorkspaceRoot } from "../review-utils"
import { PatentRadarClient, type PatentRadarModule, type PatentRadarScope } from "./client"
import { PatentRadarPanel } from "./PatentRadarPanel"
import { normalizePatentServerBaseUrl } from "../shared/patent-center"
import type { PatentCenterModelSelection } from "../shared/patent-center"

const LAST_SCAN = "chipmate.v2.patentRadar.lastScan"

export function registerPatentRadar(context: vscode.ExtensionContext, connection: ChipMateConnectionService) {
  const client = new PatentRadarClient(connection)
  const directory = () => {
    const root = getWorkspaceRoot()
    if (!root) throw new Error("请先打开一个本地工作区")
    return root
  }
  const server = () => configuredServer()
  const panel = new PatentRadarPanel(context.extensionUri, {
    currentWorkspace: () => getWorkspaceRoot(),
    list: () => client.list(directory()),
    get: (runId) => client.get(directory(), runId),
    research: (runId) => client.research(directory(), runId, server()),
    export: (runId) => client.export(directory(), runId),
    review: (runId, candidateId, decision, note) =>
      client.review(directory(), runId, { candidateId, decision, note, reviewer: reviewer() }),
  })
  const scan = async (
    _background = false,
    selectedModel?: PatentCenterModelSelection,
    scope: PatentRadarScope = { kind: "workspace" },
    confirmLargeClosure = false,
  ) => {
    const root = directory()
    const model = selectedModel ?? analysisModel()
    if (!model) throw new Error("请先连接 Provider，并在“设置 > 专利中心”选择分析模型")
    const run = await client.scan(root, new Date().toISOString().slice(0, 10), server(), model, scope, confirmLargeClosure)
    await context.globalState.update(key(root), Date.now())
    return run
  }
  context.subscriptions.push(
    panel,
    vscode.commands.registerCommand(
      "chipmate.v2.patentRadar.scan",
      (options?: { analysisModel?: PatentCenterModelSelection }) => scan(false, options?.analysisModel),
    ),
    vscode.commands.registerCommand(
      "chipmate.v2.patentRadar.scanModule",
      async (resource?: vscode.Uri | { analysisModel?: PatentCenterModelSelection }, resources?: vscode.Uri[]) => {
        const model = resource && !(resource instanceof vscode.Uri) ? resource.analysisModel : undefined
        const selected = resource instanceof vscode.Uri ? [resource, ...(resources ?? []).filter((item) => item.fsPath !== resource.fsPath)] : undefined
        const scope = selected?.length ? await scopeFromUris(directory(), selected) : await pickModuleScope(client, directory())
        if (!scope) return
        const prepared = await previewAndConfirm(client, directory(), scope)
        if (!prepared) return
        return scan(false, model, prepared.scope, prepared.confirmLargeClosure)
      },
    ),
    vscode.commands.registerCommand("chipmate.v2.patentRadar.manageModules", async () => {
      await manageModules(client, directory())
    }),
    vscode.commands.registerCommand("chipmate.v2.patentRadar.open", async () => {
      panel.open((await client.list(directory()).catch(() => []))[0])
    }),
    vscode.commands.registerCommand("chipmate.v2.patentRadar.research", async () => {
      const run = (await client.list(directory()))[0]
      if (!run) throw new Error("没有可重新检索的 Patent Radar 运行")
      panel.open(await client.research(directory(), run.id, server()))
    }),
    vscode.commands.registerCommand("chipmate.v2.patentRadar.export", async () => {
      const run = (await client.list(directory()))[0]
      if (!run) throw new Error("没有可导出的 Patent Radar 运行")
      const output = await client.export(directory(), run.id)
      await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(output.root))
    }),
    vscode.commands.registerCommand("chipmate.v2.patentRadar.importReviews", async () => {
      const selected = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { "Patent Radar 盲审结果": ["json"] },
        title: "导入 Patent Radar 盲审结果",
      })
      if (!selected?.[0]) return
      const value = parseReviewImport(
        JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(selected[0]))),
      )
      panel.open(await client.importReviews(directory(), value.runId, value))
      void vscode.window.showInformationMessage(`Patent Radar 已导入 ${value.reviews.length} 条盲审结果。`)
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => panel.clear()),
  )
  const root = getWorkspaceRoot()
  if (root) {
    void client
      .list(root)
      .then((runs) => runs.find((run) => run.status === "SCANNING"))
      .then((run) => (run ? client.resume(root, run.id) : undefined))
      .catch((error) => console.warn("[ChipMate New] Patent Radar 断点续跑失败：", error))
  }
  void catchUp(context, scan).catch((error) => console.warn("[ChipMate New] Patent Radar 补跑失败：", error))
  void catchUpModules(context, client).catch((error) => console.warn("[ChipMate New] Patent Radar 模块补跑失败：", error))
}

async function catchUpModules(context: vscode.ExtensionContext, client: PatentRadarClient) {
  const root = getWorkspaceRoot()
  const model = analysisModel()
  if (!root || !model) return
  const days = Math.max(1, vscode.workspace.getConfiguration("chipmate.v2.patentRadar").get<number>("scheduleDays", 7))
  for (const module of (await client.listModules(root)).filter((item) => item.autoScan)) {
    const stateKey = `${LAST_SCAN}.module.${module.id}`
    if (Date.now() - context.globalState.get<number>(stateKey, 0) < days * 24 * 60 * 60 * 1000) continue
    const scope = moduleScope(module)
    const preview = await client.previewScope(root, scope)
    if (preview.coverage.requiresConfirmation) {
      console.warn(`[ChipMate New] 模块 ${module.name} 闭包超过 40%，自动扫描已暂停，等待人工范围确认。`)
      continue
    }
    await client.scan(root, new Date().toISOString().slice(0, 10), configuredServer(), model, scope)
    await context.globalState.update(stateKey, Date.now())
  }
}

async function pickModuleScope(client: PatentRadarClient, root: string): Promise<PatentRadarScope | undefined> {
  const modules = await client.listModules(root)
  const picked = await vscode.window.showQuickPick(
    [
      { label: "$(add) 选择文件或目录创建临时模块", value: "new" },
      ...modules.map((item) => ({ label: `$(package) ${item.name}`, description: item.corePaths.join("、"), value: item.id })),
    ],
    { title: "Patent Radar：选择模块", placeHolder: "选择已保存模块，或创建临时模块" },
  )
  if (!picked) return
  if (picked.value !== "new") {
    const module = modules.find((item) => item.id === picked.value)!
    return moduleScope(module)
  }
  const selected = await vscode.window.showOpenDialog({
    defaultUri: vscode.Uri.file(root),
    canSelectFiles: true,
    canSelectFolders: true,
    canSelectMany: true,
    title: "选择 Patent Radar 模块核心文件或目录",
    openLabel: "预览模块范围",
  })
  if (!selected?.length) return
  return scopeFromUris(root, selected)
}

async function scopeFromUris(root: string, resources: vscode.Uri[]): Promise<PatentRadarScope> {
  const paths = resources.map((resource) => {
    if (resource.scheme !== "file") throw new Error("模块扫描只支持本地文件或目录")
    const relative = path.relative(root, resource.fsPath).replaceAll(path.sep, "/")
    if (!relative || relative === "." || relative.startsWith("../") || path.isAbsolute(relative))
      throw new Error("多选路径必须位于同一当前工作区，且不能选择工作区根目录")
    return relative
  })
  return { kind: "module", corePaths: [...new Set(paths)], expansionPolicy: "quality-first" }
}

async function previewAndConfirm(client: PatentRadarClient, root: string, initial: PatentRadarScope) {
  if (initial.kind === "workspace") return { scope: initial, confirmLargeClosure: false }
  let scope = initial
  let preview = await client.previewScope(root, scope)
  const detail = () =>
    [
      `核心文件 ${preview.coverage.coreFiles.length} 个`,
      `自动依赖 ${preview.coverage.dependencyFiles.length} 个`,
      `设计文档 ${preview.coverage.documentFiles.length} 个`,
      `证据 ${preview.coverage.selectedEvidence}/${preview.coverage.workspaceEvidence}（${(preview.coverage.workspacePercent * 100).toFixed(1)}%）`,
      `预计模型调用约 ${preview.estimatedModelCalls} 次`,
      ...preview.coverage.warnings,
    ].join("\n")
  let confirmLargeClosure = false
  if (preview.coverage.requiresConfirmation) {
    const choice = await vscode.window.showWarningMessage(
      `Patent Radar 模块范围较大\n\n${detail()}`,
      { modal: true },
      "改为全仓扫描",
      "继续完整模块闭包",
      "使用均衡范围",
    )
    if (!choice) return
    if (choice === "改为全仓扫描") return { scope: { kind: "workspace" } as PatentRadarScope, confirmLargeClosure: false }
    if (choice === "使用均衡范围") {
      scope = { ...scope, expansionPolicy: "balanced" }
      preview = await client.previewScope(root, scope)
    } else {
      confirmLargeClosure = true
    }
  }
  const action = await vscode.window.showInformationMessage(
    `Patent Radar 范围预览\n\n${detail()}`,
    { modal: true },
    "扫描一次",
    ...(scope.moduleId ? [] : ["保存并扫描"]),
  )
  if (!action) return
  if (action === "保存并扫描" && scope.kind === "module") {
    const name = await vscode.window.showInputBox({ title: "保存 Patent Radar 模块", prompt: "模块名称", validateInput: (value) => value.trim() ? undefined : "请输入模块名称" })
    if (!name) return
    const saved = await client.saveModule(root, {
      name: name.trim(),
      corePaths: scope.corePaths,
      expansionPolicy: scope.expansionPolicy,
      autoScan: false,
    })
    scope = moduleScope(saved)
  }
  return { scope, confirmLargeClosure }
}

async function manageModules(client: PatentRadarClient, root: string) {
  const modules = await client.listModules(root)
  if (!modules.length) {
    void vscode.window.showInformationMessage("Patent Radar 尚未保存模块，请先使用“模块扫描”创建。")
    return
  }
  const picked = await vscode.window.showQuickPick(
    modules.map((item) => ({ label: item.name, description: item.corePaths.join("、"), module: item })),
    { title: "Patent Radar：管理已保存模块" },
  )
  if (!picked) return
  const action = await vscode.window.showQuickPick(["重命名", picked.module.autoScan ? "关闭自动扫描" : "开启自动扫描", "删除"], {
    title: `管理模块：${picked.module.name}`,
  })
  if (!action) return
  if (action === "删除") {
    const confirmed = await vscode.window.showWarningMessage(`确定删除模块“${picked.module.name}”吗？历史扫描不会删除。`, { modal: true }, "删除")
    if (confirmed === "删除") await client.deleteModule(root, picked.module.id)
    return
  }
  const name = action === "重命名"
    ? await vscode.window.showInputBox({ title: "重命名模块", value: picked.module.name })
    : picked.module.name
  if (!name) return
  await client.saveModule(root, {
    ...picked.module,
    name: name.trim(),
    autoScan: action === "开启自动扫描" ? true : action === "关闭自动扫描" ? false : picked.module.autoScan,
  })
}

function moduleScope(module: PatentRadarModule): Extract<PatentRadarScope, { kind: "module" }> {
  return {
    kind: "module",
    moduleId: module.id,
    name: module.name,
    corePaths: module.corePaths,
    expansionPolicy: module.expansionPolicy,
  }
}

async function catchUp(context: vscode.ExtensionContext, scan: (background?: boolean) => Promise<unknown>) {
  const config = vscode.workspace.getConfiguration("chipmate.v2.patentRadar")
  if (!config.get<boolean>("enabled", false) || !configuredServer()) return
  const root = getWorkspaceRoot()
  if (!root) return
  const days = Math.max(1, config.get<number>("scheduleDays", 7))
  const last = context.globalState.get<number>(key(root), 0)
  if (Date.now() - last < days * 24 * 60 * 60 * 1000) return
  await scan(true)
}

function configuredServer() {
  const value = vscode.workspace.getConfiguration("chipmate.v2.patentRadar").get<string>("serverBaseUrl", "").trim()
  if (!value) return undefined
  return normalizePatentServerBaseUrl(value)
}

function reviewer() {
  return vscode.env.machineId.slice(0, 12)
}

function analysisModel() {
  return (
    vscode.workspace
      .getConfiguration("chipmate.v2.patentRadar")
      .get<PatentCenterModelSelection | null>("analysisModel", null) ?? undefined
  )
}

function key(directory: string) {
  return `${LAST_SCAN}.${createHash("sha256").update(directory).digest("hex").slice(0, 16)}`
}

function parseReviewImport(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("盲审结果必须是 JSON 对象")
  const item = value as Record<string, unknown>
  if (
    item.schemaVersion !== 2 ||
    typeof item.runId !== "string" ||
    typeof item.sourceFingerprint !== "string" ||
    typeof item.methodVersion !== "string" ||
    !Array.isArray(item.reviews)
  ) {
    throw new Error("盲审结果缺少 schemaVersion、runId 或 reviews")
  }
  const reviews = item.reviews.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`第 ${index + 1} 条评审无效`)
    const review = value as Record<string, unknown>
    const decision = String(review.decision)
    if (
      typeof review.candidateId !== "string" ||
      typeof review.reviewer !== "string" ||
      !review.reviewer.trim() ||
      !["worthy", "reject", "needs-arbitration"].includes(decision) ||
      typeof review.note !== "string"
    ) {
      throw new Error(`第 ${index + 1} 条评审字段无效`)
    }
    return {
      candidateId: review.candidateId,
      reviewer: review.reviewer,
      decision: decision as "worthy" | "reject" | "needs-arbitration",
      note: review.note,
    }
  })
  return {
    schemaVersion: 2 as const,
    runId: item.runId,
    sourceFingerprint: item.sourceFingerprint,
    methodVersion: item.methodVersion,
    reviews,
  }
}
