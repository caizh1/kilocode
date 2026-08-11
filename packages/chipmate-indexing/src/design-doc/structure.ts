import { createHash } from "crypto"
import { constants } from "fs"
import { open } from "fs/promises"
import path from "path"
import type { Node as SyntaxNode } from "web-tree-sitter"
import { loadRequiredLanguageParsers } from "../tree-sitter/languageParser"
import type { DiscoveredDesignDocModule, RawStructureEvidence, StructureExtractionResult } from "./types"
import { DesignDocDiscoveryError } from "./types"

export async function extractStructureEvidence(module: DiscoveredDesignDocModule): Promise<StructureExtractionResult> {
  const parsers = await loadRequiredLanguageParsers(module.files.map((file) => file.absolutePath))
  const files = new Map(module.files.map((file) => [path.normalize(file.absolutePath), file]))
  const evidence: RawStructureEvidence[] = []

  for (const file of module.files) {
    const content = await readVerifiedSource(file)
    evidence.push(sourceFileEvidence(file, content))
    const extension = path.extname(file.absolutePath).slice(1).toLowerCase()
    const parser = file.language === "typescript" ? parsers.ts?.parser : parsers[extension]?.parser
    if (!parser) continue
    const tree = parser.parse(content)
    if (!tree) continue
    visit(tree.rootNode, (node) => {
      const dependency = dependencyFromNode(node, file.language)
      if (!dependency) return
      const target = resolveDependency(file.absolutePath, dependency.specifier, files)
      evidence.push(
        makeDependencyEvidence(node, content, file, {
          from: file.path,
          to: target?.path ?? dependency.specifier,
          dependencyKind: dependency.kind,
          internal: Boolean(target),
        }),
      )
    })
    tree.delete()
  }

  const unique = deduplicate(evidence)
  const production = unique.filter((item) => item.source.sourceKind !== "test")
  const unknowns: string[] = []
  if (!production.some((item) => item.kind === "source-file")) unknowns.push("未发现生产源码文件")
  if (!production.some((item) => item.kind === "dependency")) unknowns.push("未发现可由源码直接证明的文件依赖")
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
      throw new DesignDocDiscoveryError("SOURCE_CHANGED", `源码文件在结构证据提取前发生变化：${file.path}`)
    }
    return content.toString("utf8")
  } finally {
    await handle.close()
  }
}

function sourceFileEvidence(file: DiscoveredDesignDocModule["files"][number], content: string): RawStructureEvidence {
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

function dependencyFromNode(node: SyntaxNode, language: DiscoveredDesignDocModule["files"][number]["language"]) {
  if (language === "c" && node.type === "preproc_include") {
    const match = node.text.match(/^\s*#\s*include\s*[<"]([^>"]+)[>"]/)
    return match?.[1] ? { specifier: match[1], kind: "include" } : undefined
  }
  if (
    (language === "typescript" || language === "tsx") &&
    ["import_statement", "export_statement"].includes(node.type)
  ) {
    const source = node.childForFieldName("source")
    if (source?.type !== "string" || source.text.length < 2) return undefined
    return { specifier: source.text.slice(1, -1), kind: "import" }
  }
  return undefined
}

function resolveDependency(
  source: string,
  specifier: string,
  files: Map<string, DiscoveredDesignDocModule["files"][number]>,
) {
  if (!specifier.startsWith(".")) {
    return files.get(path.normalize(path.resolve(path.dirname(source), specifier)))
  }
  const target = path.resolve(path.dirname(source), specifier)
  const withoutJavaScriptExtension = target.replace(/\.(mjs|cjs|js|jsx)$/, "")
  for (const candidate of [
    target,
    withoutJavaScriptExtension,
    `${target}.ts`,
    `${target}.tsx`,
    `${withoutJavaScriptExtension}.ts`,
    `${withoutJavaScriptExtension}.tsx`,
    `${target}.c`,
    `${target}.h`,
    path.join(target, "index.ts"),
    path.join(target, "index.tsx"),
  ]) {
    const file = files.get(path.normalize(candidate))
    if (file) return file
  }
  return undefined
}

function makeDependencyEvidence(
  node: SyntaxNode,
  content: string,
  file: DiscoveredDesignDocModule["files"][number],
  attributes: Record<string, string | number | boolean | null>,
): RawStructureEvidence {
  const startLine = node.startPosition.row + 1
  const endLine = node.endPosition.row + 1
  return {
    kind: "dependency",
    fact: `${attributes.from} 依赖 ${attributes.to}`,
    source: {
      path: file.path,
      contentHash: file.contentHash,
      startLine,
      endLine,
      sourceKind: file.sourceKind,
    },
    attributes,
    confidence: "explicit",
    snippet: content
      .split(/\r?\n/)
      .slice(startLine - 1, endLine)
      .join("\n")
      .trim(),
  }
}

function visit(node: SyntaxNode, callback: (node: SyntaxNode) => void) {
  callback(node)
  for (const child of node.namedChildren) if (child) visit(child, callback)
}

function deduplicate(items: RawStructureEvidence[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = [item.kind, item.source.path, item.source.startLine, item.fact].join(":")
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
