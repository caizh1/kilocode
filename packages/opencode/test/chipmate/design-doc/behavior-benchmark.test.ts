import { afterAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { discoverDesignDocModule, extractBehaviorEvidence } from "@chipmate/chipmate-indexing/design-doc"
import { buildBehaviorEvidencePack, hasSufficientBehaviorEvidence } from "../../../src/chipmate/design-doc/evidence"

type View = "execution-flow" | "sequence" | "data-flow" | "error-flow"

interface BenchmarkCase {
  name: string
  extension: "ts" | "c"
  content: string
  supported: boolean
}

const root = await mkdtemp(path.join(tmpdir(), "chipmate-design-doc-behavior-benchmark-"))

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("Behavior 30 模块固定基准", () => {
  test("20 个多视角正样本通过，10 个无行为样本确定性拒绝", async () => {
    const cases = benchmarkCases()
    const views: View[] = ["execution-flow", "sequence", "data-flow", "error-flow"]
    const counts = new Map(views.map((view) => [view, { passed: 0, rejected: 0 }]))

    expect(cases).toHaveLength(30)
    for (const [index, item] of cases.entries()) {
      const directory = path.join(root, `module-${String(index + 1).padStart(2, "0")}`)
      await mkdir(directory, { recursive: true })
      await Bun.write(path.join(directory, `runner.${item.extension}`), item.content)
      const module = await discoverDesignDocModule({ workspace: root, targetPath: path.relative(root, directory) })
      const extraction = await extractBehaviorEvidence(module)
      for (const view of views) {
        const pack = buildBehaviorEvidencePack({
          artifactType: view,
          extraction,
          workItemID: `WI-${view}-${index + 1}`,
          maxItems: 128,
          maxPromptBytes: 128 * 1024,
          maxSnippetCharacters: 1_200,
        })
        const actual = hasSufficientBehaviorEvidence(pack)
        expect(actual, `${item.name} / ${view}`).toBe(item.supported)
        const count = counts.get(view)!
        if (actual) count.passed += 1
        else count.rejected += 1
      }
    }

    for (const view of views) expect(counts.get(view), view).toEqual({ passed: 20, rejected: 10 })
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
    name: `TypeScript 行为 ${index}`,
    extension: "ts",
    supported: true,
    content: `function persist${index}(value: number) { return value }
export function run${index}(input: number) {
  let output = input
  if (input > 0) output = persist${index}(input)
  if (output < 0) throw new Error("negative")
  return output
}
`,
  }
}

function cCase(index: number): BenchmarkCase {
  return {
    name: `C 行为 ${index}`,
    extension: "c",
    supported: true,
    content: `static int persist_${index}(int value) { return value; }
int run_${index}(int input) {
  int output = input;
  if (input > 0) output = persist_${index}(input);
  if (output < 0) goto failed;
  return output;
failed:
  return -1;
}
`,
  }
}

function typescriptNegative(index: number): BenchmarkCase {
  return {
    name: `TypeScript 无行为 ${index}`,
    extension: "ts",
    supported: false,
    content: `export const value_${index} = ${index}\n`,
  }
}

function cNegative(index: number): BenchmarkCase {
  return {
    name: `C 无行为 ${index}`,
    extension: "c",
    supported: false,
    content: `int value_${index} = ${index};\n`,
  }
}
