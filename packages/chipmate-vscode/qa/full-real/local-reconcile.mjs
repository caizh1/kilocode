#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const out = resolve(process.argv[2])
const base = String(process.argv[3] ?? "http://127.0.0.1:6002").replace(/\/+$/, "")
const file = join(out, "service-results.json")
const data = JSON.parse(readFileSync(file, "utf8"))
const checks = []
for (let run = 1; run <= 2; run += 1) {
  const started = Date.now()
  const [skills, extensions] = await Promise.all([
    fetch(`${base}/api/v1/skills?q=qa-e2e-20260718`).then(async (response) => ({ status: response.status, body: await response.json() })),
    fetch(`${base}/api/v1/extensions?q=qa-e2e-20260718`).then(async (response) => ({ status: response.status, body: await response.json() })),
  ])
  checks.push({ run, elapsedMs: Date.now() - started, skills: { status: skills.status, count: skills.body.items?.length }, extensions: { status: extensions.status, count: extensions.body.items?.length } })
}
const pass = checks.every((item) => item.skills.status === 200 && item.skills.count === 0 && item.extensions.status === 200 && item.extensions.count === 0)
const index = data.serviceResults.findIndex((item) => item.id === "SVC-FAIL-08")
data.serviceResults[index] = {
  ...data.serviceResults[index],
  status: pass ? "PASS" : "FAIL",
  summary: pass ? "首次清理审计连接异常；随后两次独立重查均确认 Skill/Extension 残留为 0。" : "两次独立清理重查仍发现异常或残留。",
  evidence: ["evidence/local-actions/cleanup-recheck.json"],
}
const evidence = join(out, "evidence", "local-actions")
mkdirSync(evidence, { recursive: true })
writeFileSync(join(evidence, "cleanup-recheck.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), baseUrl: base, pass, checks }, null, 2)}\n`)
writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`)
process.stdout.write(`${JSON.stringify({ pass, checks }, null, 2)}\n`)
