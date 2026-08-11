import { createHash } from "crypto"
import { constants } from "fs"
import { open } from "fs/promises"
import path from "path"
import type { Node as SyntaxNode } from "web-tree-sitter"
import { loadRequiredLanguageParsers } from "../tree-sitter/languageParser"
import type {
  CodeStructureExtractionResult,
  CodeStructureSymbolKind,
  DesignDocSourceFile,
  DiscoveredDesignDocModule,
  RawCodeStructureEvidence,
} from "./types"
import { DesignDocDiscoveryError } from "./types"

interface ParentSymbol {
  ref: string
  qualifiedName: string
}

export async function extractCodeStructureEvidence(
  module: DiscoveredDesignDocModule,
): Promise<CodeStructureExtractionResult> {
  const parsers = await loadRequiredLanguageParsers(module.files.map((file) => file.absolutePath))
  const evidence: RawCodeStructureEvidence[] = []
  let anonymous = 0

  for (const file of module.files) {
    const content = await readVerifiedSource(file)
    evidence.push(sourceFileEvidence(file, content))
    const extension = path.extname(file.absolutePath).slice(1).toLowerCase()
    const parser = file.language === "typescript" ? parsers.ts?.parser : parsers[extension]?.parser
    if (!parser) continue
    const tree = parser.parse(content)
    if (!tree) continue
    const parent: ParentSymbol = { ref: file.path, qualifiedName: "" }
    if (file.language === "c") {
      for (const node of tree.rootNode.namedChildren) if (node) processC(node, parent, file, content, evidence)
    } else {
      for (const node of tree.rootNode.namedChildren) {
        if (node) anonymous += processTypeScript(node, parent, file, content, evidence)
      }
    }
    tree.delete()
  }

  const unique = deduplicate(evidence)
  const production = unique.filter((item) => item.source.sourceKind !== "test")
  const unknowns: string[] = []
  if (!production.some((item) => item.kind === "source-file")) unknowns.push("未发现生产源码文件")
  if (!production.some((item) => item.kind === "code-symbol")) unknowns.push("未发现受支持的顶层代码符号")
  if (anonymous > 0) unknowns.push(`存在 ${anonymous} 个无法稳定命名的代码声明`)
  return {
    moduleID: module.id,
    sourceSnapshotHash: module.sourceSnapshotHash,
    evidence: unique,
    unknowns,
  }
}

function processTypeScript(
  node: SyntaxNode,
  parent: ParentSymbol,
  file: DesignDocSourceFile,
  content: string,
  evidence: RawCodeStructureEvidence[],
): number {
  if (node.type === "export_statement") {
    const declaration = node.childForFieldName("declaration") ?? children(node).find((child) => supportedTS(child.type))
    return declaration ? processTypeScript(declaration, parent, file, content, evidence) : 0
  }
  const kind = typeScriptKind(node.type)
  if (kind) {
    const name = node.childForFieldName("name")?.text
    if (!name) return 1
    const symbol = addSymbol(node, name, kind, parent, file, content, evidence)
    let anonymous = 0
    if (["class", "interface"].includes(kind)) {
      const body = children(node).find((child) => child.type === "class_body" || child.type === "interface_body")
      for (const member of body?.namedChildren ?? []) {
        if (!member || !methodNode(member)) continue
        const method = methodName(member)
        if (!method) {
          anonymous += 1
          continue
        }
        addSymbol(member, method, "method", symbol, file, content, evidence)
      }
    }
    if (kind === "namespace") {
      const body = node.childForFieldName("body") ?? children(node).at(-1)
      for (const child of body?.namedChildren ?? []) {
        if (child) anonymous += processTypeScript(child, symbol, file, content, evidence)
      }
    }
    return anonymous
  }
  if (node.type === "lexical_declaration" || node.type === "variable_declaration") {
    let anonymous = 0
    for (const declarator of children(node).filter((child) => child.type === "variable_declarator")) {
      const value = declarator.childForFieldName("value")
      if (!value || !["arrow_function", "function_expression"].includes(value.type)) continue
      const name = declarator.childForFieldName("name")?.text
      if (!name) {
        anonymous += 1
        continue
      }
      addSymbol(declarator, name, "function", parent, file, content, evidence)
    }
    return anonymous
  }
  return 0
}

function processC(
  node: SyntaxNode,
  parent: ParentSymbol,
  file: DesignDocSourceFile,
  content: string,
  evidence: RawCodeStructureEvidence[],
) {
  if (["preproc_if", "preproc_ifdef", "preproc_elif", "preproc_else"].includes(node.type)) {
    for (const child of node.namedChildren) if (child) processC(child, parent, file, content, evidence)
    return
  }
  if (node.type === "type_definition") {
    const name = declaratorName(node.childForFieldName("declarator"))
    if (!name) return
    const kind = cTypeKind(node)
    addSymbol(node, name, kind, parent, file, content, evidence)
    return
  }
  if (["struct_specifier", "union_specifier", "enum_specifier"].includes(node.type)) {
    const name = node.childForFieldName("name")?.text
    if (!name) return
    addSymbol(node, name, cTypeKind(node), parent, file, content, evidence)
    return
  }
  if (node.type === "function_definition") {
    const name = functionName(node.childForFieldName("declarator"))
    if (name) addSymbol(node, name, "function", parent, file, content, evidence)
    return
  }
  if (node.type !== "declaration") return
  for (const declarator of directFunctionDeclarators(node)) {
    const name = functionName(declarator)
    if (name) addSymbol(node, name, "function", parent, file, content, evidence)
  }
}

