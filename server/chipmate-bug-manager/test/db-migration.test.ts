import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { test } from "node:test"
import { Store } from "../src/db.js"

test("现有执行日志数据库自动增加详情字段", () => {
  const directory = mkdtempSync(join(tmpdir(), "chipmate-bug-db-"))
  const path = join(directory, "bugs.sqlite")
  try {
    const legacy = new DatabaseSync(path)
    legacy.exec(`
      CREATE TABLE run_logs (
        id INTEGER PRIMARY KEY,
        run_id INTEGER NOT NULL,
        stage TEXT NOT NULL,
        kind TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        summary TEXT,
        created_at TEXT NOT NULL
      )
    `)
    legacy.close()

    const store = new Store(path)
    const columns = store.db.prepare("PRAGMA table_info(run_logs)").all() as Array<{ name: string }>
    assert.equal(columns.some((column) => column.name === "detail"), true)
    store.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
