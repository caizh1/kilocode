import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import * as Readiness from "@/kilocode/skill/workflow-readiness"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe("source-backed workflow readiness", () => {
  test("rejects combined topics and non-state-machine N/A shortcuts", async () => {
    const root = await setup()
    await file(
      root,
      "artifact/05-enhanced-detail-design/units/target.md",
      [
        "### target",
        "#### 1. 简介",
        "SBDD-TOPIC-STATUS: 01 | PASS | E1",
        "这是解释性正文。",
        "#### 2-13. 简化",
        "SBDD-TOPIC-STATUS: 02-13 | N/A | E1",
        "批量省略。",
        "#### 14. 证据",
        "SBDD-TOPIC-STATUS: 14 | PASS | E1",
        "这是证据说明。",
      ].join("\n"),
    )

    const ready = await Readiness.prose(root, "artifact")
    expect(ready.issues).toContain("target combines topic status ranges")
    expect(ready.issues.some((item) => item.includes("topic 2 requires one separate H4 heading"))).toBe(true)
  })

  test("accepts fourteen separate topics and requires every applicable rendered view", async () => {
    const root = await setup()
    await file(root, "artifact/05-enhanced-detail-design/units/target.md", unit())
    await file(root, "artifact/resume-state.md", "ready")
    await file(root, "artifact/review-notes.md", "ready")
    const views = ["architecture", "business-flow", "code-flow", "data-lifecycle"]
    const items = []
    for (const view of views) {
      const id = `target-${view}`
      await file(
        root,
        `artifact/04-diagrams/${id}.claims.json`,
        JSON.stringify({ version: 1, diagramId: id, diagramType: view, designUnitId: "target" }),
      )
      await file(root, `artifact/04-diagrams/${id}.png`, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      items.push({
        diagramId: id,
        rendered: true,
        semanticStatus: "valid",
        pngPath: `artifact/04-diagrams/${id}.png`,
        documentReady: true,
      })
    }
    await file(
      root,
      "artifact/04-diagrams/batch.results.json",
      JSON.stringify({ complete: true, items }),
    )

    const ready = await Readiness.figures(root, "artifact")
    expect(ready.issues).toEqual([])

    await fs.rm(path.join(root, "artifact/04-diagrams/target-code-flow.png"))
    const missing = await Readiness.figures(root, "artifact")
    expect(missing.issues).toContain("target:code-flow has a missing or invalid PNG")
  })

  test("rejects utility exclusions that silently remove a required DesignUnit", async () => {
    const root = await setup()
    const censusPath = path.join(root, "artifact/02-source-evidence/design-unit-census.json")
    const census = JSON.parse(await fs.readFile(censusPath, "utf8"))
    census.implementationUnits.push({
      path: "src/helper.c",
      disposition: "excluded",
      designUnitId: null,
      exclusion: { reason: "utility" },
    })
    await fs.writeFile(censusPath, JSON.stringify(census))
    await file(root, "artifact/05-enhanced-detail-design/units/target.md", unit())

    const ready = await Readiness.prose(root, "artifact")
    expect(ready.issues.some((item) => item.includes("invalid exclusion reason utility"))).toBe(true)
  })
})

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "sbdd-readiness-"))
  roots.push(root)
  await file(
    root,
    "artifact/02-source-evidence/design-unit-census.json",
    JSON.stringify({
      version: 1,
      targetDesignUnitId: "target",
      targetSourceRoot: "src",
      designUnits: [{ id: "target", name: "Target", kind: "target" }],
      implementationUnits: [{ path: "src/target.c", disposition: "target", designUnitId: "target" }],
    }),
  )
  return root
}

function unit() {
  return [
    "### target",
    ...Array.from({ length: 14 }, (_, index) => {
      const topic = index + 1
      const status = topic === 8 ? "N/A" : "PASS"
      return [
        `#### ${topic}. 主题 ${topic}`,
        `SBDD-TOPIC-STATUS: ${String(topic).padStart(2, "0")} | ${status} | E${topic}`,
        `主题 ${topic} 的设计结论、机制、异常处理与源码依据说明。`,
      ].join("\n")
    }),
  ].join("\n")
}

async function file(root: string, name: string, data: string | Buffer) {
  const target = path.join(root, name)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, data)
}
