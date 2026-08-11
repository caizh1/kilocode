import { createHash } from "crypto"
import { constants } from "fs"
import { open } from "fs/promises"
import path from "path"
import type { Node as SyntaxNode, Tree } from "web-tree-sitter"
import { loadRequiredLanguageParsers } from "../tree-sitter/languageParser"
import type {
  BehaviorExtractionResult,
  DesignDocSourceFile,
  DiscoveredDesignDocModule,
  RawBehaviorEvidence,
} from "./types"
import { DesignDocDiscoveryError } from "./types"

interface Callable {
  ref: string
  name: string
  node: SyntaxNode
  body?: SyntaxNode
  file: DesignDocSourceFile
  content: string
}

interface Step {
  ref: string
  kind: "entry" | "action" | "decision" | "exit" | "error"
  label: string
  node: SyntaxNode
  ownerRef: string
}

interface Edge {
  fromRef: string
  toRef: string
  kind: "next" | "branch-true" | "branch-false" | "loop" | "return" | "error"
  label?: string
}

interface Port {
  ref: string
  kind: Edge["kind"]
}

interface Fragment {
  entries: string[]
  exits: Port[]
  errors: string[]
  breaks: string[]
  continues: string[]
}

type AssertionContract = {
  name: string
  source: RawBehaviorEvidence["source"]
  snippet: string
}

export async function extractBehaviorEvidence(module: DiscoveredDesignDocModule): Promise<BehaviorExtractionResult> {
  const parsers = await loadRequiredLanguageParsers(module.files.map((file) => file.absolutePath))
  const callables: Callable[] = []
  const assertions = new Map<string, AssertionContract>()
  const trees: Tree[] = []
  let parseFailures = 0
  const evidence: RawBehaviorEvidence[] = []
  try {
    for (const file of module.files) {
      const content = await readVerifiedSource(file)
      const extension = path.extname(file.absolutePath).slice(1).toLowerCase()
      const parser = file.language === "typescript" ? parsers.ts?.parser : parsers[extension]?.parser
      if (!parser) {
        parseFailures += 1
        continue
      }
      const tree = parser.parse(content)
      if (!tree) {
        parseFailures += 1
        continue
      }
      trees.push(tree)
      collectConfiguration(tree.rootNode, file, content, evidence)
      if (file.language === "c") {
        collectC(tree.rootNode, file, content, callables)
        collectTerminatingAssertions(file, content, assertions)
      } else collectTypeScript(tree.rootNode, file, content, callables)
    }
    const names = new Map<string, string[]>()
    for (const callable of callables) {
      const values = names.get(callable.name) ?? []
      values.push(callable.ref)
      names.set(callable.name, values)
    }
    for (const callable of callables) extractCallable(callable, names, evidence, assertions)
  } finally {
    for (const tree of trees) tree.delete()
  }

  const production = evidence.filter((item) => item.source.sourceKind !== "test")
  const unknowns: string[] = []
  if (!production.some((item) => item.kind === "flow-node" && item.attributes.nodeKind === "entry")) {
    unknowns.push("未发现可分析的生产代码执行入口")
  }
  if (parseFailures) unknowns.push(`有 ${parseFailures} 个源码文件无法加载对应解析器`)
  return {
    moduleID: module.id,
    sourceSnapshotHash: module.sourceSnapshotHash,
    evidence: deduplicate(evidence),
    unknowns,
  }
}

/**
 * 父设计单元只描述子组件之间的真实调用交接，避免把每个子组件内部 AST 控制流
 * 在父模块中再次复制。所有聚合节点和关系仍引用原始 call-message 的源码位置。
 */
