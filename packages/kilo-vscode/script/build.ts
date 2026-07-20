#!/usr/bin/env bun
import { $ } from "bun"
import { join } from "node:path"
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs"
import {
  copyCodeGraphParserWorker,
  copyIndexingProcess,
  copyKiloSandboxWorker,
  copySandboxResources,
  copyTreeSitterResources,
  indexingProcessForBinary,
} from "../src/services/cli-backend/cli-resources"
import { ensureFfmpegForTarget } from "./ffmpeg-helper"
import { ensureRipgrepForTarget } from "./ripgrep-helper"
import { copyLanceDBRuntime } from "./lancedb-helper"
import { ensurePopplerForTarget } from "./poppler-helper"
import {
  applyPackagedChipmateServer,
  resolvePackagedChipmateServer,
  restorePackagedManifest,
  type PackagedChipmateServerDefaults,
} from "./chipmate-server-defaults"

type Target = {
  target: string
  cliDir: string
  binary: string
  vsceTarget?: string
  internal?: boolean
}

const packageJsonPath = join(import.meta.dir, "..", "package.json")
const rootDir = join(import.meta.dir, "..", "..", "..")
const cleanPackageJson = await Bun.file(packageJsonPath).text()
const packageJson = JSON.parse(cleanPackageJson)
const version = process.env.KILO_VERSION ? process.env.KILO_VERSION : packageJson.version
const prerelease = process.env.KILO_PRE_RELEASE === "true"
const internal = process.argv.includes("--internal-offline") || process.env.CHIPMATE_INTERNAL_OFFLINE === "1"
const targetsArg = process.argv.find((arg) => arg.startsWith("--targets="))?.slice("--targets=".length)
const requested = targetsArg
  ? new Set(
      targetsArg
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    )
  : undefined

console.log(`Building VSCode extension version: ${version}${prerelease ? " (pre-release)" : ""}`)
if (internal) console.log("Using internal offline baseline build mode")

if (packageJson.version !== version) {
  console.log(`Updating package.json version from ${packageJson.version} to ${version}`)
  packageJson.version = version
}
const render = await localRenderDefaults(rootDir)
const indexing = await localIndexingDefaults(rootDir)
const marketplace = await localMarketplaceDefaults(rootDir)
const chipmate = await localChipmateServerDefaults(rootDir, render, marketplace)
const hasLocalPackagedDefaults = Boolean(chipmate.baseUrl || indexing.openaiCompatibleBaseUrl)

const cliDistDir = process.env.CLI_DIST_DIR || join(import.meta.dir, "..", "..", "opencode", "dist")
console.log(`Using CLI dist directory: ${cliDistDir}`)

if (!existsSync(cliDistDir)) {
  throw new Error(`CLI dist directory not found: ${cliDistDir}`)
}

const publicTargets: Target[] = [
  { target: "linux-x64", cliDir: "@kilocode/cli-linux-x64", binary: "kilo" },
  { target: "linux-arm64", cliDir: "@kilocode/cli-linux-arm64", binary: "kilo" },
  { target: "alpine-x64", cliDir: "@kilocode/cli-linux-x64-musl", binary: "kilo" },
  { target: "alpine-arm64", cliDir: "@kilocode/cli-linux-arm64-musl", binary: "kilo" },
  { target: "darwin-x64", cliDir: "@kilocode/cli-darwin-x64", binary: "kilo" },
  { target: "darwin-arm64", cliDir: "@kilocode/cli-darwin-arm64", binary: "kilo" },
  { target: "win32-x64", cliDir: "@kilocode/cli-windows-x64", binary: "kilo.exe" },
  { target: "win32-arm64", cliDir: "@kilocode/cli-windows-arm64", binary: "kilo.exe" },
]
const internalTargets: Target[] = [
  {
    target: "win32-x64-baseline",
    cliDir: "@kilocode/cli-windows-x64-baseline",
    binary: "kilo.exe",
    vsceTarget: "win32-x64",
    internal: true,
  },
]
const extras: Target[] = [
  {
    target: "darwin-arm64",
    cliDir: "@kilocode/cli-darwin-arm64",
    binary: "kilo",
    internal: true,
  },
  {
    target: "linux-x64",
    cliDir: "@kilocode/cli-linux-x64",
    binary: "kilo",
    internal: true,
  },
  {
    target: "linux-x64-baseline",
    cliDir: "@kilocode/cli-linux-x64-baseline",
    binary: "kilo",
    vsceTarget: "linux-x64",
    internal: true,
  },
]
const available = internal ? [...internalTargets, ...extras] : publicTargets
const targets = requested
  ? available.filter((item) => requested.has(item.target))
  : internal
    ? internalTargets
    : available
