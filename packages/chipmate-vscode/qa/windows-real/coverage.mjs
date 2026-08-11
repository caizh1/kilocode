#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const dir = dirname(fileURLToPath(import.meta.url))
const root = resolve(dir, "../../../..")
const args = new Map()
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i]
  if (!arg.startsWith("--")) continue
  const [key, inline] = arg.slice(2).split("=", 2)
  const next = inline ?? (process.argv[i + 1]?.startsWith("--") ? undefined : process.argv[++i])
  args.set(key, next ?? true)
}

const source = join(dir, "cases.json")
const matrix = JSON.parse(readFileSync(source, "utf8"))
const atomic = JSON.parse(readFileSync(join(dir, "atomic-cases.json"), "utf8"))
const errors = []
const ids = new Set()
const mapped = new Map()

if (matrix.version !== 1 || !Array.isArray(matrix.cases))
  errors.push("cases.json must use version 1 with a cases array")
for (const item of matrix.cases ?? []) {
  if (!/^WIN-[A-Z0-9-]+$/.test(item.id ?? "")) errors.push(`invalid case id: ${item.id}`)
  if (ids.has(item.id)) errors.push(`duplicate case id: ${item.id}`)
  ids.add(item.id)
  for (const field of ["suite", "title", "severity", "visualOracle"]) {
    if (!item[field]) errors.push(`${item.id}: missing ${field}`)
  }
  for (const field of [
    "profiles",
    "changesets",
    "pathPatterns",
    "preconditions",
    "steps",
    "expectedState",
    "cleanup",
  ]) {
    if (!Array.isArray(item[field])) errors.push(`${item.id}: ${field} must be an array`)
  }
  for (const change of item.changesets ?? []) {
    const cases = mapped.get(change) ?? []
    cases.push(item.id)
    mapped.set(change, cases)
  }
  for (const pattern of item.pathPatterns ?? []) {
    try {
      new RegExp(pattern)
    } catch (err) {
      errors.push(`${item.id}: invalid path regex ${pattern}: ${err.message}`)
    }
  }
}

const changeDir = join(root, ".changeset")
const changes = readdirSync(changeDir)
  .filter((name) => name.endsWith(".md") && name !== "README.md")
  .map((name) => name.slice(0, -3))
  .sort()
const missing = changes.filter((name) => !mapped.has(name))
const unknown = [...mapped.keys()].filter((name) => !changes.includes(name)).sort()
if (missing.length) errors.push(`unmapped changesets: ${missing.join(", ")}`)
if (unknown.length) errors.push(`unknown changesets: ${unknown.join(", ")}`)

const problems = new Map()
const assertions = new Set()
for (const item of atomic.problems ?? []) {
  if (problems.has(item.changeset)) errors.push(`duplicate atomic changeset: ${item.changeset}`)
  problems.set(item.changeset, item)
  const parent = matrix.cases.find((entry) => entry.id === item.parent)
  if (!parent) errors.push(`${item.changeset}: unknown atomic parent ${item.parent}`)
  if (parent && !parent.changesets.includes(item.changeset)) {
    errors.push(`${item.changeset}: atomic parent ${item.parent} does not own changeset`)
  }
  if (!Array.isArray(item.assertions) || item.assertions.length === 0) {
    errors.push(`${item.changeset}: no atomic assertions`)
    continue
  }
  for (const check of item.assertions) {
    if (assertions.has(check.id)) errors.push(`duplicate atomic assertion id: ${check.id}`)
    assertions.add(check.id)
    if (!/^REG-[A-Z0-9-]+-[0-9]{2}$/.test(check.id ?? "")) errors.push(`invalid atomic id: ${check.id}`)
    if (!String(check.title ?? "").trim()) errors.push(`${check.id}: missing atomic title`)
    if (check.oracle !== "boolean") errors.push(`${check.id}: oracle must be boolean`)
    if (!Array.isArray(check.evidence) || check.evidence.length === 0) errors.push(`${check.id}: missing evidence`)
    for (const lane of ["source", "macos", "windows"]) {
      if (!check[lane] || typeof check[lane].required !== "boolean") errors.push(`${check.id}: invalid ${lane} lane`)
      if (!check[lane]?.executor) errors.push(`${check.id}: missing ${lane} executor`)
      if (!new Set(["implemented", "planned"]).has(check[lane]?.state)) errors.push(`${check.id}: invalid ${lane} state`)
    }
  }
}
const atomicMissing = changes.filter((name) => !problems.has(name))
const atomicUnknown = [...problems.keys()].filter((name) => !changes.includes(name)).sort()
if (atomicMissing.length) errors.push(`changesets without atomic assertions: ${atomicMissing.join(", ")}`)
if (atomicUnknown.length) errors.push(`atomic assertions for unknown changesets: ${atomicUnknown.join(", ")}`)

