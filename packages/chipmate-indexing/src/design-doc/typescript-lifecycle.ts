import { createHash } from "crypto"
import { constants } from "fs"
import { open } from "fs/promises"
import type { Node as SyntaxNode } from "web-tree-sitter"
import { loadRequiredLanguageParsers } from "../tree-sitter/languageParser"
import type {
  DiscoveredDesignDocModule,
  LifecycleExtractionResult,
  LifecycleEvidenceKind,
  RawLifecycleEvidence,
} from "./types"
import { DesignDocDiscoveryError } from "./types"

const stateName = /(state|status|phase|lifecycle)/i
const terminalName = /^(done|completed|complete|cancelled|canceled|closed|failed|error|terminated)$/i

export async function extractTypeScriptLifecycleEvidence(
  module: DiscoveredDesignDocModule,
): Promise<LifecycleExtractionResult> {
  const files = module.files.filter((file) => file.language === "typescript" || file.language === "tsx")
  const parsers = await loadRequiredLanguageParsers(files.map((file) => file.absolutePath))
  const evidence: RawLifecycleEvidence[] = []

  for (const file of files) {
    const content = await readVerifiedSource(file)
    const parser = parsers[file.language === "typescript" ? "ts" : "tsx"]?.parser
    if (!parser) continue
    const tree = parser.parse(content)
    if (!tree) continue
    visit(tree.rootNode, (node) => extractNode(node, content, file, evidence))
    tree.delete()
  }

  const unique = deduplicate(evidence)
  const explicitStates = new Set(
    unique
      .filter((item) => item.kind === "state-definition" || item.kind === "initial-state")
      .flatMap((item) => (typeof item.attributes.state === "string" ? [item.attributes.state] : [])),
  )
  const transitions = unique.filter((item) => item.kind === "state-transition")
  const unknowns = []
  const stateFields = new Set(
    unique
      .filter((item) => item.kind === "state-field")
      .flatMap((item) => (typeof item.attributes.field === "string" ? [item.attributes.field] : [])),
  )
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

function extractNode(
  node: SyntaxNode,
  content: string,
  file: DiscoveredDesignDocModule["files"][number],
  output: RawLifecycleEvidence[],
) {
  if (node.type === "enum_declaration") extractEnum(node, content, file, output)
  if (node.type === "type_alias_declaration") extractUnion(node, content, file, output)
  if (node.type === "variable_declarator" || node.type === "public_field_definition") {
    extractStateField(node, content, file, output)
  }
  if (node.type === "assignment_expression") extractAssignment(node, content, file, output)
  if (node.type === "call_expression") extractSetter(node, content, file, output)
}

function extractEnum(
  node: SyntaxNode,
  content: string,
  file: DiscoveredDesignDocModule["files"][number],
  output: RawLifecycleEvidence[],
) {
  const name = node.childForFieldName("name")?.text ?? ""
  if (!stateName.test(name)) return
  const body =
    node.childForFieldName("body") ?? node.namedChildren.find((item) => item?.type === "enum_body") ?? undefined
  for (const member of body?.namedChildren.filter((item): item is SyntaxNode => item !== null) ?? []) {
    if (member.type !== "enum_assignment" && member.type !== "property_identifier") continue
    const memberName = member.childForFieldName("name")?.text ?? member.text.split("=")[0]?.trim()
    const value = literalValue(member.childForFieldName("value")?.text) ?? memberName
    if (!value) continue
    output.push(
      makeEvidence("state-definition", `枚举 ${name} 定义状态 ${value}`, node, content, file, {
        state: value,
        declaration: name,
      }),
    )
    if (terminalName.test(value)) {
      output.push(
        makeEvidence(
          "terminal-state",
          `状态 ${value} 表示终态或错误终态`,
          member,
          content,
          file,
          {
            state: value,
          },
          "inferred",
        ),
      )
    }
  }
}

function extractUnion(
  node: SyntaxNode,
  content: string,
  file: DiscoveredDesignDocModule["files"][number],
  output: RawLifecycleEvidence[],
) {
  const name = node.childForFieldName("name")?.text ?? ""
  if (!stateName.test(name)) return
  const values = [...node.text.matchAll(/["'`]([^"'`]+)["'`]/g)].map((match) => match[1])
  if (values.length < 2) return
  for (const value of values) {
    output.push(
      makeEvidence("state-definition", `联合类型 ${name} 定义状态 ${value}`, node, content, file, {
        state: value,
        declaration: name,
      }),
    )
    if (terminalName.test(value)) {
      output.push(
        makeEvidence(
          "terminal-state",
          `状态 ${value} 表示终态或错误终态`,
          node,
          content,
          file,
          {
            state: value,
          },
          "inferred",
        ),
      )
    }
  }
}

function extractStateField(
  node: SyntaxNode,
  content: string,
  file: DiscoveredDesignDocModule["files"][number],
  output: RawLifecycleEvidence[],
) {
  const name = node.childForFieldName("name")?.text ?? node.namedChildren[0]?.text ?? ""
  if (!stateName.test(name)) return
  const value = literalValue(node.childForFieldName("value")?.text) ?? enumValue(node.childForFieldName("value")?.text)
  const declaredType = node.childForFieldName("type")?.text ?? ""
  if (!value && !stateName.test(declaredType)) return
  output.push(makeEvidence("state-field", `字段 ${name} 保存生命周期状态`, node, content, file, { field: name }))
  if (!value) return
  output.push(
    makeEvidence("initial-state", `字段 ${name} 初始化为 ${value}`, node, content, file, {
      field: name,
      state: value,
    }),
  )
}

function extractAssignment(
  node: SyntaxNode,
  content: string,
  file: DiscoveredDesignDocModule["files"][number],
  output: RawLifecycleEvidence[],
) {
  const left = node.childForFieldName("left")?.text ?? ""
  const field = lastIdentifier(left)
  if (!stateName.test(field)) return
  const to = literalValue(node.childForFieldName("right")?.text) ?? enumValue(node.childForFieldName("right")?.text)
  const from = guardedState(node, field)
  if (!from || !to || from === to) return
  const symbol = enclosingSymbol(node)
  const guard = transitionGuard(node, field, from)
  output.push(
    makeEvidence("state-transition", `${left} 从 ${from} 迁移到 ${to}`, node, content, file, {
      field: left,
      from,
      to,
      trigger: symbol ?? null,
      guard: guard ?? null,
      action: node.text.trim(),
    }),
  )
}

function extractSetter(
  node: SyntaxNode,
  content: string,
  file: DiscoveredDesignDocModule["files"][number],
  output: RawLifecycleEvidence[],
) {
  const fn = node.childForFieldName("function")?.text ?? node.namedChildren[0]?.text ?? ""
  const setter = /(^|\.)(set(State|Status|Phase)|transitionTo)$/i.exec(fn)
  if (!setter) return
  const args =
    node.childForFieldName("arguments") ?? node.namedChildren.find((item) => item?.type === "arguments") ?? undefined
  const target = args?.namedChildren[0]
  const to = literalValue(target?.text) ?? enumValue(target?.text)
  const method = setter[2]?.toLowerCase() ?? ""
  const field = method === "transitionto" ? "state" : method.replace(/^set/, "") || "state"
  const from = guardedState(node, field)
  if (!from || !to || from === to) return
  const symbol = enclosingSymbol(node)
  const guard = transitionGuard(node, field, from)
  output.push(
    makeEvidence("state-transition", `${fn} 将状态从 ${from} 迁移到 ${to}`, node, content, file, {
      field: fn,
      from,
      to,
      trigger: symbol ?? null,
      guard: guard ?? null,
      action: node.text.trim(),
    }),
  )
}

function transitionGuard(node: SyntaxNode, field: string, from: string) {
  const conditions: string[] = []
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === "if_statement") {
      const condition = current.childForFieldName("condition")?.text ?? ""
      const remaining = withoutStatePredicate(condition, field, from)
      if (remaining) conditions.unshift(isAlternativeBranch(current, node) ? `!(${remaining})` : remaining)
    }
    if (isFunctionNode(current)) break
  }
  return conditions.length ? conditions.join(" && ") : undefined
}

function withoutStatePredicate(condition: string, field: string, from: string) {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const escapedState = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const anyState = new RegExp(`(?:\\bthis\\.)?\\b${escapedField}\\b\\s*={2,3}\\s*(?:["'\\x60]([^"'\\x60]+)["'\\x60]|[A-Za-z_$][\\w$]*\\.([A-Za-z_$][\\w$]*))`, "i")
  const comparedState = anyState.exec(condition)
  const comparedValue = comparedState?.[1] ?? comparedState?.[2]
  if (comparedValue && comparedValue !== from) return undefined
  const quoted = `["'\x60]${escapedState}["'\x60]`
  const member = `[A-Za-z_$][\\w$]*\\.${escapedState}`
  const state = new RegExp(`(?:\\bthis\\.)?\\b${escapedField}\\b\\s*={2,3}\\s*(?:${quoted}|${member})`, "i")
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
  const literal = new RegExp(`(?:\\bthis\\.)?\\b${escaped}\\b\\s*={2,3}\\s*["'\`]([^"'\`]+)["'\`]`, "i")
  const member = new RegExp(`(?:\\bthis\\.)?\\b${escaped}\\b\\s*={2,3}\\s*[A-Za-z_$][\\w$]*\\.([A-Za-z_$][\\w$]*)`, "i")
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === "if_statement") {
      const condition = current.childForFieldName("condition")?.text ?? ""
      const match = literal.exec(condition)
      if (match?.[1]) return match[1]
      const enumMatch = member.exec(condition)
      if (enumMatch?.[1]) return enumMatch[1]
    }
    if (current.type === "switch_case") {
      const statement = switchStatement(current)
      const switched = statement?.childForFieldName("value")?.text ?? statement?.childForFieldName("condition")?.text
      if (lastIdentifier(switched ?? "") !== field) continue
      const value = current.childForFieldName("value")?.text ?? current.namedChildren[0]?.text
      const state = literalValue(value) ?? enumValue(value)
      if (state) return state
    }
    if (isFunctionNode(current)) break
  }
  return undefined
}

function switchStatement(node: SyntaxNode) {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === "switch_statement") return current
    if (isFunctionNode(current)) return undefined
  }
  return undefined
}

function enclosingSymbol(node: SyntaxNode): string | undefined {
  for (let current = node.parent; current; current = current.parent) {
    if (!isFunctionNode(current)) continue
    return current.childForFieldName("name")?.text ?? current.parent?.childForFieldName("name")?.text
  }
  return undefined
}

function isFunctionNode(node: SyntaxNode) {
  return ["function_declaration", "method_definition", "arrow_function", "function_expression"].includes(node.type)
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
  const lines = content.split(/\r?\n/).slice(startLine - 1, endLine)
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
    snippet: lines.join("\n").trim(),
  }
}

function visit(node: SyntaxNode, callback: (node: SyntaxNode) => void) {
  callback(node)
  for (const child of node.namedChildren) {
    if (child) visit(child, callback)
  }
}

function literalValue(value?: string) {
  const match = value?.trim().match(/^["'`]([^"'`]+)["'`]$/)
  return match?.[1]
}

function enumValue(value?: string) {
  const match = value?.trim().match(/(?:^|\.)([A-Za-z_$][\w$]*)$/)
  return match?.[1]
}

function lastIdentifier(value: string) {
  return /([A-Za-z_$][\w$]*)\s*\)?\s*$/.exec(value)?.[1] ?? value
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
