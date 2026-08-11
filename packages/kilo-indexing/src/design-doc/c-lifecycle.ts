import { createHash } from "crypto"
import { constants } from "fs"
import { open } from "fs/promises"
import path from "path"
import type { Node as SyntaxNode } from "web-tree-sitter"
import { loadRequiredLanguageParsers } from "../tree-sitter/languageParser"
import type {
  DiscoveredDesignDocModule,
  LifecycleExtractionResult,
  LifecycleEvidenceKind,
  RawLifecycleEvidence,
} from "./types"
import { DesignDocDiscoveryError } from "./types"

const stateFieldName = /(?:^|_)(state|status|phase|lifecycle)$/i
const terminalName = /(?:^|_)(done|completed|cancelled|canceled|closed|failed|error|terminated)$/i
const anyCurrentState = "__ANY_CURRENT_STATE__"

type MacroDefinition = {
  name: string
  value?: number
  evidence: RawLifecycleEvidence
}

type ZeroInitializedVariable = {
  name: string
  evidence: RawLifecycleEvidence
}

export async function extractCLifecycleEvidence(module: DiscoveredDesignDocModule): Promise<LifecycleExtractionResult> {
  const files = module.files.filter((file) => file.language === "c")
  const parsers = await loadRequiredLanguageParsers(files.map((file) => file.absolutePath))
  const evidence: RawLifecycleEvidence[] = []
  const definitions: MacroDefinition[] = []
  const zeroInitialized: ZeroInitializedVariable[] = []
  const referencedStates = new Set<string>()

  for (const file of files) {
    const content = await readVerifiedSource(file)
    const extension = path.extname(file.absolutePath).slice(1).toLowerCase()
    const parser = parsers[extension]?.parser
    if (!parser) continue
    const tree = parser.parse(content)
    if (!tree) continue
    visit(tree.rootNode, (node) => {
      if (node.type === "preproc_def") extractMacro(node, content, file, definitions)
      if (node.type === "field_declaration") extractStateField(node, content, file, evidence)
      if (node.type === "declaration") extractZeroInitializedGlobal(node, content, file, zeroInitialized)
      if (node.type === "assignment_expression") {
        extractAssignment(node, content, file, evidence, referencedStates)
      }
    })
    tree.delete()
  }

  for (const definition of definitions) {
    if (!referencedStates.has(definition.name)) continue
    evidence.push(definition.evidence)
    if (!terminalName.test(definition.name)) continue
    evidence.push({
      ...definition.evidence,
      kind: "terminal-state",
      fact: `宏 ${definition.name} 的名称表示终态或错误终态`,
      confidence: "inferred",
    })
  }

  const transitionFields = new Set(
    evidence
      .filter((item) => item.kind === "state-transition")
      .flatMap((item) => (typeof item.attributes.field === "string" ? [item.attributes.field] : [])),
  )
  for (const variable of zeroInitialized) {
    const field = [...transitionFields].find(
      (candidate) =>
        candidate === variable.name ||
        candidate.startsWith(`${variable.name}.`) ||
        candidate.startsWith(`${variable.name}->`),
    )
    if (!field) continue
    const fieldStates = new Set(
      evidence
        .filter((item) => item.kind === "state-transition" && item.attributes.field === field)
        .flatMap((item) => [item.attributes.from, item.attributes.to])
        .filter((state): state is string => typeof state === "string"),
    )
    const zeroStates = definitions.filter(
      (definition) => definition.value === 0 && fieldStates.has(definition.name),
    )
    if (zeroStates.length !== 1) continue
    evidence.push({
      ...variable.evidence,
      fact: `${field} 具有静态存储期，C 零初始化对应状态 ${zeroStates[0].name}`,
      attributes: { field, state: zeroStates[0].name },
    })
  }

  const unique = deduplicate(evidence)
  const explicitStates = new Set(
    unique
      .filter((item) => item.kind === "state-definition" || item.kind === "initial-state")
      .flatMap((item) => (typeof item.attributes.state === "string" ? [item.attributes.state] : [])),
  )
  const transitions = unique.filter((item) => item.kind === "state-transition")
  const stateFields = new Set(
    unique
      .filter((item) => item.kind === "state-field")
      .flatMap((item) => (typeof item.attributes.field === "string" ? [item.attributes.field] : [])),
  )
  const unknowns: string[] = []
  if (explicitStates.size < 2) unknowns.push("未发现至少两个可由源码直接证明的状态")
  if (transitions.length === 0) unknowns.push("未发现同时具有明确起点和终点的状态迁移")
  if (stateFields.size > 1) unknowns.push(`发现多个候选状态字段，MVP 不自动合并：${[...stateFields].join("、")}`)

  return {
    moduleID: module.id,
    sourceSnapshotHash: module.sourceSnapshotHash,
    evidence: unique,
    unknowns,
  }
}

