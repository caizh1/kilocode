import { mkdtemp, readFile, readdir, writeFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { describe, expect, test } from "bun:test"
import {
  CODE_GRAPH_PARSER_VERSION,
  CODE_GRAPH_SCHEMA_VERSION,
  type CodeGraphManifest,
} from "../../../../src/indexing/codegraph"
import { parseCodeGraphFile } from "../../../../src/indexing/codegraph/parser"
import { CodeGraphJsonStorage } from "../../../../src/indexing/codegraph/storage"

async function root() {
  return mkdtemp(path.join(tmpdir(), "codegraph-storage-test-"))
}

function sample(workspacePath: string, filePath = path.join(workspacePath, "src/main.c"), text = "int main(void) { return helper(); }\n") {
  return parseCodeGraphFile({
    workspacePath,
    filePath: path.relative(workspacePath, filePath),
    content: text,
    fileHash: digest(text),
    updatedAt: "2026-06-10T00:00:00.000Z",
  })
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const next = path.join(dir, item.name)
    if (item.isDirectory()) out.push(...(await walk(next)))
    else out.push(next)
  }
  return out
}

describe("CodeGraphJsonStorage", () => {
  test("upserts, gets, lists, and writes atomically with hashed graph filenames", async () => {
    const workspacePath = await root()
    const cacheDirectory = path.join(workspacePath, ".cache")
    const storage = new CodeGraphJsonStorage({ workspacePath, cacheDirectory, clock: () => new Date("2026-06-10T00:00:00.000Z") })
    const filePath = path.join(workspacePath, "src/main.c")
    const graph = sample(workspacePath, filePath)

    await storage.beginFullScan()
    await storage.upsertFileGraph(filePath, graph.fileHash, graph)
    await storage.markFullScanComplete()

    expect(await storage.listFiles()).toEqual(["src/main.c"])
    expect(await storage.getFileGraph(filePath)).toMatchObject({ filePath: "src/main.c", fileHash: graph.fileHash })
    expect(storage.status()).toMatchObject({
      recordCount: 1,
      validFileCount: 1,
      parseErrorCount: 0,
      unsupportedCount: 0,
      staleCount: 0,
      schemaMismatch: false,
      needsRebuild: false,
      lastFullScanAt: "2026-06-10T00:00:00.000Z",
      evidenceAvailable: false,
    })

    const manifest = JSON.parse(await readFile(path.join(cacheDirectory, "codegraph/v1/manifest.json"), "utf-8")) as CodeGraphManifest
    const record = manifest.records["src/main.c"]!
    expect(record.graphFile.endsWith(`${digest("src/main.c")}.json`)).toBe(true)
    expect(record.graphFile).toContain("files/")
    expect(record.graphFile).not.toContain("main.c")
    expect((await walk(path.join(cacheDirectory, "codegraph/v1"))).some((item) => item.endsWith(".tmp"))).toBe(false)
  })

  test("keeps same-hash upsert idempotent and updates changed files", async () => {
    const workspacePath = await root()
    const cacheDirectory = path.join(workspacePath, ".cache")
    const filePath = path.join(workspacePath, "main.c")
    let tick = 0
    const storage = new CodeGraphJsonStorage({
      workspacePath,
      cacheDirectory,
      clock: () => new Date(`2026-06-10T00:00:0${tick++}.000Z`),
    })
    const first = sample(workspacePath, filePath, "int first(void) { return 1; }\n")
    await storage.upsertFileGraph(filePath, first.fileHash, first)
    const manifestPath = path.join(cacheDirectory, "codegraph/v1/manifest.json")
    const before = JSON.parse(await readFile(manifestPath, "utf-8")) as CodeGraphManifest

    await storage.upsertFileGraph(filePath, first.fileHash, first)
    const same = JSON.parse(await readFile(manifestPath, "utf-8")) as CodeGraphManifest
    expect(same.records["main.c"]?.updatedAt).toBe(before.records["main.c"]?.updatedAt)

    const second = sample(workspacePath, filePath, "int second(void) { return 2; }\n")
    await storage.upsertFileGraph(filePath, second.fileHash, second)
    expect((await storage.getFileGraph(filePath))?.functions[0]?.name).toBe("second")
  })

  test("tracks parse_error, unsupported, stale, and schema mismatch without deleting old sidecar", async () => {
    const workspacePath = await root()
    const cacheDirectory = path.join(workspacePath, ".cache")
    const storage = new CodeGraphJsonStorage({ workspacePath, cacheDirectory })
    const filePath = path.join(workspacePath, "main.c")
    const graph = sample(workspacePath, filePath)

    await storage.upsertFileGraph(filePath, graph.fileHash, graph)
    await storage.markFileGraphStatus(filePath, "parse_error", { fileHash: "bad", error: "parse failed" })
    await storage.markFileGraphStatus(path.join(workspacePath, "readme.md"), "unsupported", { fileHash: "md" })
    await storage.removeFileGraph(path.join(workspacePath, "old.c"))
    expect(storage.status()).toMatchObject({
      recordCount: 3,
      validFileCount: 0,
      parseErrorCount: 1,
      unsupportedCount: 1,
      staleCount: 1,
    })
    expect(await storage.getFileGraph(filePath)).toBeUndefined()

    const manifestPath = path.join(cacheDirectory, "codegraph/v1/manifest.json")
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as CodeGraphManifest
    await writeFile(
      manifestPath,
      JSON.stringify({ ...manifest, graphSchemaVersion: CODE_GRAPH_SCHEMA_VERSION + 1, parserVersion: CODE_GRAPH_PARSER_VERSION + 1 }),
      "utf-8",
    )

    const mismatched = new CodeGraphJsonStorage({ workspacePath, cacheDirectory })
    expect(mismatched.status()).toMatchObject({
      recordCount: 3,
      validFileCount: 0,
      schemaMismatch: true,
      needsRebuild: true,
      evidenceAvailable: false,
    })
    expect(await mismatched.getFileGraph(filePath)).toBeUndefined()
  })
})

function digest(value: string): string {
  return `${fnv(value, 0x811c9dc5)}${fnv(value, 0x45d9f3b)}`
}

function fnv(value: string, seed: number): string {
  let hash = seed
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}
