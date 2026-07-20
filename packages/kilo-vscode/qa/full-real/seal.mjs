#!/usr/bin/env node

import { execFileSync } from "node:child_process"
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { basename, extname, join, resolve } from "node:path"

const out = resolve(process.argv[2])
const binary = new Set([".zip", ".vsix", ".png", ".pdf", ".docx", ".node", ".exe", ".wasm", ".ttf", ".ttc"])
const patterns = [
  ["openai-key", /\bsk-[A-Za-z0-9_-]{16,}/g],
  ["bearer", /Bearer\s+(?!\[REDACTED\])[A-Za-z0-9._~+/-]{16,}/gi],
  ["assigned-secret", /(?:api[_-]?key|token|secret)\s*[:=]\s*["']?[A-Za-z0-9._~+/-]{20,}/gi],
]
const findings = []
for (const path of walk(out)) {
  const relative = path.slice(out.length + 1)
  if (relative.startsWith("macos-run/runtime/") || relative.startsWith("macos-run-2/runtime/")) continue
  if (relative.startsWith("local-service/")) continue
  if (binary.has(extname(path).toLowerCase()) || basename(path) === "secret-scan.json") continue
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.size > 10 * 1024 * 1024) continue
  const text = readFileSync(path, "utf8")
  for (const [kind, pattern] of patterns) {
    pattern.lastIndex = 0
    for (const match of text.matchAll(pattern)) findings.push({ path: relative, kind, offset: match.index })
  }
}
const scan = { generatedAt: new Date().toISOString(), status: findings.length === 0 ? "PASS" : "FAIL", findings }
const evidence = join(out, "evidence", "snapshots")
mkdirSync(evidence, { recursive: true })
writeFileSync(join(evidence, "secret-scan.json"), `${JSON.stringify(scan, null, 2)}\n`)
if (findings.length) throw new Error(`Potential secrets found: ${findings.length}`)

const zip = join(out, "evidence.zip")
if (existsSync(zip)) unlinkSync(zip)
const inputs = [
  "evidence",
  "macos-run-2/evidence",
  "macos-run-2/results.json",
  "macos-run-2/report.html",
  "coverage-snapshot.json",
  "freeze.json",
  "service-results.json",
  "windows-results.json",
  "mutation-ledger.json",
  "unified-results.json",
  "report.md",
  "report.html",
  "local-service-run/evidence",
  "local-service-run/service-results.json",
  "local-service-run/service-report.html",
  "local-service-run/local-report.md",
  "local-service-macos-run3/evidence",
  "local-service-macos-run3/service-results.json",
  "local-service-macos-run3/service-report.html",
  "macos-run-4/evidence",
  "macos-run-4/qwen-results.json",
  "macos-run-4/slash-settings-results.json",
]
execFileSync("zip", ["-X", "-q", "-r", zip, ...inputs], { cwd: out, stdio: "inherit" })
process.stdout.write(`${JSON.stringify({ scan: scan.status, zip, inputs: inputs.length }, null, 2)}\n`)

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return walk(path)
    return entry.isFile() ? [path] : []
  })
}