async function readVerifiedSource(file: DiscoveredDesignDocModule["files"][number]) {
  const handle = await open(file.absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => undefined)
  if (!handle) throw new DesignDocDiscoveryError("SOURCE_CHANGED", `源码文件已被替换：${file.path}`)
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new DesignDocDiscoveryError("SOURCE_CHANGED", `源码文件不再是普通文件：${file.path}`)
    const content = await handle.readFile()
    const hash = createHash("sha256").update(content).digest("hex")
    if (hash !== file.contentHash) {
      throw new DesignDocDiscoveryError("SOURCE_CHANGED", `源码文件在证据提取前发生变化：${file.path}`)
    }
    return content.toString("utf8")
  } finally {
    await handle.close()
  }
}

function extractMacro(
  node: SyntaxNode,
  content: string,
  file: DiscoveredDesignDocModule["files"][number],
  output: MacroDefinition[],
) {
  const name = node.namedChildren.find((item) => item?.type === "identifier")?.text
  if (!name) return
  output.push({
    name,
    value: macroNumericValue(node.text),
    evidence: makeEvidence("state-definition", `宏 ${name} 定义状态 ${name}`, node, content, file, {
      state: name,
      declaration: "preprocessor",
    }),
  })
}

function extractZeroInitializedGlobal(
  node: SyntaxNode,
  content: string,
  file: DiscoveredDesignDocModule["files"][number],
  output: ZeroInitializedVariable[],
) {
  if (node.parent?.type !== "translation_unit" || /^\s*extern\b/.test(node.text) || node.text.includes("=")) return
  const name = node.namedChildren.find((item) => item?.type === "identifier")?.text
  if (!name) return
  output.push({
    name,
    evidence: makeEvidence(
      "initial-state",
      `文件作用域对象 ${name} 未显式初始化，依 C 语义执行零初始化`,
      node,
      content,
      file,
      { field: name, state: "" },
    ),
  })
}

function macroNumericValue(value: string) {
  const token = /^\s*#\s*define\s+[A-Za-z_][A-Za-z0-9_]*\s+\(?\s*(0[xX][0-9A-Fa-f]+|[0-9]+)[uUlL]*\s*\)?(?:\s|$)/.exec(value)?.[1]
  if (!token) return undefined
  return Number.parseInt(token, token.toLowerCase().startsWith("0x") ? 16 : 10)
}

function extractStateField(
  node: SyntaxNode,
  content: string,
  file: DiscoveredDesignDocModule["files"][number],
  output: RawLifecycleEvidence[],
) {
  const field = node.namedChildren.find((item) => item?.type === "field_identifier")?.text ?? ""
  if (!stateFieldName.test(field)) return
  output.push(makeEvidence("state-field", `字段 ${field} 保存生命周期状态`, node, content, file, { field }))
}

function extractAssignment(
  node: SyntaxNode,
  content: string,
  file: DiscoveredDesignDocModule["files"][number],
  output: RawLifecycleEvidence[],
  referencedStates: Set<string>,
) {
  const left = node.childForFieldName("left")?.text ?? node.namedChildren[0]?.text ?? ""
  const field = lastIdentifier(left)
  if (!stateFieldName.test(field)) return
  const right = node.childForFieldName("right")?.text ?? node.namedChildren[1]?.text
  const to = identifierValue(right)
  if (!to) return
  referencedStates.add(to)
  const from = guardedState(node, field)
  if (from) referencedStates.add(from)
  if (from && from !== to) {
    const guard = transitionGuard(node, field, from)
    const action = node.text.trim()
    const sourceNode = transitionSourceNode(node, field, from)
    output.push(
      makeEvidence("state-transition", `${left} 从 ${from} 迁移到 ${to}`, sourceNode, content, file, {
        field: left,
        from,
        to,
        trigger: enclosingSymbol(node) ?? null,
        guard: guard ?? null,
        action,
      }),
    )
    return
  }
  const symbol = enclosingSymbol(node)
  if (!from && symbol && /(?:irq|interrupt|event|handler|callback)/i.test(symbol)) {
    const guard = externalEventGuard(node)
    output.push(
      makeEvidence(
        "state-transition",
        `${left} 在外部事件 ${symbol} 中迁移到 ${to}，源码未限制当前状态`,
        externalEventSourceNode(node),
        content,
        file,
        {
          field: left,
          from: anyCurrentState,
          to,
          trigger: symbol,
          guard: guard ?? null,
          action: node.text.trim(),
          transitionScope: "any-current-state",
        },
      ),
    )
    return
  }
  if (!isEntryInitialization(node)) return
  output.push(
    makeEvidence("initial-state", `${left} 在入口函数中初始化为 ${to}`, node, content, file, {
      field: left,
      state: to,
    }),
  )
}

function externalEventGuard(node: SyntaxNode) {
  const conditions: string[] = []
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === "if_statement") {
      const condition = trimCondition(current.childForFieldName("condition")?.text ?? "")
      if (condition) conditions.unshift(isAlternativeBranch(current, node) ? `!(${condition})` : condition)
    }
    if (current.type === "function_definition") break
  }
  return conditions.length ? conditions.join(" && ") : undefined
}

function externalEventSourceNode(node: SyntaxNode) {
  let source = node
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === "if_statement") source = current
    if (current.type === "function_definition") break
  }
  return source
}

