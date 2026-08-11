import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
export const catalogPath = join(here, "cases.json")

export function loadCatalog() {
  return JSON.parse(readFileSync(catalogPath, "utf8"))
}

export function validateCatalog(catalog) {
  const errors = []
  const severities = new Set(["P0", "P1", "P2", "P3"])
  const scopes = new Set(["source", "package", "windows-installed"])
  const evidence = new Set([
    "status-trace",
    "request-count",
    "vector-readback",
    "retrieval-result",
    "graph-result",
    "native-runtime",
    "source-test",
  ])
  if (catalog?.version !== 1) errors.push("version 必须为 1")
  if (catalog?.suite !== "chipmate-indexing-regression") {
    errors.push("suite 必须为 chipmate-indexing-regression")
  }
  if (!Array.isArray(catalog?.cases) || catalog.cases.length === 0) {
    errors.push("cases 必须是非空数组")
    return errors
  }

  const ids = new Set()
  const sourceExecutors = new Set(["progress-core", "manager-lifecycle", "lancedb-native", "vscode-status-sync"])
  for (const item of catalog.cases) {
    if (!/^IDX-REG-\d{3}$/.test(item.id ?? "")) errors.push(`${item.id ?? "未知用例"}：id 格式错误`)
    if (ids.has(item.id)) errors.push(`${item.id}：id 重复`)
    ids.add(item.id)
    for (const field of ["title", "regression"]) {
      if (typeof item[field] !== "string" || !item[field].trim()) errors.push(`${item.id}：${field} 不能为空`)
    }
    if (!severities.has(item.severity)) errors.push(`${item.id}：未知 severity ${item.severity}`)
    for (const field of ["scope", "preconditions", "steps", "expected", "sourceExecutors", "evidence"]) {
      if (!Array.isArray(item[field]) || item[field].length === 0) errors.push(`${item.id}：${field} 必须是非空数组`)
    }
    if (new Set(item.scope ?? []).size !== (item.scope ?? []).length) errors.push(`${item.id}：scope 不能重复`)
    for (const scope of item.scope ?? []) {
      if (!scopes.has(scope)) errors.push(`${item.id}：未知 scope ${scope}`)
    }
    for (const field of ["preconditions", "steps", "expected"]) {
      if ((item[field] ?? []).some((value) => typeof value !== "string" || !value.trim())) {
        errors.push(`${item.id}：${field} 不能包含空项`)
      }
    }
    for (const executor of item.sourceExecutors ?? []) {
      if (!sourceExecutors.has(executor)) errors.push(`${item.id}：未知 source executor ${executor}`)
    }
    if (!["formal-indexer-ipc", "not-required"].includes(item.packageExecutor)) {
      errors.push(`${item.id}：未知 package executor ${item.packageExecutor}`)
    }
    for (const type of item.evidence ?? []) {
      if (!evidence.has(type)) errors.push(`${item.id}：未知 evidence ${type}`)
    }
    if (item.scope?.includes("package") && item.packageExecutor !== "formal-indexer-ipc") {
      errors.push(`${item.id}：package 范围必须绑定 formal-indexer-ipc`)
    }
  }
  return errors
}

export function selectCases(catalog, requested) {
  if (!requested?.length) return catalog.cases
  const ids = new Set(requested)
  const selected = catalog.cases.filter((item) => ids.has(item.id))
  const missing = [...ids].filter((id) => !selected.some((item) => item.id === id))
  if (missing.length) throw new Error(`未知用例：${missing.join("、")}`)
  return selected
}
