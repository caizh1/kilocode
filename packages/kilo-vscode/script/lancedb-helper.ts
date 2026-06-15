import { join } from "node:path"
import { cpSync, existsSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs"

const root = join(import.meta.dir, "..", "..", "..")
const store = join(root, "node_modules", ".bun", "node_modules")
const modules = [
  "@lancedb/lancedb",
  "@lancedb/lancedb-win32-x64-msvc",
  "apache-arrow",
  "flatbuffers",
  "reflect-metadata",
  "tslib",
] as const

export function lancedbRuntimeDir(bin: string): string {
  return join(bin, "lancedb")
}

export function lancedbRuntimeEntry(bin: string): string {
  return join(lancedbRuntimeDir(bin), "node_modules", "@lancedb", "lancedb", "dist", "index.js")
}

export async function copyLanceDBRuntime(bin: string): Promise<void> {
  const dir = lancedbRuntimeDir(bin)
  const dest = join(dir, "node_modules")
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })

  for (const name of modules) copy(name, dest)
  prune(dir)
  verify(bin)
}

function copy(name: string, dest: string): void {
  const src = resolve(name)
  const out = join(dest, ...parts(name))
  mkdirSync(join(out, ".."), { recursive: true })
  cpSync(src, out, { recursive: true, dereference: true })
}

function resolve(name: string): string {
  const src = join(store, ...parts(name))
  if (!existsSync(join(src, "package.json"))) {
    throw new Error(`LanceDB runtime package is missing: ${name}. Run bun install before packaging.`)
  }
  return realpathSync(src)
}

function parts(name: string): string[] {
  return name.startsWith("@") ? name.split("/") : [name]
}

function prune(dir: string): void {
  for (const item of readdirSync(dir)) {
    const file = join(dir, item)
    const stat = statSync(file)
    if (stat.isDirectory()) {
      prune(file)
      continue
    }
    if (file.endsWith(".map")) rmSync(file, { force: true })
  }
}

function verify(bin: string): void {
  const required = [
    lancedbRuntimeEntry(bin),
    join(lancedbRuntimeDir(bin), "node_modules", "@lancedb", "lancedb", "dist", "native.js"),
    join(lancedbRuntimeDir(bin), "node_modules", "@lancedb", "lancedb-win32-x64-msvc", "lancedb.win32-x64-msvc.node"),
    join(lancedbRuntimeDir(bin), "node_modules", "apache-arrow", "Arrow.node.js"),
    join(lancedbRuntimeDir(bin), "node_modules", "flatbuffers", "js", "flatbuffers.js"),
    join(lancedbRuntimeDir(bin), "node_modules", "reflect-metadata", "Reflect.js"),
    join(lancedbRuntimeDir(bin), "node_modules", "tslib", "tslib.js"),
  ]

  for (const file of required) {
    if (!existsSync(file)) throw new Error(`Bundled LanceDB runtime missing required file: ${file}`)
  }
}