export async function extractRootComponentBehaviorEvidence(
  module: DiscoveredDesignDocModule,
): Promise<BehaviorExtractionResult> {
  const extraction = await extractBehaviorEvidence(module)
  const calls = extraction.evidence.filter((item) => {
    if (item.kind !== "call-message") return false
    const from = typeof item.attributes.fromRef === "string" ? item.attributes.fromRef : ""
    const to = typeof item.attributes.toRef === "string" ? item.attributes.toRef : ""
    return to && !to.startsWith("external:") && sourceFile(from) !== sourceFile(to)
  })
  if (!calls.length) return { ...extraction, evidence: [] }
  const components = new Map<string, RawBehaviorEvidence>()
  for (const call of calls) {
    components.set(sourceFile(String(call.attributes.fromRef)), call)
    components.set(sourceFile(String(call.attributes.toRef)), call)
  }
  const incoming = new Set(calls.map((item) => sourceFile(String(item.attributes.toRef))))
  const evidence: RawBehaviorEvidence[] = []
  for (const [component, call] of [...components].sort(([left], [right]) => left.localeCompare(right))) {
    const ref = componentRef(component)
    const label = path.basename(component, path.extname(component))
    evidence.push({
      ...call,
      kind: "flow-node",
      fact: `父模块包含源码组件 ${label}`,
      attributes: {
        ref,
        ownerRef: ref,
        nodeKind: incoming.has(component) ? "action" : "entry",
        label,
      },
    })
    evidence.push({
      ...call,
      kind: "data-entity",
      fact: `父模块跨组件数据流包含 ${label}`,
      attributes: { ref: dataRef(component), entityKind: incoming.has(component) ? "variable" : "input", label },
    })
  }
  for (const call of calls) {
    const from = sourceFile(String(call.attributes.fromRef))
    const to = sourceFile(String(call.attributes.toRef))
    const name = String(call.attributes.label ?? "跨组件调用")
    const callRef = String(call.attributes.ref)
    evidence.push({
      ...call,
      kind: "flow-edge",
      fact: `${path.basename(from)} 调用 ${path.basename(to)} 的 ${name}`,
      attributes: {
        ref: `root-flow:${callRef}`,
        fromRef: componentRef(from),
        toRef: componentRef(to),
        edgeKind: "next",
        label: `跨组件调用：${name}`,
      },
    })
    evidence.push({
      ...call,
      kind: "data-flow",
      fact: `${path.basename(from)} 向 ${path.basename(to)} 传递 ${name} 调用数据`,
      attributes: {
        ref: `root-data:${callRef}`,
        fromRef: dataRef(from),
        toRef: dataRef(to),
        flowKind: "transfer",
        label: `通过 ${name} 传递请求与结果`,
      },
    })
  }
  return { ...extraction, evidence }
}

function sourceFile(ref: string) {
  return ref.split("#", 1)[0] ?? ref
}

function componentRef(file: string) {
  return `root-component:${file}`
}

function dataRef(file: string) {
  return `root-component-data:${file}`
}

function collectTypeScript(root: SyntaxNode, file: DesignDocSourceFile, content: string, output: Callable[]) {
  const visit = (node: SyntaxNode, parentName = "") => {
    if (node.type === "function_declaration") {
      addCallable(node, node.childForFieldName("name")?.text, parentName, file, content, output)
      return
    }
    if (node.type === "lexical_declaration" || node.type === "variable_declaration") {
      for (const declarator of children(node).filter((child) => child.type === "variable_declarator")) {
        const value = declarator.childForFieldName("value")
        if (!value || !["arrow_function", "function_expression"].includes(value.type)) continue
        addCallable(value, declarator.childForFieldName("name")?.text, parentName, file, content, output, declarator)
      }
      return
    }
    if (["class_declaration", "abstract_class_declaration"].includes(node.type)) {
      const className = node.childForFieldName("name")?.text ?? parentName
      const body = children(node).find((child) => child.type === "class_body")
      for (const member of body?.namedChildren ?? []) {
        if (
          !member ||
          !["method_definition", "abstract_method_signature", "public_field_definition"].includes(member.type)
        )
          continue
        const value = member.type === "public_field_definition" ? member.childForFieldName("value") : member
        if (
          !value ||
          (member.type === "public_field_definition" && !["arrow_function", "function_expression"].includes(value.type))
        )
          continue
        addCallable(value, member.childForFieldName("name")?.text, className, file, content, output, member)
      }
      return
    }
    if (node.type === "export_statement") {
      for (const child of node.namedChildren) if (child) visit(child, parentName)
      return
    }
    for (const child of node.namedChildren) if (child) visit(child, parentName)
  }
  visit(root)
}

function collectC(root: SyntaxNode, file: DesignDocSourceFile, content: string, output: Callable[]) {
  const visit = (node: SyntaxNode) => {
    if (node.type === "function_definition") {
      const name = cFunctionName(node.childForFieldName("declarator"))
      addCallable(node, name, "", file, content, output)
      return
    }
    if (["preproc_if", "preproc_ifdef", "preproc_elif", "preproc_else"].includes(node.type)) {
      for (const child of node.namedChildren) if (child) visit(child)
      return
    }
    for (const child of node.namedChildren) if (child) visit(child)
  }
  visit(root)
}