if (requested && targets.length === 0) throw new Error(`No VSIX targets matched --targets=${targetsArg}`)

const binDir = join(import.meta.dir, "..", "bin")
const distDir = join(import.meta.dir, "..", "dist")
const outDir = join(import.meta.dir, "..", "out")
const vsceBin = join(import.meta.dir, "..", "node_modules", ".bin", process.platform === "win32" ? "vsce.cmd" : "vsce")
const vsce = existsSync(vsceBin) ? vsceBin : "vsce"

console.log("\n🧹 Cleaning up directories...")
for (const dir of [binDir, distDir, outDir]) {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
    console.log(`  ✓ Cleaned ${dir}`)
  }
}

mkdirSync(outDir, { recursive: true })
mkdirSync(distDir, { recursive: true })

console.log("\n🔄 Rebuilding SDK types (ensures dist/ is in sync with server API)...")
await $`bun run --cwd ${join(import.meta.dir, "..", "..", "sdk", "js")} build`

console.log("\n📦 Compiling extension...")
await $`bun run check-types`
await $`bun run lint`
const esbuildArgs = internal ? ["--production", "--internal-offline"] : ["--production"]
await $`node ${join(import.meta.dir, "..", "esbuild.js")} ${esbuildArgs}`.env({
  ...process.env,
  ...(internal && { CHIPMATE_INTERNAL_OFFLINE: "1" }),
  ...(internal &&
    indexing.openaiCompatibleBaseUrl && {
      KILO_INTERNAL_INDEXING_OPENAI_COMPATIBLE_BASE_URL: indexing.openaiCompatibleBaseUrl,
    }),
})
removeMaps(distDir)

