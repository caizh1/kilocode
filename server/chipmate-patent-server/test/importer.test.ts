import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import type { Config } from "../src/config.js"
import type { PatentDatabase } from "../src/database.js"
import { PatentImporter } from "../src/importer.js"
import type { OpenSearchStore } from "../src/opensearch.js"

test("损坏 manifest 仍保存原始包并隔离，不中断扫描进程", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chipmate-patent-importer-"))
  try {
    const importer = create(root, {
      withImportLock: async (callback: () => Promise<unknown>) => callback(),
    } as unknown as PatentDatabase)
    await importer.raw.initialize()
    importer.raw.stable = async () => true
    const file = path.join(importer.raw.paths.drop, "CN-broken.xml")
    await fs.writeFile(file, "<exchange-documents/>")
    await fs.writeFile(`${file}.manifest.json`, "{损坏的清单")
    const result = await importer.import(file)
    assert.equal(result.status, "quarantined")
    const raw = await fs.readdir(importer.raw.paths.raw, { recursive: true })
    assert.ok(raw.some((name) => String(name).endsWith("payload.xml")))
    assert.equal((await fs.readdir(importer.raw.paths.quarantine)).length, 2)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("同批次不同哈希被拒绝时不会把既有在线批次标记隔离", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chipmate-patent-importer-"))
  let quarantined = 0
  try {
    const database = {
      withImportLock: async (callback: () => Promise<unknown>) => callback(),
      beginBatch: async () => {
        throw new Error("批次已存在但 SHA-256 不同")
      },
      quarantine: async () => {
        quarantined += 1
      },
    } as unknown as PatentDatabase
    const importer = create(root, database)
    await importer.raw.initialize()
    importer.raw.stable = async () => true
    const file = path.join(importer.raw.paths.drop, "CN-fulltext.xml")
    await fs.writeFile(file, "<exchange-documents/>")
    await fs.writeFile(
      `${file}.manifest.json`,
      JSON.stringify({
        schemaVersion: 1,
        source: "CNIPA",
        jurisdiction: "CN",
        batchId: "CN-conflict",
        dataType: "fulltext",
      }),
    )
    const result = await importer.import(file)
    assert.equal(result.status, "quarantined")
    assert.equal(quarantined, 0)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

function create(root: string, database: PatentDatabase) {
  const config: Config = {
    host: "127.0.0.1",
    port: 6020,
    databaseUrl: "postgresql://unused",
    opensearchUrl: "http://unused",
    dataRoot: root,
    allowedCidrs: ["127.0.0.1/32"],
    searchMaxConcurrency: 1,
    jurisdictions: ["CN", "JP", "KR", "US", "EP", "RU"],
    allowIncompleteCorpusSearch: false,
    rerankMode: "off",
  }
  return new PatentImporter(config, database, {} as OpenSearchStore)
}
