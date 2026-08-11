import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "crypto"
import { PhotonImage } from "@silvia-odwyer/photon-node"
import { mkdir, readFile, writeFile } from "fs/promises"
import path from "path"
import { assembleDesignDocument, buildQualityReport } from "@/kilocode/design-doc/assembler"
import { buildFullDesignWorkItems } from "@/kilocode/design-doc/content-contract"
import { inspectWordDocument } from "@/kilocode/documents/word"
import type { Artifact, DesignDocJob, EvidencePack, WorkItem } from "@/kilocode/design-doc/domain"
import { artifact, DesignDocStore } from "@/kilocode/design-doc/store"
import { provideTestInstance, tmpdir } from "../../fixture/fixture"

const roots: AsyncDisposable[] = []
const PAGE_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAS0lEQVR4Ae3AA6AkWZbG8f937o3IzKdyS2Oubdu2bdu2bdu2bWmMnpZKr54yMyLu+Xa3anqmhztr1a+efvSrm2ej8pyoPCcqz4l/BGF0AYgN8w88AAAAAElFTkSuQmCC"
const ONE_PAGE_PDF =
  "JVBERi0xLjMKJZOMi54gUmVwb3J0TGFiIEdlbmVyYXRlZCBQREYgZG9jdW1lbnQgKG9wZW5zb3VyY2UpCjEgMCBvYmoKPDwKL0YxIDIgMCBSCj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9CYXNlRm9udCAvSGVsdmV0aWNhIC9FbmNvZGluZyAvV2luQW5zaUVuY29kaW5nIC9OYW1lIC9GMSAvU3VidHlwZSAvVHlwZTEgL1R5cGUgL0ZvbnQKPj4KZW5kb2JqCjMgMCBvYmoKPDwKL0NvbnRlbnRzIDcgMCBSIC9NZWRpYUJveCBbIDAgMCA2MTIgNzkyIF0gL1BhcmVudCA2IDAgUiAvUmVzb3VyY2VzIDw8Ci9Gb250IDEgMCBSIC9Qcm9jU2V0IFsgL1BERiAvVGV4dCAvSW1hZ2VCIC9JbWFnZUMgL0ltYWdlSSBdCj4+IC9Sb3RhdGUgMCAvVHJhbnMgPDwKCj4+IAogIC9UeXBlIC9QYWdlCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9QYWdlTW9kZSAvVXNlTm9uZSAvUGFnZXMgNiAwIFIgL1R5cGUgL0NhdGFsb2cKPj4KZW5kb2JqCjUgMCBvYmoKPDwKL0F1dGhvciAoYW5vbnltb3VzKSAvQ3JlYXRpb25EYXRlIChEOjIwMjYwODA1MDkzNzMxKzA4JzAwJykgL0NyZWF0b3IgKGFub255bW91cykgL0tleXdvcmRzICgpIC9Nb2REYXRlIChEOjIwMjYwODA1MDkzNzMxKzA4JzAwJykgL1Byb2R1Y2VyIChSZXBvcnRMYWIgUERGIExpYnJhcnkgLSBcKG9wZW5zb3VyY2VcKSkgCiAgL1N1YmplY3QgKHVuc3BlY2lmaWVkKSAvVGl0bGUgKHVudGl0bGVkKSAvVHJhcHBlZCAvRmFsc2UKPj4KZW5kb2JqCjYgMCBvYmoKPDwKL0NvdW50IDEgL0tpZHMgWyAzIDAgUiBdIC9UeXBlIC9QYWdlcwo+PgplbmRvYmoKNyAwIG9iago8PAovRmlsdGVyIFsgL0FTQ0lJODVEZWNvZGUgL0ZsYXRlRGVjb2RlIF0gL0xlbmd0aCAxMjUKPj4Kc3RyZWFtCkdhcFFoMEU9RiwwVVxIM1RccE5ZVF5RS2s/dGM+SVAsO1cjVTFeMjNpaFBFTV8/Q1c0S0lTaTwhWzdgI09CX3F1UWRrJD1vSzdobHI4YztdZUBaRUpVPT9pP2UwOVVSYl9oUzNVL1hqQE89WihzL1diLFovY2JAPylOK34+ZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgOAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwNjEgMDAwMDAgbiAKMDAwMDAwMDA5MiAwMDAwMCBuIAowMDAwMDAwMTk5IDAwMDAwIG4gCjAwMDAwMDAzOTIgMDAwMDAgbiAKMDAwMDAwMDQ2MCAwMDAwMCBuIAowMDAwMDAwNzIxIDAwMDAwIG4gCjAwMDAwMDA3ODAgMDAwMDAgbiAKdHJhaWxlcgo8PAovSUQgCls8ZWY3MDBmN2FlYTBjNmI3MjdiYzQ1OWU5ODZiMzI1YWU+PGVmNzAwZjdhZWEwYzZiNzI3YmM0NTllOTg2YjMyNWFlPl0KJSBSZXBvcnRMYWIgUERGIExpYnJhcnkgLS0gZGlnZXN0IChvcGVuc291cmNlKQoKL0luZm8gNSAwIFIKL1Jvb3QgNCAwIFIKL1NpemUgOAo+PgpzdGFydHhyZWYKOOTUKJSVFT0YK"

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => root[Symbol.asyncDispose]()))
})

