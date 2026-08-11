import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { loadCatalog, validateCatalog } from "./catalog.mjs"

const here = dirname(fileURLToPath(import.meta.url))

test("索引回归用例库结构完整且用例 ID 唯一", () => {
  const catalog = loadCatalog()
  assert.deepEqual(validateCatalog(catalog), [])
  assert.equal(new Set(catalog.cases.map((item) => item.id)).size, catalog.cases.length)
})

test("每个 P0/P1 用例都绑定自动化源码执行器", () => {
  const catalog = loadCatalog()
  for (const item of catalog.cases.filter((entry) => ["P0", "P1"].includes(entry.severity))) {
    assert.ok(item.sourceExecutors.length > 0, `${item.id} 缺少源码执行器`)
    assert.ok(item.expected.length >= 2, `${item.id} 的预期结果不充分`)
  }
})

test("所有 package 范围用例都绑定正式 indexer IPC", () => {
  const catalog = loadCatalog()
  for (const item of catalog.cases.filter((entry) => entry.scope.includes("package"))) {
    assert.equal(item.packageExecutor, "formal-indexer-ipc", `${item.id} 未绑定包内 IPC`)
  }
})

test("Windows 现场用例登记当前 RAG 进度与终态缺陷", () => {
  const windows = JSON.parse(readFileSync(join(here, "../windows-real/cases.json"), "utf8"))
  const atomic = JSON.parse(readFileSync(join(here, "../windows-real/atomic-cases.json"), "utf8"))
  const lifecycle = windows.cases.find((item) => item.id === "WIN-INDEXING-LIFECYCLE")
  assert.ok(lifecycle)
  assert.ok(lifecycle.changesets.includes("fix-rag-progress-and-finalization"))
  assert.ok(lifecycle.steps.some((item) => item.includes("processedFiles")))
  assert.ok(lifecycle.expectedState.some((item) => item.includes("运行态不超过 99%")))
  assert.ok(lifecycle.expectedState.some((item) => item.includes("Document RAG")))

  const problem = atomic.problems.find((item) => item.changeset === "fix-rag-progress-and-finalization")
  assert.equal(problem?.parent, "WIN-INDEXING-LIFECYCLE")
  assert.equal(problem?.assertions.length, 6)
  assert.ok(problem.assertions.every((item) => item.source.state === "implemented"))
  assert.ok(problem.assertions.every((item) => item.windows.executor === "WIN-INDEXING-LIFECYCLE"))
})
