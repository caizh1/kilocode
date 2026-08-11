import { describe, expect, test } from "bun:test"
import { PhotonImage } from "@silvia-odwyer/photon-node"
import fs from "node:fs/promises"
import { createServer } from "node:http"
import path from "node:path"
import * as Job from "@/kilocode/source-backed-design/job"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

function source(name: string) {
  return Array.from({ length: 80 }, (_, index) =>
    index === 0
      ? `int ${name}_entry(int value) {`
      : index === 79
        ? "}"
        : `  value = value + ${index}; /* ${name} 第 ${index + 1} 行 */`,
  ).join("\n")
}

function prose(topicIds: number[], evidence: string, stateMachineNa: boolean) {
  const explanation =
    "本主题基于冻结源码说明真实责任、执行顺序、条件分支、数据变化和调用副作用。入口在满足前置条件后处理输入，分支失败时保留错误并进入清理路径，成功时提交结果；未观察到的机制会明确标记为证据缺口，不用名称清单代替分析。"
  return topicIds
    .map((id) => {
      const status = id === 8 && stateMachineNa ? "N/A" : "PASS"
      return [
        `#### ${String(id).padStart(2, "0")} 主题 ${id}`,
        "",
        `SBDD-TOPIC-STATUS: ${String(id).padStart(2, "0")} | ${status} | ${evidence}:1-40`,
        "",
        `设计结论：${explanation}`,
        "",
        `机制与流程：${explanation}`,
        "",
        `异常与边界：${explanation}`,
        "",
        `源码证据：${evidence}:1-40。`,
      ].join("\n")
    })
    .join("\n\n")
}

function relationships(evidence: string) {
  return [
    "source-ownership",
    "owning-module",
    "system-position",
    "caller",
    "callee",
    "data-flow",
    "state-flow",
    "control-flow",
    "dependency",
    "collaboration",
    "management",
    "resource-ownership",
  ].map((kind) => ({
    kind,
    subject: "目标单元",
    object: kind === "source-ownership" ? "src" : "待确认关系对象",
    statement:
      kind === "source-ownership" ? "目标单元的实现归属于冻结源码目录。" : `${kind} 已独立审计，当前证据待确认。`,
    confidence: kind === "source-ownership" ? "source-confirmed" : "not-confirmed",
    evidence: [{ path: evidence, startLine: 1, endLine: 40 }],
  }))
}

async function setup(dir: string, children = true) {
  await fs.mkdir(path.join(dir, "src"), { recursive: true })
  await fs.writeFile(path.join(dir, "src/target.c"), source("target"))
  if (children) await fs.writeFile(path.join(dir, "src/child.c"), source("child"))
}

async function writePacket(dir: string, response: Job.JobResponse, content: string) {
  if (!response.artifactDir || !response.workItem) throw new Error("缺少工作包")
  const file = response.workItem.draftPath
  await fs.writeFile(file, content, "utf8")
  return file
}

async function server(handler: (body: Record<string, unknown>, count: number) => Record<string, unknown>) {
  let count = 0
  const instance = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    request.once("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>
      response.writeHead(200, { "content-type": "application/json", connection: "close" })
      response.end(JSON.stringify(handler(body, count++)))
    })
  })
  await new Promise<void>((resolve) => instance.listen(0, "127.0.0.1", resolve))
  const address = instance.address()
  if (!address || typeof address === "string") throw new Error("测试服务未绑定端口")
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests: () => count,
    stop: () => new Promise<void>((resolve, reject) => instance.close((error) => (error ? reject(error) : resolve()))),
  }
}

function png(index: number) {
  const pixels = new Uint8Array(480 * 280 * 4)
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const pixel = offset / 4
    const x = pixel % 480
    const y = Math.floor(pixel / 480)
    const ink = x > 36 && x < 444 && y > 28 && y < 252 && (x % 36 < 24 || y % 28 < 18)
    pixels[offset] = ink ? Math.min(220, 30 + index * 17) : 255
    pixels[offset + 1] = ink ? Math.min(220, 60 + index * 13) : 255
    pixels[offset + 2] = ink ? Math.min(220, 90 + index * 9) : 255
    pixels[offset + 3] = 255
  }
  const image = new PhotonImage(pixels, 480, 280)
  try {
    return Buffer.from(image.get_bytes()).toString("base64")
  } finally {
    image.free()
  }
}

function pdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << >> >>",
    "<< /Length 0 >>\nstream\n\nendstream",
  ]
  let body = "%PDF-1.4\n"
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body))
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(body)
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  body += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body).toString("base64")
}

function diagram(response: Job.JobResponse) {
  const view = response.workItem!.view!
  const nodes = Array.from({ length: 5 }, (_, index) => ({
    id: `n${index + 1}`,
    label: `${view} 语义节点 ${index + 1}`,
    kind: index === 4 ? "terminal" : "step",
    designUnitId: "target_unit",
    evidence: [{ path: "src/target.c", startLine: 1, endLine: 40 }],
  }))
  const edges = [
    ["e1", "n1", "n2", "进入处理"],
    ["e2", "n2", "n3", "条件成立"],
    ["e3", "n2", "n4", "失败恢复"],
    ["e4", "n3", "n5", "提交并清理"],
    ["e5", "n4", "n5", "清理后终止"],
  ].map(([id, from, to, label]) => ({
    id,
    from,
    to,
    label,
    relation: "dependency",
    evidence: [{ path: "src/target.c", startLine: 1, endLine: 40 }],
  }))
  const coverage =
    view === "architecture"
      ? {
          boundaryNodeIds: ["n1"],
          entryNodeIds: ["n2"],
          componentNodeIds: ["n3"],
          dependencyEdgeIds: ["e1"],
          resourceNodeIds: ["n4"],
        }
      : view === "business-flow"
        ? {
            flowFamilyIds: ["e1"],
            decisionEdgeIds: ["e2"],
            errorEdgeIds: ["e3"],
            terminalNodeIds: ["n4"],
            effectNodeIds: ["n5"],
          }
        : view === "code-flow"
          ? {
              entryNodeIds: ["n1"],
              conditionEdgeIds: ["e1"],
              mutationNodeIds: ["n3"],
              errorEdgeIds: ["e3"],
              cleanupNodeIds: ["n5"],
            }
          : {
              objectNodeIds: ["n1"],
              ownerNodeIds: ["n2"],
              readWriteEdgeIds: ["e1"],
              handoffEdgeIds: ["e2"],
              releaseNodeIds: ["n5"],
            }
  return {
    version: 1,
    diagramId: `target_unit_${view.replaceAll("-", "_")}`,
    designUnitId: "target_unit",
    view,
    title: `目标单元 ${view} 详细图`,
    direction: view === "architecture" ? "LR" : "TB",
    nodes,
    edges,
    groups: [{ id: "g1", label: "目标单元", nodeIds: nodes.map((node) => node.id) }],
    coverage,
  }
}