function collectTerminatingAssertions(
  file: DesignDocSourceFile,
  content: string,
  output: Map<string, AssertionContract>,
) {
  const lines = content.split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    const match = /^\s*#\s*define\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)/.exec(lines[index] ?? "")
    if (!match?.[1]) continue
    const start = index
    const body = [lines[index] ?? ""]
    while (/\\\s*$/.test(body.at(-1) ?? "") && index + 1 < lines.length) {
      index += 1
      body.push(lines[index] ?? "")
    }
    const snippet = body.join("\n")
    const semantics = snippet
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "")
      .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "")
    if (!/(?:\bwhile\s*\(\s*(?:1|true)\s*\)|\b(?:abort|exit|_Exit|panic|__builtin_trap)\s*\()/i.test(semantics)) {
      continue
    }
    output.set(match[1], {
      name: match[1],
      source: {
        path: file.path,
        contentHash: file.contentHash,
        startLine: start + 1,
        endLine: index + 1,
        sourceKind: file.sourceKind,
      },
      snippet,
    })
  }
}

function addCallable(
  callableNode: SyntaxNode,
  name: string | undefined,
  parentName: string,
  file: DesignDocSourceFile,
  content: string,
  output: Callable[],
  declarationNode = callableNode,
) {
  if (!name) return
  const qualifiedName = parentName ? `${parentName}.${name}` : name
  const line = declarationNode.startPosition.row + 1
  const ref = `${file.path}#${qualifiedName}@${line}`
  const body =
    callableNode.childForFieldName("body") ??
    children(callableNode).find((child) => child.type === "compound_statement" || child.type === "statement_block")
  if (!body) return
  output.push({ ref, name, node: declarationNode, body, file, content })
}

function extractCallable(
  callable: Callable,
  names: Map<string, string[]>,
  evidence: RawBehaviorEvidence[],
  assertions: Map<string, AssertionContract>,
) {
  const entry: Step = {
    ref: `${callable.ref}::entry`,
    kind: "entry",
    label: callable.name,
    node: callable.node,
    ownerRef: callable.ref,
  }
  const control = buildControlFlow(callable)
  const steps = [entry, ...control.steps]
  const edges = [
    ...control.entries.map((toRef): Edge => ({ fromRef: entry.ref, toRef, kind: "next" })),
    ...control.edges,
  ]
  for (const step of steps) {
    evidence.push(stepEvidence(callable, step))
  }
  for (const edge of edges) {
    evidence.push(edgeEvidence(callable, edge, steps))
  }
  extractErrorHandling(callable, entry, evidence, assertions)
  for (const node of descendants(callable.body!)) {
    if (node.type === "call_expression" || node.type === "call_expression_statement") {
      const target = callTarget(node)
      if (target) evidence.push(callEvidence(callable, node, target, names))
    }
  }
  extractData(callable, evidence)
}

