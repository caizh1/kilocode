import { afterEach, describe, expect, test } from "bun:test"
import { Database as BunDatabase } from "bun:sqlite"
import { mkdtemp, readFile, readdir, rm, writeFile } from "fs/promises"
import os from "os"
import path from "path"
import { parse } from "jsonc-parser"
import { LegacyProductStateMigration } from "@/chipmate/migration/legacy-product-state"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function temp() {
  const root = await mkdtemp(path.join(os.tmpdir(), "chipmate-migration-"))
  roots.push(root)
  return root
}

describe("旧产品状态迁移", () => {
  test("迁移 JSONC 配置并保留注释、密钥和用户文本", async () => {
    const root = await temp()
    await writeFile(
      path.join(root, "kilo.jsonc"),
      `{
  // 保留这条注释
  "$schema": "https://app.kilo.ai/config.json",
  "provider": { "kilo": { "options": { "apiKey": "chat-secret" } } },
  "indexing": {
    "provider": "kilo",
    "openai-compatible": { "apiKey": "embedding-secret", "baseUrl": "https://example.test/embeddings" }
  },
  "model": "kilo/model-a",
  "agent": { "review": { "model": "kilo/model-b", "prompt": "do not replace kilo in prose" } }
}`,
    )

    await LegacyProductStateMigration.configDirectory(root)

    const text = await readFile(path.join(root, "chipmate.jsonc"), "utf8")
    const data = parse(text) as {
      $schema: string
      provider: Record<string, { options: { apiKey: string } }>
      indexing: { provider: string; "openai-compatible": { apiKey: string } }
      model: string
      agent: { review: { model: string; prompt: string } }
    }
    expect(text).toContain("// 保留这条注释")
    expect(data.$schema).toBe("https://app.chipmate.ai/config.json")
    expect(data.provider.chipmate.options.apiKey).toBe("chat-secret")
    expect(data.provider.kilo).toBeUndefined()
    expect(data.indexing.provider).toBe("chipmate")
    expect(data.indexing["openai-compatible"].apiKey).toBe("embedding-secret")
    expect(data.model).toBe("chipmate/model-a")
    expect(data.agent.review.model).toBe("chipmate/model-b")
    expect(data.agent.review.prompt).toBe("do not replace kilo in prose")
    expect(await Bun.file(path.join(root, "kilo.jsonc")).exists()).toBe(false)
    expect((await readdir(path.join(root, "migration-backup"))).some((file) => file.endsWith(".bak"))).toBe(true)

    const first = text
    await LegacyProductStateMigration.configDirectory(root)
    expect(await readFile(path.join(root, "chipmate.jsonc"), "utf8")).toBe(first)
  })

  test("当前配置优先并只补充缺失字段", async () => {
    const root = await temp()
    await writeFile(
      path.join(root, "kilo.json"),
      JSON.stringify({ indexing: { model: "legacy", "openai-compatible": { apiKey: "old-key" } }, mcp: { a: {} } }),
    )
    await writeFile(
      path.join(root, "chipmate.json"),
      JSON.stringify({ indexing: { model: "current", "openai-compatible": { apiKey: "new-key" } } }),
    )

    await LegacyProductStateMigration.configDirectory(root)

    const data = JSON.parse(await readFile(path.join(root, "chipmate.json"), "utf8"))
    expect(data.indexing.model).toBe("current")
    expect(data.indexing["openai-compatible"].apiKey).toBe("new-key")
    expect(data.mcp).toEqual({ a: {} })
  })

  test("损坏的旧配置不会阻塞启动且保留源文件供后续重试", async () => {
    const root = await temp()
    await writeFile(path.join(root, "kilo.jsonc"), "{ invalid")

    await expect(LegacyProductStateMigration.configDirectory(root)).resolves.toBeUndefined()

    expect(await readFile(path.join(root, "kilo.jsonc"), "utf8")).toBe("{ invalid")
    expect(await Bun.file(path.join(root, "chipmate.jsonc")).exists()).toBe(false)
  })

  test("只转换结构化 provider 字段和 variant 键", () => {
    expect(
      LegacyProductStateMigration.transformPersistedState({
        recent: [{ providerID: "kilo", modelID: "m" }],
        variant: { "kilo/m": "high", "agent/code/kilo/m": "max" },
        content: "kilo must remain in user text",
      }),
    ).toEqual({
      recent: [{ providerID: "chipmate", modelID: "m" }],
      variant: { "chipmate/m": "high", "agent/code/chipmate/m": "max" },
      content: "kilo must remain in user text",
    })
  })

  test("事务迁移 SQLite 结构化字段且不改消息正文", async () => {
    const root = await temp()
    const file = path.join(root, "chipmate.db")
    const db = new BunDatabase(file)
    db.run("CREATE TABLE session (model TEXT)")
    db.run("CREATE TABLE message (data TEXT)")
    db.run("CREATE TABLE part (data TEXT)")
    db.run("CREATE TABLE session_message (data TEXT)")
    db.run("CREATE TABLE session_input (prompt TEXT)")
    db.query("INSERT INTO session(model) VALUES (?)").run(JSON.stringify({ id: "m", providerID: "kilo" }))
    db.query("INSERT INTO message(data) VALUES (?)").run(
      JSON.stringify({ role: "user", providerID: "kilo", content: "keep kilo in text" }),
    )
    db.close()

    LegacyProductStateMigration.database(file)
    LegacyProductStateMigration.database(file)

    const check = new BunDatabase(file)
    const session = JSON.parse((check.query("SELECT model FROM session").get() as { model: string }).model)
    const message = JSON.parse((check.query("SELECT data FROM message").get() as { data: string }).data)
    const markers = check.query("SELECT count(*) AS count FROM chipmate_data_migration").get() as { count: number }
    check.close()
    expect(session.providerID).toBe("chipmate")
    expect(message.providerID).toBe("chipmate")
    expect(message.content).toBe("keep kilo in text")
    expect(markers.count).toBe(1)
  })
})
