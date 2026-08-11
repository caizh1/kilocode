import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { discoverLogicalDesignDocUnits, extractProductEvidence } from "@chipmate/chipmate-indexing/design-doc"
import {
  canRegisterAttempt,
  nextAttemptNumber,
  normalizeOptionalNulls,
  scopeProductEvidenceToLogicalOwner,
} from "@/chipmate/design-doc/manager"
import type { ProductExtractionResult } from "@chipmate/chipmate-indexing/design-doc"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("产品详细设计逻辑模块发现", () => {
  test("同一 WorkItem 不能并行注册两个活动 Attempt", () => {
    expect(canRegisterAttempt({ status: "running", attempts: [] })).toBeTrue()
    expect(canRegisterAttempt({ status: "ready", attempts: [] })).toBeTrue()
    expect(canRegisterAttempt({ status: "retryable", attempts: [] })).toBeTrue()
    expect(canRegisterAttempt({ status: "validating", attempts: [] })).toBeFalse()
    expect(canRegisterAttempt({ status: "passed", attempts: [] })).toBeFalse()
    expect(
      canRegisterAttempt({
        status: "running",
        attempts: [
          {
            number: 1,
            kind: "generate",
            sessionID: "session-1",
            model: { providerID: "deepseek", modelID: "deepseek-v4-flash", variant: "thinking" },
            status: "running",
            startedAt: 1,
          },
        ],
      }),
    ).toBeFalse()
  })

  test("历史 Attempt 编号重复时从最大编号继续", () => {
    expect(nextAttemptNumber([])).toBe(1)
    expect(nextAttemptNumber([{ number: 1 }, { number: 2 }, { number: 2 }, { number: 4 }])).toBe(5)
  })

  test("结构化候选把可选 null 归一化为缺省且保留数组顺序", () => {
    expect(
      normalizeOptionalNulls({ guard: null, action: "提交", nested: { note: null, value: 1 }, values: [null, 2] }),
    ).toEqual({ action: "提交", nested: { value: 1 }, values: [null, 2] })
  })

  test("纯头文件和支撑实现不会被误拆为子模块，编译单元只有一个所有者", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "design-doc-logical-"))
    roots.push(workspace)
    await mkdir(path.join(workspace, "nvme"), { recursive: true })
    await Promise.all([
      writeFile(path.join(workspace, "nvme/main.c"), "void nvme_main(void) { dma_init(); dma_submit(); helper(); }\n"),
      writeFile(path.join(workspace, "nvme/main.h"), "void nvme_main(void);\n"),
      writeFile(
        path.join(workspace, "nvme/dma.c"),
        "static unsigned dma_queue[16];\nvoid dma_init(void) {}\nvoid dma_submit(void) {}\n",
      ),
      writeFile(path.join(workspace, "nvme/dma.h"), "void dma_init(void);\nvoid dma_submit(void);\n"),
      writeFile(path.join(workspace, "nvme/helper.c"), "static void helper_inner(void) {}\nvoid helper(void) { helper_inner(); }\n"),
      writeFile(path.join(workspace, "nvme/types.h"), "typedef struct { unsigned status; } NVME_CONTEXT;\n"),
    ])

    const tree = await discoverLogicalDesignDocUnits({ workspace, targetPath: "nvme" })

    expect(tree.modules).toHaveLength(2)
    expect(tree.modules.find((module) => module.unitKind === "logical-submodule")?.name).toBe("dma")
    expect(tree.modules.some((module) => module.name === "types")).toBeFalse()
    expect(tree.modules.some((module) => module.name === "helper")).toBeFalse()
    const ownership = tree.ownership ?? []
    expect(ownership).toHaveLength(6)
    expect(new Set(ownership.map((item) => item.path)).size).toBe(6)
    expect(ownership.find((item) => item.path.endsWith("dma.c"))?.ownerModuleID).toBe(
      tree.modules.find((module) => module.name === "dma")?.id,
    )
  })

  test("moduleHints 可确定性合并多个实现文件且拒绝重复所有权", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "design-doc-hints-"))
    roots.push(workspace)
    await mkdir(path.join(workspace, "module/io"), { recursive: true })
    await writeFile(path.join(workspace, "module/io/read.c"), "void read_io(void) {}\n")
    await writeFile(path.join(workspace, "module/io/write.c"), "void write_io(void) {}\n")

    const tree = await discoverLogicalDesignDocUnits({
      workspace,
      targetPath: "module",
      moduleHints: [{ name: "IO 数据通路", includePaths: ["io"] }],
    })

    const child = tree.modules.find((module) => module.name === "IO 数据通路")
    expect(child?.files.map((file) => file.path).sort()).toEqual(["module/io/read.c", "module/io/write.c"])
    expect(tree.ownership?.filter((item) => item.ownerModuleID === child?.id)).toHaveLength(2)
  })

  test("根模块产品章节只保留根所有事实和跨逻辑模块关系", () => {
    const root = {
      id: "root",
      name: "控制器",
      path: "module",
      absolutePath: "/workspace/module",
      sourceSnapshotHash: "snapshot",
      files: [],
      totalBytes: 0,
      unitKind: "root" as const,
    }
    const source = (sourcePath: string, sourceKind: "production" | "document" = "production") => ({
      path: sourcePath,
      contentHash: "hash",
      startLine: 1,
      endLine: 1,
      sourceKind,
    })
    const result: ProductExtractionResult = {
      moduleID: root.id,
      sourceSnapshotHash: root.sourceSnapshotHash,
      section: "data-entities",
      unknowns: [],
      evidence: [
        {
          kind: "data-entity",
          fact: "根模块上下文",
          source: source("module/main.c"),
          attributes: {},
          confidence: "explicit",
          snippet: "context",
        },
        {
          kind: "data-entity",
          fact: "DMA 私有队列",
          source: source("module/dma.c"),
          attributes: {},
          confidence: "explicit",
          snippet: "queue",
        },
        {
          kind: "data-flow",
          fact: "DMA 向 IO 传递请求",
          source: source("module/dma.c"),
          attributes: { fromRef: "module/dma.c#submit", toRef: "module/io.c#handle" },
          confidence: "explicit",
          snippet: "submit();",
        },
        {
          kind: "requirement",
          fact: "外部需求",
          source: source("requirements.docx", "document"),
          attributes: {},
          confidence: "explicit",
          snippet: "REQ-1",
        },
      ],
    }
    const scoped = scopeProductEvidenceToLogicalOwner(result, root, {
      rootModuleID: root.id,
      modules: [root],
      sourceSnapshotHash: root.sourceSnapshotHash,
      ownership: [
        { path: "module/main.c", ownerModuleID: root.id, role: "implementation" },
        { path: "module/dma.c", ownerModuleID: "dma", role: "implementation" },
        { path: "module/io.c", ownerModuleID: "io", role: "implementation" },
      ],
    })

    expect(scoped.evidence.map((item) => item.fact)).toEqual(["根模块上下文", "DMA 向 IO 传递请求", "外部需求"])
  })

  test("数据实体章节不把函数间数据流误拆成实体", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "design-doc-entity-"))
    roots.push(workspace)
    await mkdir(path.join(workspace, "module"), { recursive: true })
    await writeFile(
      path.join(workspace, "module/main.ts"),
      "interface Request { id: number }\nfunction send(value: Request) { return consume(value) }\nfunction consume(value: Request) { return value.id }\n",
    )
    const tree = await discoverLogicalDesignDocUnits({ workspace, targetPath: "module" })
    const root = tree.modules.find((module) => module.id === tree.rootModuleID)!
    const extraction = await extractProductEvidence({ workspace, module: root, section: "data-entities" })

    expect(extraction.evidence.some((item) => item.kind === "data-flow")).toBeFalse()
    expect(extraction.evidence.some((item) => String(item.attributes.ref).startsWith("root-component-data:"))).toBeFalse()
    expect(extraction.evidence.some((item) => item.kind === "data-entity" || item.kind === "code-symbol")).toBeTrue()
  })

  test("模块概述只收集函数入口而不吞入全部控制流节点", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "design-doc-overview-"))
    roots.push(workspace)
    await mkdir(path.join(workspace, "module"), { recursive: true })
    await writeFile(
      path.join(workspace, "module/worker.ts"),
      "export function run(value: number) { if (value > 0) { while (value > 1) value-- } return value }\n",
    )
    const tree = await discoverLogicalDesignDocUnits({ workspace, targetPath: "module" })
    const worker = tree.modules.find((module) => module.unitKind === "logical-submodule")!
    const extraction = await extractProductEvidence({ workspace, module: worker, section: "module-overview" })
    const flowNodes = extraction.evidence.filter((item) => item.kind === "flow-node")

    expect(flowNodes.length).toBeGreaterThan(0)
    expect(flowNodes.every((item) => item.attributes.nodeKind === "entry")).toBeTrue()
  })

  test("资源性能章节不把普通 DMA 操作误当成资源约束", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "design-doc-resource-"))
    roots.push(workspace)
    await mkdir(path.join(workspace, "module"), { recursive: true })
    await writeFile(
      path.join(workspace, "module/dma.ts"),
      "export interface DmaQueue { capacity: number }\nexport function submitDma(queue: DmaQueue) { if (queue.capacity > 0) return queue.capacity; return 0 }\n",
    )
    const tree = await discoverLogicalDesignDocUnits({ workspace, targetPath: "module" })
    const dma = tree.modules.find((module) => module.unitKind === "logical-submodule")!
    const extraction = await extractProductEvidence({ workspace, module: dma, section: "resource-performance" })

    expect(extraction.evidence.some((item) => item.kind === "resource")).toBeTrue()
    expect(extraction.evidence.some((item) => item.attributes.nodeKind === "action")).toBeFalse()
  })
})
