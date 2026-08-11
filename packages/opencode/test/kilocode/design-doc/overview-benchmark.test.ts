import { afterAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { discoverDesignDocModule, extractOverviewEvidence } from "@kilocode/kilo-indexing/design-doc"
import { buildOverviewEvidencePack, hasSufficientOverviewEvidence } from "../../../src/kilocode/design-doc/evidence"

interface BenchmarkCase {
  name: string
  extension: "ts" | "c"
  content: string
  supported: boolean
  symbols: string[]
}

const root = await mkdtemp(path.join(tmpdir(), "kilo-design-doc-overview-benchmark-"))

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("Overview 30 模块固定基准", () => {
  test("20 个可追溯模块概览通过，10 个无声明模块确定性拒绝", async () => {
    const cases = benchmarkCases()
    let supported = 0
    let rejected = 0

    expect(cases).toHaveLength(30)
    for (const [index, item] of cases.entries()) {
      const directory = path.join(root, `module-${String(index + 1).padStart(2, "0")}`)
      await mkdir(directory, { recursive: true })
      await Bun.write(path.join(directory, `overview.${item.extension}`), item.content)
      const module = await discoverDesignDocModule({ workspace: root, targetPath: path.relative(root, directory) })
      const extraction = await extractOverviewEvidence(module)
      const pack = buildOverviewEvidencePack({
        extraction,
        workItemID: `WI-overview-${index + 1}`,
        maxItems: 64,
        maxPromptBytes: 48 * 1024,
        maxSnippetCharacters: 800,
      })
      const symbols = pack.evidence
        .filter((evidence) => evidence.kind === "code-symbol")
        .map((evidence) => String(evidence.attributes.qualifiedName))
        .sort()

      expect(symbols, `${item.name} 符号 oracle`).toEqual([...item.symbols].sort())
      expect(hasSufficientOverviewEvidence(pack), `${item.name} 支持判定`).toBe(item.supported)
      if (item.supported) supported += 1
      else rejected += 1
    }

    expect(supported).toBe(20)
    expect(rejected).toBe(10)
  })
})

function benchmarkCases(): BenchmarkCase[] {
  return [
    ...Array.from({ length: 10 }, (_, index) => typescriptCase(index + 1)),
    ...Array.from({ length: 10 }, (_, index) => cCase(index + 1)),
    ...Array.from({ length: 5 }, (_, index) => typescriptNegative(index + 1)),
    ...Array.from({ length: 5 }, (_, index) => cNegative(index + 1)),
  ]
}

function typescriptCase(index: number): BenchmarkCase {
  return {
    name: `TypeScript 概览 ${index}`,
    extension: "ts",
    supported: true,
    content: `export class Service${index} {
  run(value: number) { return value + ${index} }
}
export function create${index}() { return new Service${index}() }
`,
    symbols: [`create${index}`],
  }
}

function cCase(index: number): BenchmarkCase {
  return {
    name: `C 概览 ${index}`,
    extension: "c",
    supported: true,
    content: `typedef struct { int value; } CONTEXT_${index};
int run_${index}(CONTEXT_${index} *context) { return context->value; }
`,
    symbols: [`run_${index}`],
  }
}

function typescriptNegative(index: number): BenchmarkCase {
  return {
    name: `TypeScript 无概览声明 ${index}`,
    extension: "ts",
    supported: false,
    content: `export const value_${index} = ${index}\n`,
    symbols: [],
  }
}

function cNegative(index: number): BenchmarkCase {
  return {
    name: `C 无概览声明 ${index}`,
    extension: "c",
    supported: false,
    content: `int value_${index} = ${index};\n`,
    symbols: [],
  }
}
