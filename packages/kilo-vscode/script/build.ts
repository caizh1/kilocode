#!/usr/bin/env bun
import { $ } from "bun"
import { join } from "node:path"
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs"
import { copyCodeGraphParserWorker, copyTreeSitterResources } from "../src/services/cli-backend/cli-resources"
import { ensureFfmpegForTarget } from "./ffmpeg-helper"
import { ensureRipgrepForTarget } from "./ripgrep-helper"
import { copyLanceDBRuntime } from "./lancedb-helper"
import { ensurePopplerForTarget } from "./poppler-helper"

type Target = {
  target: string
  cliDir: string
  binary: string
  vsceTarget?: string
  internal?: boolean
}

const packageJsonPath = join(import.meta.dir, "..", "package.json")
const packageJson = await Bun.file(packageJsonPath).json()
const version = process.env.KILO_VERSION ? process.env.KILO_VERSION : packageJson.version
const prerelease = process.env.KILO_PRE_RELEASE === "true"
const internal = process.argv.includes("--internal-offline") || process.env.CHIPMATE_INTERNAL_OFFLINE === "1"

console.log(`Building VSCode extension version: ${version}${prerelease ? " (pre-release)" : ""}`)
if (internal) console.log("Using internal offline Windows baseline build mode")

if (packageJson.version !== version) {
  console.log(`Updating package.json version from ${packageJson.version} to ${version}`)
  packageJson.version = version
  await Bun.write(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n")
}

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
const targets = internal ? internalTargets : publicTargets

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
})
if (internal) removeMaps(distDir)

for (const config of targets) {
  console.log(`\n🎯 Processing target: ${config.target}`)

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
  if (!config.internal && !existsSync(sourceSnapshot)) {
    throw new Error(`CLI models snapshot not found at ${sourceSnapshot}`)
  }

  console.log(`  📥 Copying binary from ${config.cliDir}/bin/${config.binary}...`)
  await $`cp ${sourceBinary} ${targetBinary}`
  if (config.internal) {
    await Bun.write(targetSnapshot, "{}\n")
  } else {
    await $`cp ${sourceSnapshot} ${targetSnapshot}`
  }
  await copyTreeSitterResources(sourceBinary, targetBinary)
  await copyCodeGraphParserWorker(sourceBinary, targetBinary)

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
    await copyLanceDBRuntime(binDir)
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
  if (config.internal) await verifyInternalVsix(vsixPath)
  console.log(`  ✅ Created ${vsixPath}`)
}

console.log("\n✨ All VSIX packages built successfully!")

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

async function verifyInternalVsix(vsix: string): Promise<void> {
  const files = await listVsix(vsix)
  if (!files) return
  const required = [
    "extension/bin/kilo.exe",
    "extension/bin/rg.exe",
    "extension/bin/poppler/pdftotext.exe",
    "extension/bin/models-snapshot.json",
    "extension/bin/codegraph-parser-worker.mjs",
    "extension/bin/tree-sitter/tree-sitter.wasm",
    "extension/bin/lancedb/node_modules/@lancedb/lancedb/dist/index.js",
    "extension/bin/lancedb/node_modules/@lancedb/lancedb/dist/native.js",
    "extension/bin/lancedb/node_modules/@lancedb/lancedb-win32-x64-msvc/lancedb.win32-x64-msvc.node",
    "extension/bin/lancedb/node_modules/apache-arrow/Arrow.node.js",
    "extension/bin/lancedb/node_modules/flatbuffers/js/flatbuffers.js",
    "extension/bin/lancedb/node_modules/reflect-metadata/Reflect.js",
    "extension/bin/lancedb/node_modules/tslib/tslib.js",
    "extension/dist/extension.js",
    "extension/dist/webview.js",
    "extension/dist/agent-manager.js",
    "extension/dist/diff-viewer.js",
    "extension/dist/diff-virtual.js",
  ]
  for (const file of required) {
    if (!files.includes(file)) throw new Error(`Internal VSIX missing required file: ${file}`)
  }
  if (!files.some((file) => file.startsWith("extension/bin/poppler/") && file.toLowerCase().endsWith(".dll"))) {
    throw new Error("Internal VSIX missing bundled Poppler DLL dependencies.")
  }
  if (!files.some((file) => file.startsWith("extension/bin/poppler/share/poppler/"))) {
    throw new Error("Internal VSIX missing bundled Poppler data files.")
  }
  const forbidden = files.filter((file) => file === "extension/bin/ffmpeg.exe" || file.endsWith(".map"))
  if (forbidden.length > 0) {
    throw new Error(`Internal VSIX contains forbidden files:\n${forbidden.join("\n")}`)
  }
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
