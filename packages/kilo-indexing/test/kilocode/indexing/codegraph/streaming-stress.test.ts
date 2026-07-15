import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { expect, test } from "bun:test"
import { parseCodeGraphFile } from "../../../../src/indexing/codegraph/parser"
import { CodeGraphJsonStorage, CodePostingsJsonStorage } from "../../../../src/indexing/codegraph/storage"

const files = Number(process.env.KILO_INDEXING_STRESS_FILES ?? 1260)
const target = Number(process.env.KILO_INDEXING_STRESS_LINES ?? 3_100_000)
const symbols = Number(process.env.KILO_INDEXING_STRESS_SYMBOLS_PER_FILE ?? 32)
const stress = process.env.KILO_INDEXING_STRESS === "1" ? test : test.skip

stress(
  "rebuilds a 3M+ line C corpus with bounded graph and postings memory",
  async () => {
    Bun.gc(true)
    const baseline = process.memoryUsage.rss()
    let peak = baseline
    const timer = setInterval(() => {
      peak = Math.max(peak, process.memoryUsage.rss())
    }, 5)
    const workspacePath = await mkdtemp(path.join(tmpdir(), "codegraph-streaming-stress-"))
    const cacheDirectory = path.join(workspacePath, ".cache")
    const graph = new CodeGraphJsonStorage({ workspacePath, cacheDirectory })
    const postings = new CodePostingsJsonStorage({ workspacePath, cacheDirectory })
    const lines = Math.ceil(target / files)
    let total = 0

    await graph.beginFullScan()
    await postings.beginFullScan()
    for (let index = 0; index < files; index += 1) {
      const filePath = `drivers/unit_${index}.c`
      const declarations = Array.from(
        { length: symbols },
        (_, symbol) => `int unit_${index}_${symbol}(void) { return UNIT_${index}_REG + ${symbol}; }`,
      )
      const fixed = declarations.length + 3
      const content = [
        `#define UNIT_${index}_REG ${index}`,
        ...declarations,
        `int caller_${index}(void) { return unit_${index}_0(); }`,
        ...Array.from({ length: Math.max(0, lines - fixed) }, () => "// shared_timeout_error evidence"),
        "",
      ].join("\n")
      total += content.split("\n").length
      const parsed = parseCodeGraphFile({
        workspacePath,
        filePath,
        content,
        fileHash: Bun.hash(content).toString(16),
        updatedAt: "2026-07-14T00:00:00.000Z",
      })
      await graph.upsertFileGraph(filePath, parsed.fileHash, parsed)
      await postings.upsertFilePostings(filePath, parsed.fileHash, parsed, { content })
    }
    await graph.markFullScanComplete()
    await postings.markFullScanComplete()
    clearInterval(timer)
    peak = Math.max(peak, process.memoryUsage.rss())

    expect((await graph.listFiles()).length).toBe(files)
    expect((await postings.listFiles()).length).toBe(files)
    expect((await postings.search(`UNIT_${files - 1}_REG`))[0]?.filePath).toBe(`drivers/unit_${files - 1}.c`)
    expect(total).toBeGreaterThanOrEqual(target)
    expect(peak - baseline).toBeLessThan(1024 * 1024 * 1024)
  },
  10 * 60_000,
)
