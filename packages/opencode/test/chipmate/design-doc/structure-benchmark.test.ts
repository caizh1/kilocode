import { afterAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { discoverDesignDocModule, extractStructureEvidence } from "@chipmate/chipmate-indexing/design-doc"
import { buildStructureEvidencePack, hasSufficientStructureEvidence } from "../../../src/chipmate/design-doc/evidence"

interface BenchmarkCase {
  name: string
  files: Record<string, string>
  supported: boolean
  refs: string[]
  dependencies: string[]
}

const root = await mkdtemp(path.join(tmpdir(), "chipmate-design-doc-structure-benchmark-"))

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("Structure 30 模块固定基准", () => {
  test("20 个正样本完整发现文件依赖，10 个负样本确定性拒绝", async () => {
    const cases = benchmarkCases()
    let supported = 0
    let rejected = 0

    expect(cases).toHaveLength(30)
    for (const [index, item] of cases.entries()) {
      const directory = path.join(root, `module-${String(index + 1).padStart(2, "0")}`)
      await mkdir(directory, { recursive: true })
      await Promise.all(
        Object.entries(item.files).map(async ([file, content]) => {
          const target = path.join(directory, file)
          await mkdir(path.dirname(target), { recursive: true })
          await Bun.write(target, content)
        }),
      )
      const module = await discoverDesignDocModule({ workspace: root, targetPath: path.relative(root, directory) })
      const extraction = await extractStructureEvidence(module)
      const pack = buildStructureEvidencePack({
        extraction,
        workItemID: `WI-structure-${index + 1}`,
        maxItems: 64,
        maxPromptBytes: 48 * 1024,
        maxSnippetCharacters: 800,
      })
      const prefix = `${path.relative(root, directory).split(path.sep).join("/")}/`
      const refs = pack.evidence
        .filter((evidence) => evidence.kind === "source-file")
        .map((evidence) => String(evidence.attributes.ref).replace(prefix, ""))
        .sort()
      const dependencies = pack.evidence
        .filter((evidence) => evidence.kind === "dependency")
        .map(
          (evidence) =>
            `${String(evidence.attributes.from).replace(prefix, "")}->${String(evidence.attributes.to).replace(prefix, "")}`,
        )
        .sort()

      expect(refs, `${item.name} 文件 oracle`).toEqual([...item.refs].sort())
      expect(dependencies, `${item.name} 依赖 oracle`).toEqual([...item.dependencies].sort())
      expect(hasSufficientStructureEvidence(pack), `${item.name} 支持判定`).toBe(item.supported)
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
    ...Array.from({ length: 5 }, (_, index) => noTypeScriptDependency(index + 1)),
    ...Array.from({ length: 5 }, (_, index) => noCDependency(index + 1)),
  ]
}

function typescriptCase(index: number): BenchmarkCase {
  return {
    name: `TypeScript 结构 ${index}`,
    files: {
      "helper.ts": `export const helper${index} = ${index}\n`,
      "index.ts": `import { helper${index} } from "./helper.js"\nimport type { Effect } from "effect"\nexport { helper${index} }\n`,
    },
    supported: true,
    refs: ["helper.ts", "index.ts"],
    dependencies: ["index.ts->effect", "index.ts->helper.ts"],
  }
}

function cCase(index: number): BenchmarkCase {
  return {
    name: `C 结构 ${index}`,
    files: {
      "local.h": `void run_${index}(void);\n`,
      "main.c": `#include "local.h"\n#include <stdint.h>\nvoid run_${index}(void) {}\n`,
    },
    supported: true,
    refs: ["local.h", "main.c"],
    dependencies: ["main.c->local.h", "main.c->stdint.h"],
  }
}

function noTypeScriptDependency(index: number): BenchmarkCase {
  return {
    name: `TypeScript 无依赖 ${index}`,
    files: { "value.ts": `export const value${index} = ${index}\n` },
    supported: false,
    refs: ["value.ts"],
    dependencies: [],
  }
}

function noCDependency(index: number): BenchmarkCase {
  return {
    name: `C 无依赖 ${index}`,
    files: { "value.c": `int value_${index}(void) { return ${index}; }\n` },
    supported: false,
    refs: ["value.c"],
    dependencies: [],
  }
}
