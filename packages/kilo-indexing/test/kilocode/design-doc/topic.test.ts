import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { discoverDesignDocModule, extractTopicEvidence } from "../../../src/design-doc"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("主题证据提取", () => {
  test("完整返回全部相关函数签名，不在 Evidence Pack 之前破坏性采样", async () => {
    const root = await workspace()
    const declarations = Array.from(
      { length: 64 },
      (_, index) => `void operation_${String(index).padStart(2, "0")}(int value);`,
    )
    declarations.push("int atomic_queue_submit(const char *input, char *output);")
    await Bun.write(path.join(root, "module", "api.h"), `${declarations.join("\n")}\n`)
    const module = await discoverDesignDocModule({ workspace: root, targetPath: "module" })

    const responsibilities = await extractTopicEvidence(module, "responsibilities")
    const inputsOutputs = await extractTopicEvidence(module, "inputs-outputs")
    const concurrency = await extractTopicEvidence(module, "concurrency")

    expect(responsibilities.evidence).toHaveLength(65)
    expect(responsibilities.unknowns.some((item) => item.startsWith("topic-evidence-sampled:"))).toBe(false)
    expect(responsibilities.unknowns.some((item) => item.startsWith("topic-absence:"))).toBe(false)
    expect(
      inputsOutputs.evidence.some(
        (item) =>
          item.kind === "code-symbol" &&
          item.attributes.symbolKind === "function" &&
          item.attributes.name === "operation_00" &&
          item.snippet.includes("void operation_00(int value)"),
      ),
    ).toBe(true)
    expect(inputsOutputs.unknowns.some((item) => item.startsWith("topic-absence:"))).toBe(false)
    expect(
      concurrency.evidence.some(
        (item) => item.kind === "code-symbol" && item.attributes.name === "atomic_queue_submit",
      ),
    ).toBe(true)
    expect(concurrency.unknowns.some((item) => item.startsWith("topic-absence:"))).toBe(false)
  })

  test("把没有函数体的 TypeScript 方法签名识别为输入输出证据", async () => {
    const root = await workspace()
    await Bun.write(
      path.join(root, "module", "contract.ts"),
      `export interface Transport {
  send(input: string, retry: number): Promise<number>
}
`,
    )
    const module = await discoverDesignDocModule({ workspace: root, targetPath: "module" })

    const result = await extractTopicEvidence(module, "inputs-outputs")

    expect(
      result.evidence.some(
        (item) =>
          item.kind === "code-symbol" &&
          item.attributes.symbolKind === "method" &&
          item.attributes.qualifiedName === "Transport.send" &&
          item.snippet.includes("input: string, retry: number"),
      ),
    ).toBe(true)
    expect(result.unknowns.some((item) => item.startsWith("topic-absence:"))).toBe(false)
  })

  test("不会仅凭文件名中的并发关键词把主题判为适用", async () => {
    const root = await workspace()
    await Bun.write(path.join(root, "module", "atomic_queue.c"), "int value = 1;\n")
    const module = await discoverDesignDocModule({ workspace: root, targetPath: "module" })

    const result = await extractTopicEvidence(module, "concurrency")

    expect(result.evidence).toHaveLength(0)
    expect(result.unknowns.some((item) => item.startsWith("topic-absence:concurrency:"))).toBe(true)
  })

  test("标准库依赖不会被误写成配置或启动机制", async () => {
    const root = await workspace()
    await Bun.write(path.join(root, "module", "main.c"), "#include <stdint.h>\nint value = 1;\n")
    const module = await discoverDesignDocModule({ workspace: root, targetPath: "module" })

    const result = await extractTopicEvidence(module, "configuration-startup")

    expect(result.evidence).toHaveLength(0)
    expect(result.unknowns.some((item) => item.startsWith("topic-absence:configuration-startup:"))).toBe(true)
  })

  test("普通内存数据流也属于数据流转主题，并只携带被数据流引用的实体", async () => {
    const root = await workspace()
    await Bun.write(
      path.join(root, "module", "transform.c"),
      "int transform(int input) { int value = input + 1; return value; }\n",
    )
    const module = await discoverDesignDocModule({ workspace: root, targetPath: "module" })

    const result = await extractTopicEvidence(module, "data-persistence")
    const flows = result.evidence.filter((item) => item.kind === "data-flow")
    const referenced = new Set(
      flows.flatMap((item) => [String(item.attributes.fromRef), String(item.attributes.toRef)]),
    )
    const entities = result.evidence.filter((item) => item.kind === "data-entity")

    expect(flows.length).toBeGreaterThan(0)
    expect(entities.length).toBeGreaterThan(1)
    expect(entities.every((item) => referenced.has(String(item.attributes.ref)))).toBe(true)
    expect(result.unknowns.some((item) => item.startsWith("topic-absence:data-persistence:"))).toBe(false)
  })

  test("父模块主题只保留跨组件交接，组件内部完整分支留给子模块", async () => {
    const root = await workspace()
    await Bun.write(
      path.join(root, "module", "main.c"),
      "void start(int flag) { if (flag) handle(); else handle(); }\n",
    )
    await Bun.write(path.join(root, "module", "worker.c"), "void handle(void) { int value = 1; value++; }\n")
    const discovered = await discoverDesignDocModule({ workspace: root, targetPath: "module" })

    const result = await extractTopicEvidence({ ...discovered, unitKind: "root" }, "business-process")

    expect(
      result.evidence.some((item) => item.kind === "flow-edge" && String(item.attributes.label).includes("跨组件调用")),
    ).toBe(true)
    expect(
      result.evidence.some((item) => item.kind === "flow-node" && String(item.attributes.ref).includes("::decision@")),
    ).toBe(false)
  })
})

async function workspace() {
  const root = await mkdtemp(path.join(tmpdir(), "kilo-design-doc-topic-"))
  roots.push(root)
  await mkdir(path.join(root, "module"), { recursive: true })
  return root
}