function buildControlFlow(callable: Callable) {
  const steps: Step[] = []
  const edges: Edge[] = []
  const make = (node: SyntaxNode, kind: Step["kind"], label = stepLabel(node)) => {
    const ref = `${callable.ref}::${kind}@${node.startPosition.row + 1}:${node.startPosition.column}:${node.type}`
    const step = { ref, kind, label, node, ownerRef: callable.ref } satisfies Step
    if (!steps.some((item) => item.ref === ref)) steps.push(step)
    return step
  }
  const connect = (ports: Port[], entries: string[]) => {
    for (const port of ports) for (const toRef of entries) edges.push({ fromRef: port.ref, toRef, kind: port.kind })
  }
  const sequence = (nodes: SyntaxNode[]): Fragment => {
    let result: Fragment = { entries: [], exits: [], errors: [], breaks: [], continues: [] }
    for (const node of nodes) {
      const current = statement(node)
      const first = result.entries.length === 0
      const reachable = first || result.exits.length > 0
      if (first) result.entries = current.entries
      else if (reachable) connect(result.exits, current.entries)
      result = {
        entries: result.entries,
        exits: reachable && current.entries.length ? current.exits : result.exits,
        errors: [...result.errors, ...current.errors],
        breaks: [...result.breaks, ...current.breaks],
        continues: [...result.continues, ...current.continues],
      }
    }
    return result
  }
  const block = (node: SyntaxNode | null | undefined) => {
    if (!node) return { entries: [], exits: [], errors: [], breaks: [], continues: [] } satisfies Fragment
    if (node.type === "statement_block" || node.type === "compound_statement") return sequence(children(node))
    return statement(node)
  }
  const statement = (node: SyntaxNode): Fragment => {
    if (node.type === "if_statement") {
      const decision = make(node, "decision", conditionLabel(node))
      const yes = block(node.childForFieldName("consequence"))
      const no = block(node.childForFieldName("alternative"))
      if (yes.entries.length) connect([{ ref: decision.ref, kind: "branch-true" }], yes.entries)
      if (no.entries.length) connect([{ ref: decision.ref, kind: "branch-false" }], no.entries)
      return {
        entries: [decision.ref],
        exits: [
          ...(yes.entries.length ? yes.exits : [{ ref: decision.ref, kind: "branch-true" as const }]),
          ...(no.entries.length ? no.exits : [{ ref: decision.ref, kind: "branch-false" as const }]),
        ],
        errors: [...yes.errors, ...no.errors],
        breaks: [...yes.breaks, ...no.breaks],
        continues: [...yes.continues, ...no.continues],
      }
    }
    if (["for_statement", "for_in_statement", "while_statement", "do_statement"].includes(node.type)) {
      const decision = make(node, "decision", conditionLabel(node))
      const body = block(node.childForFieldName("body"))
      if (body.entries.length) connect([{ ref: decision.ref, kind: "branch-true" }], body.entries)
      connect([...body.exits, ...body.continues.map((ref) => ({ ref, kind: "loop" as const }))], [decision.ref])
      for (const edge of edges) {
        if (
          edge.toRef === decision.ref &&
          (body.exits.some((port) => port.ref === edge.fromRef) || body.continues.includes(edge.fromRef))
        )
          edge.kind = "loop"
      }
      return {
        entries: [decision.ref],
        exits: [
          { ref: decision.ref, kind: "branch-false" },
          ...body.breaks.map((ref) => ({ ref, kind: "next" as const })),
        ],
        errors: body.errors,
        breaks: [],
        continues: [],
      }
    }
    if (node.type === "try_statement") {
      const body = block(
        node.childForFieldName("body") ?? children(node).find((child) => child.type === "statement_block"),
      )
      const clause = children(node).find((child) => child.type === "catch_clause")
      if (!clause) return body
      const handler = make(clause, "action", `catch ${clause.childForFieldName("parameter")?.text ?? "error"}`)
      const handled = block(
        clause.childForFieldName("body") ?? children(clause).find((child) => child.type === "statement_block"),
      )
      for (const fromRef of body.errors) edges.push({ fromRef, toRef: handler.ref, kind: "error" })
      if (handled.entries.length) connect([{ ref: handler.ref, kind: "next" }], handled.entries)
      return {
        entries: body.entries.length ? body.entries : [handler.ref],
        exits: [
          ...body.exits,
          ...(handled.entries.length ? handled.exits : [{ ref: handler.ref, kind: "next" as const }]),
        ],
        errors: handled.errors,
        breaks: [...body.breaks, ...handled.breaks],
        continues: [...body.continues, ...handled.continues],
      }
    }
    if (node.type === "throw_statement" || node.type === "goto_statement") {
      const step = make(node, "error")
      return { entries: [step.ref], exits: [], errors: [step.ref], breaks: [], continues: [] }
    }
    if (node.type === "return_statement") {
      const step = make(node, "exit")
      return { entries: [step.ref], exits: [], errors: [], breaks: [], continues: [] }
    }
    if (node.type === "break_statement") {
      const step = make(node, "exit")
      return { entries: [step.ref], exits: [], errors: [], breaks: [step.ref], continues: [] }
    }
    if (node.type === "continue_statement") {
      const step = make(node, "exit")
      return { entries: [step.ref], exits: [], errors: [], breaks: [], continues: [step.ref] }
    }
    if (node.type === "switch_statement") {
      const decision = make(node, "decision", conditionLabel(node))
      const body = node.childForFieldName("body")
      const clauses = children(body ?? node).filter((child) =>
        ["case_statement", "switch_case", "switch_default"].includes(child.type),
      )
      if (!clauses.length) {
        const fragment = block(body)
        if (fragment.entries.length) connect([{ ref: decision.ref, kind: "branch-true" }], fragment.entries)
        return {
          entries: [decision.ref],
          exits: [
            ...fragment.exits,
            ...fragment.breaks.map((ref) => ({ ref, kind: "next" as const })),
            { ref: decision.ref, kind: "branch-false" },
          ],
          errors: fragment.errors,
          breaks: [],
          continues: fragment.continues,
        }
      }
      const errors: string[] = []
      const breaks: string[] = []
      const continues: string[] = []
      let fallthrough: Port[] = []
      let hasDefault = false
      for (const clause of clauses) {
        const value = clause.childForFieldName("value")
        const fallback = clause.type === "switch_default" || !value
        hasDefault ||= fallback
        const clauseLabel = fallback ? "default" : `case ${value.text.replace(/\s+/g, " ")}`
        const clauseStep = make(clause, "decision", clauseLabel)
        edges.push({
          fromRef: decision.ref,
          toRef: clauseStep.ref,
          kind: fallback ? "branch-false" : "branch-true",
          label: fallback ? "其他情况" : `匹配 ${clauseLabel}`,
        })
        connect(fallthrough, [clauseStep.ref])
        const fragment = sequence(children(clause).filter((child) => child !== value))
        if (fragment.entries.length) connect([{ ref: clauseStep.ref, kind: "next" }], fragment.entries)
        fallthrough = fragment.entries.length ? fragment.exits : [{ ref: clauseStep.ref, kind: "next" }]
        errors.push(...fragment.errors)
        breaks.push(...fragment.breaks)
        continues.push(...fragment.continues)
      }
      return {
        entries: [decision.ref],
        exits: [
          ...fallthrough,
          ...breaks.map((ref) => ({ ref, kind: "next" as const })),
          ...(hasDefault ? [] : [{ ref: decision.ref, kind: "branch-false" as const }]),
        ],
        errors,
        breaks: [],
        continues,
      }
    }
    const kind = stepKind(node)
    if (!kind) return sequence(children(node))
    const step = make(node, kind)
    return {
      entries: [step.ref],
      exits: [{ ref: step.ref, kind: "next" }],
      errors: [],
      breaks: [],
      continues: [],
    }
  }
  const fragment = block(callable.body)
  return { steps, edges, ...fragment }
}

