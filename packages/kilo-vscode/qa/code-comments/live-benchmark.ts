import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createKiloClient } from "@kilocode/sdk/v2/client"
import { resolveFunctionTarget } from "../../src/services/code-comments/function-target"
import { CodeCommentOrchestrator } from "../../src/services/code-comments/orchestrator"
import { COMMENT_SYSTEM_PROMPT } from "../../src/services/code-comments/protocol"
import {
  CodeCommentSessionError,
  CODE_COMMENT_PERMISSION,
  CODE_COMMENT_TOOL_TOGGLES,
  formatError,
  type CodeCommentSessionOutput,
} from "../../src/services/code-comments/session-runner"
import { PRODUCTION_COMMENT_STRATEGY } from "../../src/services/code-comments/strategy"
import type { CommentGenerationResult, CommentStrategy, FunctionTarget } from "../../src/services/code-comments/types"

type BenchmarkEntry = {
  id: string
  file: string
  name: string
  marker: string
  language: "c" | "cpp"
  group: "ab" | "acceptance"
  tags: string[]
}

type DirectRunnerInput = {
  directory: string
  activeFile: string
  prompt: string
  stage: string
  functionHash: string
  model?: {
    providerID: string
    modelID: string
  }
  timeoutMs: number
}

const mode = process.argv[2]
if (mode !== "list" && mode !== "ab" && mode !== "review" && mode !== "acceptance") {
  throw new Error("用法：bun qa/code-comments/live-benchmark.ts <list|ab|review|acceptance> [QEMU 路径]")
}

const workspace = path.resolve(process.argv[3] || "/Users/archer/Work/qemu")
const manifestPath = path.resolve(
  process.env.CHIPMATE_CODE_COMMENTS_MANIFEST || path.join(import.meta.dir, "benchmark-functions.json"),
)
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as BenchmarkEntry[]

if (mode === "list") {
  for (const entry of manifest) {
    const target = await loadTarget(entry)
    console.log(
      `${entry.id}\t${entry.file}\t${entry.name}\t${target.startLine + 1}-${target.endLine + 1}\t${target.functionHeaderStyle}`,
    )
  }
  process.exit(0)
}

const baseUrl = process.env.CHIPMATE_CODE_COMMENTS_SERVER_URL?.trim()
const password = process.env.CHIPMATE_CODE_COMMENTS_SERVER_PASSWORD?.trim()
if (!baseUrl || !password) {
  throw new Error("真实基准需要 CHIPMATE_CODE_COMMENTS_SERVER_URL 和 CHIPMATE_CODE_COMMENTS_SERVER_PASSWORD")
}
const model = parseModel(process.env.CHIPMATE_CODE_COMMENTS_MODEL)
if (!model) {
  throw new Error("真实基准必须通过 CHIPMATE_CODE_COMMENTS_MODEL 固定 providerID/modelID，禁止回退当前模型")
}
const auth = Buffer.from(`kilo:${password}`).toString("base64")
const client = createKiloClient({
  baseUrl,
  headers: { Authorization: `Basic ${auth}` },
})
const runner = {
  run: (input: DirectRunnerInput) => runDirect(input),
}
const logs: string[] = []
const invocations: Array<{
  functionHash: string
  stage: string
  expectedModel: string
  actualModel?: string
  elapsedMs: number
  status: "completed" | "failed"
  responseKind?: "generate" | "forbidden-skip" | "approve" | "revise" | "conflict" | "unrecognized"
  responseLength?: number
  responsePreview?: string
  responseText?: string
  error?: string
}> = []
const orchestrator = new CodeCommentOrchestrator(runner as never, (message) => logs.push(message))
const token = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose: () => undefined }),
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-")
const output = path.resolve(
  process.env.CHIPMATE_CODE_COMMENTS_QA_OUTPUT || path.join(os.tmpdir(), `chipmate-code-comments-${stamp}`),
)
fs.mkdirSync(output, { recursive: true })

if (mode === "ab") await runAb()
else if (mode === "review") await runReview()
else await runAcceptance()

