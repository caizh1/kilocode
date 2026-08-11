import { afterAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { discoverDesignDocModule, extractCodeStructureEvidence } from "@kilocode/kilo-indexing/design-doc"
import {
  buildCodeStructureEvidencePack,
  hasSufficientCodeStructureEvidence,
} from "../../../src/kilocode/design-doc/evidence"

interface BenchmarkCase {
  name: string
  content: string
  extension: "ts" | "c"
  supported: boolean
  symbols: string[]
}

const root = await mkdtemp(path.join(tmpdir(), "kilo-design-doc-code-structure-benchmark-"))

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("CodeStructure 30 模块固定基准", () => {
  test("20 个正样本完整发现声明，10 个负样本确定性拒绝", async () => {
    const cases = benchmarkCases()
    let supported = 0
    let rejected = 0

    expect(cases).toHaveLength(30)
    for (const [index, item] of cases.entries()) {
      const directory = path.join(root, `module-${String(index + 1).padStart(2, "0")}`)
      await mkdir(directory, { recursive: true })
      await Bun.write(path.join(directory, `api.${item.extension}`), item.content)
      const module = await discoverDesignDocModule({ workspace: root, targetPath: path.relative(root, directory) })
      const extraction = await extractCodeStructureEvidence(module)
      const pack = buildCodeStructureEvidencePack({
        extraction,
        workItemID: `WI-code-structure-${index + 1}`,
        maxItems: 64,
        maxPromptBytes: 48 * 1024,
        maxSnippetCharacters: 800,
      })
      const symbols = pack.evidence
        .filter((evidence) => evidence.kind === "code-symbol")
        .map((evidence) => `${evidence.attributes.qualifiedName}:${evidence.attributes.symbolKind}`)
        .sort()

      expect(symbols, `${item.name} 符号 oracle`).toEqual([...item.symbols].sort())
      expect(hasSufficientCodeStructureEvidence(pack), `${item.name} 支持判定`).toBe(item.supported)
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
    name: `TypeScript 声明 ${index}`,
    extension: "ts",
    supported: true,
    content: `export interface Service${index} { run(): void }
export class Worker${index} { start() {}; task = () => ${index} }
export function create${index}() { return new Worker${index}() }
`,
    symbols: [
      `Service${index}:interface`,
      `Service${index}.run:method`,
      `Worker${index}:class`,
      `Worker${index}.start:method`,
      `Worker${index}.task:method`,
      `create${index}:function`,
    ],
  }
}

function cCase(index: number): BenchmarkCase {
  return {
    name: `C 声明 ${index}`,
    extension: "c",
    supported: true,
    content: `typedef struct { int value; } CONTEXT_${index};
void declared_${index}(int value);
static int helper_${index}(void) { return ${index}; }
`,
    symbols: [`CONTEXT_${index}:struct`, `declared_${index}:function`, `helper_${index}:function`],
  }
}

function typescriptNegative(index: number): BenchmarkCase {
  return {
    name: `TypeScript 无声明结构 ${index}`,
    extension: "ts",
    supported: false,
    content: `export const value_${index} = ${index}\n`,
    symbols: [],
  }
}

function cNegative(index: number): BenchmarkCase {
  return {
    name: `C 无声明结构 ${index}`,
    extension: "c",
    supported: false,
    content: `int value_${index} = ${index};\n`,
    symbols: [],
  }
}
