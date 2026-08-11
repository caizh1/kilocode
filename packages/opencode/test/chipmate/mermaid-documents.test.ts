import { describe, expect, test } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { PhotonImage } from "@silvia-odwyer/photon-node"
import fs from "fs/promises"
import { createServer } from "node:http"
import path from "path"
import { deflateSync } from "node:zlib"
import { Effect } from "effect"
import { extractDocxPlantUml } from "@chipmate/chipmate-indexing/engine"
import {
  inspectMermaidSvgCollisions,
  insertMermaidIntoWord,
  mermaidWordFit,
  renderMermaidDiagram,
  renderMermaidPng,
  saveMermaidArtifact,
  validateMermaidDiagram,
} from "../../src/chipmate/documents/mermaid"
import {
  lifecycleFitFingerprint,
  lifecycleMermaid,
  overviewMermaid,
  renderBusinessFlow,
  renderLifecycle,
} from "../../src/chipmate/design-doc/renderer"
import type { BusinessFlowIR, DesignDocJob, LifecycleIR, OverviewIR } from "../../src/chipmate/design-doc/domain"
import { DesignDocStore } from "../../src/chipmate/design-doc/store"
import { createWordDocument, inspectWordDocument } from "../../src/chipmate/documents/word"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const SIMPLE_MERMAID = "flowchart TD\n  A[Start] --> B[Done]"
const SIMPLE_PLANTUML = "@startuml\nclass Controller\nController --> Service\n@enduml"

function lifecycleFixture(dense: boolean): LifecycleIR {
  const count = dense ? 6 : 2
  const states = Array.from({ length: count }, (_, index) => ({
    id: `S${index}`,
    label: `状态 S${index}`,
    sourceValue: `状态 S${index}：包含较长业务语义说明`,
    role: index === 0 ? ("initial" as const) : index === count - 1 ? ("terminal" as const) : ("intermediate" as const),
    evidenceIDs: [`EV-state-${index}`],
  }))
  const pairs = dense
    ? [
        [0, 2],
        [0, 4],
        [1, 3],
        [1, 5],
        [2, 0],
        [2, 4],
        [3, 1],
        [3, 5],
        [4, 0],
        [4, 2],
        [5, 1],
        [5, 3],
      ]
    : [[0, 1]]
  return {
    schemaVersion: 1,
    moduleID: dense ? "MOD-dense-state" : "MOD-normal-state",
    viewType: "lifecycle",
    title: dense ? "密集状态机" : "普通状态机",
    summary: "",
    assumptions: [],
    unknowns: [],
    states,
    transitions: pairs.map(([from, to], index) => ({
      id: `T${index}`,
      from: `S${from}`,
      to: `S${to}`,
      trigger: dense ? `收到来自主机命令队列的第 ${index + 1} 类业务事件并完成消息序号与命令槽位一致性校验` : "启动",
      guard: dense ? "控制器已经就绪且队列头尾指针资源标志和中断掩码全部满足当前执行条件" : "已初始化",
      action: dense ? "更新完整上下文状态队列头尾指针和命令完成标志并通知下游组件继续处理" : "进入运行态",
      evidenceIDs: [`EV-transition-${index}`],
    })),
    initialStateID: "S0",
    terminalStateIDs: [`S${count - 1}`],
  }
}

function overviewLabelCollisionFixture(): OverviewIR {
  const files = ["nvme_main.h", "nvme_io_cmd.h", "nvme_admin_cmd.h", "nvme_identify.h", "nvme.h", "io_access.h"]
  const symbols = [
    ["nvme_main", 0],
    ["handle_nvme_io_cmd", 1],
    ["handle_nvme_admin_cmd", 2],
    ["identify_namespace", 3],
    ["NVME_CONTEXT", 4],
  ] as const
  return {
    schemaVersion: 1,
    moduleID: "MOD-overview-collision",
    viewType: "overview",
    title: "存储控制模块概览",
    summary: "",
    assumptions: [],
    unknowns: [],
    responsibilities: [],
    boundaries: [],
    items: [
      ...files.map((label, index) => ({
        id: `file-${index}`,
        kind: "file" as const,
        sourceRef: `source/controller/${label}`,
        label,
        evidenceIDs: [`EV-file-${index}`],
      })),
      ...symbols.map(([name], index) => ({
        id: `symbol-${index}`,
        kind: "symbol" as const,
        sourceRef: `source/controller/${files[index]}#${name}`,
        label: `${index === 4 ? "struct" : "function"} ${name}`,
        evidenceIDs: [`EV-symbol-${index}`],
      })),
    ],
    relations: symbols.map(([, fileIndex], index) => ({
      id: `declares-${index}`,
      from: `file-${fileIndex}`,
      to: `symbol-${index}`,
      kind: "contains" as const,
      label: "声明",
      evidenceIDs: [`EV-symbol-${index}`],
    })),
  }
}