function stepKind(node: SyntaxNode): Step["kind"] | undefined {
  if (
    [
      "if_statement",
      "switch_statement",
      "for_statement",
      "for_in_statement",
      "while_statement",
      "do_statement",
    ].includes(node.type)
  )
    return "decision"
  if (["return_statement", "break_statement", "continue_statement"].includes(node.type)) return "exit"
  if (["throw_statement", "goto_statement"].includes(node.type)) return "error"
  if (["expression_statement", "lexical_declaration", "declaration"].includes(node.type)) return "action"
  return undefined
}

function stepLabel(node: SyntaxNode) {
  return node.text.replace(/\s+/g, " ")
}

function conditionLabel(node: SyntaxNode) {
  const condition = node.childForFieldName("condition") ?? node.childForFieldName("value")
  return condition ? condition.text.replace(/\s+/g, " ") : stepLabel(node)
}

function stepEvidence(callable: Callable, step: Step): RawBehaviorEvidence {
  return raw(callable, step.node, "flow-node", `${callable.name} 包含 ${step.kind} 步骤`, {
    ref: step.ref,
    ownerRef: step.ownerRef,
    nodeKind: step.kind,
    label: step.label,
  })
}

function edgeEvidence(callable: Callable, edge: Edge, steps: Step[]): RawBehaviorEvidence {
  const node = steps.find((step) => step.ref === edge.fromRef)?.node ?? callable.node
  const condition = steps.find((step) => step.ref === edge.fromRef && step.kind === "decision")?.label
  const label =
    edge.label ??
    {
      next: "顺序执行",
      "branch-true": condition ? `条件成立：${condition}` : "条件成立",
      "branch-false": condition ? `条件不成立：${condition}` : "条件不成立",
      loop: "继续循环",
      return: "返回结果",
      error: "进入异常路径",
    }[edge.kind]
  return raw(callable, node, "flow-edge", `${callable.name} 的 ${edge.kind} 控制流`, {
    ref: `${edge.fromRef}->${edge.toRef}:${edge.kind}`,
    fromRef: edge.fromRef,
    toRef: edge.toRef,
    edgeKind: edge.kind,
    label,
  })
}

