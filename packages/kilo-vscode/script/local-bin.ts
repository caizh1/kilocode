#!/usr/bin/env bun
import { $ } from "bun"
import { join, relative, dirname, basename } from "node:path"
import { chmodSync, statSync, rmSync, readdirSync, existsSync, readFileSync } from "node:fs"
import {
  copyCodeGraphParserWorker,
  copyIndexingProcess,
  copyKiloSandboxWorker,
  copySandboxResources,
  copyTreeSitterResources,
  hasCodeGraphParserWorker,
  hasIndexingProcess,
  hasKiloSandboxWorker,
  hasTreeSitterResources,
  indexingProcessForBinary,
  kiloSandboxWorkerForBinary,
  sanitizeSandboxResources,
} from "../src/services/cli-backend/cli-resources"
import { currentBwrapTarget, ensureBwrapForTarget } from "./bwrap-helper"
import { currentFfmpegTarget, ensureFfmpegForTarget } from "./ffmpeg-helper"
import { ensureRipgrepForTarget } from "./ripgrep-helper"

const forceRebuild = process.argv.includes("--force")

/**
 * Ensures the VS Code extension has a CLI binary at `packages/kilo-vscode/bin/kilo`.
 *
 * Strategy:
 * 1) If `bin/kilo` already exists -> ok.
 * 2) Else try to locate a prebuilt binary produced by `packages/opencode` build.
 * 3) Else try to build it via `bun run build --single` in `packages/opencode`.
 * 4) Copy the resulting binary into `packages/kilo-vscode/bin/kilo` and chmod +x.
 *
 * This script is intended to be run from `packages/kilo-vscode` as part of build/package.
 */

const kiloVscodeDir = join(import.meta.dir, "..")
const packagesDir = join(kiloVscodeDir, "..")
const repoDir = join(packagesDir, "..")
const opencodeDir = join(packagesDir, "opencode")
const coreDir = join(packagesDir, "core")
const gatewayDir = join(packagesDir, "kilo-gateway")
const indexingDir = join(packagesDir, "kilo-indexing")
const sandboxDir = join(packagesDir, "kilo-sandbox")

const targetBinDir = join(kiloVscodeDir, "bin")
const binName = process.platform === "win32" ? "kilo.exe" : "kilo"
const targetBinPath = join(targetBinDir, binName)
const snapshotName = "models-snapshot.json"
const targetSnapshotPath = join(targetBinDir, snapshotName)
const versionFile = join(targetBinDir, ".cli-version")
const devSnapshotPath = join(opencodeDir, "src", "provider", snapshotName)

function log(msg: string) {
  console.log(`[local-bin] ${msg}`)
}

async function cliSourceHash(): Promise<string | null> {
  try {
    const opencodeResult = await $`git log -1 --format=%H -- .`.cwd(opencodeDir).quiet()
    const coreResult = await $`git log -1 --format=%H -- .`.cwd(coreDir).quiet()
    const gatewayResult = await $`git log -1 --format=%H -- .`.cwd(gatewayDir).quiet()
    const indexingResult = await $`git log -1 --format=%H -- .`.cwd(indexingDir).quiet()
    const sandboxResult = await $`git log -1 --format=%H -- .`.cwd(sandboxDir).quiet()
    return `${opencodeResult.text().trim()}-${coreResult.text().trim()}-${gatewayResult.text().trim()}-${indexingResult.text().trim()}-${sandboxResult.text().trim()}`
  } catch {
    return null
  }
}

async function isDirty(): Promise<boolean> {
  try {
    const opencodeResult = await $`git status --porcelain -- .`.cwd(opencodeDir).quiet()
    const coreResult = await $`git status --porcelain -- .`.cwd(coreDir).quiet()
    const gatewayResult = await $`git status --porcelain -- .`.cwd(gatewayDir).quiet()
    const indexingResult = await $`git status --porcelain -- .`.cwd(indexingDir).quiet()
    const sandboxResult = await $`git status --porcelain -- .`.cwd(sandboxDir).quiet()
    return (
      opencodeResult.text().trim().length > 0 ||
      coreResult.text().trim().length > 0 ||
      gatewayResult.text().trim().length > 0 ||
      indexingResult.text().trim().length > 0 ||
      sandboxResult.text().trim().length > 0
    )
  } catch {
    return false
  }
}

async function isStale(): Promise<boolean> {
  if (await isDirty()) return true
  const hash = await cliSourceHash()
  if (!hash) return false // can't determine — assume fresh
  try {
    const stored = (await Bun.file(versionFile).text()).trim()
    return stored !== hash
  } catch {
    return true // no version file — treat as stale
  }
}