async function runReview() {
  const entries = manifest.filter((entry) => entry.group === "ab")
  const expectedCount = Number(process.env.CHIPMATE_CODE_COMMENTS_EXPECTED_COUNT || "5")
  if (!Number.isInteger(expectedCount) || expectedCount < 1 || entries.length !== expectedCount) {
    throw new Error(`双会话复核清单必须正好包含 ${expectedCount} 个函数，当前为 ${entries.length}`)
  }
  const samples = []
  const results: CommentGenerationResult[] = []
  for (const entry of entries) {
    console.log(`正在双会话复核 ${entry.id} ${entry.name}…`)
    const target = await loadTarget(entry)
    const result = await orchestrator.generate(
      { targets: [target], model, strategy: "independent-review" },
      token as never,
    )
    results.push(result)
    samples.push({
      编号: entry.id,
      文件: entry.file,
      函数: entry.name,
      标签: entry.tags,
      源码: target.functionSource,
      结果: blindResult(result),
    })
  }
  assertSameModel(results)
  fs.writeFileSync(
    path.join(output, "双会话复核原始数据.json"),
    JSON.stringify(
      {
        说明: "仅测试双会话独立复核策略；内容评分只针对完成样本，超时和失败单独计入完成率。",
        固定模型: `${model.providerID}/${model.modelID}`,
        样本: samples,
      },
      null,
      2,
    ),
  )
  fs.writeFileSync(path.join(output, "评分模板.json"), JSON.stringify(reviewScoreTemplate(entries), null, 2))
  writeSummary("双会话独立复核重测", entries.length)
}

async function runAb() {
  const entries = manifest.filter((entry) => entry.group === "ab")
  if (entries.length !== 5) throw new Error(`A/B 清单必须正好包含 5 个函数，当前为 ${entries.length}`)
  const reversed = crypto.randomInt(2) === 1
  const mapping: Record<string, CommentStrategy> = reversed
    ? { 方案甲: "independent-review", 方案乙: "single-self-check" }
    : { 方案甲: "single-self-check", 方案乙: "independent-review" }
  const samples = []
  const results: CommentGenerationResult[] = []
  for (const entry of entries) {
    const target = await loadTarget(entry)
    const candidates: Record<string, CommentGenerationResult> = {}
    for (const [label, strategy] of Object.entries(mapping)) {
      console.log(`正在生成 ${entry.id} ${entry.name} · ${label}…`)
      candidates[label] = await orchestrator.generate({ targets: [target], model, strategy }, token as never)
      results.push(candidates[label]!)
    }
    samples.push({
      编号: entry.id,
      文件: entry.file,
      函数: entry.name,
      标签: entry.tags,
      源码: target.functionSource,
      候选: Object.fromEntries(Object.entries(candidates).map(([label, result]) => [label, blindResult(result)])),
    })
  }
  assertSameModel(results)
  fs.writeFileSync(
    path.join(output, "盲评数据.json"),
    JSON.stringify(
      {
        说明: "请先按评分模板盲评方案甲和方案乙，不要读取映射文件。",
        样本: samples,
      },
      null,
      2,
    ),
  )
  fs.writeFileSync(path.join(output, "方案映射.json"), JSON.stringify(mapping, null, 2))
  fs.writeFileSync(path.join(output, "评分模板.json"), JSON.stringify(scoreTemplate(entries), null, 2))
  writeSummary("A/B 架构定标", entries.length)
}

async function runAcceptance() {
  if (manifest.length !== 50) throw new Error(`正式验收清单必须正好包含 50 个函数，当前为 ${manifest.length}`)
  const samples = []
  for (const entry of manifest) {
    console.log(`正在验收 ${entry.id} ${entry.name}…`)
    const target = await loadTarget(entry)
    const result = await orchestrator.generate(
      { targets: [target], model, strategy: PRODUCTION_COMMENT_STRATEGY },
      token as never,
    )
    samples.push({
      编号: entry.id,
      文件: entry.file,
      函数: entry.name,
      标签: entry.tags,
      源码: target.functionSource,
      结果: result,
    })
  }
  assertSameModel(samples.map((sample) => sample.结果))
  fs.writeFileSync(
    path.join(output, "正式验收原始数据.json"),
    JSON.stringify(
      {
        说明: "这是 50 个真实 C/C++ 函数的原始结果；未完成证据评分前不得宣称通过质量门禁。",
        生产策略: PRODUCTION_COMMENT_STRATEGY,
        样本: samples,
      },
      null,
      2,
    ),
  )
  fs.writeFileSync(path.join(output, "评分模板.json"), JSON.stringify(scoreTemplate(manifest), null, 2))
  writeSummary("50 函数正式验收", manifest.length)
}