const status = git(["status", "--porcelain=v1"])
const paths = status
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => line.slice(3).replace(/^.* -> /, ""))
  .filter(isRuntimePath)
  .sort()
const patterns = (matrix.cases ?? []).flatMap((item) =>
  (item.pathPatterns ?? []).map((pattern) => ({ id: item.id, regex: new RegExp(pattern) })),
)
const files = paths.map((path) => ({
  path,
  cases: patterns.filter((entry) => entry.regex.test(path)).map((entry) => entry.id),
}))
const uncovered = files.filter((item) => item.cases.length === 0).map((item) => item.path)
if (uncovered.length) errors.push(`unmapped runtime paths: ${uncovered.join(", ")}`)

const ledger = {
  generatedAt: new Date().toISOString(),
  repository: args.has("portable") ? "." : root,
  git: {
    branch: git(["branch", "--show-current"]).trim(),
    head: git(["rev-parse", "HEAD"]).trim(),
    dirty: status.length > 0,
  },
  matrix: {
    cases: matrix.cases.length,
    changesets: changes.length,
    mappedChangesets: changes.length - missing.length,
    runtimePaths: files.length,
    mappedRuntimePaths: files.length - uncovered.length,
  },
  atomic: {
    changesets: problems.size,
    assertions: assertions.size,
    mappedChangesets: changes.length - atomicMissing.length,
    sourceRequired: [...problems.values()].flatMap((item) => item.assertions).filter((item) => item.source.required).length,
    sourceImplemented: [...problems.values()]
      .flatMap((item) => item.assertions)
      .filter((item) => item.source.required && item.source.state === "implemented").length,
    macosRequired: [...problems.values()].flatMap((item) => item.assertions).filter((item) => item.macos.required).length,
    macosImplemented: [...problems.values()]
      .flatMap((item) => item.assertions)
      .filter((item) => item.macos.required && item.macos.state === "implemented").length,
    windowsRequired: [...problems.values()].flatMap((item) => item.assertions).filter((item) => item.windows.required).length,
    windowsImplemented: [...problems.values()]
      .flatMap((item) => item.assertions)
      .filter((item) => item.windows.required && item.windows.state === "implemented").length,
    automationStatus:
      [...problems.values()].flatMap((item) => item.assertions).every((item) => {
        if (item.macos.required && item.macos.state !== "implemented") return false
        if (item.windows.required && item.windows.state !== "implemented") return false
        return true
      })
        ? "READY"
        : "BLOCKED",
  },
  changesets: changes.map((name) => ({ name, cases: mapped.get(name) ?? [] })),
  runtimePaths: files,
  errors,
  status: errors.length ? "FAIL" : "PASS",
}

const output = args.get("output")
if (typeof output === "string") {
  const path = resolve(process.cwd(), output)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`)
}

process.stdout.write(`${JSON.stringify(ledger, null, 2)}\n`)
if (errors.length) process.exitCode = 1

function git(argv) {
  try {
    return execFileSync("git", argv, { cwd: root, encoding: "utf8" }).trim()
  } catch (err) {
    errors.push(`git ${argv.join(" ")} failed: ${err.message}`)
    return ""
  }
}

function isRuntimePath(path) {
  if (!existsSync(join(root, path)) && !path.includes(" -> ")) return false
  if (/\/(test|tests|docs|qa)\//.test(path)) return false
  if (/\.(md|snap|map)$/.test(path)) return false
  return [
    "packages/core/src/",
    "packages/chipmate-i18n/src/",
    "packages/chipmate-indexing/src/",
    "packages/chipmate-vscode/package.json",
    "packages/chipmate-vscode/script/",
    "packages/chipmate-vscode/src/",
    "packages/chipmate-vscode/webview-ui/src/",
    "packages/opencode/src/",
    "server/chipmate-word-render/",
  ].some((prefix) => path.startsWith(prefix))
}