function transitionGuard(node: SyntaxNode, field: string, from: string) {
  const conditions: string[] = []
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === "if_statement") {
      const condition = current.childForFieldName("condition")?.text ?? ""
      const remaining = withoutStatePredicate(condition, field, from)
      if (remaining) conditions.unshift(isAlternativeBranch(current, node) ? `!(${remaining})` : remaining)
    }
    if (current.type === "function_definition") break
  }
  return conditions.length ? conditions.join(" && ") : undefined
}

function transitionSourceNode(node: SyntaxNode, field: string, from: string) {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === "if_statement") {
      const condition = current.childForFieldName("condition")?.text ?? ""
      if (withoutStatePredicate(condition, field, from)) return current
    }
    if (current.type === "function_definition") break
  }
  return node
}

function withoutStatePredicate(condition: string, field: string, from: string) {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const escapedState = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const anyState = new RegExp(`(?:\\b[A-Za-z_][A-Za-z0-9_]*\\s*(?:\\.|->)\\s*)?\\b${escapedField}\\b\\s*==\\s*([A-Za-z_][A-Za-z0-9_]*)\\b`)
  const comparedState = anyState.exec(condition)?.[1]
  if (comparedState && comparedState !== from) return undefined
  const state = new RegExp(`(?:\\b[A-Za-z_][A-Za-z0-9_]*\\s*(?:\\.|->)\\s*)?\\b${escapedField}\\b\\s*==\\s*${escapedState}\\b`)
  if (!state.test(condition)) return trimCondition(condition)
  return trimCondition(condition.replace(state, "").replace(/^\s*(?:&&|\|\|)\s*|\s*(?:&&|\|\|)\s*$/g, ""))
}

function trimCondition(value: string) {
  let output = value.trim()
  while (output.startsWith("(") && output.endsWith(")")) output = output.slice(1, -1).trim()
  return output || undefined
}

function isAlternativeBranch(statement: SyntaxNode, node: SyntaxNode) {
  const alternative = statement.childForFieldName("alternative")
  return Boolean(alternative && alternative.startIndex <= node.startIndex && node.endIndex <= alternative.endIndex)
}

function guardedState(node: SyntaxNode, field: string): string | undefined {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const pattern = new RegExp(`\\b${escaped}\\b\\s*==\\s*([A-Za-z_][A-Za-z0-9_]*)`)
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === "if_statement") {
      const condition = current.childForFieldName("condition")?.text ?? ""
      const match = pattern.exec(condition)
      if (match?.[1]) return match[1]
    }
    if (current.type === "case_statement") {
      const value = current.childForFieldName("value")?.text ?? current.namedChildren[0]?.text
      const state = identifierValue(value)
      const switched = enclosingSwitchValue(current)
      if (state && switched && lastIdentifier(switched) === field) return state
    }
    if (current.type === "function_definition") break
  }
  return undefined
}

function enclosingSwitchValue(node: SyntaxNode) {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === "switch_statement") return current.childForFieldName("condition")?.text
    if (current.type === "function_definition") return undefined
  }
  return undefined
}

function isEntryInitialization(node: SyntaxNode) {
  const symbol = enclosingSymbol(node)
  if (!symbol || !/(^|_)main$/i.test(symbol)) return false
  for (let current = node.parent; current; current = current.parent) {
    if (
      ["if_statement", "switch_statement", "for_statement", "while_statement", "do_statement"].includes(current.type)
    ) {
      return false
    }
    if (current.type === "function_definition") return true
  }
  return false
}

function enclosingSymbol(node: SyntaxNode): string | undefined {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type !== "function_definition") continue
    const declarator = current.childForFieldName("declarator")?.text ?? ""
    return /^([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(declarator)?.[1]
  }
  return undefined
}

function makeEvidence(
  kind: LifecycleEvidenceKind,
  fact: string,
  node: SyntaxNode,
  content: string,
  file: DiscoveredDesignDocModule["files"][number],
  attributes: Record<string, string | number | boolean | null>,
  confidence: RawLifecycleEvidence["confidence"] = "explicit",
): RawLifecycleEvidence {
  const startLine = node.startPosition.row + 1
  const endLine = node.endPosition.row + 1
  return {
    kind,
    fact,
    source: {
      path: file.path,
      contentHash: file.contentHash,
      startLine,
      endLine,
      symbol: enclosingSymbol(node),
      sourceKind: file.sourceKind,
    },
    attributes,
    confidence,
    snippet: content
      .split(/\r?\n/)
      .slice(startLine - 1, endLine)
      .join("\n")
      .trim(),
  }
}

function identifierValue(value?: string) {
  return value?.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)$/)?.[1]
}

function lastIdentifier(value: string) {
  return /([A-Za-z_][A-Za-z0-9_]*)\s*\)?\s*$/.exec(value)?.[1] ?? value
}

function visit(node: SyntaxNode, callback: (node: SyntaxNode) => void) {
  callback(node)
  for (const child of node.namedChildren) {
    if (child) visit(child, callback)
  }
}

function deduplicate(items: RawLifecycleEvidence[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = [item.kind, item.source.path, item.source.startLine, item.fact].join(":")
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