async function loadTarget(entry: BenchmarkEntry): Promise<FunctionTarget> {
  const filePath = path.join(workspace, entry.file)
  const source = fs.readFileSync(filePath, "utf8")
  let from = 0
  while (from < source.length) {
    const cursor = source.indexOf(entry.marker, from)
    if (cursor < 0) break
    const target = await resolveFunctionTarget({
      uri: `file://${filePath}`,
      filePath,
      relativePath: entry.file,
      workspacePath: workspace,
      languageId: entry.language,
      documentVersion: 1,
      documentText: source,
      cursorOffset: cursor,
      eol: source.includes("\r\n") ? "\r\n" : "\n",
    })
    if (target?.functionSource.includes(entry.name)) return target
    from = cursor + entry.marker.length
  }
  throw new Error(`无法在 ${entry.file} 中定位函数 ${entry.name}`)
}

async function runDirect(input: DirectRunnerInput): Promise<CodeCommentSessionOutput> {
  const startedAt = Date.now()
  const expectedModel = `${model.providerID}/${model.modelID}`
  const { data: session } = await client.session.create(
    {
      directory: input.directory,
      title: `代码注释真实基准 · ${input.stage}`,
      agent: "code",
      metadata: {
        ephemeral: true,
        feature: "high-confidence-code-comments-benchmark",
        stage: input.stage,
        functionHash: input.functionHash,
      },
      permission: CODE_COMMENT_PERMISSION,
    },
    { throwOnError: true },
  )
  let rejectTimeout: (error: CodeCommentSessionError) => void = () => undefined
  const timeoutFailure = new Promise<never>((_, reject) => {
    rejectTimeout = reject
  })
  const timeout = setTimeout(() => {
    void client.session.abort({ sessionID: session.id, directory: input.directory }).catch(() => undefined)
    rejectTimeout(new CodeCommentSessionError(`Code agent 会话超过 ${Math.ceil(input.timeoutMs / 1000)} 秒未完成`))
  }, input.timeoutMs)
  try {
    const request = client.session.prompt(
      {
        sessionID: session.id,
        directory: input.directory,
        agent: "code",
        ...(input.model ? { model: input.model } : {}),
        tools: CODE_COMMENT_TOOL_TOGGLES,
        system: COMMENT_SYSTEM_PROMPT,
        editorContext: { activeFile: input.activeFile },
        parts: [{ type: "text", text: input.prompt }],
      },
      { throwOnError: true },
    )
    const { data } = await Promise.race([request, timeoutFailure])
    if (data.info.error) throw benchmarkError(data.info.error)
    const actualModel = `${data.info.providerID}/${data.info.modelID}`
    if (actualModel !== expectedModel) {
      throw new CodeCommentSessionError(`模型不一致：指定 ${expectedModel}，实际 ${actualModel}`, true)
    }
    const text = data.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
    const response = classifyResponse(text)
    invocations.push({
      functionHash: input.functionHash,
      stage: input.stage,
      expectedModel,
      actualModel,
      elapsedMs: Date.now() - startedAt,
      status: "completed",
      ...response,
    })
    return {
      output: text,
      providerID: data.info.providerID,
      modelID: data.info.modelID,
      sessionID: session.id,
    }
  } catch (error) {
    const failure = error instanceof CodeCommentSessionError ? error : benchmarkError(error)
    invocations.push({
      functionHash: input.functionHash,
      stage: input.stage,
      expectedModel,
      elapsedMs: Date.now() - startedAt,
      status: "failed",
      error: failure.message,
    })
    throw failure
  } finally {
    clearTimeout(timeout)
    await client.session.delete({ sessionID: session.id, directory: input.directory }).catch(() => undefined)
  }
}

function classifyResponse(text: string) {
  const value = text.trim()
  const base = {
    responseLength: value.length,
    responsePreview: value.slice(0, 240),
    responseText: value,
  }
  if (/^\s*结论\s*[:：]\s*生成注释\s*$/m.test(value)) return { ...base, responseKind: "generate" as const }
  if (/^\s*结论\s*[:：]\s*无需注释\s*$/m.test(value)) {
    return { ...base, responseKind: "forbidden-skip" as const }
  }
  if (/^\s*结论\s*[:：]\s*通过\s*$/m.test(value)) return { ...base, responseKind: "approve" as const }
  if (/^\s*结论\s*[:：]\s*修订\s*$/m.test(value)) return { ...base, responseKind: "revise" as const }
  if (/^\s*结论\s*[:：]\s*存在冲突\s*$/m.test(value)) return { ...base, responseKind: "conflict" as const }
  return { ...base, responseKind: "unrecognized" as const }
}