function callEvidence(callable: Callable, node: SyntaxNode, target: string, names: Map<string, string[]>) {
  const line = node.startPosition.row + 1
  const candidates = names.get(target.split(".").at(-1) ?? target) ?? []
  const toRef = candidates.length === 1 ? candidates[0] : `external:${target}`
  return raw(callable, node, "call-message", `${callable.name} 调用 ${target}`, {
    ref: `${callable.ref}::call:${target}@${line}`,
    fromRef: callable.ref,
    toRef,
    label: target,
    callKind: toRef.startsWith("external:") ? "external" : "internal",
  })
}

function extractData(callable: Callable, evidence: RawBehaviorEvidence[]) {
  const entities = new Set<string>()
  const addEntity = (node: SyntaxNode, name: string, kind: string) => {
    const ref = `${callable.ref}::data:${name}`
    if (!entities.has(ref)) {
      entities.add(ref)
      evidence.push(
        raw(callable, node, "data-entity", `${callable.name} 使用数据 ${name}`, { ref, label: name, entityKind: kind }),
      )
    }
    return ref
  }
  const parameters = callable.node.childForFieldName("parameters") ?? callable.node.childForFieldName("parameter_list")
  for (const parameter of parameters?.namedChildren ?? []) {
    if (!parameter) continue
    const name = parameter.childForFieldName("name")?.text ?? parameter.childForFieldName("declarator")?.text
    if (name) addEntity(parameter, name, "input")
  }
  for (const node of descendants(callable.body!)) {
    if (node.type === "assignment_expression") {
      const target = node.childForFieldName("left")?.text
      const value = node.childForFieldName("right")?.text
      if (!target || !value) continue
      const fromRef = addEntity(node, value, "value")
      const toRef = addEntity(node, target, "variable")
      evidence.push(dataFlowEvidence(callable, node, fromRef, toRef, "write"))
    }
    if (node.type === "return_statement") {
      const value = children(node)[0]?.text
      if (!value) continue
      const fromRef = addEntity(node, value, "value")
      const outputRef = addEntity(node, "return", "output")
      evidence.push(dataFlowEvidence(callable, node, fromRef, outputRef, "return"))
    }
    if (node.type === "call_expression" || node.type === "call_expression_statement") {
      const target = callTarget(node)
      const io = target ? ioKind(target) : undefined
      if (!target || !io) continue
      const external = addEntity(node, target, io.entity)
      const args = node.childForFieldName("arguments") ?? node.childForFieldName("argument_list")
      const argument = args?.namedChildren.find((child) => child !== null)?.text
      if (io.direction === "write" || io.direction === "transfer") {
        const input = addEntity(node, argument || "request", "value")
        evidence.push(dataFlowEvidence(callable, node, input, external, io.direction))
      } else {
        const result = addEntity(node, `${target} result`, "value")
        evidence.push(dataFlowEvidence(callable, node, external, result, "read"))
      }
    }
  }
}

function ioKind(
  target: string,
): { entity: "store" | "external"; direction: "read" | "write" | "transfer" } | undefined {
  const store = /(?:db|database|cache|redis|repository|store|readFile|writeFile|Bun\.file|fs\.)/i.test(target)
  const remote = /(?:fetch|axios|http|rpc|api|client|publish|send|emit)/i.test(target)
  if (!store && !remote) return undefined
  if (/(?:read|get|find|select|query|load|open|Bun\.file)/i.test(target))
    return { entity: store ? "store" : "external", direction: "read" }
  if (/(?:write|set|insert|update|delete|save|remove|put|append)/i.test(target))
    return { entity: store ? "store" : "external", direction: "write" }
  return { entity: store ? "store" : "external", direction: "transfer" }
}

