import { join } from "node:path"
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs"

const root = join(import.meta.dir, "..", "..", "..")
const store = join(root, "node_modules", ".bun", "node_modules")
const baseModules = [
  "@lancedb/lancedb",
  "@opentelemetry/api",
  "apache-arrow",
  "flatbuffers",
  "reflect-metadata",
  "tslib",
] as const

const nativeModules: Record<string, { module: string; binary: string }> = {
  "darwin-arm64": {
    module: "@lancedb/lancedb-darwin-arm64",
    binary: "lancedb.darwin-arm64.node",
  },
  "win32-x64": {
    module: "@lancedb/lancedb-win32-x64-msvc",
    binary: "lancedb.win32-x64-msvc.node",
  },
  "win32-arm64": {
    module: "@lancedb/lancedb-win32-arm64-msvc",
    binary: "lancedb.win32-arm64-msvc.node",
  },
  "linux-x64": {
    module: "@lancedb/lancedb-linux-x64-gnu",
    binary: "lancedb.linux-x64-gnu.node",
  },
}

export type LanceDBNativeOverrides = Partial<Record<keyof typeof nativeModules, string>>

export function lancedbRuntimeDir(bin: string): string {
  return join(bin, "lancedb")
}

export function lancedbRuntimeEntry(bin: string): string {
  return join(lancedbRuntimeDir(bin), "node_modules", "@lancedb", "lancedb", "dist", "index.js")
}

export async function copyLanceDBRuntime(
  bin: string,
  target = "win32-x64",
  extras: string[] = [],
  overrides: LanceDBNativeOverrides = configuredOverrides(),
): Promise<void> {
  const targets = [target, ...extras]
  const natives = targets.map((item) => nativeModules[item])
  const missing = targets.find((_, index) => !natives[index])
  if (missing) throw new Error(`Unsupported LanceDB runtime target for internal packaging: ${missing}`)
  const dir = lancedbRuntimeDir(bin)
  const dest = join(dir, "node_modules")
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })

  for (const name of [...baseModules, ...natives.map((native) => native.module)]) copy(name, dest)
  for (const [index, native] of natives.entries()) {
    const override = overrides[targets[index] as keyof typeof nativeModules]
    if (override) replaceNative(dir, native, override, targets[index]!)
  }
  prune(dir)
  for (const native of natives) verify(bin, native)
}

function configuredOverrides(): LanceDBNativeOverrides {
  const windows = process.env.KILO_INTERNAL_LANCEDB_WIN32_X64_BINARY?.trim()
  return windows ? { "win32-x64": windows } : {}
}

function replaceNative(dir: string, native: { module: string; binary: string }, source: string, target: string): void {
  if (!existsSync(source) || !statSync(source).isFile()) {
    throw new Error(`Configured LanceDB native override is not a file: ${source}`)
  }
  verifyWindowsBinary(source, target)
  const destination = join(dir, "node_modules", ...parts(native.module), native.binary)
  const original = statSync(destination).size
  const replacement = statSync(source).size
  if (replacement >= original) {
    throw new Error(
      `Configured LanceDB native override must be smaller than the upstream binary: ${replacement} >= ${original}`,
    )
  }
  cpSync(source, destination)
  console.log(`  ✅ Applied audited LanceDB ${target} local-only native override (${replacement} bytes)`)
}

function verifyWindowsBinary(file: string, target: string): void {
  if (!target.startsWith("win32-")) return
  const handle = openSync(file, "r")
  try {
    const dos = Buffer.alloc(64)
    if (readSync(handle, dos, 0, dos.length, 0) !== dos.length || dos.subarray(0, 2).toString("ascii") !== "MZ") {
      throw new Error(`Configured LanceDB native override is not a Windows PE binary: ${file}`)
    }
    const offset = dos.readUInt32LE(60)
    const pe = Buffer.alloc(6)
    if (readSync(handle, pe, 0, pe.length, offset) !== pe.length || pe.subarray(0, 4).toString("binary") !== "PE\0\0") {
      throw new Error(`Configured LanceDB native override has an invalid PE header: ${file}`)
    }
    const expected = target === "win32-x64" ? 0x8664 : 0xaa64
    if (pe.readUInt16LE(4) !== expected) {
      throw new Error(`Configured LanceDB native override architecture does not match ${target}: ${file}`)
    }
  } finally {
    closeSync(handle)
  }
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

function verify(bin: string, native: { module: string; binary: string }): void {
  const runtimePackage = join(lancedbRuntimeDir(bin), "node_modules", "@lancedb", "lancedb", "package.json")
  const nativePackage = join(lancedbRuntimeDir(bin), "node_modules", ...parts(native.module), "package.json")
  const required = [
    runtimePackage,
    nativePackage,
    lancedbRuntimeEntry(bin),
    join(lancedbRuntimeDir(bin), "node_modules", "@lancedb", "lancedb", "dist", "native.js"),
    join(lancedbRuntimeDir(bin), "node_modules", ...parts(native.module), native.binary),
    join(lancedbRuntimeDir(bin), "node_modules", "@opentelemetry", "api", "build", "src", "index.js"),
    join(lancedbRuntimeDir(bin), "node_modules", "apache-arrow", "Arrow.node.js"),
    join(lancedbRuntimeDir(bin), "node_modules", "flatbuffers", "js", "flatbuffers.js"),
    join(lancedbRuntimeDir(bin), "node_modules", "reflect-metadata", "Reflect.js"),
    join(lancedbRuntimeDir(bin), "node_modules", "tslib", "tslib.js"),
  ]

  for (const file of required) {
    if (!existsSync(file)) throw new Error(`Bundled LanceDB runtime missing required file: ${file}`)
  }

  const runtimeVersion = JSON.parse(readFileSync(runtimePackage, "utf8")).version
  const nativeVersion = JSON.parse(readFileSync(nativePackage, "utf8")).version
  if (runtimeVersion !== nativeVersion) {
    throw new Error(
      `Bundled LanceDB runtime version mismatch: @lancedb/lancedb=${runtimeVersion}, ${native.module}=${nativeVersion}. Run bun install with matching --os and --cpu before packaging.`,
    )
  }
}