try {
  if (hasLocalPackagedDefaults) {
    applyPackagedChipmateServer(packageJson, chipmate)
    applyIndexingDefaults(packageJson, indexing)
    applyMarketplaceDefaults(packageJson, { baseUrl: chipmate.marketplace })
    await Bun.write(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n")
    console.log("Using local defaults for packaged VSIX manifest.")
  }

  for (const config of targets) {
    console.log(`\n🎯 Processing target: ${config.target}`)
    packageJson.chipmatePackageTarget = config.target
    await Bun.write(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n")

    if (existsSync(binDir)) {
      rmSync(binDir, { recursive: true, force: true })
    }
    mkdirSync(binDir, { recursive: true })

    const sourceBinary = join(cliDistDir, config.cliDir, "bin", config.binary)
    const targetBinary = join(binDir, config.binary)
    const sourceSnapshot = join(cliDistDir, config.cliDir, "bin", "models-snapshot.json")
    const targetSnapshot = join(binDir, "models-snapshot.json")

    if (!existsSync(sourceBinary)) {
      throw new Error(`CLI binary not found at ${sourceBinary}`)
    }
    if (!existsSync(sourceSnapshot)) {
      throw new Error(`CLI models snapshot not found at ${sourceSnapshot}`)
    }

    console.log(`  📥 Copying binary from ${config.cliDir}/bin/${config.binary}...`)
    await $`cp ${sourceBinary} ${targetBinary}`
    await $`cp ${sourceSnapshot} ${targetSnapshot}`
    await copyTreeSitterResources(sourceBinary, targetBinary)
    await copyCodeGraphParserWorker(sourceBinary, targetBinary)
    await copyIndexingProcess(sourceBinary, targetBinary)
    await copySandboxResources(sourceBinary, targetBinary)
    await copyKiloSandboxWorker(sourceBinary, targetBinary)

    if (config.binary !== "kilo.exe") {
      chmodSync(targetBinary, 0o755)
    }

    console.log(`  ✅ Binary ready at ${targetBinary}`)

    if (config.internal) {
      console.log("Skipping bundled FFmpeg helper for internal no-audio package...")
    } else {
      console.log("Adding bundled FFmpeg helper...")
      await ensureFfmpegForTarget(config.target, binDir)
    }

    console.log("Adding bundled ripgrep helper...")
    await ensureRipgrepForTarget(config.vsceTarget ?? config.target, binDir)

    if (config.internal) {
      console.log("Adding bundled LanceDB runtime...")
      await copyLanceDBRuntime(binDir, config.vsceTarget ?? config.target)
      console.log("Adding bundled Poppler pdftotext helper...")
      await ensurePopplerForTarget(config.vsceTarget ?? config.target, binDir)
    }

    console.log(`  📦 Packaging .vsix for ${config.target}${prerelease ? " (pre-release)" : ""}...`)
    const vsixPath = join(outDir, `kilo-vscode-${config.target}.vsix`)
    const args = ["--no-dependencies", "--skip-license", "--target", config.vsceTarget ?? config.target, "-o", vsixPath]
    if (prerelease) args.push("--pre-release")
    await $`${vsce} package ${args}`.env({
      ...process.env,
      npm_config_ignore_scripts: "true",
    })
    await verifyPackageTarget(vsixPath, config.target)
    if (chipmate.baseUrl) await verifyChipmateServer(vsixPath, chipmate)
    if (config.internal) {
      await verifyInternalVsix(vsixPath, config)
      await verifyInternalModelsSnapshot(vsixPath)
      await verifyInternalMarketplaceManifest(vsixPath)
    }
    console.log(`  ✅ Created ${vsixPath}`)
  }
} finally {
  await restorePackagedManifest(packageJsonPath, cleanPackageJson)
  console.log("Restored package.json after packaging.")
}

console.log("\n✨ All VSIX packages built successfully!")

type RenderDefaults = {
  word?: string
  mermaid?: string
}

type IndexingDefaults = {
  openaiCompatibleBaseUrl?: string
}

type MarketplaceDefaults = {
  baseUrl?: string
}

async function localRenderDefaults(root: string): Promise<RenderDefaults> {
  const env = await localEnv(join(root, ".env.local"))
  const json = await localJson(join(root, ".kilo-render-defaults.local.json"))
  const base =
    trim(process.env.CHIPMATE_RENDER_SERVICE_BASE_URL) || trim(env.CHIPMATE_RENDER_SERVICE_BASE_URL) || trim(json.base)
  return {
    word:
      trim(process.env.KILO_WORD_RENDER_ENDPOINT) ||
      trim(env.KILO_WORD_RENDER_ENDPOINT) ||
      trim(json.word) ||
      route(base, "word"),
    mermaid:
      trim(process.env.KILO_MERMAID_RENDER_ENDPOINT) ||
      trim(env.KILO_MERMAID_RENDER_ENDPOINT) ||
      trim(json.mermaid) ||
      route(base, "mermaid"),
  }
}

async function localIndexingDefaults(root: string): Promise<IndexingDefaults> {
  const env = await localEnv(join(root, ".env.local"))
  const json = await localJson(join(root, ".kilo-render-defaults.local.json"))
  return {
    openaiCompatibleBaseUrl:
      trim(process.env.KILO_INTERNAL_INDEXING_OPENAI_COMPATIBLE_BASE_URL) ||
      trim(env.KILO_INTERNAL_INDEXING_OPENAI_COMPATIBLE_BASE_URL) ||
      trim(json.indexing?.openaiCompatibleBaseUrl),
  }
}

async function localMarketplaceDefaults(root: string): Promise<MarketplaceDefaults> {
  const env = await localEnv(join(root, ".env.local"))
  const json = await localJson(join(root, ".kilo-render-defaults.local.json"))
  return {
    baseUrl:
      trim(process.env.KILO_MARKETPLACE_BASE_URL) ||
      trim(env.KILO_MARKETPLACE_BASE_URL) ||
      trim(json.marketplace?.baseUrl),
  }
}

async function localChipmateServerDefaults(
  root: string,
  render: RenderDefaults,
  marketplace: MarketplaceDefaults,
): Promise<PackagedChipmateServerDefaults> {
  const env = await localEnv(join(root, ".env.local"))
  const json = await localJson(join(root, ".kilo-render-defaults.local.json"))
  return resolvePackagedChipmateServer({
    baseUrl:
      trim(process.env.CHIPMATE_SERVER_BASE_URL) ||
      trim(env.CHIPMATE_SERVER_BASE_URL) ||
      trim(json.chipmateServer?.baseUrl),
    marketplace: marketplace.baseUrl,
    word: render.word,
    mermaid: render.mermaid,
  })
}

async function localEnv(file: string): Promise<Record<string, string>> {
  if (!existsSync(file)) return {}
  const text = await Bun.file(file).text()
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=")
        const key = line.slice(0, index).trim()
        const raw = line.slice(index + 1).trim()
        const value = raw.replace(/^['"]|['"]$/g, "")
        return [key, value]
      }),
  )
}

async function localJson(file: string): Promise<
  RenderDefaults & {
    base?: string
    indexing?: IndexingDefaults
    marketplace?: MarketplaceDefaults
    chipmateServer?: { baseUrl?: string }
  }
> {
  if (!existsSync(file)) return {}
  const data = await Bun.file(file).json()
  const legacy = trim(data.wordRender?.remoteEndpoint)
  return {
    base: trim(data.renderService?.baseUrl) || trim(data.renderService?.remoteEndpoint) || serviceBase(legacy),
    word: endpoint(trim(data.wordRender?.endpoint) || legacy, "word"),
    mermaid: endpoint(trim(data.mermaidRender?.endpoint) || trim(data.mermaidRender?.remoteEndpoint), "mermaid"),
    indexing: {
      openaiCompatibleBaseUrl:
        trim(data.indexing?.openaiCompatible?.baseUrl) || trim(data.indexing?.openaiCompatibleBaseUrl),
    },
    marketplace: {
      baseUrl: trim(data.marketplace?.baseUrl),
    },
    chipmateServer: {
      baseUrl: trim(data.chipmateServer?.baseUrl),
    },
  }
}

function applyIndexingDefaults(pkg: typeof packageJson, indexing: IndexingDefaults): void {
  const props = pkg.contributes?.configuration?.properties
  if (!props)
    throw new Error("Cannot inject local indexing defaults: package.json configuration properties are missing.")
  if (indexing.openaiCompatibleBaseUrl) {
    props["chipmate.v2.indexing.openaiCompatible.baseUrl"].default = indexing.openaiCompatibleBaseUrl
  }
}

function applyMarketplaceDefaults(pkg: typeof packageJson, marketplace: MarketplaceDefaults): void {
  const props = pkg.contributes?.configuration?.properties
  if (!props)
    throw new Error("Cannot inject local marketplace defaults: package.json configuration properties are missing.")
  if (marketplace.baseUrl) {
    props["chipmate.v2.marketplace.baseUrl"].default = marketplace.baseUrl
    if (internal) props["chipmate.v2.marketplace.skillsOnly"].default = true
  }
}

function route(base: string | undefined, name: "word" | "mermaid"): string | undefined {
  if (!base) return undefined
  const root = base.replace(/\/+$/, "")
  if (root.endsWith(`/render/${name}`)) return root
  return `${root}/render/${name}`
}

function endpoint(value: string | undefined, name: "word" | "mermaid"): string | undefined {
  if (!value) return undefined
  const root = value.replace(/\/+$/, "")
  if (root.endsWith(`/render/${name}`)) return root
  if (root.includes("/render/")) return undefined
  return route(root, name)
}

function serviceBase(value: string | undefined): string | undefined {
  if (!value) return undefined
  const root = value.replace(/\/+$/, "")
  return root.includes("/render/") ? undefined : root
}

function trim(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function removeMaps(dir: string): void {
  if (!existsSync(dir)) return
  for (const item of readdirSync(dir)) {
    const file = join(dir, item)
    const stat = statSync(file)
    if (stat.isDirectory()) {
      removeMaps(file)
      continue
    }
    if (file.endsWith(".map")) rmSync(file, { force: true })
  }
}

async function verifyInternalVsix(vsix: string, config: Target): Promise<void> {
  const files = await listVsix(vsix)
  if (!files) return
  const required = [
    `extension/bin/${config.binary}`,
    `extension/bin/${indexingProcessForBinary(config.binary)}`,
    "extension/bin/models-snapshot.json",
    "extension/bin/codegraph-parser-worker.mjs",
    "extension/bin/kilo-sandbox-mutation-worker.js",
    "extension/bin/tree-sitter/tree-sitter.wasm",
    "extension/bin/tree-sitter/tree-sitter-c.wasm",
    "extension/bin/tree-sitter/tree-sitter-cpp.wasm",
    "extension/bin/lancedb/node_modules/@lancedb/lancedb/dist/index.js",
    "extension/bin/lancedb/node_modules/@lancedb/lancedb/dist/native.js",
    "extension/bin/lancedb/node_modules/apache-arrow/Arrow.node.js",
    "extension/bin/lancedb/node_modules/flatbuffers/js/flatbuffers.js",
    "extension/bin/lancedb/node_modules/reflect-metadata/Reflect.js",
    "extension/bin/lancedb/node_modules/tslib/tslib.js",
    "extension/dist/extension.js",
    "extension/dist/webview.js",
    "extension/dist/agent-manager.js",
    "extension/dist/agent-console.js",
    "extension/dist/diff-viewer.js",
    "extension/dist/diff-virtual.js",
  ]
  if ((config.vsceTarget ?? config.target) === "win32-x64") {
    required.push(
      "extension/bin/rg.exe",
      "extension/bin/poppler/pdftotext.exe",
      "extension/bin/lancedb/node_modules/@lancedb/lancedb-win32-x64-msvc/lancedb.win32-x64-msvc.node",
    )
  }
  if ((config.vsceTarget ?? config.target) === "linux-x64") {
    required.push(
      "extension/bin/rg",
      "extension/bin/lancedb/node_modules/@lancedb/lancedb-linux-x64-gnu/lancedb.linux-x64-gnu.node",
    )
  }
  if ((config.vsceTarget ?? config.target) === "darwin-arm64") {
    required.push(
      "extension/bin/rg",
      "extension/bin/lancedb/node_modules/@lancedb/lancedb-darwin-arm64/lancedb.darwin-arm64.node",
    )
  }
  for (const file of required) {
    if (!files.includes(file)) throw new Error(`Internal VSIX missing required file: ${file}`)
  }
  if ((config.vsceTarget ?? config.target) === "win32-x64") {
    if (!files.some((file) => file.startsWith("extension/bin/poppler/") && file.toLowerCase().endsWith(".dll"))) {
      throw new Error("Internal VSIX missing bundled Poppler DLL dependencies.")
    }
    if (!files.some((file) => file.startsWith("extension/bin/poppler/share/poppler/"))) {
      throw new Error("Internal VSIX missing bundled Poppler data files.")
    }
  }
  const forbidden = files.filter(
    (file) => file === "extension/bin/ffmpeg" || file === "extension/bin/ffmpeg.exe" || file.endsWith(".map"),
  )
  if (forbidden.length > 0) {
    throw new Error(`Internal VSIX contains forbidden files:\n${forbidden.join("\n")}`)
  }
}

async function verifyInternalModelsSnapshot(vsix: string): Promise<void> {
  const unzip = Bun.which("unzip")
  if (!unzip) {
    console.warn("Skipping VSIX models snapshot verification because unzip is not available.")
    return
  }
  const out = await $`${unzip} -p ${vsix} extension/bin/models-snapshot.json`.quiet()
  const text = out.text().trim()
  const snapshot = JSON.parse(text) as unknown
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("Internal VSIX models-snapshot.json must be a provider object.")
  }
  if (Object.keys(snapshot).length === 0) {
    throw new Error("Internal VSIX models-snapshot.json must contain at least one provider.")
  }
}

async function verifyInternalMarketplaceManifest(vsix: string): Promise<void> {
  const unzip = Bun.which("unzip")
  if (!unzip) throw new Error("Cannot verify internal marketplace manifest because unzip is not available.")
  const out = await $`${unzip} -p ${vsix} extension/package.json`.quiet()
  const manifest = JSON.parse(out.text()) as {
    contributes?: {
      configuration?:
        | { properties?: Record<string, { default?: unknown }> }
        | Array<{ properties?: Record<string, { default?: unknown }> }>
    }
  }
  const props = manifestConfigurationProperties(manifest)
  const baseUrl = props["chipmate.v2.marketplace.baseUrl"]?.default
  const skillsOnly = props["chipmate.v2.marketplace.skillsOnly"]?.default
  if (typeof baseUrl !== "string" || !baseUrl.trim()) {
    throw new Error(
      "Internal VSIX marketplace manifest must contain a non-empty chipmate.v2.marketplace.baseUrl default.",
    )
  }
  if (skillsOnly !== true) {
    throw new Error("Internal VSIX marketplace manifest must set chipmate.v2.marketplace.skillsOnly.default to true.")
  }
}

async function verifyPackageTarget(vsix: string, target: string): Promise<void> {
  const unzip = Bun.which("unzip")
  if (!unzip) throw new Error("Cannot verify VSIX package target because unzip is not available.")
  const out = await $`${unzip} -p ${vsix} extension/package.json`.quiet()
  const manifest = JSON.parse(out.text()) as { chipmatePackageTarget?: unknown }
  if (manifest.chipmatePackageTarget !== target) {
    throw new Error(`VSIX package target must be ${target}.`)
  }
}

async function verifyChipmateServer(vsix: string, expected: PackagedChipmateServerDefaults): Promise<void> {
  const unzip = Bun.which("unzip")
  if (!unzip) throw new Error("Cannot verify packaged ChipMate Server defaults because unzip is not available.")
  const out = await $`${unzip} -p ${vsix} extension/package.json`.quiet()
  const manifest = JSON.parse(out.text()) as {
    contributes?: {
      configuration?:
        | { properties?: Record<string, { default?: unknown }> }
        | Array<{ properties?: Record<string, { default?: unknown }> }>
    }
  }
  const props = manifestConfigurationProperties(manifest)
  const values = {
    "chipmate.v2.chipmateServer.baseUrl": expected.baseUrl,
    "chipmate.v2.marketplace.baseUrl": expected.marketplace,
    "chipmate.v2.documents.wordRender.remoteEndpoint": expected.word,
    "chipmate.v2.documents.mermaidRender.remoteEndpoint": expected.mermaid,
  }
  for (const [key, value] of Object.entries(values)) {
    if (props[key]?.default !== value) {
      throw new Error(`Packaged ChipMate Server default mismatch for ${key}.`)
    }
  }
}

function manifestConfigurationProperties(manifest: {
  contributes?: {
    configuration?:
      | { properties?: Record<string, { default?: unknown }> }
      | Array<{ properties?: Record<string, { default?: unknown }> }>
  }
}): Record<string, { default?: unknown }> {
  const configuration = manifest.contributes?.configuration
  if (!configuration) return {}
  if (Array.isArray(configuration)) return Object.assign({}, ...configuration.map((item) => item.properties ?? {}))
  return configuration.properties ?? {}
}

async function listVsix(vsix: string): Promise<string[] | undefined> {
  const unzip = Bun.which("unzip")
  if (!unzip) {
    console.warn("Skipping VSIX content verification because unzip is not available.")
    return undefined
  }
  const out = await $`${unzip} -Z1 ${vsix}`.quiet()
  return out.text().split(/\r?\n/).filter(Boolean)
}