function lifecycleFacetFixture(): LifecycleIR {
  const state = (id: string, role: "initial" | "intermediate" = "intermediate") => ({
    id,
    label: id,
    sourceValue: id,
    role,
    evidenceIDs: [`EV-state-${id}`],
  })
  const transition = (
    id: string,
    from: string,
    to: string,
    trigger: string,
    guard: string | undefined,
    action: string,
  ) => ({ id, from, to, trigger, ...(guard ? { guard } : {}), action, evidenceIDs: [`EV-transition-${id}`] })
  return {
    schemaVersion: 1,
    moduleID: "MOD-lifecycle-facet",
    viewType: "lifecycle",
    title: "控制器生命周期",
    summary: "",
    assumptions: [],
    unknowns: [],
    states: [
      state("TASK_IDLE", "initial"),
      state("TASK_WAIT_CC_EN"),
      state("TASK_RUNNING"),
      state("TASK_SHUTDOWN"),
      state("TASK_WAIT_RESET"),
      state("TASK_RESET"),
    ],
    transitions: [
      transition("T-01", "TASK_WAIT_RESET", "TASK_IDLE", "controller_main", "ccEn == 0", "task.status = TASK_IDLE"),
      transition(
        "T-02",
        "__ANY_CURRENT_STATE__",
        "TASK_RESET",
        "device_irq_handler",
        "device.ccEn == 1 && controller.ccEn != 1",
        "task.status = TASK_RESET",
      ),
      transition("T-03", "TASK_RESET", "TASK_IDLE", "controller_main", undefined, "task.status = TASK_IDLE"),
      transition(
        "T-04",
        "__ANY_CURRENT_STATE__",
        "TASK_SHUTDOWN",
        "device_irq_handler",
        "device.shutdown == 1 && controller.shutdown == 1",
        "task.status = TASK_SHUTDOWN",
      ),
      transition(
        "T-05",
        "__ANY_CURRENT_STATE__",
        "TASK_RESET",
        "device_irq_handler",
        "device.link == 1 && controller.linkUp == 0",
        "task.status = TASK_RESET",
      ),
      transition(
        "T-06",
        "TASK_SHUTDOWN",
        "TASK_WAIT_RESET",
        "controller_main",
        "controller.shutdown != 0",
        "task.status = TASK_WAIT_RESET",
      ),
      transition(
        "T-07",
        "TASK_WAIT_CC_EN",
        "TASK_RUNNING",
        "controller_main",
        "ccEn == 1",
        "task.status = TASK_RUNNING",
      ),
      transition(
        "T-08",
        "__ANY_CURRENT_STATE__",
        "TASK_WAIT_CC_EN",
        "device_irq_handler",
        "device.ccEn == 1 && controller.ccEn == 1",
        "task.status = TASK_WAIT_CC_EN",
      ),
    ],
    initialStateID: "TASK_IDLE",
    terminalStateIDs: [],
  }
}

function businessFlowFacetFixture(): BusinessFlowIR {
  const activities = Array.from({ length: 13 }, (_, index) => ({
    id: `A${index}`,
    kind: index === 0 ? ("trigger" as const) : index === 12 ? ("outcome" as const) : ("activity" as const),
    sourceRef: `module.c#step_${index}`,
    label: `执行第 ${index + 1} 个业务步骤`,
    businessMeaning: `执行第 ${index + 1} 个业务步骤并完整处理输入参数、资源状态、硬件寄存器、队列指针、异常分支、恢复动作、完成通知和返回结果`,
    evidenceIDs: [`EV-activity-${index}`],
  }))
  return {
    schemaVersion: 1,
    moduleID: "MOD-business-facets",
    viewType: "business-flow",
    title: "详细业务流程",
    summary: "",
    assumptions: [],
    unknowns: [],
    activities,
    flows: activities.slice(0, -1).map((activity, index) => ({
      id: `F${index}`,
      from: activity.id,
      to: activities[index + 1]!.id,
      kind: "next" as const,
      label: `第 ${index + 1} 步完成后携带完整处理结果、状态标志、资源所有权、异常诊断和恢复上下文进入下一业务阶段`,
      evidenceIDs: [`EV-flow-${index}`],
    })),
  }
}

function runningDesignDocJob(workspace: string, id: string): DesignDocJob {
  const now = Date.now()
  return {
    schemaVersion: 1,
    id,
    revision: 0,
    status: "running",
    workspace,
    config: {
      targetPath: "module",
      artifactTypes: ["lifecycle"],
      languages: ["typescript", "tsx"],
      concurrency: 1,
      recursive: false,
      evidenceBudget: { maxItems: 64, maxPromptBytes: 49_152, maxSnippetCharacters: 800 },
      retryPolicy: { maxAttempts: 3, timeoutMs: 120_000, backoffMs: [0], retryableCodes: [] },
      modelPolicy: {
        primary: { providerID: "test", modelID: "test" },
        fallbacks: [],
        structuredOutput: "tool-json-schema",
      },
      renderer: "mermaid",
    },
    workItems: [],
    artifacts: [],
    progress: { total: 0, pending: 0, running: 0, passed: 0, failed: 0, blocked: 0, cancelled: 0 },
    createdAt: now,
    updatedAt: now,
  }
}