function platformTag(): string {
  const os = process.platform === "win32" ? "windows" : process.platform
  return `cli-${os}-${process.arch}`
}

function vscodeTarget(): string {
  const os = process.platform === "win32" ? "win32" : process.platform
  const arch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : process.arch
  return `${os}-${arch}`
}

function isRunnableOnCurrentPlatform(file: string): boolean {
  try {
    const header = readFileSync(file).subarray(0, 4)
    if (header[0] === 0x23 && header[1] === 0x21) return process.platform !== "win32"
    if (process.platform === "win32") return header[0] === 0x4d && header[1] === 0x5a
    if (process.platform === "linux") return header.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
    if (process.platform !== "darwin") return false
    const magic = header.readUInt32BE(0)
    return new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca]).has(magic)
  } catch {
    return false
  }
}

async function findKiloBinaryInOpencodeDist(): Promise<string | null> {
  const distDir = join(opencodeDir, "dist")

  try {
    readdirSync(distDir)
  } catch {
    return null
  }

  // Prefer the binary matching the current platform (e.g. cli-darwin-arm64)
  const tag = platformTag()
  const preferred = join(distDir, `@kilocode`, tag, "bin", binName)
  try {
    statSync(preferred)
    if (!isRunnableOnCurrentPlatform(preferred)) return null
    if (!hasTreeSitterResources(preferred) || !hasKiloSandboxWorker(preferred)) return null
    if (!hasCodeGraphParserWorker(preferred) || !hasIndexingProcess(preferred)) return null
    if (!existsSync(snapshotForBinary(preferred))) return null
    return preferred
  } catch {
    // fall through to generic search
  }

  // Fallback: find any dist/**/bin/kilo or kilo.exe
  const queue = [distDir]
  while (queue.length) {
    const dir = queue.pop()
    if (!dir) continue

    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        queue.push(p)
        continue
      }
      if (e.isFile() && e.name === binName && basename(dirname(p)) === "bin") {
        if (!isRunnableOnCurrentPlatform(p)) continue
        if (!hasTreeSitterResources(p) || !hasKiloSandboxWorker(p)) continue
        if (!hasCodeGraphParserWorker(p) || !hasIndexingProcess(p)) continue
        if (!existsSync(snapshotForBinary(p))) continue
        return p
      }
    }
  }
  return null
}

function snapshotForBinary(file: string): string {
  return join(dirname(file), snapshotName)
}

async function ensureBuiltBinary(): Promise<string> {
  const found = await findKiloBinaryInOpencodeDist()
  if (found) return found

  log(
    `No prebuilt binary found under ${relative(kiloVscodeDir, join(opencodeDir, "dist"))} - attempting build via bun.`,
  )

  if (!Bun.which("bun")) {
    throw new Error(
      `Bun is required to build the CLI binary, but was not found on PATH. ` +
        `Install bun, or build the CLI separately in ${opencodeDir} and re-run.`,
    )
  }

  // Use the repository-pinned Bun version throughout. Newer canaries can fail compilation
  // and must not cause packaged snapshots to fall back to the browser-mode source wrapper.
  const pkg = await Bun.file(join(repoDir, "package.json")).json()
  const bun = String(pkg.packageManager)
  log("Installing dependencies in opencode package...")
  await $`bunx ${bun} install --frozen-lockfile`.cwd(opencodeDir)
  await $`bunx ${bun} run build --single --skip-install`.cwd(opencodeDir)

  const built = await findKiloBinaryInOpencodeDist()
  if (!built) {
    throw new Error(
      `CLI build completed but no binary was found in ${join(opencodeDir, "dist")} (expected dist/**/bin/kilo).`,
    )
  }
  return built
}

async function bundleKiloSandboxWorker() {
  const result = await Bun.build({
    entrypoints: [join(sandboxDir, "src", "kilo-sandbox-mutation-worker.ts")],
    target: "bun",
    format: "esm",
    minify: true,
  })
  if (!result.success || result.outputs.length !== 1) throw new Error("Could not bundle Kilo sandbox mutation worker")
  await Bun.write(kiloSandboxWorkerForBinary(targetBinPath), result.outputs[0])
}

async function ensureLocalHelpers() {
  await ensureFfmpegForTarget(currentFfmpegTarget(), targetBinDir)
  await ensureRipgrepForTarget(vscodeTarget(), targetBinDir)
  if (process.env.KILO_SKIP_BUNDLED_BWRAP === "1") return
  if (await sanitizeSandboxResources(targetBinDir, true)) return
  await ensureBwrapForTarget(currentBwrapTarget())
}