describe("source-backed design 分块任务控制器", () => {
  test("工作区根目标使用点号并纳入固件构建与配置证据文件", async () => {
    await using temp = await tmpdir()
    await setup(temp.path, false)
    await fs.writeFile(path.join(temp.path, "Makefile"), "all:\n\t@echo build\n")
    await fs.writeFile(
      path.join(temp.path, "build config.json"),
      Array.from({ length: 80 }, (_, index) => `配置证据第 ${index + 1} 行`).join("\n"),
    )
    await provideTestInstance({
      directory: temp.path,
      fn: async () => {
        const response = await Job.start({
          targetPath: ".",
          request: "生成完整详细设计",
          sessionId: "root-session",
          messageId: "root-message",
        })
        expect(response.workItem?.worker.tool).toBe("task")
        expect(response.workItem?.worker.subagentType).toBe("general")
        expect(response.workItem?.worker.prompt).toContain(response.workItem!.draftPath)
        expect(
          await Job.authorizeWorker({
            command: response.workItem!.worker.command,
            sessionId: "root-session",
            boundJobId: response.jobId!,
          }),
        ).toBe(true)
        expect(
          await Job.authorizeWorker({
            command: `${response.workItem!.worker.command}-tampered`,
            sessionId: "root-session",
            boundJobId: response.jobId!,
          }),
        ).toBe(false)
        const state = JSON.parse(
          await fs.readFile(path.join(temp.path, response.artifactDir!, "job.json"), "utf8"),
        ) as { targetPath: string; sourceFiles: Array<{ path: string; implementation: boolean }> }
        expect(state.targetPath).toBe(".")
        expect(state.sourceFiles).toContainEqual(expect.objectContaining({ path: "Makefile", implementation: false }))
        expect(state.sourceFiles).toContainEqual(
          expect.objectContaining({ path: "build config.json", implementation: false }),
        )
        const scope = {
          version: 1,
          target: { id: "target_unit", name: "目标单元", implementationPaths: ["src/target.c"] },
          submodules: [],
          implementationUnits: [
            {
              path: "src/target.c",
              disposition: "target",
              designUnitId: "target_unit",
              evidence: [{ path: "src/target.c", startLine: 1, endLine: 40 }],
            },
          ],
          relationships: relationships("src/target.c"),
          evidence: [{ path: "src/target.c", startLine: 1, endLine: 40 }],
        }
        let next = await Job.submit({
          jobId: response.jobId!,
          workItemId: response.workItem!.id,
          expectedRevision: response.revision!,
          resultPath: await writePacket(temp.path, response, `${JSON.stringify(scope, null, 2)}\n`),
          sessionId: "root-session",
          messageId: "root-message",
        })
        next = await Job.submit({
          jobId: next.jobId!,
          workItemId: next.workItem!.id,
          expectedRevision: next.revision!,
          resultPath: await writePacket(
            temp.path,
            next,
            prose(next.workItem!.topicIds!, "build config.json", false).replaceAll(
              "源码证据：build config.json:1-40。",
              "源码证据：build config.json:1-40；当前单元实现 src/target.c:1-40。",
            ),
          ),
          sessionId: "root-session",
          messageId: "root-message",
        })
        expect(next.phase).toBe("prose")
      },
    })
  })

  test("单目标模块可从范围、正文和四类适用图自动组装为严格有效的最终 Word", async () => {
    await using temp = await tmpdir()
    await setup(temp.path, false)
    const mermaid = await server((_body, count) => ({
      ok: true,
      png: { contentType: "image/png", base64: png(count) },
      width: 480,
      height: 280,
      pixelWidth: 1440,
      pixelHeight: 840,
      scale: 3,
      contentBounds: { x: 32, y: 32, width: 416, height: 216 },
      cropBounds: { x: 0, y: 0, width: 480, height: 280 },
      padding: 32,
      contentCropRatio: 0.67,
      renderer: { kind: "test-mermaid" },
      issues: [],
      warnings: [],
    }))
    const word = await server(() => ({
      ok: true,
      pageCount: 1,
      returnedPageCount: 1,
      pageCountKind: "exact",
      fieldRefreshStatus: "not-required",
      fieldRefreshDiagnostics: [],
      tocHeadingCount: 1,
      tocEntryCount: 1,
      tocPageNumberCount: 1,
      pdfBase64: pdf(),
      pages: [{ page: 1, pngBase64: png(9) }],
      textQa: {
        ok: true,
        titlePresent: true,
        firstHeadingPresent: true,
        sourceCjkCount: 100,
        pdfCjkCount: 100,
        cjkCoverage: 1,
        sentinelCount: 4,
        matchedSentinelCount: 4,
        sentinelCoverage: 1,
        diagnostics: [],
      },
      issues: [],
      renderer: { kind: "test-word" },
    }))
    const previousMermaid = process.env.KILO_MERMAID_RENDER_ENDPOINT
    const previousWord = process.env.KILO_WORD_RENDER_ENDPOINT
    process.env.KILO_MERMAID_RENDER_ENDPOINT = mermaid.origin
    process.env.KILO_WORD_RENDER_ENDPOINT = word.origin
    try {
      await provideTestInstance({
        directory: temp.path,
        fn: async () => {
          let turn = 1
          let messageId = `vertical-message-${turn}`
          let response = await Job.start({
            targetPath: "src",
            request: "生成目标模块完整源码驱动详细设计 Word",
            sessionId: "vertical-session",
            messageId,
          })
          const scope = {
            version: 1,
            target: { id: "target_unit", name: "目标单元", implementationPaths: ["src/target.c"] },
            submodules: [],
            implementationUnits: [
              {
                path: "src/target.c",
                disposition: "target",
                designUnitId: "target_unit",
                evidence: [{ path: "src/target.c", startLine: 1, endLine: 40 }],
              },
            ],
            relationships: relationships("src/target.c"),
            evidence: [{ path: "src/target.c", startLine: 1, endLine: 40 }],
          }
          response = await Job.submit({
            jobId: response.jobId!,
            workItemId: response.workItem!.id,
            expectedRevision: response.revision!,
            resultPath: await writePacket(temp.path, response, `${JSON.stringify(scope, null, 2)}\n`),
            sessionId: "vertical-session",
            messageId,
          })
          while (response.phase === "prose") {
            if (response.status === "awaiting-continuation") {
              messageId = `vertical-message-${++turn}`
              response = await Job.resume({ jobId: response.jobId, sessionId: "vertical-session", messageId })
            }
            response = await Job.submit({
              jobId: response.jobId!,
              workItemId: response.workItem!.id,
              expectedRevision: response.revision!,
              resultPath: await writePacket(
                temp.path,
                response,
                prose(response.workItem!.topicIds!, "src/target.c", true),
              ),
              sessionId: "vertical-session",
              messageId,
            })
          }
          while (response.phase === "diagrams") {
            if (response.status === "awaiting-continuation") {
              messageId = `vertical-message-${++turn}`
              response = await Job.resume({ jobId: response.jobId, sessionId: "vertical-session", messageId })
            }
            response = await Job.submit({
              jobId: response.jobId!,
              workItemId: response.workItem!.id,
              expectedRevision: response.revision!,
              resultPath: await writePacket(temp.path, response, `${JSON.stringify(diagram(response), null, 2)}\n`),
              sessionId: "vertical-session",
              messageId,
            })
          }
          expect(response.phase).toBe("closing")
          const detail =
            "本章根据冻结源码总结跨单元关系、索引、运行约束和风险。入口按条件处理输入并更新结果；失败分支保留错误、执行清理并返回，未发现的行为明确记录为待确认，不用名称清单代替机制解释。源码证据：src/target.c:1-40。"
          const closing = [
            "跨模块协作与端到端链路",
            "全局对象、接口、状态、配置与构建索引",
            "算法、并发、资源与性能",
            "调试、可观测性与建议点读源码",
            "覆盖、证据、风险与待确认项",
          ]
            .map((title) => `## ${title}\n\n${detail}${detail}`)
            .join("\n\n")
          response = await Job.submit({
            jobId: response.jobId!,
            workItemId: response.workItem!.id,
            expectedRevision: response.revision!,
            resultPath: await writePacket(temp.path, response, closing),
            sessionId: "vertical-session",
            messageId,
          })
          if (response.status !== "complete") throw new Error(response.message)
          expect(response.absoluteFinalDocxPath).toEndWith("final.docx")
          expect(await fs.stat(response.absoluteFinalDocxPath!)).toBeDefined()
          const completed = await Job.status(response.jobId)
          expect(completed.status).toBe("complete")
          expect(completed.absoluteFinalDocxPath).toBe(response.absoluteFinalDocxPath)
          expect(mermaid.requests()).toBe(4)
          expect(word.requests()).toBe(1)
        },
      })
    } finally {
      if (previousMermaid === undefined) delete process.env.KILO_MERMAID_RENDER_ENDPOINT
      else process.env.KILO_MERMAID_RENDER_ENDPOINT = previousMermaid
      if (previousWord === undefined) delete process.env.KILO_WORD_RENDER_ENDPOINT
      else process.env.KILO_WORD_RENDER_ENDPOINT = previousWord
      await Promise.all([mermaid.stop(), word.stop()])
    }
  }, 30_000)

  test("冻结范围，逐块完成正文，并只为证据化 N/A 省略状态机图", async () => {
    await using temp = await tmpdir()
    await setup(temp.path)
    await provideTestInstance({
      directory: temp.path,
      fn: async () => {
        let turn = 1
        let messageId = `message-a-${turn}`
        let response = await Job.start({
          targetPath: "src",
          request: "生成目标模块完整源码驱动详细设计 Word",
          sessionId: "session-a",
          messageId,
        })
        expect(response.phase).toBe("scope")
        expect(response.workItem?.id).toBe("scope-lock")
        const scope = {
          version: 1,
          target: { id: "target_unit", name: "目标单元", implementationPaths: ["src/target.c"] },
          submodules: [{ id: "child_unit", name: "子单元", implementationPaths: ["src/child.c"] }],
          implementationUnits: [
            {
              path: "src/target.c",
              disposition: "target",
              designUnitId: "target_unit",
              evidence: [{ path: "src/target.c", startLine: 1, endLine: 40 }],
            },
            {
              path: "src/child.c",
              disposition: "confirmed-submodule",
              designUnitId: "child_unit",
              evidence: [{ path: "src/child.c", startLine: 1, endLine: 40 }],
            },
          ],
          relationships: relationships("src/target.c"),
          evidence: [{ path: "src/target.c", startLine: 1, endLine: 40 }],
        }
        const scopePath = await writePacket(temp.path, response, `${JSON.stringify(scope, null, 2)}\n`)
        response = await Job.submit({
          jobId: response.jobId!,
          workItemId: response.workItem!.id,
          expectedRevision: response.revision!,
          resultPath: scopePath,
          sessionId: "session-a",
          messageId,
        })
        while (response.phase === "prose") {
          if (response.status === "awaiting-continuation") {
            messageId = `message-a-${++turn}`
            response = await Job.resume({ jobId: response.jobId, sessionId: "session-a", messageId })
          }
          const unitId = response.workItem!.unitId!
          const evidence = unitId === "target_unit" ? "src/target.c" : "src/child.c"
          const result = prose(response.workItem!.topicIds!, evidence, unitId === "child_unit").replaceAll(
            "源码证据：src/child.c:1-40。",
            "源码证据：src/child.c:1-40；上游接口上下文 src/target.c:1-40。",
          )
          const resultPath = await writePacket(temp.path, response, result)
          response = await Job.submit({
            jobId: response.jobId!,
            workItemId: response.workItem!.id,
            expectedRevision: response.revision!,
            resultPath,
            sessionId: "session-a",
            messageId,
          })
        }
        if (response.status === "awaiting-continuation") {
          messageId = `message-a-${++turn}`
          response = await Job.resume({ jobId: response.jobId, sessionId: "session-a", messageId })
        }
        expect(response.phase).toBe("diagrams")
        const state = JSON.parse(
          await fs.readFile(path.join(temp.path, response.artifactDir!, "job.json"), "utf8"),
        ) as { workItems: Array<{ kind: string; unitId?: string; view?: string }>; sourceFiles: unknown[] }
        const diagrams = state.workItems.filter((item) => item.kind === "diagram")
        expect(diagrams.filter((item) => item.unitId === "target_unit")).toHaveLength(5)
        expect(diagrams.filter((item) => item.unitId === "child_unit")).toHaveLength(4)
        expect(diagrams.some((item) => item.unitId === "child_unit" && item.view === "state-machine")).toBe(false)
        expect(state.sourceFiles).toHaveLength(2)
        const shallow = {
          version: 1,
          diagramId: "target_unit_architecture",
          designUnitId: "target_unit",
          view: "architecture",
          title: "过度简化的架构图",
          nodes: [
            {
              id: "n1",
              label: "唯一节点",
              kind: "component",
              designUnitId: "target_unit",
              evidence: [{ path: "src/target.c", startLine: 1, endLine: 40 }],
            },
            {
              id: "n2",
              label: "第二节点",
              kind: "component",
              designUnitId: "child_unit",
              evidence: [{ path: "src/target.c", startLine: 1, endLine: 40 }],
            },
          ],
          edges: [
            {
              id: "e1",
              from: "n1",
              to: "n2",
              label: "依赖",
              relation: "dependency",
              evidence: [{ path: "src/target.c", startLine: 1, endLine: 40 }],
            },
          ],
          coverage: Object.fromEntries(
            ["boundaryNodeIds", "entryNodeIds", "componentNodeIds", "dependencyEdgeIds", "resourceNodeIds"].map(
              (key) => [key, key.endsWith("EdgeIds") ? ["e1"] : ["n1"]],
            ),
          ),
        }
        const shallowPath = await writePacket(temp.path, response, `${JSON.stringify(shallow, null, 2)}\n`)
        await expect(
          Job.submit({
            jobId: response.jobId!,
            workItemId: response.workItem!.id,
            expectedRevision: response.revision!,
            resultPath: shallowPath,
            sessionId: "session-a",
            messageId,
          }),
        ).rejects.toThrow("不能全部复用同一节点或边")
        response = await Job.resume({
          jobId: response.jobId,
          sessionId: "session-a",
          messageId,
        })
        const disconnectedEvidence = diagram(response)
        disconnectedEvidence.nodes[4]!.designUnitId = "child_unit"
        for (const entry of [...disconnectedEvidence.nodes, ...disconnectedEvidence.edges]) {
          entry.evidence = [{ path: "src/target.c", startLine: 50, endLine: 60 }]
        }
        await expect(
          Job.submit({
            jobId: response.jobId!,
            workItemId: response.workItem!.id,
            expectedRevision: response.revision!,
            resultPath: await writePacket(
              temp.path,
              response,
              `${JSON.stringify(disconnectedEvidence, null, 2)}\n`,
            ),
            sessionId: "session-a",
            messageId,
          }),
        ).rejects.toThrow("未覆盖对应正文的源码证据")
      },
    })
  })

  test("租约隔离并发会话，显式续作使用新结果文件且旧 revision 不能覆盖", async () => {
    await using temp = await tmpdir()
    await setup(temp.path, false)
    await provideTestInstance({
      directory: temp.path,
      fn: async () => {
        const first = await Job.start({
          targetPath: "src",
          request: "生成完整详细设计",
          sessionId: "old-session",
          messageId: "old-message",
        })
        const same = await Job.resume({
          jobId: first.jobId,
          sessionId: "old-session",
          messageId: "old-message",
        })
        expect(same.workItem?.draftPath).toBe(first.workItem?.draftPath)
        const held = await Job.resume({
          jobId: first.jobId,
          sessionId: "new-session",
          messageId: "new-message",
        })
        expect(held.status).toBe("awaiting-continuation")
        const takeover = await Job.resume({
          jobId: first.jobId,
          sessionId: "new-session",
          messageId: "new-message",
          takeover: true,
        })
        expect(takeover.status).toBe("work-ready")
        expect(takeover.workItem?.draftPath).not.toBe(first.workItem?.draftPath)
        expect(takeover.revision).toBeGreaterThan(first.revision!)
        await expect(
          Job.submit({
            jobId: first.jobId!,
            workItemId: first.workItem!.id,
            expectedRevision: first.revision!,
            resultPath: first.workItem!.draftPath,
            sessionId: "old-session",
            messageId: "old-message",
          }),
        ).rejects.toThrow("revision 已变化")
      },
    })
  })

  test("源码清单变化只重置范围及下游，不复用旧租约", async () => {
    await using temp = await tmpdir()
    await setup(temp.path, false)
    await provideTestInstance({
      directory: temp.path,
      fn: async () => {
        const first = await Job.start({
          targetPath: "src",
          request: "生成完整详细设计",
          sessionId: "session-a",
          messageId: "message-a",
        })
        await fs.writeFile(path.join(temp.path, "src/new_unit.c"), source("new_unit"))
        const resumed = await Job.resume({
          jobId: first.jobId,
          sessionId: "session-b",
          messageId: "message-b",
          takeover: true,
        })
        expect(resumed.phase).toBe("scope")
        expect(resumed.workItem?.id).toBe("scope-lock")
        expect(resumed.workItem?.draftPath).not.toBe(first.workItem?.draftPath)
        const template = JSON.parse(
          await fs.readFile(resumed.workItem!.draftPath, "utf8"),
        ) as { implementationUnits: Array<{ path: string }> }
        expect(template.implementationUnits.map((row) => row.path).sort()).toEqual(["src/new_unit.c", "src/target.c"])
      },
    })
  })

  test("多个未完成任务必须显式选择，损坏状态不会被扫描或覆盖", async () => {
    await using temp = await tmpdir()
    await setup(temp.path, false)
    await provideTestInstance({
      directory: temp.path,
      fn: async () => {
        const first = await Job.start({
          targetPath: "src",
          request: "生成第一份完整详细设计",
          sessionId: "session-a",
          messageId: "message-a",
        })
        await Job.start({
          targetPath: "src",
          request: "生成第二份完整详细设计",
          sessionId: "session-b",
          messageId: "message-b",
        })
        const selection = await Job.resume({ sessionId: "session-c", messageId: "message-c" })
        expect(selection.status).toBe("needs-selection")
        expect(selection.candidates).toHaveLength(2)
        const statePath = path.join(temp.path, first.artifactDir!, "job.json")
        const state = JSON.parse(await fs.readFile(statePath, "utf8")) as Record<string, unknown>
        state.artifactDir = "../outside"
        await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`)
        await expect(
          Job.submit({
            jobId: first.jobId!,
            workItemId: first.workItem!.id,
            expectedRevision: first.revision!,
            resultPath: first.workItem!.draftPath,
            sessionId: "session-a",
            messageId: "message-a",
          }),
        ).rejects.toThrow("越界路径")
        expect(
          await fs
            .access(path.join(temp.path, "outside"))
            .then(() => true)
            .catch(() => false),
        ).toBe(false)
      },
    })
  })
})
