import { afterEach, describe, expect, test } from "bun:test"
import { Database as BunDatabase } from "bun:sqlite"
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "fs/promises"
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

async function modified(file: string, offset: number) {
  const time = new Date(Date.now() + offset)
  await utimes(file, time, time)
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

  test("当前配置更新时优先并只补充缺失字段", async () => {
    const root = await temp()
    await writeFile(
      path.join(root, "kilo.json"),
      JSON.stringify({ indexing: { model: "legacy", "openai-compatible": { apiKey: "old-key" } }, mcp: { a: {} } }),
    )
    await writeFile(
      path.join(root, "chipmate.json"),
      JSON.stringify({ indexing: { model: "current", "openai-compatible": { apiKey: "new-key" } } }),
    )
    await modified(path.join(root, "kilo.json"), -20_000)
    await modified(path.join(root, "chipmate.json"), -10_000)

    await LegacyProductStateMigration.configDirectory(root)

    const data = JSON.parse(await readFile(path.join(root, "chipmate.json"), "utf8"))
    expect(data.indexing.model).toBe("current")
    expect(data.indexing["openai-compatible"].apiKey).toBe("new-key")
    expect(data.mcp).toEqual({ a: {} })
  })

  test("旧版配置更新时覆盖冲突字段并保留当前配置的补充字段", async () => {
    const root = await temp()
    const directory = path.join(root, ".chipmate-v2")
    await mkdir(directory)
    await Bun.write(
      path.join(directory, "chipmate.jsonc"),
      `{
  // 陈旧的新版配置
  "indexing": { "model": "qwen3-embedding-8b", "dimensionMode": "auto" },
  "mcp": { "current-only": {} }
}`,
    )
    await Bun.write(
      path.join(directory, "kilo.jsonc"),
      `{
  // 用户降级后最后选择的模型
  "indexing": { "model": "bge-m3", "dimensionMode": "auto" },
  "agent": { "review": { "prompt": "保留用户文本中的 kilo" } }
}`,
    )
    await modified(path.join(directory, "chipmate.jsonc"), -20_000)
    await modified(path.join(directory, "kilo.jsonc"), -10_000)

    await LegacyProductStateMigration.configDirectory(directory)

    const text = await readFile(path.join(directory, "chipmate.jsonc"), "utf8")
    const data = parse(text) as {
      indexing: { model: string; dimensionMode: string }
      mcp: Record<string, unknown>
      agent: { review: { prompt: string } }
    }
    expect(text).toContain("// 用户降级后最后选择的模型")
    expect(text).not.toContain("// 陈旧的新版配置")
    expect(data.indexing).toEqual({ model: "bge-m3", dimensionMode: "auto" })
    expect(data.mcp).toEqual({ "current-only": {} })
    expect(data.agent.review.prompt).toBe("保留用户文本中的 kilo")
    expect(await Bun.file(path.join(directory, "kilo.jsonc")).exists()).toBe(false)

    const first = text
    await LegacyProductStateMigration.configDirectory(directory)
    expect(await readFile(path.join(directory, "chipmate.jsonc"), "utf8")).toBe(first)
  })

  test("修改时间相同时当前配置优先", async () => {
    const root = await temp()
    const source = path.join(root, "kilo.json")
    const target = path.join(root, "chipmate.json")
    await writeFile(source, JSON.stringify({ indexing: { model: "bge-m3" }, legacyOnly: true }))
    await writeFile(target, JSON.stringify({ indexing: { model: "qwen3-embedding-8b" }, currentOnly: true }))
    const time = new Date(Date.now() - 10_000)
    await utimes(source, time, time)
    await utimes(target, time, time)

    await LegacyProductStateMigration.configDirectory(root)

    const data = JSON.parse(await readFile(target, "utf8"))
    expect(data.indexing.model).toBe("qwen3-embedding-8b")
    expect(data.legacyOnly).toBe(true)
    expect(data.currentOnly).toBe(true)
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