async function writeSourceWrapper() {
  if (process.platform === "win32") {
    throw new Error("Compiled CLI build failed and source wrapper fallback is not supported on Windows.")
  }

  const bun = Bun.which("bun") ?? "bun"
  await $`mkdir -p ${targetBinDir}`
  await Bun.write(
    targetBinPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `cd ${JSON.stringify(opencodeDir)}`,
      `exec ${JSON.stringify(bun)} --conditions=node src/index.ts "$@"`,
      "",
    ].join("\n"),
  )
  const indexing = indexingProcessForBinary(targetBinPath)
  await Bun.write(
    indexing,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `cd ${JSON.stringify(opencodeDir)}`,
      `exec ${JSON.stringify(bun)} --conditions=browser src/kilocode/indexing-process.ts "$@"`,
      "",
    ].join("\n"),
  )
  chmodSync(targetBinPath, 0o755)
  chmodSync(indexing, 0o755)
  if (existsSync(devSnapshotPath)) await $`cp ${devSnapshotPath} ${targetSnapshotPath}`
  await bundleKiloSandboxWorker()
  await ensureLocalHelpers()

  const hash = await cliSourceHash()
  if (hash) await Bun.write(versionFile, hash + "\n")
  log(
    `Compiled CLI build failed; wrote source wrapper at ${relative(kiloVscodeDir, targetBinPath)} for local development.`,
  )
}

async function main() {
  const targetFile = Bun.file(targetBinPath)
  const exists = await targetFile.exists()
  const snapshotExists = await Bun.file(targetSnapshotPath).exists()
  const processExists = hasIndexingProcess(targetBinPath)
  const ready =
    exists &&
    isRunnableOnCurrentPlatform(targetBinPath) &&
    snapshotExists &&
    processExists &&
    hasTreeSitterResources(targetBinPath) &&
    hasCodeGraphParserWorker(targetBinPath) &&
    hasKiloSandboxWorker(targetBinPath)

  const stale = ready && !forceRebuild && (await isStale())
  const rebuild = forceRebuild || stale || !ready

  if (ready && !rebuild) {
    const st = statSync(targetBinPath)
    log(
      `CLI binary already present at ${relative(kiloVscodeDir, targetBinPath)} (${Math.round(st.size / 1024 / 1024)}MB). Use --force to rebuild.`,
    )
    await ensureLocalHelpers()
    return
  }

  if (forceRebuild && !exists) {
    removeDist()
  }

  if (exists && rebuild) {
    log(stale ? `CLI source has changed — rebuilding.` : `Refreshing existing CLI resources.`)
    rmSync(targetBinPath)
    rmSync(indexingProcessForBinary(targetBinPath), { force: true })
    rmSync(kiloSandboxWorkerForBinary(targetBinPath), { force: true })
    if (existsSync(targetSnapshotPath)) rmSync(targetSnapshotPath)
    if (forceRebuild || stale) {
      removeDist()
    }
  }

  const opencodePkgFile = Bun.file(join(opencodeDir, "package.json"))
  if (!(await opencodePkgFile.exists())) {
    throw new Error(`Expected opencode package at ${opencodeDir}, but it does not exist.`)
  }

  const sourceBinPath = await ensureBuiltBinary().catch(async (err) => {
    if (forceRebuild) throw err
    await writeSourceWrapper()
    log(`Wrapper fallback reason: ${err instanceof Error ? err.message : String(err)}`)
    return null
  })
  if (!sourceBinPath) return
  const sourceSnapshotPath = snapshotForBinary(sourceBinPath)
  await $`mkdir -p ${targetBinDir}`
  await $`cp ${sourceSnapshotPath} ${targetSnapshotPath}`
  await $`cp ${sourceBinPath} ${targetBinPath}`
  await copyTreeSitterResources(sourceBinPath, targetBinPath)
  await copyCodeGraphParserWorker(sourceBinPath, targetBinPath)
  await copyIndexingProcess(sourceBinPath, targetBinPath)
  await copySandboxResources(sourceBinPath, targetBinPath)
  await copyKiloSandboxWorker(sourceBinPath, targetBinPath)
  chmodSync(targetBinPath, 0o755)
  await ensureLocalHelpers()

  const hash = await cliSourceHash()
  if (hash) await Bun.write(versionFile, hash + "\n")

  log(`Copied CLI binary from ${relative(packagesDir, sourceBinPath)} -> ${relative(kiloVscodeDir, targetBinPath)}`)
}

function removeDist() {
  // Also remove the prebuilt dist so ensureBuiltBinary() triggers a fresh build
  const distDir = join(opencodeDir, "dist")
  if (!existsSync(distDir)) return
  rmSync(distDir, { recursive: true })
  log(`Removed ${relative(kiloVscodeDir, distDir)} to force rebuild.`)
}

try {
  await main()
} catch (err) {
  console.error(`[local-bin] ERROR: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