function crc32(input: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of input) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(kind: string, data: Uint8Array) {
  const name = Buffer.from(kind, "ascii")
  const out = Buffer.alloc(12 + data.byteLength)
  out.writeUInt32BE(data.byteLength, 0)
  name.copy(out, 4)
  Buffer.from(data).copy(out, 8)
  out.writeUInt32BE(crc32(Buffer.concat([name, Buffer.from(data)])), 8 + data.byteLength)
  return out
}

function plantumlPng() {
  const png = Buffer.from(PNG_1X1, "base64")
  const iend = png.lastIndexOf(Buffer.from("IEND", "ascii")) - 4
  const payload = Buffer.concat([
    Buffer.from("plantuml\0", "latin1"),
    Buffer.from([1, 0, 0, 0]),
    deflateSync(Buffer.from(`${SIMPLE_PLANTUML}\n\n1.2026.6`, "utf8")),
  ])
  return Buffer.concat([png.subarray(0, iend), pngChunk("iTXt", payload), png.subarray(iend)])
}

function provideTmpdirInstance<A, E>(self: (dir: string) => Effect.Effect<A, E>, options?: { git?: boolean }) {
  return Effect.promise(async () => {
    await using temp = await tmpdir(options)
    return await provideTestInstance({
      directory: temp.path,
      fn: () => Effect.runPromise(self(temp.path).pipe(Effect.provide(CrossSpawnSpawner.defaultLayer))),
    })
  })
}

