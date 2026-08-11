import * as fs from "fs"
import * as crypto from "crypto"
import * as os from "os"
import * as path from "path"
import { pathToFileURL } from "url"

const dir = "tree-sitter"
const runtime = "tree-sitter.wasm"
const lancedb = "lancedb"
const lancedbEntry = ["node_modules", "@lancedb", "lancedb", "dist", "index.js"]
const codegraph = "codegraph-parser-worker.mjs"
const chipmateSandboxWorker = "chipmate-sandbox-mutation-worker.js"
const bwrap = "bwrap"
const bwrapLicense = path.join("licenses", "bubblewrap")
const bwrapLicenseFiles = ["NOTICE", "COPYING", "MUSL-COPYRIGHT", "build.ts"]
const sandboxNetworkFiles = ["chipmate-sandbox-network-relay.js", "chipmate-sandbox-seccomp"]
const sandboxRuntimeLicense = path.join("licenses", "sandbox-runtime")

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
  return { CHIPMATE_TREE_SITTER_WASM_DIR: treeSitterDirForExtension(root) }
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
  return { CHIPMATE_LANCEDB_PATH: pathToFileURL(file).href }
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
  const name = p.extname(file).toLowerCase() === ".exe" ? "chipmate-indexer.exe" : "chipmate-indexer"
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

export function chipmateSandboxWorkerForBinary(file: string): string {
  const p = paths(file)
  return p.join(p.dirname(file), chipmateSandboxWorker)
}

export function hasChipMateSandboxWorker(file: string): boolean {
  return fs.existsSync(chipmateSandboxWorkerForBinary(file))
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

export async function copySandboxResources(source: string, target: string): Promise<void> {
  const from = path.dirname(source)
  const to = path.dirname(target)
  const helper = path.join(to, bwrap)
  const destination = path.join(to, bwrapLicense)
  await fs.promises.rm(helper, { force: true })
  await fs.promises.rm(destination, { recursive: true, force: true })
  await Promise.all(sandboxNetworkFiles.map((file) => fs.promises.rm(path.join(to, file), { force: true })))
  await fs.promises.rm(path.join(to, sandboxRuntimeLicense), { recursive: true, force: true })

  for (const file of sandboxNetworkFiles) {
    const input = path.join(from, file)
    if (!fs.existsSync(input)) continue
    const output = path.join(to, file)
    await fs.promises.copyFile(input, output)
    if (file === "chipmate-sandbox-seccomp") await fs.promises.chmod(output, 0o755)
  }
  const runtimeLicense = path.join(from, sandboxRuntimeLicense)
  if (fs.existsSync(runtimeLicense)) {
    await fs.promises.cp(runtimeLicense, path.join(to, sandboxRuntimeLicense), { recursive: true })
  }

  const executable = path.join(from, bwrap)
  if (!fs.existsSync(executable)) return
  await fs.promises.copyFile(executable, helper)
  await fs.promises.chmod(helper, 0o755)

  const licenses = path.join(from, bwrapLicense)
  if (!fs.existsSync(licenses)) return
  await fs.promises.cp(licenses, destination, { recursive: true })
}

export async function copyChipMateSandboxWorker(source: string, target: string): Promise<void> {
  const from = chipmateSandboxWorkerForBinary(source)
  const to = chipmateSandboxWorkerForBinary(target)
  if (!fs.existsSync(from)) throw new Error(`ChipMate sandbox mutation worker not found at ${from}`)
  await fs.promises.copyFile(from, to)
}

function cacheRoot() {
  const root = process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache")
  return path.join(root, "chipmate-vscode", "bwrap")
}

function bwrapLicenseDir(bin: string) {
  return path.join(bin, bwrapLicense)
}

function hasBwrapSource(dir: string) {
  try {
    return fs.readdirSync(dir).some((file) => /^bubblewrap-[a-f0-9]+\.tar\.gz$/.test(file))
  } catch {
    return false
  }
}

function hasProductionBwrap(bin: string) {
  const executable = path.join(bin, bwrap)
  const dir = bwrapLicenseDir(bin)
  try {
    const entry = fs.statSync(executable)
    if (!entry.isFile()) return false
    if (!bwrapLicenseFiles.every((file) => fs.existsSync(path.join(dir, file)))) return false
    return hasBwrapSource(dir)
  } catch {
    return false
  }
}

export function localBwrapPath(target: string, root = cacheRoot()): string | undefined {
  if (target !== "linux-x64" && target !== "linux-arm64") return undefined
  return path.join(root, target, bwrap)
}

export function localBwrapDigest(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")
}

export function validLocalBwrap(file: string): boolean {
  try {
    const entry = fs.lstatSync(file)
    if (entry.isSymbolicLink() || !entry.isFile() || (entry.mode & 0o6000) !== 0) return false
    if ((entry.mode & 0o022) !== 0 || (entry.mode & 0o111) === 0) return false
    const digest = fs.readFileSync(`${file}.sha256`, "utf8").trim()
    if (!/^[a-f0-9]{64}$/.test(digest)) return false
    return localBwrapDigest(file) === digest
  } catch {
    return false
  }
}

export function resolveLocalBwrapEnv(
  extension: string,
  local: boolean,
  target = `${process.platform === "win32" ? "win32" : process.platform}-${process.arch}`,
  root?: string,
): Record<string, string> {
  if (hasProductionBwrap(path.join(extension, "bin"))) return {}
  if (!local) return {}

  const executable = localBwrapPath(target, root)
  if (!executable || !validLocalBwrap(executable)) return {}
  return { CHIPMATE_BWRAP_PATH: executable }
}

export async function sanitizeSandboxResources(bin: string, local: boolean): Promise<boolean> {
  if (hasProductionBwrap(bin)) return true
  if (!local) return false

  await fs.promises.rm(path.join(bin, bwrap), { force: true })
  await fs.promises.rm(bwrapLicenseDir(bin), { recursive: true, force: true })
  return false
}
