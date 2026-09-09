import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { glob } from "glob"
import { extractDocument } from "@chipmate/chipmate-indexing/engine"
import { parseCodeGraphFile } from "@chipmate/chipmate-indexing/codegraph-parser"
import type { PatentRadar } from "./types"

const CODE = new Set([".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".hh"])
const TEXT = new Set([".md", ".markdown", ".txt", ".csv", ".tsv", ".rst"])
const DOCUMENT = new Set([".pdf", ".docx", ".xlsx", ".ods", ...TEXT])
const MAX_FILE = 25 * 1024 * 1024
const WINDOW = 80

type FunctionSummary = {
  name: string
  evidenceId: string
  calls: Array<{ name: string; args: string[]; evidenceId: string }>
  file: string
  isStatic: boolean
}
type GraphSummary = {
  file: string
  functions: FunctionSummary[]
  includes: string[]
  globals: string[]
  types: string[]
  registers: string[]
  symbols: string[]
}
type CompileInfo = {
  state: PatentRadar.WorkspaceCoverage["compileCommands"]
  variants: PatentRadar.WorkspaceCoverage["variants"]
  byFile: Map<string, string[]>
}

export interface ScanResult {
  fingerprint: string
  fileFingerprints: Record<string, string>
  evidence: PatentRadar.SourceEvidence[]
  warnings: string[]
  files: number
  coverage: PatentRadar.WorkspaceCoverage
  relations: PatentRadar.EvidenceRelation[]
}

export async function scanWorkspace(directory: string): Promise<ScanResult> {
  const root = await fs.realpath(directory)
  const names = await glob("**/*", {
    cwd: root,
    nodir: true,
    dot: false,
    follow: false,
    ignore: ["**/.git/**", "**/node_modules/**", "**/dist/**", "**/build/**", "**/out/**", "**/.cache/**"],
  })
  const selected = names.filter(
    (name) => CODE.has(path.extname(name).toLowerCase()) || DOCUMENT.has(path.extname(name).toLowerCase()),
  )
  const supported = new Set(selected)
  const unsupported = names.filter((name) => !supported.has(name) && path.basename(name) !== "compile_commands.json")
  const evidence: PatentRadar.SourceEvidence[] = []
  const warnings: string[] = []
  const digest = createHash("sha256")
  for (const name of unsupported.sort()) digest.update("unsupported\0").update(name).update("\0")
  const fileFingerprints: Record<string, string> = {}
  const graphs: GraphSummary[] = []
  const parseFailures: PatentRadar.WorkspaceCoverage["parseFailures"] = []
  const skipped: PatentRadar.WorkspaceCoverage["skipped"] = unsupported.map((file) => ({
    file,
    reason: "首期不支持的文件类型",
  }))
  let files = 0
  for (const name of selected.sort()) {
    const file = path.join(root, name)
    const stat = await fs.lstat(file)
    if (stat.isSymbolicLink()) {
      digest.update("skipped-symlink\0").update(name).update("\0")
      warnings.push(`${name} 是符号链接，已跳过以保持工作区边界。`)
      skipped.push({ file: name, reason: "符号链接越界保护" })
      continue
    }
    if (stat.size > MAX_FILE) {
      digest.update("skipped-large\0").update(name).update("\0").update(String(stat.size)).update("\0")
      warnings.push(`${name} 超过 ${MAX_FILE / 1024 / 1024} MiB，已跳过。`)
      skipped.push({ file: name, reason: `文件超过 ${MAX_FILE / 1024 / 1024} MiB` })
      continue
    }
    const bytes = await fs.readFile(file)
    const hash = createHash("sha256").update(bytes).digest("hex")
    fileFingerprints[name] = hash
    digest.update(name).update("\0").update(hash).update("\0")
    files += 1
    const extension = path.extname(name).toLowerCase()
    if (CODE.has(extension)) {
      const parsed = (() => {
        try {
          return codeEvidence(root, name, hash, bytes.toString("utf8"))
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          parseFailures.push({ file: name, reason })
          warnings.push(`${name} 代码图解析失败，已降级为确定性分段：${reason}`)
          return { evidence: segments(name, hash, bytes.toString("utf8"), "code"), graph: undefined }
        }
      })()
      evidence.push(...parsed.evidence)
      if (parsed.graph) graphs.push(parsed.graph)
      continue
    }
    const extracted = await extract(file).catch((error) => {
      const reason = error instanceof Error ? error.message : String(error)
      parseFailures.push({ file: name, reason })
      warnings.push(`${name} 解析失败：${reason}`)
      return undefined
    })
    if (!extracted) continue
    warnings.push(...extracted.warnings.map((warning) => `${name}：${warning}`))
    for (const section of extracted.sections) {
      evidence.push(...segments(name, hash, section.text, "document", section.startLine, section.page))
    }
  }
  const compile = await compileCommandsInfo(root)
  if (compile.state !== "available")
    warnings.push("未取得有效 compile_commands.json；条件编译和硬件 Variant 关系将降级为 conditional/weak。")
  for (const item of evidence) item.variantIds = compile.byFile.get(item.location.file) ?? []
  const relations = buildEvidenceRelations(evidence, graphs)
  const codeEvidenceCount = evidence.filter((item) => item.kind === "code").length
  const documentEvidenceCount = evidence.length - codeEvidenceCount
  const analyzedFiles = files - parseFailures.length
  const coverage: PatentRadar.WorkspaceCoverage = {
    supportedFiles: selected.length,
    analyzedFiles,
    skippedFiles: skipped.length + parseFailures.length,
    parseFailures,
    skipped,
    codeEvidence: codeEvidenceCount,
    documentEvidence: documentEvidenceCount,
    relations: relations.length,
    compileCommands: compile.state,
    variants: compile.variants,
    conditionalCoverageComplete:
      compile.state === "available" && graphs.every((graph) => compile.byFile.has(graph.file)),
    completeWorkspaceScan:
      skipped.length === 0 &&
      parseFailures.length === 0 &&
      compile.state === "available" &&
      graphs.every((graph) => compile.byFile.has(graph.file)),
  }
  if (!coverage.completeWorkspaceScan)
    warnings.push("工作区覆盖不完整；仍可生成局部观察项，但不得声明已完整扫描整个工作区。")
  return {
    fingerprint: digest.digest("hex"),
    fileFingerprints,
    evidence,
    warnings,
    files,
    coverage,
    relations,
  }
}

async function extract(
  file: string,
): Promise<{ sections: Array<{ text: string; startLine: number; page?: number }>; warnings: string[] }> {
  const sections = await extractDocument(file, MAX_FILE)
  return { sections, warnings: [] as string[] }
}

function codeEvidence(
  root: string,
  file: string,
  sha256: string,
  text: string,
): { evidence: PatentRadar.SourceEvidence[]; graph: GraphSummary } {
  const lines = text.replace(/\r\n/g, "\n").split("\n")
  const graph = parseCodeGraphFile({ workspacePath: root, filePath: file, content: text, fileHash: sha256 })
  const summaries: FunctionSummary[] = []
  const functions = graph.functions.flatMap((fn) => {
    const lineStart = Math.max(1, fn.startLine)
    const end = Math.min(lines.length, fn.endLine)
    const starts = []
    for (let start = lineStart; start <= end; start += 160) starts.push(start)
    const items = starts.flatMap((start) => {
      const lineEnd = Math.min(end, start + 179)
      const excerpt = lines
        .slice(start - 1, lineEnd)
        .join("\n")
        .trim()
      const localCalls = fn.calls.filter((call) => call.startLine >= start && call.startLine <= lineEnd)
      const calls = [...new Set(localCalls.map((call) => call.calleeName))].slice(0, 20)
      const signals = detect(excerpt, "code")
      if (calls.length) signals.push(`调用图：${calls.join("、")}`)
      if (localCalls.some((call) => call.returnHandling)) signals.push("返回值与异常路径")
      if (excerpt.length < 40) return []
      if (!signals.length) signals.push("代码实现")
      return [evidence(file, sha256, start, lineEnd, excerpt, signals, [fn.name], conditionAt(lines, start))]
    })
    if (!items.length) return []
    summaries.push({
      name: fn.name,
      evidenceId: items[0]!.id,
      calls: fn.calls.map((call) => ({
        name: call.calleeName,
        args: call.args,
        evidenceId:
          items.find((item) => call.startLine >= item.location.lineStart && call.startLine <= item.location.lineEnd)
            ?.id ?? items[0]!.id,
      })),
      file,
      isStatic: fn.isStatic,
    })
    return items
  })
  const structures = [
    ...graph.types,
    ...graph.globals,
    ...graph.macros,
    ...graph.initializers,
    ...graph.registerMacroFamilies,
  ].flatMap((item) => {
    const lineStart = Math.max(1, item.startLine)
    const lineEnd = Math.min(lines.length, item.endLine, lineStart + 119)
    const excerpt = lines
      .slice(lineStart - 1, lineEnd)
      .join("\n")
      .trim()
    const signals = detect(excerpt, "code")
    signals.push("确定性符号与初始化约束")
    const name =
      "name" in item && typeof item.name === "string"
        ? item.name
        : "family" in item && typeof item.family === "string"
          ? item.family
          : "结构初始化"
    return excerpt.length >= 40 ? [evidence(file, sha256, lineStart, lineEnd, excerpt, signals, [name])] : []
  })
  const output =
    functions.length || structures.length ? [...functions, ...structures] : segments(file, sha256, text, "code")
  return {
    evidence: output,
    graph: {
      file,
      functions: summaries,
      includes: graph.includes.map((item) => item.target),
      globals: graph.globals.map((item) => item.name),
      types: graph.types.map((item) => item.name),
      registers: graph.registerMacroFamilies.flatMap((item) => [
        item.family,
        ...item.mmioIdentifiers,
        ...item.macros.map((macro) => macro.name),
      ]),
      symbols: [...graph.functions, ...graph.types, ...graph.globals, ...graph.macros].map((item) => item.name),
    },
  }
}

function evidence(
  file: string,
  sha256: string,
  lineStart: number,
  lineEnd: number,
  excerpt: string,
  signals: string[],
  symbols: string[] = [],
  condition: string | null = null,
): PatentRadar.SourceEvidence {
  const id = createHash("sha256").update(`${file}:0:${lineStart}:${sha256}`).digest("hex").slice(0, 16)
  return {
    id,
    kind: "code",
    location: { file, lineStart, lineEnd, sha256 },
    excerpt: excerpt.slice(0, 12_000),
    signals: [...new Set(signals)],
    symbols: [...new Set(symbols)],
    variantIds: [],
    condition,
  }
}

function segments(
  file: string,
  sha256: string,
  text: string,
  kind: "code" | "document",
  baseLine = 1,
  page?: number,
): PatentRadar.SourceEvidence[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n")
  const starts = kind === "code" ? codeStarts(lines) : documentStarts(lines)
  return starts.flatMap((start, index) => {
    const end = Math.min(lines.length, starts[index + 1] ?? start + WINDOW, start + WINDOW)
    const excerpt = lines.slice(start, end).join("\n").trim()
    if (excerpt.length < 40) return []
    const signals = detect(excerpt, kind)
    if (!signals.length) return []
    const lineStart = baseLine + start
    const lineEnd = baseLine + end - 1
    const id = createHash("sha256")
      .update(`${file}:${page ?? 0}:${lineStart}:${sha256}`)
      .digest("hex")
      .slice(0, 16)
    return [
      {
        id,
        kind,
        location: { file, lineStart, lineEnd, ...(page ? { page } : {}), sha256 },
        excerpt: excerpt.slice(0, 12_000),
        signals,
        symbols: [],
        variantIds: [],
        condition: null,
      },
    ]
  })
}

async function compileCommandsInfo(root: string): Promise<CompileInfo> {
  const file = path.join(root, "compile_commands.json")
  try {
    const value = JSON.parse(await fs.readFile(file, "utf8"))
    if (!Array.isArray(value)) return { state: "invalid", variants: [], byFile: new Map() }
    const byFile = new Map<string, string[]>()
    const variants = new Map<string, PatentRadar.WorkspaceCoverage["variants"][number]>()
    for (const row of value) {
      if (!row || typeof row !== "object" || typeof row.file !== "string") continue
      const unresolved = path.resolve(typeof row.directory === "string" ? row.directory : root, row.file)
      const absolute = await fs.realpath(unresolved).catch(() => unresolved)
      const relative = path.relative(root, absolute).split(path.sep).join("/")
      if (relative.startsWith("../") || path.isAbsolute(relative)) continue
      const args = Array.isArray(row.arguments)
        ? row.arguments.filter((item: unknown): item is string => typeof item === "string")
        : typeof row.command === "string"
          ? commandArguments(row.command)
          : []
      const flags = variantFlags(args).sort()
      const id = `variant-${createHash("sha256")
        .update(flags.join("\0") || "default")
        .digest("hex")
        .slice(0, 12)}`
      byFile.set(relative, [...new Set([...(byFile.get(relative) ?? []), id])])
      variants.set(`${id}:${relative}`, { id, file: relative, condition: flags.length ? flags.join(" ") : null })
    }
    return { state: "available", variants: [...variants.values()], byFile }
  } catch (error) {
    return {
      state: error && typeof error === "object" && "code" in error && error.code === "ENOENT" ? "missing" : "invalid",
      variants: [],
      byFile: new Map(),
    }
  }
}

function commandArguments(command: string) {
  const output: string[] = []
  let current = ""
  let quote: "'" | '"' | null = null
  let escaped = false
  for (const character of command) {
    if (escaped) {
      current += character
      escaped = false
      continue
    }
    if (character === "\\" && quote !== "'") {
      escaped = true
      continue
    }
    if (character === "'" || character === '"') {
      if (quote === character) quote = null
      else if (!quote) quote = character
      else current += character
      continue
    }
    if (/\s/.test(character) && !quote) {
      if (current) output.push(current)
      current = ""
      continue
    }
    current += character
  }
  if (escaped) current += "\\"
  if (current) output.push(current)
  return output
}

function variantFlags(args: string[]) {
  const output: string[] = []
  const separated = new Set([
    "-D",
    "-U",
    "-I",
    "-isystem",
    "-include",
    "--sysroot",
    "-mcpu",
    "-march",
    "-mabi",
    "-mfpu",
  ])
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!
    if (separated.has(argument)) {
      const value = args[index + 1]
      output.push(value ? `${argument}=${value}` : `${argument}=<missing>`)
      if (value) index += 1
      continue
    }
    if (/^(?:-D|-U|-I|-isystem|-include|--sysroot=|-[fm](?:cpu|arch|abi|fpu)=)/.test(argument)) output.push(argument)
  }
  return [...new Set(output)]
}

export function buildEvidenceRelations(
  evidence: PatentRadar.SourceEvidence[],
  graphs: GraphSummary[],
): PatentRadar.EvidenceRelation[] {
  const byId = new Map(evidence.map((item) => [item.id, item]))
  const byFunction = new Map<string, FunctionSummary[]>()
  const code = evidence.filter((item) => item.kind === "code")
  for (const graph of graphs)
    for (const fn of graph.functions) byFunction.set(fn.name, [...(byFunction.get(fn.name) ?? []), fn])
  const output = new Map<string, PatentRadar.EvidenceRelation>()
  const add = (
    kind: PatentRadar.EvidenceRelation["kind"],
    from: string,
    to: string,
    resolution?: PatentRadar.EvidenceRelation["resolution"],
    strength?: PatentRadar.EvidenceRelation["strength"],
  ) => {
    if (from === to) return
    const first = byId.get(from)
    const second = byId.get(to)
    if (!first || !second) return
    const sharedVariants =
      first.kind === "document"
        ? second.variantIds
        : second.kind === "document"
          ? first.variantIds
          : first.variantIds.filter((id) => second.variantIds.includes(id))
    const conditional = Boolean(first.condition || second.condition)
    const resolved = resolution ?? (sharedVariants.length && !conditional ? "exact" : "conditional")
    const weighted = strength ?? (resolved === "exact" ? "strong" : "weak")
    const key = `${kind}:${from}:${to}`
    const relationId = createHash("sha256").update(key).digest("hex").slice(0, 16)
    output.set(key, {
      relationId,
      kind,
      fromEvidenceId: from,
      toEvidenceId: to,
      evidenceIds: [from, to],
      resolution: resolved,
      strength: weighted,
      variantIds: sharedVariants,
      condition:
        resolved === "exact"
          ? null
          : [first.condition, second.condition].filter(Boolean).join(" AND ") ||
            "未找到两个机制可同时成立的编译 Variant",
      locations: [first.location, second.location],
    })
  }
  for (const graph of graphs) {
    for (const caller of graph.functions) {
      for (const call of caller.calls) {
        const name = call.name
        const targets = (byFunction.get(name) ?? []).filter((target) => !target.isStatic || target.file === caller.file)
        const exact = targets.length === 1
        for (const target of targets) {
          add("call", call.evidenceId, target.evidenceId, exact ? undefined : "ambiguous", exact ? undefined : "weak")
          const from = byId.get(call.evidenceId)
          const to = byId.get(target.evidenceId)
          if (from?.signals.includes("数据流") || to?.signals.includes("数据流"))
            add(
              "data-path",
              call.evidenceId,
              target.evidenceId,
              exact ? undefined : "ambiguous",
              exact ? undefined : "weak",
            )
          if (
            from?.signals.includes("返回值与异常路径") ||
            /watchdog|timeout|recover|cleanup/i.test(`${from?.excerpt ?? ""}\n${to?.excerpt ?? ""}`)
          )
            add(
              "recovery-path",
              call.evidenceId,
              target.evidenceId,
              exact ? undefined : "ambiguous",
              exact ? undefined : "weak",
            )
        }
        for (const arg of call.args) {
          const symbol = arg.match(/&?\b([A-Za-z_]\w*)\b/)?.[1]
          const callbacks = symbol
            ? (byFunction.get(symbol) ?? []).filter((target) => !target.isStatic || target.file === caller.file)
            : []
          for (const callback of callbacks)
            add(
              "callback-registration",
              call.evidenceId,
              callback.evidenceId,
              callbacks.length === 1 ? undefined : "ambiguous",
              callbacks.length === 1 ? undefined : "weak",
            )
        }
      }
    }
    for (const include of graph.includes) {
      const target = graphs.filter(
        (item) =>
          path.basename(item.file) === path.basename(include).replace(/\.h(?:pp)?$/i, ".c") ||
          path.basename(item.file, path.extname(item.file)) === path.basename(include, path.extname(include)),
      )
      const from = graph.functions[0]
      for (const linked of target)
        if (from && linked.functions[0])
          add(
            "include",
            from.evidenceId,
            linked.functions[0].evidenceId,
            target.length === 1 ? undefined : "ambiguous",
            target.length === 1 ? undefined : "weak",
          )
    }
  }
  for (const source of code) {
    for (const [name, targets] of byFunction) {
      if (
        !new RegExp(`(?:handler|callback|isr|ops|operation)\\w*\\s*=\\s*&?${escape(name)}\\b`, "i").test(source.excerpt)
      )
        continue
      const visible = targets.filter((target) => !target.isStatic || target.file === source.location.file)
      for (const target of visible)
        add(
          "operation-table",
          source.id,
          target.evidenceId,
          visible.length === 1 ? undefined : "ambiguous",
          visible.length === 1 ? undefined : "weak",
        )
    }
  }
  for (const graph of graphs) {
    for (const global of graph.globals) {
      const refs = code.filter((item) => new RegExp(`\\b${escape(global)}\\b`).test(item.excerpt))
      for (let index = 1; index < refs.length; index += 1) {
        add("shared-state", refs[0]!.id, refs[index]!.id)
        if (refs[0]!.signals.includes("状态机") || refs[index]!.signals.includes("状态机"))
          add("state-transition", refs[0]!.id, refs[index]!.id)
      }
    }
  }
  for (const graph of graphs) {
    for (const type of graph.types) {
      const refs = code.filter((item) => new RegExp(`\\b${escape(type)}\\b`).test(item.excerpt))
      for (let index = 1; index < refs.length; index += 1) add("type-dependency", refs[0]!.id, refs[index]!.id)
    }
    for (const register of graph.registers) {
      const refs = code.filter((item) => new RegExp(`\\b${escape(register)}\\b`).test(item.excerpt))
      for (let index = 1; index < refs.length; index += 1) add("register-control", refs[0]!.id, refs[index]!.id)
    }
  }
  const documents = evidence.filter((item) => item.kind === "document")
  for (const item of documents) {
    for (const graph of graphs) {
      const target = code.find(
        (entry) =>
          entry.location.file === graph.file &&
          (item.excerpt.includes(path.basename(graph.file)) ||
            graph.symbols.some((symbol) => symbol.length > 3 && item.excerpt.includes(symbol))),
      )
      if (target) add("document-reference", item.id, target.id, "exact", "strong")
    }
  }
  return [...output.values()]
}

function escape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function conditionAt(lines: string[], line: number) {
  const stack: string[] = []
  for (let index = 0; index < Math.min(lines.length, line - 1); index += 1) {
    const text = lines[index]!.trim()
    const open = text.match(/^#\s*(?:if|ifdef|ifndef)\s+(.+)$/)
    if (open) stack.push(open[1]!.trim())
    else if (/^#\s*(?:elif|else)\b/.test(text) && stack.length) stack[stack.length - 1] = text.replace(/^#\s*/, "")
    else if (/^#\s*endif\b/.test(text)) stack.pop()
  }
  return stack.length ? stack.join(" AND ") : null
}

function codeStarts(lines: string[]) {
  const output = new Set<number>([0])
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ""
    if (/^[\w\s*]+\([^;]*\)\s*\{\s*$/.test(line) || /\b(?:switch|enum|typedef struct)\b/.test(line)) {
      output.add(Math.max(0, index - 3))
    }
  }
  return [...output].sort((a, b) => a - b)
}

function documentStarts(lines: string[]) {
  const output = new Set<number>([0])
  for (let index = 0; index < lines.length; index += 1) {
    if (
      /^\s*(?:#{1,4}\s+|\d+(?:\.\d+)*[、.\s]|(?:方案|原理|算法|状态机|技术效果|约束)[:：])/.test(lines[index] ?? "")
    ) {
      output.add(index)
    }
  }
  if (output.size === 1) for (let index = WINDOW; index < lines.length; index += WINDOW) output.add(index)
  return [...output].sort((a, b) => a - b)
}

function detect(text: string, kind: "code" | "document") {
  const patterns: Array<[string, RegExp]> = [
    ["状态机", /\b(?:state|switch|case|transition|fsm)\b|状态机|状态迁移/i],
    ["时序与并发", /\b(?:interrupt|irq|atomic|mutex|semaphore|dma|timeout|deadline)\b|中断|并发|时序/i],
    ["数据流", /\b(?:buffer|queue|ring|pipeline|filter|encode|decode|compress)\b|数据流|缓冲|队列/i],
    ["算法组合", /\b(?:adaptive|calibrat|compensat|predict|estimate|optimi[sz])\b|自适应|校准|补偿|预测|优化/i],
    ["资源约束", /\b(?:memory|power|latency|flash|ram|low.?power)\b|低功耗|内存|延迟|资源约束/i],
    ["技术效果", /(?:提高|降低|减少|避免|实现|解决|改进).{0,30}(?:精度|功耗|延迟|可靠性|吞吐|安全|性能)/i],
  ]
  const hits = patterns.filter(([, regex]) => regex.test(text)).map(([label]) => label)
  if (kind === "document" && /技术|设计|架构|算法|控制|处理/.test(text)) hits.push("设计说明")
  return [...new Set(hits)]
}
