import * as fs from "fs"
import * as path from "path"
import { pathToFileURL } from "url"

const dir = "tree-sitter"
const runtime = "tree-sitter.wasm"
const lancedb = "lancedb"
const lancedbEntry = ["node_modules", "@lancedb", "lancedb", "dist", "index.js"]
const codegraph = "codegraph-parser-worker.mjs"

function paths(file: string) {
  if (/^[a-z]:[\\/]/i.test(file) || file.includes("\\")) return path.win32
  return path
}

export function treeSitterDirForBinary(file: string): string {
  const p = paths(file)
  return p.join(p.dirname(file), dir)
}

export function treeSitterDirForExtension(root: string): string {
  return paths(root).join(root, "bin", dir)
}

export function resolveTreeSitterEnv(root: string): Record<string, string> {
  return { KILO_TREE_SITTER_WASM_DIR: treeSitterDirForExtension(root) }
}

export function lancedbDirForExtension(root: string): string {
  return paths(root).join(root, "bin", lancedb)
}

export function lancedbEntryForExtension(root: string): string {
  return paths(root).join(lancedbDirForExtension(root), ...lancedbEntry)
}

export function resolveLanceDBEnv(root: string): Record<string, string> {
  const file = lancedbEntryForExtension(root)
  if (!fs.existsSync(file)) return {}
  return { KILO_LANCEDB_PATH: pathToFileURL(file).href }
}

export function hasTreeSitterResources(file: string): boolean {
  return fs.existsSync(path.join(treeSitterDirForBinary(file), runtime))
}

export function codeGraphParserWorkerForBinary(file: string): string {
  return paths(file).join(paths(file).dirname(file), codegraph)
}

export function hasCodeGraphParserWorker(file: string): boolean {
  return fs.existsSync(codeGraphParserWorkerForBinary(file))
}

export function indexingProcessForBinary(file: string): string {
  const p = paths(file)
  const name = p.extname(file).toLowerCase() === ".exe" ? "kilo-indexer.exe" : "kilo-indexer"
  return p.join(p.dirname(file), name)
}

export function hasIndexingProcess(file: string): boolean {
  return fs.existsSync(indexingProcessForBinary(file))
}

export async function copyIndexingProcess(source: string, target: string): Promise<void> {
  const from = indexingProcessForBinary(source)
  const to = indexingProcessForBinary(target)
  if (!fs.existsSync(from)) throw new Error(`CLI indexing process not found at ${from}`)
  await fs.promises.copyFile(from, to)
  if (path.extname(to).toLowerCase() !== ".exe") await fs.promises.chmod(to, 0o755)
}

export async function copyCodeGraphParserWorker(source: string, target: string): Promise<void> {
  const from = codeGraphParserWorkerForBinary(source)
  if (!fs.existsSync(from)) {
    throw new Error(`CLI CodeGraph parser worker not found at ${from}`)
  }

  await fs.promises.copyFile(from, codeGraphParserWorkerForBinary(target))
}

export async function copyTreeSitterResources(source: string, target: string): Promise<void> {
  const from = treeSitterDirForBinary(source)
  const to = treeSitterDirForBinary(target)

  if (!fs.existsSync(path.join(from, runtime))) {
    throw new Error(`CLI tree-sitter resources not found at ${from}`)
  }

  await fs.promises.rm(to, { recursive: true, force: true })
  await fs.promises.cp(from, to, { recursive: true })
}