function benchmarkError(error: unknown): CodeCommentSessionError {
  const message = formatError(error)
  const nonRecoverable =
    /(?:ProviderAuthError|PAID_MODEL_AUTH_REQUIRED|400|401|403|404|authentication|unauthorized|sign in|unknown model|model not found|invalid_request_error|tool_choice)/i.test(
      message,
    )
  return new CodeCommentSessionError(message, nonRecoverable)
}

function blindResult(result: CommentGenerationResult) {
  const { strategy: _strategy, ...blind } = result
  return blind
}

function parseModel(value: string | undefined) {
  const raw = value?.trim()
  if (!raw) return
  const slash = raw.indexOf("/")
  if (slash <= 0 || slash === raw.length - 1) {
    throw new Error("CHIPMATE_CODE_COMMENTS_MODEL 必须使用 providerID/modelID 格式")
  }
  return {
    providerID: raw.slice(0, slash),
    modelID: raw.slice(slash + 1),
  }
}

function assertSameModel(results: CommentGenerationResult[]) {
  const models = new Set(
    results.flatMap((result) => (result.status === "unresolved" ? [] : [`${result.providerID}/${result.modelID}`])),
  )
  if (models.size > 1) throw new Error(`真实基准混用了多个模型：${[...models].join("、")}`)
}

function scoreTemplate(entries: BenchmarkEntry[]) {
  return {
    评分说明: "每个方案按源码证据盲评；严重事实幻觉、代码改写或不安全锚点直接判失败。",
    权重: {
      事实与证据: 40,
      契约状态副作用覆盖: 20,
      克制与避免重复: 20,
      位置中文表达和项目风格: 10,
      写入安全: 10,
    },
    样本: entries.map((entry) => ({
      编号: entry.id,
      方案甲: null,
      方案乙: null,
      严重问题: [],
      证据说明: "",
    })),
  }
}

function reviewScoreTemplate(entries: BenchmarkEntry[]) {
  return {
    评分说明:
      "只对 status=ready 的完成样本进行内容评分；unresolved 不计零分，单独计入完成率，避免超时拉低内容质量分。模型返回“无需注释”属于协议违规，不得计为完成。",
    权重: {
      事实与证据: 40,
      契约状态副作用覆盖: 20,
      克制与避免重复: 20,
      位置中文表达和项目风格: 10,
      写入安全: 10,
    },
    汇总字段: {
      完成率: null,
      完成样本平均分: null,
      事实正确率: null,
      严重幻觉数: null,
      各阶段超时数: null,
      模型违规拒绝生成次数: null,
      违规拒绝后的恢复成功率: null,
    },
    样本: entries.map((entry) => ({
      编号: entry.id,
      状态: null,
      总分: null,
      事实正确率: null,
      严重问题: [],
      证据说明: "",
    })),
  }
}

function writeSummary(title: string, count: number) {
  const forbiddenSkipCount = invocations.filter((invocation) => invocation.responseKind === "forbidden-skip").length
  fs.writeFileSync(path.join(output, "调用记录.json"), JSON.stringify(invocations, null, 2))
  fs.writeFileSync(path.join(output, "编排日志.json"), JSON.stringify(logs, null, 2))
  fs.writeFileSync(
    path.join(output, "运行摘要.md"),
    [
      `# ${title}`,
      "",
      `- 样本数：${count}`,
      `- 工作区路径：${workspace}`,
      `- 样本清单：${manifestPath}`,
      `- 指定模型：${model.providerID}/${model.modelID}`,
      `- 模型违规返回“无需注释”次数：${forbiddenSkipCount}`,
      `- 输出目录：${output}`,
      "- 状态：仅完成原始生成；证据评分、架构选择或正式质量结论尚未完成。",
      "",
    ].join("\n"),
  )
  console.log(`真实基准原始数据已写入：${output}`)
}
