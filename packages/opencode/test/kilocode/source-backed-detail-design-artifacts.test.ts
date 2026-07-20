import { describe, expect, test } from "bun:test"
import { PhotonImage } from "@silvia-odwyer/photon-node"
import fs from "fs/promises"
import { createHash } from "node:crypto"
import path from "path"
import {
  applyWordDocumentEdits,
  createWordDocument,
  inspectWordDocument,
  insertWordPngImage,
  materializeWordFields,
  renderWordDocument,
  type WordBlock,
} from "../../src/kilocode/documents/word"
import { renderMermaidDiagram } from "../../src/kilocode/documents/mermaid"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

type View = "architecture" | "business" | "code" | "state" | "data"

type Policy = {
  diagramCoverageFixture: {
    targetUnits: number
    confirmedSubmodules: number
    stateMachineNa: number
    focusedFigures: number
    expectedBaseSlots: number
    expectedRequiredPngs: number
    designUnits: Array<{
      id: string
      kind: "target" | "confirmed_submodule"
      views: Record<View, string>
    }>
  }
  complexitySignalFixture: {
    instances: Array<{
      designUnitId: string
      requiredView: View
      requiredFigureKind: string
      diagramIds: string[]
    }>
  }
  wordAcceptanceFixture: {
    skeletonRelationshipIds: string[]
    lateInsertedRelationshipIds: string[]
    finalRelationshipIds: string[]
  }
}

type Figure = {
  id: string
  unit: string
  view: View
  heading: string
  kind: "base" | "focused"
  block: Extract<WordBlock, { type: "image" }>
  bytes: Buffer
}

function png(seed: number): Buffer {
  const width = 48
  const height = 32
  const pixels = new Uint8Array(width * height * 4).fill(255)
  const left = 2 + (seed % 11)
  const top = 2 + (seed % 7)
  for (let y = top; y < Math.min(height - 2, top + 14); y += 1) {
    for (let x = left; x < Math.min(width - 2, left + 24); x += 1) {
      const offset = (y * width + x) * 4
      pixels[offset] = (seed * 41) % 220
      pixels[offset + 1] = (seed * 67) % 220
      pixels[offset + 2] = (seed * 89) % 220
    }
  }
  const image = new PhotonImage(pixels, width, height)
  try {
    return Buffer.from(image.get_bytes())
  } finally {
    image.free()
  }
}

function tables(start: number, count: number): WordBlock[] {
  return Array.from({ length: count }, (_, offset) => ({
    type: "table" as const,
    caption: `表 ${start + offset} 源码证据`,
    headers: ["证据 ID", "源码位置", "结论"],
    rows: [[`SRC-${String(start + offset).padStart(4, "0")}`, "src/module.c:1", "source_confirmed"]],
  }))
}

