#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { basename, dirname, join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"

const dir = dirname(fileURLToPath(import.meta.url))
const root = resolve(dir, "../../../..")
const args = parse(process.argv.slice(2))
if (!(args.windows ?? args.vsix) || !args.macos || !args.output) {
  process.stderr.write(
    "Usage: node freeze-kit.mjs --windows <vsix> --macos <vsix> --output <zip> [--previous <vsix>] [--kilo <vsix>]\n",
  )
  process.exit(2)
}

const windows = resolve(process.cwd(), args.windows ?? args.vsix)
const macos = resolve(process.cwd(), args.macos)
const output = resolve(process.cwd(), args.output)
if (!existsSync(windows)) throw new Error(`Windows VSIX not found: ${windows}`)
if (!existsSync(macos)) throw new Error(`macOS VSIX not found: ${macos}`)
const win = readManifest(windows, "win32-x64-baseline")
const mac = readManifest(macos, "darwin-arm64")

const temp = mkdtempSync(join(tmpdir(), "chipmate-proxy-qa-"))
const stage = join(temp, `chipmate-proxy-regression-${win.version}`)
const qa = join(stage, "qa")
mkdirSync(qa, { recursive: true })
cpSync(dir, join(qa, "windows-real"), { recursive: true, filter: (path) => !path.endsWith("coverage-snapshot.json") })
cpSync(join(dir, "..", "macos-real"), join(qa, "macos-real"), { recursive: true })

const coverage = spawnSync(
  process.execPath,
  [join(dir, "coverage.mjs"), "--portable", "--output", join(qa, "windows-real", "coverage-snapshot.json")],
  {
    cwd: root,
    encoding: "utf8",
  },
)
if (coverage.status !== 0) throw new Error(`Coverage freeze failed:\n${coverage.stdout}\n${coverage.stderr}`)

const files = [
  { role: "windows", source: windows, name: `chipmate-${win.version}-win32-x64-baseline.vsix` },
  { role: "macos", source: macos, name: `chipmate-${mac.version}-darwin-arm64.vsix` },
]
for (const [role, value] of [
  ["previous", args.previous],
  ["kilo", args.kilo],
]) {
  if (!value) continue
  const source = resolve(process.cwd(), value)
  if (!existsSync(source)) throw new Error(`${role} VSIX not found: ${source}`)
  files.push({ role, source, name: basename(source) })
}
for (const file of files) cpSync(file.source, join(stage, file.name))

const frozen = {
  generatedAt: new Date().toISOString(),
  git: {
    branch: git(["branch", "--show-current"]),
    head: git(["rev-parse", "HEAD"]),
    dirty: git(["status", "--porcelain=v1"]).length > 0,
  },
  source: {
    diffSha256: createHash("sha256").update(git(["diff", "--binary", "HEAD"])).digest("hex"),
    status: git(["status", "--porcelain=v1"]),
  },
  extension: {
    id: "chipmate.chipmate",
    version: win.version,
    targets: [win.chipmatePackageTarget, mac.chipmatePackageTarget],
  },
  files: files.map((file) => ({ role: file.role, name: file.name, sha256: sha(file.source) })),
}
writeFileSync(join(stage, "freeze-manifest.json"), `${JSON.stringify(frozen, null, 2)}\n`)
writeFileSync(
  join(stage, "SHA256SUMS.txt"),
  `${frozen.files.map((file) => `${file.sha256}  ${file.name}`).join("\n")}\n`,
)
writeFileSync(
  join(stage, "RUN-WINDOWS.ps1"),
  `[CmdletBinding()]\nparam([string] $CodePath, [string] $FixtureRoot, [string] $Output)\n$root = $PSScriptRoot\n$args = @{ Vsix = Join-Path $root '${files[0].name}'; Lane = 'smoke' }\nif ($CodePath) { $args.CodePath = $CodePath }\nif ($FixtureRoot) { $args.FixtureRoot = $FixtureRoot }\nif ($Output) { $args.Output = $Output }\n${files.find((file) => file.role === "previous") ? `$args.PreviousVsix = Join-Path $root '${files.find((file) => file.role === "previous").name}'` : ""}\n${files.find((file) => file.role === "kilo") ? `$args.KiloVsix = Join-Path $root '${files.find((file) => file.role === "kilo").name}'` : ""}\n& (Join-Path $root 'qa\\windows-real\\run.ps1') @args\nexit $LASTEXITCODE\n`,
)
writeFileSync(
  join(stage, "RUN-MACOS.sh"),
  `#!/bin/sh\nset -eu\nroot=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec node "$root/qa/macos-real/run.mjs" --vsix "$root/${files[1].name}" --output "${win.version}-macos-proxy" "$@"\n`,
  { mode: 0o755 },
)

mkdirSync(dirname(output), { recursive: true })
if (existsSync(output)) rmSync(output)
execFileSync("zip", ["-X", "-q", "-r", output, basename(stage)], { cwd: dirname(stage), stdio: "inherit" })
process.stdout.write(`${JSON.stringify({ output, manifest: frozen }, null, 2)}\n`)
rmSync(temp, { recursive: true, force: true })

function parse(argv) {
  const out = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith("--")) continue
    const [key, inline] = arg.slice(2).split("=", 2)
    out[key] = inline ?? argv[++index]
  }
  return out
}

function sha(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function git(argv) {
  return execFileSync("git", argv, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim()
}

function readManifest(path, target) {
  const manifest = JSON.parse(execFileSync("unzip", ["-p", path, "extension/package.json"], { encoding: "utf8" }))
  if (manifest.publisher !== "chipmate" || manifest.name !== "chipmate") throw new Error("Unexpected VSIX identity")
  if (manifest.version !== "0.0.88") throw new Error(`Expected version 0.0.88, got ${manifest.version}`)
  if (manifest.chipmatePackageTarget !== target) throw new Error(`Expected target ${target}, got ${manifest.chipmatePackageTarget}`)
  return manifest
}