describe("完整详细设计 Word 组装", () => {
  test("十四主题和 5D 矩阵生成同源 Markdown、原生目录 DOCX 与完整页面证据", async () => {
    const workspace = await tmpdir()
    roots.push(workspace)
    await mkdir(path.join(workspace.path, "module"), { recursive: true })
    await writeFile(path.join(workspace.path, "module/index.ts"), "export function run() { return 1 }\n")
    let sequence = 0
    const items = buildFullDesignWorkItems(["MOD-root"], Date.now(), () => `WI-${++sequence}`)
    const job = await createStoredJob(workspace.path, items)
    const completed = await attachFullArtifacts(job)
    const server = Bun.serve({
      port: 0,
      fetch: () => Response.json(renderResponse()),
    })
    const previous = process.env["KILO_WORD_RENDER_ENDPOINT"]
    process.env["KILO_WORD_RENDER_ENDPOINT"] = `http://127.0.0.1:${server.port}`
    try {
      const quality = await buildQualityReport(completed)
      expect(quality.passed, JSON.stringify(quality.issues)).toBeTrue()
      const result = await provideTestInstance({
        directory: workspace.path,
        fn: () => assembleDesignDocument(workspace.path, completed),
      })
      const root = DesignDocStore.directory(workspace.path, completed.id)
      const markdown = await readFile(path.join(root, result.document.path), "utf8")
      expect("word" in result).toBeTrue()
      if (!("word" in result)) throw new Error("完整设计结果缺少 Word 产物")
      const word = result.word
      expect(word).toBeDefined()
      expect(word!.toc.toc).toBe("materialized")
      expect(word!.toc.tocEntryCount).toBeGreaterThan(20)
      expect(word!.inspection.imageCount).toBe(5)
      expect(word!.render.pageEvidenceStatus).toBe("completed")
      expect(word!.render.visualQaStatus).toBe("completed")
      expect(markdown).not.toMatch(/\bEV-[A-Za-z0-9_-]+\b/)
      expect(markdown).not.toMatch(
        /\b(?:Evidence Pack|WorkItem|Schema|runtime|Owner|DesignUnit|unknowns?)\b|topic-evidence-/i,
      )
      expect(markdown).not.toMatch(/证据包|采样|PASS|结构校验通过率|证据覆盖率|图渲染成功率|模型无权/)
      expect(markdown).not.toMatch(/设计单元|\bMOD-[A-Za-z0-9_-]+\b|源码快照：/)
      expect(markdown).not.toContain("…")
      expect(markdown).toContain("源码依据：index.ts:1")
      expect(markdown).toStartWith("# module 模块详细设计\n")
      expect(markdown.match(/目标范围：module$/gm)).toHaveLength(1)
      expect(markdown).toContain("## 模块概览与系统位置")
      expect(markdown).toContain("## 模块职责、边界与整体结构")
      expect(markdown).toContain("### 本模块负责的工作")
      expect(markdown).toContain("### 本模块处理到哪里，之后交给谁")
      expect(markdown).toContain("### 模块组成和调用关系")
      expect(markdown).not.toContain("### 结论")
      const positioning = markdown.slice(
        markdown.indexOf("## 模块概览与系统位置"),
        markdown.indexOf("## 模块职责、边界与整体结构"),
      )
      expect(positioning.match(/\*\*从源码可以确认什么\*\*/g)).toHaveLength(1)
      expect(positioning.match(/\*\*代码中的具体做法\*\*/g)).toHaveLength(1)
      expect(positioning).toContain("**依赖谁，以及由谁调用**")
      expect(positioning).not.toContain("**执行路径**")
      expect(positioning.match(/源码依据：index\.ts:1/g)).toHaveLength(3)
      expect(positioning).not.toContain("设计结论：")
      expect(positioning).not.toContain("实现机制：")
      const responsibilities = markdown.slice(
        markdown.indexOf("### 本模块负责的工作"),
        markdown.indexOf("### 本模块处理到哪里，之后交给谁"),
      )
      expect(responsibilities).toContain("**index（index.ts）**")
      expect(responsibilities).toContain("- 承担入口处理职责")
      expect(responsibilities).toContain("- 承担结果返回职责")
      expect(responsibilities.match(/源码依据：index\.ts:1/g)).toHaveLength(2)
      const businessFlowImage = markdown.indexOf("![业务流程图（分面 1/2）]")
      expect(markdown.indexOf("## 完整业务流程")).toBeLessThan(businessFlowImage)
      expect(businessFlowImage).toBeLessThan(markdown.indexOf("## 内部组成与子模块"))
      expect(markdown).toContain("业务流程图（分面 1/2）")
      expect(markdown).toContain("业务流程图（分面 2/2）")
      expect(markdown).not.toContain("适用性：")
      expect(markdown).not.toContain("目标模块与子模块能力总览")
      expect(markdown).not.toContain("## 模块之间如何协作")
      expect(markdown).not.toContain("## 全局对象、接口、状态、配置与构建索引")
      expect(markdown).not.toContain("## 跨模块算法、并发、资源与性能")
      expect(markdown).not.toContain("## 函数、图示与源码证据覆盖")
      expect(markdown).toContain("| module | 目标模块 | — | 1 |")
      expect(markdown).toContain("## 目标模块实现细节\n\n### 核心对象与状态载体")
      expect(markdown).toContain("## 源码参考索引")
      expect(markdown).toContain("## 待确认事项")
      expect(markdown).toContain("不适用：完整源码扫描没有发现可证明的状态机")
      const docx = path.join(root, "design-doc.docx")
      expect(await readFile(docx)).not.toHaveLength(0)
      const inspection = await provideTestInstance({
        directory: workspace.path,
        fn: () => inspectWordDocument({ path: docx, internalMaxParagraphs: 10_000, internalMaxTables: 1_000 }),
      })
      expect(inspection.outline.slice(0, 7).map((item) => item.title)).toEqual([
        "阅读路径",
        "设计范围与阅读说明",
        "模块概览与系统位置",
        "模块职责、边界与整体结构",
        "本模块负责的工作",
        "本模块处理到哪里，之后交给谁",
        "模块组成和调用关系",
      ])
      expect(inspection.outline.some((item) => ["结论", "实现机制", "流程"].includes(item.title))).toBeFalse()
      expect(inspection.images.find((item) => item.title?.includes("业务流程图"))?.headingPath).toContain(
        "完整业务流程",
      )
      expect(inspection.images.filter((item) => item.title?.includes("业务流程图（分面"))).toHaveLength(2)
      expect(inspection.images.find((item) => item.title?.includes("代码执行图"))?.headingPath).toContain(
        "代码如何执行",
      )
      expect(inspection.images.find((item) => item.title?.includes("数据流转与保存边界图"))?.headingPath).toContain(
        "数据如何流转和保存",
      )
      const paragraphs = inspection.paragraphs.map((item) => item.text)
      expect(paragraphs.filter((text) => /^业务流程图（分面 [12]\/2）$/.test(text))).toHaveLength(2)
      expect(paragraphs.filter((text) => text === "业务步骤、分支与结果")).toHaveLength(1)
      expect(paragraphs.some((text) => text.startsWith("作者："))).toBeFalse()
      expect(paragraphs.filter((text) => text === "目标范围：module")).toHaveLength(1)
      expect(paragraphs.join("\n")).not.toMatch(/证据包|采样|PASS|结构校验通过率|证据覆盖率|图渲染成功率|模型无权/)
      expect(paragraphs.join("\n")).not.toMatch(/设计单元|\bMOD-[A-Za-z0-9_-]+\b|源码快照：/)
      expect(paragraphs.join("\n")).not.toContain("…")
      expect(JSON.stringify(inspection)).not.toMatch(/\bEV-[A-Za-z0-9_-]+\b/)
    } finally {
      if (previous === undefined) delete process.env["KILO_WORD_RENDER_ENDPOINT"]
      else process.env["KILO_WORD_RENDER_ENDPOINT"] = previous
      await server.stop(true)
    }
  }, 30_000)

  test("源码关系分图缺项时质量报告拒绝发布完整 Word", async () => {
    const workspace = await tmpdir()
    roots.push(workspace)
    await mkdir(path.join(workspace.path, "module"), { recursive: true })
    await writeFile(path.join(workspace.path, "module/index.ts"), "export function run() { return 1 }\n")
    let sequence = 0
    const items = buildFullDesignWorkItems(["MOD-root"], Date.now(), () => `WI-gap-${++sequence}`)
    const job = await createStoredJob(workspace.path, items)
    const completed = await attachFullArtifacts(job)
    const target = completed.workItems.find((item) => item.artifactType === "execution-flow")
    if (!target || target.evidenceScope?.kind !== "behavior-refs") throw new Error("测试缺少执行流关系范围")
    const scope = target.evidenceScope
    const broken = {
      ...completed,
      workItems: completed.workItems.map((item) =>
        item.id === target.id ? { ...item, evidenceScope: { ...scope, coverageTotal: 2 } } : item,
      ),
    }

    const quality = await buildQualityReport(broken)

    expect(quality.passed).toBeFalse()
    expect(quality.issues.some((item) => item.code === "RELATION_COVERAGE_INCOMPLETE")).toBeTrue()
  })

  test("主题分片缺项时质量报告拒绝发布完整文档", async () => {
    const workspace = await tmpdir()
    roots.push(workspace)
    await mkdir(path.join(workspace.path, "module"), { recursive: true })
    await writeFile(path.join(workspace.path, "module/index.ts"), "export function run() { return 1 }\n")
    let sequence = 0
    const items = buildFullDesignWorkItems(["MOD-root"], Date.now(), () => `WI-topic-gap-${++sequence}`)
    const target = items.find((item) => item.purpose?.kind === "topic" && item.purpose.topic === "responsibilities")
    if (!target) throw new Error("测试缺少职责主题")
    const refs = ["TOPIC-A", "TOPIC-B"]
    target.evidenceScope = {
      kind: "topic-evidence",
      values: [refs[0]!],
      label: "index.ts / run",
      coverageTotal: refs.length,
      coverageSetHash: createHash("sha256").update(refs.join("\n")).digest("hex"),
    }
    const job = await createStoredJob(workspace.path, items)
    const completed = await attachFullArtifacts(job)

    const quality = await buildQualityReport(completed)

    expect(quality.passed).toBeFalse()
    expect(quality.issues.some((item) => item.code === "TOPIC_COVERAGE_INCOMPLETE")).toBeTrue()
  })

  test("同一主题的多个原子 Session 结果无遗漏合并为一个人类章节", async () => {
    const workspace = await tmpdir()
    roots.push(workspace)
    await mkdir(path.join(workspace.path, "module"), { recursive: true })
    await writeFile(path.join(workspace.path, "module/index.ts"), "export function run() { return 1 }\n")
    let sequence = 0
    const original = buildFullDesignWorkItems(["MOD-root"], Date.now(), () => `WI-topic-merge-${++sequence}`)
    const target = original.find((item) => item.purpose?.kind === "topic" && item.purpose.topic === "responsibilities")
    if (!target) throw new Error("测试缺少职责主题")
    const refs = ["TOPIC-A", "TOPIC-B"]
    const coverageSetHash = createHash("sha256").update(refs.join("\n")).digest("hex")
    const scope = (value: string): WorkItem["evidenceScope"] => ({
      kind: "topic-evidence",
      values: [value],
      label: `index.ts / ${value}`,
      coverageTotal: refs.length,
      coverageSetHash,
    })
    const fragment = {
      ...target,
      id: "WI-topic-merge-fragment",
      evidenceScope: scope(refs[1]!),
      attempts: [],
      artifactIDs: [],
    }
    const items = original.flatMap((item) => {
      if (item.id === target.id) return [{ ...item, evidenceScope: scope(refs[0]!) }, fragment]
      if (item.purpose?.kind === "review") return [{ ...item, dependencies: [...item.dependencies, fragment.id] }]
      return [item]
    })
    const stored = await createStoredJob(workspace.path, items)
    const markdownOnly = await DesignDocStore.update(workspace.path, stored.id, stored.revision, (current) => ({
      ...current,
      config: { ...current.config, outputFormats: ["markdown"] },
    }))
    const completed = await attachFullArtifacts(markdownOnly)
    const quality = await buildQualityReport(completed)
    expect(quality.passed, JSON.stringify(quality.issues)).toBeTrue()

    const result = await provideTestInstance({
      directory: workspace.path,
      fn: () => assembleDesignDocument(workspace.path, completed),
    })
    const markdown = await readFile(
      path.join(DesignDocStore.directory(workspace.path, completed.id), result.document.path),
      "utf8",
    )

    expect(markdown.match(/### 本模块负责的工作/g)).toHaveLength(1)
    expect(markdown).toContain("承担第二源码范围职责")
  })

  test("源码引用使用最短无歧义路径且同名文件保留必要目录", async () => {
    const workspace = await tmpdir()
    roots.push(workspace)
    await mkdir(path.join(workspace.path, "module/a"), { recursive: true })
    await mkdir(path.join(workspace.path, "module/b"), { recursive: true })
    await mkdir(path.join(workspace.path, "module/runtime"), { recursive: true })
    await writeFile(path.join(workspace.path, "module/a/index.ts"), "export function a() { return 1 }\n")
    await writeFile(path.join(workspace.path, "module/b/index.ts"), "export function b() { return 2 }\n")
    await writeFile(path.join(workspace.path, "module/runtime/runtime.ts"), "export function runtime() { return 3 }\n")
    let sequence = 0
    const items = buildFullDesignWorkItems(["MOD-root"], Date.now(), () => `WI-path-${++sequence}`)
    const stored = await createStoredJob(workspace.path, items)
    const markdownOnly = await DesignDocStore.update(workspace.path, stored.id, stored.revision, (current) => ({
      ...current,
      config: { ...current.config, outputFormats: ["markdown"] },
    }))
    const completed = await attachFullArtifacts(markdownOnly, () => "module/index.ts", [
      "module/a/index.ts",
      "module/b/index.ts",
      "module/runtime/runtime.ts",
    ])
    const quality = await buildQualityReport(completed)
    expect(quality.passed, JSON.stringify(quality.issues)).toBeTrue()

    const result = await provideTestInstance({
      directory: workspace.path,
      fn: () => assembleDesignDocument(workspace.path, completed),
    })
    const markdown = await readFile(
      path.join(DesignDocStore.directory(workspace.path, completed.id), result.document.path),
      "utf8",
    )

    expect(markdown).toContain("| a/index.ts | 位置：1 |")
    expect(markdown).toContain("| b/index.ts | 位置：1 |")
    expect(markdown).toContain("| runtime.ts | 位置：1 |")
    expect(markdown).not.toContain("程序.ts")
    expect(markdown).not.toContain("module/a/index.ts")
    expect(markdown).not.toContain("module/b/index.ts")
  })
})

async function createStoredJob(workspace: string, workItems: WorkItem[], sourceFiles = ["module/index.ts"]) {
  const now = Date.now()
  const job: DesignDocJob = {
    schemaVersion: 1,
    id: `full-${now}`,
    revision: 0,
    status: "assembling",
    workspace,
    config: {
      targetPath: "module",
      artifactTypes: ["overview", "review"],
      languages: ["typescript", "tsx"],
      concurrency: 1,
      recursive: true,
      documentProfile: "source-backed-full",
      outputFormats: ["markdown", "docx"],
      evidenceBudget: { maxItems: 64, maxPromptBytes: 49_152, maxSnippetCharacters: 800 },
      retryPolicy: {
        maxAttempts: 3,
        timeoutMs: 120_000,
        backoffMs: [0, 500, 1_000],
        retryableCodes: [],
      },
      modelPolicy: {
        primary: { providerID: "deepseek", modelID: "deepseek-v4-flash" },
        fallbacks: [],
        structuredOutput: "tool-json-schema",
      },
      renderer: "mermaid",
    },
    moduleManifestPath: "module-manifest.json",
    workItems: workItems.map((item) => ({
      ...item,
      status: item.purpose?.kind === "review" ? "pending" : "passed",
      ...behaviorScope(item),
    })),
    artifacts: [],
    progress: {
      total: workItems.length,
      pending: 1,
      running: 0,
      passed: workItems.length - 1,
      failed: 0,
      blocked: 0,
      cancelled: 0,
    },
    createdAt: now,
    updatedAt: now,
  }
  await DesignDocStore.create(job)
  const manifest = await DesignDocStore.writeJSON(workspace, job.id, "module-manifest.json", {
    schemaVersion: 1,
    sourceSnapshotHash: "snapshot",
    rootModuleID: "MOD-root",
    modules: [
      {
        id: "MOD-root",
        name: "module",
        path: "module",
        unitKind: "root",
        languages: ["typescript"],
        sourceFiles,
        testFiles: [],
        implementationFiles: sourceFiles,
        supportFiles: [],
      },
    ],
    workItemIDs: workItems.map((item) => item.id),
    ownership: sourceFiles.map((sourcePath) => ({
      path: sourcePath,
      ownerModuleID: "MOD-root",
      role: "implementation",
    })),
    createdAt: now,
  })
  return DesignDocStore.update(workspace, job.id, 0, (current) => ({
    ...current,
    artifacts: [
      artifact({
        ...manifest,
        id: "ART-MANIFEST",
        workItemID: workItems[0].id,
        kind: "manifest",
        status: "passed",
      }),
    ],
  }))
}

function behaviorScope(item: WorkItem): Pick<WorkItem, "evidenceScope"> | Record<string, never> {
  if (!["business-flow", "execution-flow", "data-flow", "error-flow"].includes(item.artifactType)) return {}
  const ref = `${item.artifactType}:${item.id}`
  return {
    evidenceScope: {
      kind: "behavior-refs",
      values: [ref],
      path: "module/index.ts",
      label: "完整源码关系",
      coverageRole: "detail",
      coverageTotal: 1,
      coverageSetHash: createHash("sha256").update(ref).digest("hex"),
    },
  }
}

async function attachFullArtifacts(
  job: DesignDocJob,
  sourcePathForItem: (item: WorkItem) => string = () => "module/index.ts",
  supplementalSources: readonly string[] = [],
) {
  const values: Artifact[] = []
  const colors = [
    [24, 84, 140, 255],
    [52, 122, 89, 255],
    [152, 75, 67, 255],
    [105, 72, 142, 255],
    [46, 113, 125, 255],
  ]
  let color = 0
  for (const item of job.workItems.filter((candidate) => candidate.purpose?.kind !== "review")) {
    const packValue = evidencePack(item, sourcePathForItem(item), supplementalSources)
    const ir = diagramIR(item, packValue.evidence[0].id)
    const root = `work-items/${item.id}`
    const [packMeta, irMeta, reportMeta] = await Promise.all([
      DesignDocStore.writeJSON(job.workspace, job.id, `${root}/evidence.json`, packValue),
      DesignDocStore.writeJSON(job.workspace, job.id, `${root}/candidate.ir.json`, ir),
      DesignDocStore.writeJSON(job.workspace, job.id, `${root}/validation.json`, validation(item)),
    ])
    values.push(
      artifact({
        ...packMeta,
        id: `ART-${item.id}-PACK`,
        workItemID: item.id,
        kind: "evidence-pack",
        status: "passed",
      }),
      artifact({ ...irMeta, id: `ART-${item.id}-IR`, workItemID: item.id, kind: "ir", status: "passed" }),
      artifact({
        ...reportMeta,
        id: `ART-${item.id}-REPORT`,
        workItemID: item.id,
        kind: "validation-report",
        status: "passed",
      }),
    )
    if (item.purpose?.kind !== "diagram" || item.purpose.view === "state-machine") continue
    const facets = item.purpose.view === "business-flow" && item.purpose.role === "base" ? 2 : 1
    for (let facet = 0; facet < facets; facet++) {
      const suffix = facets > 1 ? `-part-${facet + 1}` : ""
      const [mermaid, png] = await Promise.all([
        DesignDocStore.writeText(
          job.workspace,
          job.id,
          `${root}/diagram${suffix}.mmd`,
          `flowchart ${facet % 2 ? "TD" : "LR"}\n  A --> B\n`,
          "text/vnd.mermaid",
        ),
        DesignDocStore.writeBytes(
          job.workspace,
          job.id,
          `${root}/diagram${suffix}.png`,
          pngBytes(colors[color++]!),
          "image/png",
        ),
      ])
      values.push(
        artifact({
          ...mermaid,
          id: `ART-${item.id}-MERMAID${suffix}`,
          workItemID: item.id,
          kind: "mermaid",
          status: "passed",
        }),
        artifact({
          ...png,
          id: `ART-${item.id}-RENDER${suffix}`,
          workItemID: item.id,
          kind: "render",
          status: "passed",
        }),
      )
    }
  }
  return DesignDocStore.update(job.workspace, job.id, job.revision, (current) => ({
    ...current,
    artifacts: [...current.artifacts, ...values],
  }))
}

function evidencePack(item: WorkItem, sourcePath: string, supplementalSources: readonly string[]): EvidencePack {
  const evidenceID = `EV-${item.id}`
  const supplemental = supplementalSources.map((supplementalPath, index): EvidencePack["evidence"][number] => ({
    id: `${evidenceID}-SUP-${index + 1}`,
    kind: "source-file",
    fact: `补充源码文件 ${path.posix.basename(supplementalPath)}`,
    source: {
      path: supplementalPath,
      contentHash: String(index + 1).repeat(64),
      startLine: 1,
      endLine: 1,
      sourceKind: "production",
    },
    attributes: { ref: supplementalPath, language: "typescript" },
    confidence: "explicit",
    snippet: "export const value = 1",
  }))
  return {
    schemaVersion: 1,
    id: `PACK-${item.id}`,
    moduleID: item.moduleID,
    workItemID: item.id,
    artifactType: item.artifactType,
    ...(item.purpose ? { purpose: item.purpose } : {}),
    sourceSnapshotHash: "snapshot",
    evidence: [
      {
        id: evidenceID,
        kind: "source-file",
        fact: `模块源码事实 ${item.id}`,
        source: {
          path: sourcePath,
          contentHash: "a".repeat(64),
          startLine: 1,
          endLine: 1,
          symbol: "module/index.ts#run@1",
          sourceKind: "production",
        },
        attributes: { ref: "module/index.ts", language: "typescript" },
        confidence: "explicit",
        snippet: "export function run() { return 1 }",
      },
      ...supplemental,
    ],
    obligations: [{ id: `OB-${item.id}`, kind: "file", evidenceIDs: [evidenceID], required: true }],
    unknowns: [],
    budget: { items: 1, promptBytes: 34, truncated: false },
  }
}

function diagramIR(item: WorkItem, evidenceID: string) {
  if (item.purpose?.kind === "topic") {
    const conclusions = [{ text: `已确认 ${item.purpose.topic}`, evidenceIDs: [evidenceID] }]
    if (item.purpose.topic === "positioning") {
      conclusions.push({ text: "已确认模块上级上下文", evidenceIDs: [evidenceID] })
    }
    if (item.purpose.topic === "responsibilities") {
      conclusions.splice(
        0,
        conclusions.length,
        {
          text: item.id === "WI-topic-merge-fragment" ? "承担第二源码范围职责" : "承担入口处理职责",
          evidenceIDs: [evidenceID],
        },
        { text: "承担结果返回职责", evidenceIDs: [evidenceID] },
      )
    }
    return {
      schemaVersion: 1,
      moduleID: item.moduleID,
      viewType: "topic",
      topic: item.purpose.topic,
      applicability: "applicable",
      title: item.purpose.topic,
      summary:
        item.purpose.topic === "positioning"
          ? "模块通过平台接口接入运行环境，入口步骤由 run 提供。"
          : `源码支撑的 ${item.purpose.topic} 说明。`,
      conclusions,
      mechanisms: [{ text: `实现 ${item.purpose.topic}`, evidenceIDs: [evidenceID] }],
      flows:
        item.purpose.topic === "positioning"
          ? [{ text: "通过平台接口接入上级运行环境", evidenceIDs: [evidenceID] }]
          : [],
      exceptions: [],
      constraints: [],
      assumptions: [],
      unknowns: [],
    }
  }
  if (item.purpose?.kind !== "diagram") throw new Error(`不支持的 WorkItem：${item.id}`)
  const base = {
    schemaVersion: 1,
    moduleID: item.moduleID,
    title: item.purpose.view,
    summary: `源码支撑的 ${item.purpose.view}。`,
    assumptions: [],
    unknowns: [],
  }
  if (item.purpose.view === "architecture") {
    return {
      ...base,
      viewType: "overview",
      responsibilities: [{ text: "执行模块职责", evidenceIDs: [evidenceID] }],
      boundaries: [{ text: "模块目录边界", evidenceIDs: [evidenceID] }],
      items: [
        { id: "source", kind: "file", sourceRef: `source:${item.id}`, label: "index.ts", evidenceIDs: [evidenceID] },
      ],
    }
  }
  if (item.purpose.view === "business-flow") {
    return {
      ...base,
      viewType: "business-flow",
      activities: [
        {
          id: "trigger",
          kind: "trigger",
          sourceRef: "business:trigger",
          label: "接收请求",
          businessMeaning: "接收业务请求",
          evidenceIDs: [evidenceID],
        },
        {
          id: "outcome",
          kind: "outcome",
          sourceRef: "business:outcome",
          label: "返回结果",
          businessMeaning: "完成业务处理",
          evidenceIDs: [evidenceID],
        },
      ],
      flows: [
        {
          id: "business-next",
          from: "trigger",
          to: "outcome",
          kind: "success",
          label: "成功返回",
          evidenceIDs: [evidenceID],
        },
      ],
    }
  }
  if (item.purpose.view === "code-flow") {
    return {
      ...base,
      viewType: "execution-flow",
      nodes: [
        { id: "entry", kind: "entry", sourceRef: "code:entry", label: "run", evidenceIDs: [evidenceID] },
        { id: "action", kind: "action", sourceRef: "code:action", label: "return", evidenceIDs: [evidenceID] },
      ],
      edges: [
        { id: "code-next", from: "entry", to: "action", kind: "return", label: "返回结果", evidenceIDs: [evidenceID] },
      ],
    }
  }
  if (item.purpose.view === "state-machine") {
    return {
      schemaVersion: 1,
      moduleID: item.moduleID,
      viewType: "not-applicable",
      designView: "state-machine",
      title: "状态机不适用",
      reason: "完整源码扫描没有发现可证明的状态机",
      evidenceIDs: [evidenceID],
      unknowns: [],
    }
  }
  return {
    ...base,
    viewType: "data-flow",
    entities: [
      { id: "input", kind: "input", sourceRef: "data:input", label: "输入", evidenceIDs: [evidenceID] },
      { id: "output", kind: "output", sourceRef: "data:output", label: "输出", evidenceIDs: [evidenceID] },
    ],
    flows: [
      { id: "data-return", from: "input", to: "output", kind: "return", label: "返回结果", evidenceIDs: [evidenceID] },
    ],
  }
}

function validation(item: WorkItem) {
  const stateNotApplicable = item.purpose?.kind === "diagram" && item.purpose.view === "state-machine"
  return {
    schemaVersion: 1,
    workItemID: item.id,
    attempt: 1,
    passed: true,
    sourceSnapshotHash: "snapshot",
    validatorVersions: { schema: "1" },
    errors: [],
    warnings: stateNotApplicable
      ? [
          {
            severity: "warning",
            code: "STATE_MACHINE_NOT_APPLICABLE",
            message: "完整扫描未发现状态机",
            evidenceIDs: [],
            sourcePaths: [],
            retryable: false,
          },
        ]
      : [],
    metrics: {},
    createdAt: Date.now(),
  }
}

function pngBytes(color: number[]) {
  const rgba = new Uint8Array(32 * 32 * 4)
  for (let offset = 0; offset < rgba.length; offset += 4) rgba.set(color, offset)
  const image = new PhotonImage(rgba, 32, 32)
  try {
    return image.get_bytes()
  } finally {
    image.free()
  }
}

function renderResponse() {
  return {
    ok: true,
    pageCount: 1,
    returnedPageCount: 1,
    pageCountKind: "exact",
    fieldRefreshStatus: "failed",
    fieldRefreshDiagnostics: ["测试渲染器不刷新目录页码"],
    tocHeadingCount: 21,
    tocEntryCount: 21,
    tocPageNumberCount: 0,
    pdfBase64: ONE_PAGE_PDF,
    pages: [{ page: 1, pngBase64: PAGE_PNG, width: 1224, height: 1584 }],
    textQa: {
      ok: true,
      titlePresent: true,
      firstHeadingPresent: true,
      sourceCjkCount: 1,
      pdfCjkCount: 1,
      cjkCoverage: 1,
      sentinelCount: 2,
      matchedSentinelCount: 2,
      sentinelCoverage: 1,
      diagnostics: [],
    },
    issues: [],
    renderer: { kind: "design-doc-test" },
  }
}