async function serveJson(payload: unknown, requests?: Array<Record<string, unknown>>, delay = 0) {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.once("end", async () => {
      const body = Buffer.concat(chunks).toString("utf8")
      if (body && requests) requests.push(JSON.parse(body) as Record<string, unknown>)
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
      response.writeHead(200, { connection: "close", "content-type": "application/json" })
      response.end(JSON.stringify(payload))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("test renderer did not bind a TCP port")
  return {
    origin: `http://127.0.0.1:${address.port}`,
    stop: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  }
}

describe("chipmate Mermaid documents", () => {
  test("detects significant Mermaid SVG label collisions without flagging separated labels", () => {
    const svg = (secondX: number) => `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 300">
        <g class="edgeLabels">
          <g class="edgeLabel" transform="translate(150, 100)">
            <g class="label" data-id="edge-a" transform="translate(-90, -30)">
              <foreignObject width="180" height="60"><div xmlns="http://www.w3.org/1999/xhtml">第一条完整迁移说明</div></foreignObject>
            </g>
          </g>
          <g class="edgeLabel" transform="translate(${secondX}, 110)">
            <g class="label" data-id="edge-b" transform="translate(-90, -30)">
              <foreignObject width="180" height="60"><div xmlns="http://www.w3.org/1999/xhtml">第二条完整迁移说明</div></foreignObject>
            </g>
          </g>
        </g>
        <g class="nodes">
          <g class="node statediagram-state" id="state-a" transform="translate(400, 220)">
            <g class="label" transform="translate(-60, -20)">
              <foreignObject width="120" height="40"><div xmlns="http://www.w3.org/1999/xhtml">正常状态节点</div></foreignObject>
            </g>
          </g>
        </g>
      </svg>
    `

    const collisions = inspectMermaidSvgCollisions(svg(220))
    expect(collisions.map((item) => item.code)).toContain("mermaid-render-label-collision")
    expect(collisions[0]?.message).toContain("edge-a overlaps edge-label edge-b")
    expect(inspectMermaidSvgCollisions(svg(360))).toEqual([])
  })

  test.skipIf(!Bun.which("mmdc"))(
    "renders a real dense stateDiagram without false collision while still requiring readable facets",
    async () => {
      await Effect.runPromise(
        provideTmpdirInstance(() =>
          Effect.promise(async () => {
            const previousEndpoint = process.env["CHIPMATE_MERMAID_RENDER_ENDPOINT"]
            delete process.env["CHIPMATE_MERMAID_RENDER_ENDPOINT"]
            try {
              const denseIR = lifecycleFixture(true)
              const dense = await renderMermaidPng({ source: lifecycleMermaid(denseIR), timeoutMs: 120_000 })
              expect(dense.rendered).toBe(true)
              expect(dense.issues.map((item) => item.code)).not.toContain("mermaid-render-label-collision")
              const fit = mermaidWordFit({
                width: dense.width,
                height: dense.height,
                status: "valid",
                fingerprint: lifecycleFitFingerprint(denseIR),
                issues: dense.issues,
              })
              expect(fit.wordFitStatus).toBe("split-required")
              expect(fit.documentReady).toBe(false)

              const normalIR = lifecycleFixture(false)
              const normal = await renderMermaidPng({ source: lifecycleMermaid(normalIR), timeoutMs: 120_000 })
              expect(normal.rendered).toBe(true)
              expect(normal.issues.map((item) => item.code)).not.toContain("mermaid-render-label-collision")
              expect(
                mermaidWordFit({
                  width: normal.width,
                  height: normal.height,
                  status: "valid",
                  fingerprint: lifecycleFitFingerprint(normalIR),
                  issues: normal.issues,
                }).wordFitStatus,
              ).toBe("readable")
            } finally {
              if (previousEndpoint === undefined) delete process.env["CHIPMATE_MERMAID_RENDER_ENDPOINT"]
              else process.env["CHIPMATE_MERMAID_RENDER_ENDPOINT"] = previousEndpoint
            }
          }),
        ),
      )
    },
    120_000,
  )

  test.skipIf(!Bun.which("mmdc"))(
    "keeps real overview relations while omitting redundant category-edge labels that collide",
    async () => {
      await Effect.runPromise(
        provideTmpdirInstance(() =>
          Effect.promise(async () => {
            const previousEndpoint = process.env["CHIPMATE_MERMAID_RENDER_ENDPOINT"]
            delete process.env["CHIPMATE_MERMAID_RENDER_ENDPOINT"]
            try {
              const ir = overviewLabelCollisionFixture()
              for (const direction of ["LR", "TD"] as const) {
                const source = overviewMermaid(ir, direction)
                const readable = source.replaceAll("\u2060", "")
                const rendered = await renderMermaidPng({ source, timeoutMs: 120_000 })
                expect(rendered.rendered).toBe(true)
                expect(rendered.issues.map((item) => item.code)).not.toContain("mermaid-render-label-collision")
                expect(source).not.toContain("…")
                expect(readable.match(/-->/g)?.length).toBe(18)
                expect(readable.match(/\|"声明"\|/g)?.length).toBe(5)
                for (const item of ir.items)
                  expect(source.replaceAll("<br/>", "").replaceAll("\u2060", "")).toContain(item.label)
                for (const relation of ir.relations ?? []) expect(readable).toContain(relation.label)
              }
            } finally {
              if (previousEndpoint === undefined) delete process.env["CHIPMATE_MERMAID_RENDER_ENDPOINT"]
              else process.env["CHIPMATE_MERMAID_RENDER_ENDPOINT"] = previousEndpoint
            }
          }),
        ),
      )
    },
    120_000,
  )

  test.skipIf(!Bun.which("mmdc"))(
    "splits a real 6-state 8-transition lifecycle into readable collision-free deterministic facets",
    async () => {
      await Effect.runPromise(
        provideTmpdirInstance((directory) =>
          Effect.promise(async () => {
            const previousEndpoint = process.env["CHIPMATE_MERMAID_RENDER_ENDPOINT"]
            delete process.env["CHIPMATE_MERMAID_RENDER_ENDPOINT"]
            try {
              const jobID = "job-lifecycle-facets"
              await DesignDocStore.create(runningDesignDocJob(directory, jobID))
              const ir = lifecycleFacetFixture()
              const result = await renderLifecycle({
                workspace: directory,
                jobID,
                ir,
                outputPath: "work-items/lifecycle/render/lifecycle.png",
                timeoutMs: 120_000,
              })
              expect(result.parts.length).toBeGreaterThan(1)
              expect(result.wordFit.wordFitStatus).toBe("readable")
              expect(result.parts.every((part) => part.wordFit.wordFitStatus === "readable")).toBe(true)
              expect(result.parts.flatMap((part) => part.diagnostics).map((item) => item.code)).not.toContain(
                "mermaid-render-label-collision",
              )
              const sources = result.parts
                .map((part) => part.source.replaceAll("<br/>", "").replaceAll("\u2060", ""))
                .join("\n")
              for (const state of ir.states) expect(sources).toContain(state.sourceValue)
              for (const transition of ir.transitions) {
                expect(sources).toContain(`触发：${transition.trigger}`)
                if (transition.guard) expect(sources).toContain(`条件：${transition.guard}`)
                if (transition.action) expect(sources).toContain(`动作：${transition.action}`)
              }
              expect(new Set(result.parts.map((part) => part.render.path)).size).toBe(result.parts.length)
            } finally {
              if (previousEndpoint === undefined) delete process.env["CHIPMATE_MERMAID_RENDER_ENDPOINT"]
              else process.env["CHIPMATE_MERMAID_RENDER_ENDPOINT"] = previousEndpoint
            }
          }),
        ),
      )
    },
    120_000,
  )

  test.skipIf(!Bun.which("mmdc"))(
    "splits a dense business flow into readable facets without dropping nodes, edges, or labels",
    async () => {
      await Effect.runPromise(
        provideTmpdirInstance((directory) =>
          Effect.promise(async () => {
            const previousEndpoint = process.env["CHIPMATE_MERMAID_RENDER_ENDPOINT"]
            delete process.env["CHIPMATE_MERMAID_RENDER_ENDPOINT"]
            try {
              const jobID = "job-business-flow-facets"
              await DesignDocStore.create(runningDesignDocJob(directory, jobID))
              const ir = businessFlowFacetFixture()
              const result = await renderBusinessFlow({
                workspace: directory,
                jobID,
                ir,
                outputPath: "work-items/business-flow/render/business-flow.png",
                timeoutMs: 120_000,
              })
              expect(result.parts.length).toBeGreaterThan(1)
              expect(result.wordFit.wordFitStatus).toBe("readable")
              expect(result.parts.every((part) => part.wordFit.wordFitStatus === "readable")).toBe(true)
              expect(result.parts.flatMap((part) => part.diagnostics).map((item) => item.code)).not.toContain(
                "mermaid-render-label-collision",
              )
              const sources = result.parts
                .map((part) => part.source.replaceAll("<br/>", "").replaceAll("\u2060", ""))
                .join("\n")
              for (const activity of ir.activities) expect(sources).toContain(activity.businessMeaning)
              for (const flow of ir.flows) expect(sources).toContain(flow.label)
              expect(new Set(result.parts.map((part) => part.render.path)).size).toBe(result.parts.length)
            } finally {
              if (previousEndpoint === undefined) delete process.env["CHIPMATE_MERMAID_RENDER_ENDPOINT"]
              else process.env["CHIPMATE_MERMAID_RENDER_ENDPOINT"] = previousEndpoint
            }
          }),
        ),
      )
    },
    120_000,
  )

  test("classifies source-backed Word fit without changing ordinary Mermaid", () => {
    const ordinary = mermaidWordFit({ width: 784, height: 1085, status: "not-requested" })
    expect(ordinary).toEqual({})

    const readable = mermaidWordFit({
      width: 784,
      height: 293,
      status: "valid",
      fingerprint: {
        diagramId: "architecture",
        nodeIds: Array.from({ length: 11 }, (_, index) => `n${index}`),
        edges: Array.from({ length: 13 }, (_, index) => ({
          from: `n${index % 11}`,
          to: `n${(index + 1) % 11}`,
          relation: "dependency",
        })),
      },
    })
    expect(readable.wordFitStatus).toBe("readable")
    expect(readable.documentReady).toBe(true)
    expect(readable.wordFitScale).toBeCloseTo(624 / 784)

    const calibrated = mermaidWordFit({
      width: 911,
      height: 748,
      status: "valid",
      fingerprint: {
        diagramId: "calibrated",
        nodeIds: Array.from({ length: 11 }, (_, index) => `n${index}`),
        edges: Array.from({ length: 13 }, (_, index) => ({
          from: `n${index % 11}`,
          to: `n${(index + 1) % 11}`,
          relation: "dependency",
        })),
      },
    })
    expect(calibrated.wordFitStatus).toBe("readable")
    expect(calibrated.documentReady).toBe(true)
    expect(calibrated.wordFitScale).toBeCloseTo(624 / 911)

    const portrait = mermaidWordFit({
      width: 784,
      height: 1200,
      status: "valid",
      fingerprint: {
        diagramId: "business",
        nodeIds: Array.from({ length: 70 }, (_, index) => `n${index}`),
        edges: Array.from({ length: 76 }, (_, index) => ({
          from: `n${index % 70}`,
          to: `n${(index + 1) % 70}`,
          relation: "dependency",
        })),
      },
    })
    expect(portrait.wordFitStatus).toBe("split-required")
    expect(portrait.documentReady).toBe(false)
    expect(portrait.wordFitReasons?.some((item) => item.includes("Word-fit scale"))).toBe(true)

    const panoramic = mermaidWordFit({
      width: 784,
      height: 131,
      status: "valid",
      fingerprint: {
        diagramId: "code",
        nodeIds: Array.from({ length: 60 }, (_, index) => `n${index}`),
        edges: Array.from({ length: 62 }, (_, index) => ({
          from: `n${index % 60}`,
          to: `n${(index + 1) % 60}`,
          relation: "dependency",
        })),
      },
    })
    expect(panoramic.wordFitStatus).toBe("split-required")
    expect(panoramic.documentReady).toBe(false)
    expect(panoramic.wordFitReasons?.some((item) => item.includes("Semantic density"))).toBe(true)
    expect(panoramic.wordFitReasons?.some((item) => item.includes("Aspect ratio"))).toBe(true)
  })

  test("validates Mermaid source and saves source/png artifacts", async () => {
    await Effect.runPromise(
      provideTmpdirInstance(
        (dir) =>
          Effect.promise(async () => {
            const valid = validateMermaidDiagram({ source: SIMPLE_MERMAID })
            expect(valid.valid).toBe(true)
            expect(valid.diagramType).toBe("flowchart")

            const invalid = validateMermaidDiagram({ source: "this is not Mermaid" })
            expect(invalid.valid).toBe(false)
            expect(invalid.diagnostics.some((item) => item.code === "mermaid-render-failed")).toBe(true)

            const escaped = validateMermaidDiagram({
              source: String.raw`flowchart TD
  A["value \"quoted\""] --> B["done"]`,
            })
            expect(escaped.valid).toBe(false)
            expect(escaped.diagnostics.some((item) => item.message.includes("backslash-escaped quotes"))).toBe(true)

            const clippedSourceExpression = validateMermaidDiagram({
              source: `flowchart TD\n  A["IO_READ32(HOST_DMA_FIFO_RE…"] --> B["done"]`,
            })
            expect(clippedSourceExpression.valid).toBe(true)

            const saved = await saveMermaidArtifact({
              source: SIMPLE_MERMAID,
              pngBase64: PNG_1X1,
              sourceFile: "flow.mmd",
              pngFile: "flow.png",
            })
            expect(saved.sourcePath).toBe(`${saved.artifactDir}/flow.mmd`)
            expect(saved.pngPath).toBe(`${saved.artifactDir}/flow.png`)
            expect(await fs.stat(path.join(dir, saved.sourcePath!))).toBeDefined()
            expect(await fs.stat(path.join(dir, saved.pngPath!))).toBeDefined()
          }),
        { git: true },
      ).pipe(Effect.scoped, Effect.provide(CrossSpawnSpawner.defaultLayer)),
    )
  })

  test("renders Mermaid through a remote endpoint and records timeout diagnostics", async () => {
    await Effect.runPromise(
      provideTmpdirInstance(
        (dir) =>
          Effect.promise(async () => {
            const server = await serveJson({ pngBase64: PNG_1X1 })
            try {
              const rendered = await renderMermaidDiagram({
                source: SIMPLE_MERMAID,
                remoteEndpoint: server.origin,
                sourceFile: "remote.mmd",
                pngFile: "remote.png",
              })
              expect(rendered.rendered).toBe(true)
              expect(rendered.pngPath).toBe(`${rendered.artifactDir}/remote.png`)
              const png = await fs.readFile(path.join(dir, rendered.pngPath!))
              expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
            } finally {
              await server.stop()
            }

            const requests: Array<Record<string, unknown>> = []
            const nested = await serveJson(
              {
                ok: true,
                png: { contentType: "image/png", base64: PNG_1X1 },
                width: 480,
                height: 280,
                pixelWidth: 1440,
                pixelHeight: 840,
                scale: 3,
                contentBounds: { x: 10, y: 20, width: 448, height: 238 },
                cropBounds: { x: 0, y: 0, width: 480, height: 280 },
                padding: 32,
                contentCropRatio: 0.79,
                elapsedMs: 321,
                renderer: { kind: "remote-opencode", diagramToPng: "mermaid-chromium" },
                warnings: ["renderer warning"],
                issues: [
                  {
                    severity: "warning",
                    code: "mermaid-render-content-bounds-suspicious",
                    message: "content bounds need review",
                  },
                ],
              },
              requests,
            )
            try {
              const rendered = await renderMermaidDiagram({
                source: SIMPLE_MERMAID,
                remoteEndpoint: nested.origin,
                sourceFile: "nested.mmd",
                pngFile: "nested.png",
                scale: 3,
                timeoutMs: 15_000,
              })
              expect(rendered.rendered).toBe(true)
              expect(requests).toEqual([
                {
                  background: "white",
                  source: SIMPLE_MERMAID,
                  filename: "nested.mmd",
                  scale: 3,
                  timeoutMs: 15_000,
                },
              ])
              expect(rendered.width).toBe(480)
              expect(rendered.height).toBe(280)
              expect(rendered.pixelWidth).toBe(1440)
              expect(rendered.pixelHeight).toBe(840)
              expect(rendered.scale).toBe(3)
              expect(rendered.contentBounds).toEqual({ x: 10, y: 20, width: 448, height: 238 })
              expect(rendered.cropBounds).toEqual({ x: 0, y: 0, width: 480, height: 280 })
              expect(rendered.padding).toBe(32)
              expect(rendered.contentCropRatio).toBe(0.79)
              expect(rendered.elapsedMs).toBe(321)
              expect(rendered.renderer).toEqual({ kind: "remote-opencode", diagramToPng: "mermaid-chromium" })
              expect(rendered.issues).toEqual([
                {
                  severity: "warning",
                  code: "mermaid-render-content-bounds-suspicious",
                  message: "content bounds need review",
                },
              ])
              expect(rendered.warnings).toContain("mermaid-render-failed: renderer warning")
              expect(rendered.warnings).toContain(
                "mermaid-render-failed: mermaid-render-content-bounds-suspicious: content bounds need review",
              )
              const png = await fs.readFile(path.join(dir, rendered.pngPath!))
              expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
            } finally {
              await nested.stop()
            }

            const previousCommand = process.env["CHIPMATE_MERMAID_MMDC"]
            process.env["CHIPMATE_MERMAID_MMDC"] = path.join(dir, "missing-mmdc")
            try {
              const rejected = await serveJson({
                ok: false,
                issues: [{ severity: "error", code: "mermaid-source-empty", message: "source is required" }],
              })
              try {
                const rendered = await renderMermaidDiagram({
                  source: SIMPLE_MERMAID,
                  remoteEndpoint: rejected.origin,
                })
                expect(rendered.rendered).toBe(false)
                expect(rendered.issues).toEqual([
                  { severity: "error", code: "mermaid-source-empty", message: "source is required" },
                ])
                expect(rendered.diagnostics).toContainEqual(
                  expect.objectContaining({
                    code: "mermaid-render-failed",
                    severity: "error",
                    message: expect.stringContaining("mermaid-source-empty: source is required"),
                  }),
                )
              } finally {
                await rejected.stop()
              }

              const empty = await serveJson({ ok: true, issues: [] })
              try {
                const rendered = await renderMermaidDiagram({
                  source: SIMPLE_MERMAID,
                  remoteEndpoint: empty.origin,
                })
                expect(rendered.rendered).toBe(false)
                expect(rendered.diagnostics).toContainEqual({
                  code: "mermaid-render-failed",
                  severity: "error",
                  message: "remote Mermaid renderer returned no PNG",
                })
              } finally {
                await empty.stop()
              }

              const slow = await serveJson({ pngBase64: PNG_1X1 }, undefined, 50)
              try {
                const timedOut = await renderMermaidDiagram({
                  source: SIMPLE_MERMAID,
                  remoteEndpoint: slow.origin,
                  timeoutMs: 1,
                })
                expect(timedOut.rendered).toBe(false)
                expect(timedOut.diagnostics.some((item) => item.code === "mermaid-render-timeout")).toBe(true)
              } finally {
                await slow.stop()
              }
            } finally {
              if (previousCommand === undefined) delete process.env["CHIPMATE_MERMAID_MMDC"]
              else process.env["CHIPMATE_MERMAID_MMDC"] = previousCommand
            }
          }),
        { git: true },
      ).pipe(Effect.scoped, Effect.provide(CrossSpawnSpawner.defaultLayer)),
    )
  })

  test("renders with local mmdc scale, crops content bounds, and falls back after remote failure", async () => {
    await Effect.runPromise(
      provideTmpdirInstance(
        (dir) =>
          Effect.promise(async () => {
            const pixels = new Uint8Array(600 * 450 * 4).fill(255)
            for (let y = 150; y < 300; y += 1) {
              for (let x = 200; x < 400; x += 1) {
                const offset = (y * 600 + x) * 4
                pixels[offset] = 20
                pixels[offset + 1] = 40
                pixels[offset + 2] = 60
              }
            }
            const image = new PhotonImage(pixels, 600, 450)
            const png = Buffer.from(image.get_bytes())
            image.free()

            const fake = path.join(dir, "fake-mmdc")
            const argsPath = path.join(dir, "mmdc-args.json")
            await fs.writeFile(
              fake,
              [
                "#!/usr/bin/env bun",
                "const args = process.argv.slice(2)",
                'const output = args[args.indexOf("-o") + 1]',
                'await Bun.write(output, Buffer.from(process.env["FAKE_MMDC_PNG"]!, "base64"))',
                'await Bun.write(process.env["FAKE_MMDC_ARGS"]!, JSON.stringify(args))',
                "",
              ].join("\n"),
              { mode: 0o755 },
            )

            const previousCommand = process.env["CHIPMATE_MERMAID_MMDC"]
            const previousPng = process.env["FAKE_MMDC_PNG"]
            const previousArgs = process.env["FAKE_MMDC_ARGS"]
            const previousEndpoint = process.env["CHIPMATE_MERMAID_RENDER_ENDPOINT"]
            process.env["CHIPMATE_MERMAID_MMDC"] = fake
            process.env["FAKE_MMDC_PNG"] = png.toString("base64")
            process.env["FAKE_MMDC_ARGS"] = argsPath
            delete process.env["CHIPMATE_MERMAID_RENDER_ENDPOINT"]
            try {
              const local = await renderMermaidDiagram({
                source: SIMPLE_MERMAID,
                sourceFile: "local.mmd",
                pngFile: "local.png",
              })
              expect(local.rendered).toBe(true)
              expect(local.scale).toBe(3)
              expect(local.pixelWidth).toBe(392)
              expect(local.pixelHeight).toBe(342)
              expect(local.width).toBeCloseTo(392 / 3)
              expect(local.height).toBe(114)
              expect(local.contentBounds).toEqual({ x: 200 / 3, y: 50, width: 200 / 3, height: 50 })
              expect(local.cropBounds).toEqual({ x: 104 / 3, y: 18, width: 392 / 3, height: 114 })
              expect(local.padding).toBe(32)
              expect(local.contentCropRatio).toBeCloseTo((200 * 150) / (392 * 342))
              expect(local.renderer).toEqual({
                kind: "local-mmdc",
                diagramToPng: "mmdc",
                crop: "pixel-content-bounds",
                visualInspection: "svg-label-bounds",
              })
              const args = JSON.parse(await fs.readFile(argsPath, "utf8")) as string[]
              expect(args).toContain("white")
              expect(args.slice(args.indexOf("-s"), args.indexOf("-s") + 2)).toEqual(["-s", "3"])

              const previousPath = process.env["PATH"]
              process.env["CHIPMATE_MERMAID_MMDC"] = "fake-mmdc"
              process.env["PATH"] = `${dir}${path.delimiter}${previousPath ?? ""}`
              try {
                const resolved = await renderMermaidDiagram({
                  source: SIMPLE_MERMAID,
                  sourceFile: "resolved-local.mmd",
                  pngFile: "resolved-local.png",
                })
                expect(resolved.rendered).toBe(true)
                expect(resolved.renderer?.kind).toBe("local-mmdc")
              } finally {
                if (previousPath === undefined) delete process.env["PATH"]
                else process.env["PATH"] = previousPath
                process.env["CHIPMATE_MERMAID_MMDC"] = fake
              }

              const remote = Bun.serve({
                hostname: "127.0.0.1",
                port: 0,
                fetch: async () => new Response("offline", { status: 503 }),
              })
              try {
                const fallback = await renderMermaidDiagram({
                  source: SIMPLE_MERMAID,
                  remoteEndpoint: `http://127.0.0.1:${remote.port}`,
                  scale: 4,
                })
                expect(fallback.rendered).toBe(true)
                expect(fallback.scale).toBe(4)
                expect(fallback.renderer?.kind).toBe("local-mmdc")
                expect(fallback.diagnostics).toContainEqual(
                  expect.objectContaining({ code: "mermaid-render-remote-failed", severity: "warning" }),
                )
              } finally {
                await remote.stop(true)
              }
            } finally {
              if (previousCommand === undefined) delete process.env["CHIPMATE_MERMAID_MMDC"]
              else process.env["CHIPMATE_MERMAID_MMDC"] = previousCommand
              if (previousPng === undefined) delete process.env["FAKE_MMDC_PNG"]
              else process.env["FAKE_MMDC_PNG"] = previousPng
              if (previousArgs === undefined) delete process.env["FAKE_MMDC_ARGS"]
              else process.env["FAKE_MMDC_ARGS"] = previousArgs
              if (previousEndpoint === undefined) delete process.env["CHIPMATE_MERMAID_RENDER_ENDPOINT"]
              else process.env["CHIPMATE_MERMAID_RENDER_ENDPOINT"] = previousEndpoint
            }
          }),
        { git: true },
      ).pipe(Effect.scoped, Effect.provide(CrossSpawnSpawner.defaultLayer)),
    )
  })

  test("inserts a Mermaid PNG into a new Word artifact", async () => {
    await Effect.runPromise(
      provideTmpdirInstance(
        () =>
          Effect.promise(async () => {
            const word = await createWordDocument({
              title: "Mermaid Word",
              outputFile: "mermaid-word.docx",
              sections: [{ title: "Diagrams", paragraphs: ["Before diagram"] }],
            })

            const inserted = await insertMermaidIntoWord({
              wordPath: word.path,
              source: SIMPLE_MERMAID,
              pngBase64: PNG_1X1,
              heading: "Diagrams",
              caption: "Figure 1. Mermaid flow",
              outputFile: "mermaid-word-updated.docx",
            })

            expect(inserted.inserted).toBe(true)
            expect(inserted.wordPath).toBe(`${inserted.artifactDir}/mermaid-word-updated.docx`)
            const inspection = await inspectWordDocument({ path: inserted.wordPath! })
            expect(inspection.images.length).toBe(1)
            expect(inspection.paragraphs.some((item) => item.text === "Figure 1. Mermaid flow")).toBe(true)
          }),
        { git: true },
      ).pipe(Effect.scoped, Effect.provide(CrossSpawnSpawner.defaultLayer)),
    )
  })

  test("preserves and inspects PlantUML source metadata in an inserted Word PNG", async () => {
    await Effect.runPromise(
      provideTmpdirInstance(
        (dir) =>
          Effect.promise(async () => {
            const word = await createWordDocument({
              title: "PlantUML Word",
              outputFile: "plantuml-word.docx",
              sections: [{ title: "Diagrams", paragraphs: ["Before diagram"] }],
            })
            const inserted = await insertMermaidIntoWord({
              wordPath: word.path,
              source: SIMPLE_MERMAID,
              pngBase64: plantumlPng().toString("base64"),
              heading: "Diagrams",
              caption: "Figure 1. PlantUML class diagram",
              outputFile: "plantuml-word-updated.docx",
            })

            const inspection = await inspectWordDocument({ path: inserted.wordPath! })
            expect(inspection.images[0]?.plantUmlSource).toBe(SIMPLE_PLANTUML)
            expect(inspection.images[0]?.plantUmlVersion).toBe("1.2026.6")
            const bytes = await fs.readFile(path.join(dir, inserted.wordPath!))
            const extracted = await extractDocxPlantUml(bytes)
            expect(extracted.diagrams[0]?.source).toBe(SIMPLE_PLANTUML)
          }),
        { git: true },
      ).pipe(Effect.scoped, Effect.provide(CrossSpawnSpawner.defaultLayer)),
    )
  })
})