function collectConfiguration(
  root: SyntaxNode,
  file: DesignDocSourceFile,
  content: string,
  evidence: RawBehaviorEvidence[],
) {
  for (const node of descendants(root)) {
    const key = configurationKey(node)
    if (!key) continue
    const startLine = node.startPosition.row + 1
    const endLine = node.endPosition.row + 1
    evidence.push({
      kind: "configuration",
      fact: `源码读取配置 ${key}`,
      source: {
        path: file.path,
        contentHash: file.contentHash,
        startLine,
        endLine,
        sourceKind: file.sourceKind,
      },
      attributes: { ref: `${file.path}#config:${key}@${startLine}`, key, configKind: "environment" },
      confidence: "explicit",
      snippet: content
        .split(/\r?\n/)
        .slice(startLine - 1, endLine)
        .join("\n")
        .trim(),
    })
  }
}

function configurationKey(node: SyntaxNode) {
  if (node.type === "member_expression") {
    const match = node.text.match(/(?:process|import\.meta)\.env\.([A-Za-z_][A-Za-z0-9_]*)$/)
    return match?.[1]
  }
  if (node.type !== "call_expression") return undefined
  const target = callTarget(node)
  if (target !== "Deno.env.get" && target !== "Bun.env") return undefined
  const args = node.childForFieldName("arguments") ?? node.childForFieldName("argument_list")
  const value = args?.namedChildren.find((child) => child !== null)?.text
  return value?.match(/^['"]([^'"]+)['"]$/)?.[1]
}

function dataFlowEvidence(callable: Callable, node: SyntaxNode, fromRef: string, toRef: string, kind: string) {
  const label =
    {
      read: "读取数据",
      write: "写入数据",
      return: "返回结果",
      transfer: "传递数据",
    }[kind] ?? "传递数据"
  return raw(callable, node, "data-flow", `${callable.name} 发生 ${kind} 数据流`, {
    ref: `${fromRef}->${toRef}:${kind}@${node.startPosition.row + 1}`,
    fromRef,
    toRef,
    flowKind: kind,
    label,
  })
}

function extractErrorHandling(
  callable: Callable,
  entry: Step,
  evidence: RawBehaviorEvidence[],
  assertionContracts: Map<string, AssertionContract>,
) {
  const nodes = descendants(callable.body!)
  const raises = nodes.filter((node) => node.type === "throw_statement" || node.type === "goto_statement")
  const catches = nodes.filter((node) => node.type === "catch_clause")
  const assertionCalls = nodes.filter((node) => {
    if (node.type !== "call_expression" && node.type !== "call_expression_statement") return false
    const target = callTarget(node)
    return !!target && assertionContracts.has(target)
  })
  const refs = new Map<SyntaxNode, string>()
  const addNode = (node: SyntaxNode, kind: "raise" | "handler" | "retry" | "fallback" | "terminal", label: string) => {
    const ref = `${callable.ref}::error:${kind}@${node.startPosition.row + 1}:${node.startPosition.column}`
    refs.set(node, ref)
    evidence.push(
      raw(callable, node, "error-node", `${callable.name} 包含 ${kind} 异常节点`, {
        ref,
        ownerRef: callable.ref,
        nodeKind: kind,
        label,
      }),
    )
    return ref
  }
  const addEdge = (
    node: SyntaxNode,
    fromRef: string,
    toRef: string,
    kind: "error" | "handle" | "retry" | "fallback" | "terminate",
  ) => {
    const label = {
      error: "触发异常",
      handle: "进入异常处理",
      retry: "执行重试",
      fallback: "执行降级",
      terminate: "终止处理",
    }[kind]
    evidence.push(
      raw(callable, node, "error-edge", `${callable.name} 包含 ${kind} 异常流`, {
        ref: `${fromRef}->${toRef}:${kind}`,
        fromRef,
        toRef,
        edgeKind: kind,
        label,
      }),
    )
  }
  for (const raise of raises) {
    const ref = addNode(raise, "raise", stepLabel(raise))
    addEdge(raise, entry.ref, ref, "error")
  }
  for (const assertion of assertionCalls) {
    const terminal = addNode(assertion, "terminal", stepLabel(assertion))
    const target = callTarget(assertion)
    const contract = target ? assertionContracts.get(target) : undefined
    if (contract) {
      evidence.push({
        kind: "error-node",
        fact: `宏 ${contract.name} 的定义包含终止语义`,
        source: contract.source,
        attributes: {
          ref: terminal,
          ownerRef: callable.ref,
          nodeKind: "terminal",
          label: stepLabel(assertion),
        },
        confidence: "explicit",
        snippet: contract.snippet,
      })
    }
    addEdge(assertion, entry.ref, terminal, "terminate")
  }
  for (const clause of catches) {
    const handler = addNode(clause, "handler", `catch ${clause.childForFieldName("parameter")?.text ?? "error"}`)
    const ownerTry = ancestor(clause, "try_statement")
    const body = ownerTry?.childForFieldName("body")
    const handledRaises = raises.filter((raise) => body && contains(body, raise))
    for (const raise of handledRaises) addEdge(clause, refs.get(raise)!, handler, "handle")
    const catchBody =
      clause.childForFieldName("body") ?? children(clause).find((child) => child.type === "statement_block")
    if (!catchBody) continue
    for (const node of descendants(catchBody)) {
      if (node.type === "call_expression") {
        const target = callTarget(node)
        if (!target || !/(?:retry|reconnect|reopen|resume)/i.test(target)) continue
        const retry = addNode(node, "retry", stepLabel(node))
        addEdge(node, handler, retry, "retry")
      }
      if (node.type !== "return_statement") continue
      const fallback = addNode(node, "fallback", stepLabel(node))
      addEdge(node, handler, fallback, "fallback")
    }
  }
}