describe("source-backed detail design structural artifact identity", () => {
  test("preserves the title, native TOC, 26 unique image relationships, and 23 tables through one serial DOCX chain", async () => {
    await using temp = await tmpdir({ git: true })
    await provideTestInstance({
      directory: temp.path,
      fn: async () => {
        const fixture = JSON.parse(
          await fs.readFile(path.join(import.meta.dir, "fixtures/source-backed-detail-design-policy.json"), "utf8"),
        ) as Policy
        const headings = [
          "阅读路径",
          "术语、范围与证据基线",
          "父系统定位与目标模块角色",
          "目标模块职责、边界与架构",
          "业务能力总览",
          "详细主业务流程",
          "内部架构与子模块分解",
          "目标模块实现细节",
          "Word 子模块详细设计",
          "Mermaid 子模块详细设计",
          "Artifacts 子模块详细设计",
          "跨模块协作与端到端链路",
          "全局对象、接口、状态、配置和构建索引",
          "跨模块算法、并发、资源与性能",
          "调试、可观测性和建议点读源码",
          "功能、函数、图和证据覆盖",
          "假设、限制、风险和 owner-review 项",
        ]
        const placement = new Map([
          ["DU-WORD", "Word 子模块详细设计"],
          ["DU-MERMAID", "Mermaid 子模块详细设计"],
          ["DU-ARTIFACTS", "Artifacts 子模块详细设计"],
        ])
        const targetPlacement: Record<View, string> = {
          architecture: "目标模块职责、边界与架构",
          business: "详细主业务流程",
          code: "目标模块实现细节",
          state: "目标模块实现细节",
          data: "目标模块实现细节",
        }
        const coverage = fixture.diagramCoverageFixture
        const base = coverage.designUnits.flatMap((unit) =>
          (Object.entries(unit.views) as Array<[View, string]>)
            .filter(([, id]) => id !== "N/A")
            .map(([view, id]) => ({ id, unit: unit.id, view, kind: "base" as const })),
        )
        const focused = new Map<string, { id: string; unit: string; view: View; kind: "focused" }>()
        for (const signal of fixture.complexitySignalFixture.instances) {
          for (const id of signal.diagramIds) {
            const existing = focused.get(id)
            if (existing && (existing.unit !== signal.designUnitId || existing.view !== signal.requiredView))
              throw new Error(`focused diagram ${id} maps to conflicting design units or views`)
            focused.set(id, {
              id,
              unit: signal.designUnitId,
              view: signal.requiredView,
              kind: "focused",
            })
          }
        }
        const diagrams = [...base, ...focused.values()]
        const figures: Figure[] = diagrams.map((diagram, index) => {
          const heading = diagram.unit === "DU-TARGET" ? targetPlacement[diagram.view] : placement.get(diagram.unit)
          if (!heading) throw new Error(`missing chapter placement for ${diagram.unit}`)
          const bytes = png(index + 1)
          return {
            ...diagram,
            heading,
            bytes,
            block: {
              type: "image",
              path: `diagram-${diagram.id}.png`,
              title: `图 ${index + 1} ${diagram.id}`,
              caption: `[${diagram.unit}/${diagram.view}/${diagram.id}] ${diagram.kind} 源码驱动设计图`,
              altText: `${diagram.unit} 的 ${diagram.view} ${diagram.kind} 设计图，编号 ${diagram.id}。`,
              width: 480,
              height: 280,
            },
          }
        })
        expect(coverage.designUnits).toHaveLength(coverage.targetUnits + coverage.confirmedSubmodules)
        expect(base).toHaveLength(coverage.expectedBaseSlots - coverage.stateMachineNa)
        expect(focused.size).toBe(coverage.focusedFigures)
        expect(figures).toHaveLength(coverage.expectedRequiredPngs)
        expect(figures.find((figure) => figure.id === "DG-TARGET-ARCH")?.heading).toBe("目标模块职责、边界与架构")
        expect(figures.find((figure) => figure.id === "DG-TARGET-BUSINESS")?.heading).toBe("详细主业务流程")
        expect(figures.filter((figure) => figure.id === "DG-TARGET-BUSINESS")).toHaveLength(1)
        expect(figures.find((figure) => figure.id === "DG-TARGET-CODE")?.heading).toBe("目标模块实现细节")
        expect(new Set(figures.map((figure) => figure.id)).size).toBe(figures.length)
        await Promise.all(
          figures.map((figure, index) => {
            if (!figure.block.path) throw new Error(`figure ${index + 1} is missing its PNG path`)
            return fs.writeFile(path.join(temp.path, figure.block.path), figure.bytes)
          }),
        )
        const skeleton = figures.slice(0, fixture.wordAcceptanceFixture.skeletonRelationshipIds.length)
        const late = figures.slice(skeleton.length)
        expect(late).toHaveLength(fixture.wordAcceptanceFixture.lateInsertedRelationshipIds.length)
        expect(figures).toHaveLength(fixture.wordAcceptanceFixture.finalRelationshipIds.length)
        const sections = headings.map((title) => ({
          title,
          level: 1 as const,
          blocks: skeleton.filter((figure) => figure.heading === title).map((figure) => figure.block),
        }))
        const created = await createWordDocument({
          title: "文档组件源码驱动详细设计",
          documentType: "详细设计",
          language: "zh-CN",
          headingNumbering: "decimal",
          taskSlug: "source-backed-artifact-workflow",
          outputFile: "source-backed-artifact-workflow.docx",
          summary: ["本文档用于验证完整详设的原生 Word 产物链。", "{{TOC}}"],
          sections,
        })
        const first = await applyWordDocumentEdits({
          sourcePath: created.path,
          taskSlug: "source-backed-artifact-workflow",
          outputFile: "source-backed-artifact-workflow.docx",
          dryRun: false,
          edits: [
            {
              op: "insert_after_heading",
              locator: { heading: "术语、范围与证据基线" },
              blocks: tables(1, 11),
            },
          ],
        })
        const second = await applyWordDocumentEdits({
          sourcePath: first.path!,
          taskSlug: "source-backed-artifact-workflow",
          outputFile: "source-backed-artifact-workflow.docx",
          dryRun: false,
          edits: [
            {
              op: "insert_after_heading",
              locator: { heading: "Word 子模块详细设计" },
              blocks: tables(12, 11),
            },
          ],
        })
        const third = await applyWordDocumentEdits({
          sourcePath: second.path!,
          taskSlug: "source-backed-artifact-workflow",
          outputFile: "source-backed-artifact-workflow.docx",
          dryRun: false,
          edits: [
            {
              op: "insert_after_heading",
              locator: { heading: "功能、函数、图和证据覆盖" },
              blocks: tables(23, 1),
            },
          ],
        })
        const fourth = await insertWordPngImage({
          sourcePath: third.path!,
          pngBase64: late[0]!.bytes.toString("base64"),
          heading: late[0]!.heading,
          figureTitle: late[0]!.block.title,
          caption: late[0]!.block.caption,
          altText: late[0]!.block.altText,
          taskSlug: "source-backed-artifact-workflow",
          outputFile: "source-backed-artifact-workflow.docx",
          width: 480,
          height: 280,
        })
        const inserted = await insertWordPngImage({
          sourcePath: fourth.path,
          pngBase64: late[1]!.bytes.toString("base64"),
          heading: late[1]!.heading,
          figureTitle: late[1]!.block.title,
          caption: late[1]!.block.caption,
          altText: late[1]!.block.altText,
          taskSlug: "source-backed-artifact-workflow",
          outputFile: "source-backed-artifact-workflow.docx",
          width: 480,
          height: 280,
        })
        const materialized = await materializeWordFields({
          sourcePath: inserted.path,
          taskSlug: "source-backed-artifact-workflow",
          outputFile: "source-backed-artifact-workflow.docx",
          tocMode: "materialize",
        })
        const inspection = await inspectWordDocument({
          path: materialized.path,
          maxParagraphs: 1000,
          maxTables: 200,
        })
        const bounded = await inspectWordDocument({ path: materialized.path, maxParagraphs: 1, maxTables: 20 })

        expect(materialized.summary).toEqual({
          seqFields: 0,
          captions: 0,
          toc: "materialized",
          tocEntryCount: headings.length,
          needsLayoutRefresh: true,
        })
        expect(inspection.title).toBe("文档组件源码驱动详细设计")
        expect(inspection.firstHeading).toBe("阅读路径")
        expect(inspection.outline.map((item) => item.title)).toEqual(headings)
        expect(inspection.images).toHaveLength(coverage.expectedRequiredPngs)
        expect(inspection.imageDiagnostics.drawingCount).toBe(coverage.expectedRequiredPngs)
        expect(inspection.imageDiagnostics.relationshipCount).toBe(coverage.expectedRequiredPngs)
        expect(inspection.imageDiagnostics.orphanRelationshipIds).toEqual([])
        expect(inspection.imageDiagnostics.missingRelationshipIds).toEqual([])
        expect(inspection.imageDiagnostics.missingMediaTargets).toEqual([])
        expect(inspection.imageDiagnostics.duplicateMediaHashes).toEqual([])
        expect(new Set(inspection.images.map((image) => image.sha256)).size).toBe(coverage.expectedRequiredPngs)
        const expected = new Map(figures.map((figure) => [figure.id, figure]))
        expect(new Set(inspection.images.map((image) => image.visibleId))).toEqual(new Set(expected.keys()))
        for (const image of inspection.images) {
          const figure = image.visibleId ? expected.get(image.visibleId) : undefined
          expect(figure).toBeDefined()
          expect(image.caption).toBe(figure!.block.caption)
          expect(image.headingPath.at(-1)).toBe(figure!.heading)
          expect(image.altText).toBe(figure!.block.altText)
          expect(image.sha256).toBe(createHash("sha256").update(figure!.bytes).digest("hex"))
        }
        expect(inspection.totalTables).toBe(23)
        expect(inspection.tables).toHaveLength(23)
        expect(inspection.paragraphsTruncated).toBe(false)
        expect(inspection.tablesTruncated).toBe(false)
        expect(bounded.totalParagraphs).toBe(inspection.totalParagraphs)
        expect(bounded.totalTables).toBe(23)
        expect(bounded.paragraphsTruncated).toBe(true)
        expect(bounded.tablesTruncated).toBe(true)
        expect(inspection.paragraphs.some((item) => item.text.includes("{{TOC}}"))).toBe(false)
        expect(path.basename(materialized.path)).toBe("source-backed-artifact-workflow.docx")
      },
    })
  }, 30_000)

  const endpoint = process.env["KILO_TEST_DOCUMENT_RENDER_ENDPOINT"]?.trim()
  ;(endpoint ? test : test.skip)(
    "renders five real Mermaid views for the target and three submodules, then renders the complete DOCX",
    async () => {
      await using temp = await tmpdir({ git: true })
      await provideTestInstance({
        directory: temp.path,
        fn: async () => {
          const base = new URL(endpoint!).origin
          const units = [
            { id: "DU-TARGET", name: "文档组件" },
            { id: "DU-WORD", name: "Word 子模块" },
            { id: "DU-MERMAID", name: "Mermaid 子模块" },
            { id: "DU-ARTIFACTS", name: "Artifacts 子模块" },
          ]
          const views: View[] = ["architecture", "business", "code", "state", "data"]
          const rendered = await Promise.all(
            units.map(async (unit) => {
              const figures = []
              for (const view of views) {
                const source = integrationMermaid(unit.id, unit.name, view)
                const figure = await renderMermaidDiagram({
                  source,
                  remoteEndpoint: `${base}/render/mermaid`,
                  sourceFile: `${unit.id}-${view}.mmd`,
                  pngFile: `${unit.id}-${view}.png`,
                  taskSlug: `service-${unit.id}-${view}`,
                  scale: 3,
                  timeoutMs: 120_000,
                })
                expect(figure.rendered, figure.diagnostics.map((item) => item.message).join("; ")).toBe(true)
                expect(figure.pngPath).toBeTruthy()
                figures.push({ view, figure })
              }
              return { ...unit, figures }
            }),
          )
          const created = await createWordDocument({
            title: "文档组件真实渲染集成验收",
            documentType: "详细设计",
            language: "zh-CN",
            headingNumbering: "decimal",
            taskSlug: "source-backed-real-render-integration",
            outputFile: "source-backed-real-render-integration.docx",
            summary: ["{{TOC}}"],
            sections: rendered.map((unit) => ({
              title: `${unit.name}详细设计`,
              level: 1 as const,
              blocks: unit.figures.map(({ view, figure }) => ({
                type: "image" as const,
                path: figure.pngPath!,
                title: `${unit.name}${view}图`,
                caption: `[${unit.id}/${view}/REAL-${unit.id}-${view}] 真实渲染集成图`,
                altText: `${unit.name}的${view}设计图。`,
                width: figure.width,
                height: figure.height,
              })),
            })),
          })
          const materialized = await materializeWordFields({
            sourcePath: created.path,
            taskSlug: "source-backed-real-render-integration",
            outputFile: "source-backed-real-render-integration.docx",
            tocMode: "materialize",
          })
          const inspection = await inspectWordDocument({ path: materialized.path, maxParagraphs: 1_000, maxTables: 200 })
          expect(inspection.images).toHaveLength(units.length * views.length)
          expect(new Set(inspection.images.map((item) => item.sha256)).size).toBe(units.length * views.length)
          const pages = await renderWordDocument({
            sourcePath: materialized.path,
            remoteEndpoint: `${base}/render/word`,
            taskSlug: "source-backed-real-render-integration-pages",
            outputFile: "source-backed-real-render-integration.pdf",
            maxPages: 100,
            timeoutMs: 120_000,
          })
          expect(pages.pageEvidenceStatus, pages.diagnostics.map((item) => item.message).join("; ")).toBe("completed")
          expect(pages.fieldRefreshStatus, pages.fieldRefreshDiagnostics?.join("; ")).toBe("completed")
          expect(pages.pagePngPaths).toHaveLength(pages.expectedPageCount!)
        },
      })
    },
    180_000,
  )
})