function addSymbol(
  node: SyntaxNode,
  name: string,
  symbolKind: CodeStructureSymbolKind,
  parent: ParentSymbol,
  file: DesignDocSourceFile,
  content: string,
  evidence: RawCodeStructureEvidence[],
): ParentSymbol {
  const startLine = node.startPosition.row + 1
  const endLine = node.endPosition.row + 1
  const qualifiedName = parent.qualifiedName ? `${parent.qualifiedName}.${name}` : name
  const ref = `${file.path}#${qualifiedName}@${startLine}`
  evidence.push({
    kind: "code-symbol",
    fact: `${file.path} 声明 ${symbolKind} ${qualifiedName}`,
    source: {
      path: file.path,
      contentHash: file.contentHash,
      startLine,
      endLine,
      symbol: qualifiedName,
      sourceKind: file.sourceKind,
    },
    attributes: { ref, name, qualifiedName, symbolKind, parentRef: parent.ref },
    confidence: "explicit",
    snippet: content
      .split(/\r?\n/)
      .slice(startLine - 1, Math.min(endLine, startLine + 2))
      .join("\n")
      .trim(),
  })
  return { ref, qualifiedName }
}

function sourceFileEvidence(file: DesignDocSourceFile, content: string): RawCodeStructureEvidence {
  return {
    kind: "source-file",
    fact: `模块包含源码文件 ${file.path}`,
    source: {
      path: file.path,
      contentHash: file.contentHash,
      startLine: 1,
      endLine: 1,
      sourceKind: file.sourceKind,
    },
    attributes: { ref: file.path, language: file.language },
    confidence: "explicit",
    snippet: content.split(/\r?\n/, 1)[0]?.trim() ?? "",
  }
}

function typeScriptKind(type: string): CodeStructureSymbolKind | undefined {
  if (type === "class_declaration" || type === "abstract_class_declaration") return "class"
  if (type === "interface_declaration") return "interface"
  if (type === "type_alias_declaration") return "type"
  if (type === "enum_declaration") return "enum"
  if (type === "function_declaration" || type === "function_signature") return "function"
  if (type === "internal_module" || type === "module") return "namespace"
  return undefined
}

function supportedTS(type: string) {
  return Boolean(typeScriptKind(type)) || type === "lexical_declaration" || type === "variable_declaration"
}

function methodNode(node: SyntaxNode) {
  if (["method_definition", "method_signature", "abstract_method_signature"].includes(node.type)) return true
  if (node.type !== "public_field_definition") return false
  return ["arrow_function", "function_expression"].includes(node.childForFieldName("value")?.type ?? "")
}

function methodName(node: SyntaxNode) {
  return node.childForFieldName("name")?.text
}

function cTypeKind(node: SyntaxNode): CodeStructureSymbolKind {
  const child = node.type === "type_definition" ? node.namedChildren[0] : node
  if (child?.type === "struct_specifier") return "struct"
  if (child?.type === "union_specifier") return "union"
  if (child?.type === "enum_specifier") return "enum"
  return "type"
}

function directFunctionDeclarators(node: SyntaxNode) {
  const values: SyntaxNode[] = []
  const visit = (current: SyntaxNode) => {
    if (current.type === "function_declarator") {
      values.push(current)
      return
    }
    if (["parameter_list", "struct_specifier", "union_specifier", "enum_specifier"].includes(current.type)) return
    for (const child of current.namedChildren) if (child) visit(child)
  }
  for (const child of node.namedChildren) if (child) visit(child)
  return values
}

function functionName(node: SyntaxNode | null) {
  if (!node) return undefined
  if (node.type === "function_declarator") {
    const declarator = node.childForFieldName("declarator")
    return declarator?.type === "identifier" ? declarator.text : undefined
  }
  return functionName(node.childForFieldName("declarator"))
}

function declaratorName(node: SyntaxNode | null): string | undefined {
  if (!node) return undefined
  if (["type_identifier", "identifier"].includes(node.type)) return node.text
  return declaratorName(node.childForFieldName("declarator"))
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
      throw new DesignDocDiscoveryError("SOURCE_CHANGED", `源码文件在代码结构证据提取前发生变化：${file.path}`)
    }
    return content.toString("utf8")
  } finally {
    await handle.close()
  }
}

function deduplicate(items: RawCodeStructureEvidence[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = [item.kind, item.source.path, item.source.startLine, item.fact].join(":")
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function children(node: SyntaxNode) {
  return node.namedChildren.filter((child): child is SyntaxNode => child !== null)
}
