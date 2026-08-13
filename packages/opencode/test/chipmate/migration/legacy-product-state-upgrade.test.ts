import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, readdir, rm, writeFile } from "fs/promises"
import os from "os"
import path from "path"
import { parse } from "jsonc-parser"
import { LegacyProductStateMigration } from "@/chipmate/migration/legacy-product-state"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("1.0.19 到 1.1.0 配置升级", () => {
  test("在索引初始化前保留 bge-m3、1024 维和认证配置", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chipmate-1-0-19-upgrade-"))
    roots.push(root)
    await writeFile(
      path.join(root, "kilo.jsonc"),
      `{
  // 1.0.19 用户已经完成的索引配置
  "indexing": {
    "enabled": true,
    "provider": "openai-compatible",
    "model": "bge-m3",
    "dimension": 1024,
    "vectorStore": "lancedb",
    "openai-compatible": {
      "baseUrl": "https://example.test/v1",
      "apiKey": "保留的嵌入密钥"
    }
  }
}`,
    )

    await LegacyProductStateMigration.configDirectory(root)

    const text = await readFile(path.join(root, "chipmate.jsonc"), "utf8")
    const data = parse(text) as {
      indexing: {
        enabled: boolean
        provider: string
        model: string
        dimension: number
        vectorStore: string
        "openai-compatible": { baseUrl: string; apiKey: string }
      }
    }
    expect(text).toContain("// 1.0.19 用户已经完成的索引配置")
    expect(data.indexing).toEqual({
      enabled: true,
      provider: "openai-compatible",
      model: "bge-m3",
      dimension: 1024,
      vectorStore: "lancedb",
      "openai-compatible": {
        baseUrl: "https://example.test/v1",
        apiKey: "保留的嵌入密钥",
      },
    })
    expect(await Bun.file(path.join(root, "kilo.jsonc")).exists()).toBe(false)
    expect((await readdir(path.join(root, "migration-backup"))).some((file) => file.endsWith(".bak"))).toBe(true)
  })
})