function integrationMermaid(id: string, name: string, view: View): string {
  if (view === "state") {
    return `stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running: ${id}_start\n  Running --> Recovering: ${id}_fail\n  Recovering --> Running: ${id}_retry\n  Running --> Complete: ${id}_finish\n  Complete --> [*]`
  }
  if (view === "architecture") {
    return `flowchart LR\n  IN["${name}输入"] --> API["接口层"]\n  API --> CORE["${name}核心"]\n  CORE --> QUEUE["异步队列"]\n  CORE --> STORE["状态存储"]\n  QUEUE --> OUT["下游输出"]\n  STORE -.恢复.-> CORE`
  }
  if (view === "business") {
    return `flowchart TD\n  START["${name}业务触发"] --> PRE{"前置条件满足?"}\n  PRE -->|否| REJECT["拒绝并记录原因"]\n  PRE -->|是| RUN["执行主业务"]\n  RUN --> WAIT{"需要等待?"}\n  WAIT -->|是| RETRY["等待、超时与重试"]\n  RETRY --> RUN\n  WAIT -->|否| DONE["提交业务结果"]\n  RETRY -->|重试耗尽| RECOVER["恢复与清理"]`
  }
  if (view === "code") {
    return `flowchart TD\n  ENTRY["${id}_entry()"] --> VALIDATE["validate()"]\n  VALIDATE --> BRANCH{"condition"}\n  BRANCH -->|true| CALL["dispatch_async()"]\n  CALL --> CALLBACK["completion_callback()"]\n  CALLBACK --> WRITE["update_state()"]\n  BRANCH -->|false| ERROR["return_error()"]\n  ERROR --> CLEANUP["cleanup()"]\n  WRITE --> CLEANUP`
  }
  return `flowchart LR\n  CREATE["创建 ${name} 对象"] --> INIT["初始化所有权"]\n  INIT --> HANDOFF["跨层传递"]\n  HANDOFF --> READWRITE["并发读写"]\n  READWRITE --> PERSIST["持久化/缓存"]\n  PERSIST --> INVALIDATE["失效"]\n  INVALIDATE --> RELEASE["回收与释放"]`
}
