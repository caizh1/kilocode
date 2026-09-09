import assert from "node:assert/strict"
import test from "node:test"
import { PatentDatabase } from "../src/database.js"
import type { SourceManifest } from "../src/contracts.js"

test("解析器升级后按当前 schema 清理隔离批次并重新进入暂存", async () => {
  const statements: string[] = []
  const client = {
    async query(sql: string) {
      statements.push(sql)
      if (sql.includes("FROM patent_documents")) return { rowCount: 0, rows: [] }
      return { rowCount: 1, rows: [] }
    },
    release() {},
  }
  const pool = {
    async query(sql: string) {
      statements.push(sql)
      return {
        rowCount: 1,
        rows: [{ id: "CN-2026-001", state: "QUARANTINED", parser_version: "old-parser" }],
      }
    },
    async connect() {
      return client
    },
  }
  const database = new PatentDatabase("postgresql://invalid")
  Object.assign(database, { pool })
  const manifest: SourceManifest = {
    schemaVersion: 1,
    batchId: "CN-2026-001",
    source: "CNIPA",
    jurisdiction: "CN",
    dataType: "mixed",
    files: [],
  }
  const result = await database.beginBatch(
    manifest,
    { filename: "batch.zip", sha256: "a".repeat(64), size: 1 },
    "new-parser",
  )
  assert.equal(result, "created")
  assert.ok(statements.some((sql) => sql.includes("DELETE FROM corpus_generations")))
  assert.ok(statements.some((sql) => sql.includes("failure_message=NULL")))
  assert.ok(statements.every((sql) => !/search_generations|failure_reason|started_at|completed_at/.test(sql)))
})