function ancestor(node: SyntaxNode, type: string) {
  let current = node.parent
  while (current) {
    if (current.type === type) return current
    current = current.parent
  }
  return undefined
}

function contains(root: SyntaxNode, target: SyntaxNode) {
  return root.startIndex <= target.startIndex && root.endIndex >= target.endIndex
}

function raw(
  callable: Callable,
  node: SyntaxNode,
  kind: RawBehaviorEvidence["kind"],
  fact: string,
  attributes: RawBehaviorEvidence["attributes"],
): RawBehaviorEvidence {
  const startLine = node.startPosition.row + 1
  const endLine = node.endPosition.row + 1
  return {
    kind,
    fact,
    source: {
      path: callable.file.path,
      contentHash: callable.file.contentHash,
      startLine,
      endLine,
      symbol: callable.ref,
      sourceKind: callable.file.sourceKind,
    },
    attributes,
    confidence: "explicit",
    snippet: callable.content
      .split(/\r?\n/)
      .slice(startLine - 1, Math.min(endLine, startLine + 2))
      .join("\n")
      .trim(),
  }
}

function callTarget(node: SyntaxNode) {
  const fn = node.childForFieldName("function") ?? node.childForFieldName("function_name") ?? children(node)[0]
  if (!fn) return undefined
  return fn.text.replace(/\s+/g, " ")
}

function cFunctionName(node: SyntaxNode | null): string | undefined {
  if (!node) return undefined
  if (node.type === "function_declarator") {
    const declarator = node.childForFieldName("declarator")
    return declarator?.type === "identifier" ? declarator.text : cFunctionName(declarator)
  }
  return cFunctionName(node.childForFieldName("declarator"))
}

function descendants(root: SyntaxNode) {
  const values: SyntaxNode[] = []
  const visit = (node: SyntaxNode) => {
    for (const child of node.namedChildren) {
      if (!child) continue
      values.push(child)
      visit(child)
    }
  }
  visit(root)
  return values
}

async function readVerifiedSource(file: DesignDocSourceFile) {
  const handle = await open(file.absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => undefined)
  if (!handle) throw new DesignDocDiscoveryError("SOURCE_CHANGED", `源码文件已被替换：${file.path}`)
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new DesignDocDiscoveryError("SOURCE_CHANGED", `源码文件不再是普通文件：${file.path}`)
    const content = await handle.readFile()
    const hash = createHash("sha256").update(content).digest("hex")
    if (hash !== file.contentHash) {
      throw new DesignDocDiscoveryError("SOURCE_CHANGED", `源码文件在行为证据提取前发生变化：${file.path}`)
    }
    return content.toString("utf8")
  } finally {
    await handle.close()
  }
}

function deduplicate(items: RawBehaviorEvidence[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = [item.kind, item.source.path, item.source.startLine, item.fact, JSON.stringify(item.attributes)].join(
      ":",
    )
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function children(node: SyntaxNode) {
  return node.namedChildren.filter((child): child is SyntaxNode => child !== null)
}
