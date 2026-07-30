import { createHash } from "node:crypto"
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
    await file(root, "artifact/resume-state.md", checkpoint())
    await file(root, "artifact/review-notes.md", checkpoint())
    await file(root, "artifact/continue-prompt.md", checkpoint())
    const views = ["architecture", "business-flow", "code-flow", "data-lifecycle"]
    const items = []
    for (const view of views) {
      const id = `target-${view}`
      items.push(await figure(root, id, view))
    }
    await file(root, "artifact/04-diagrams/batch.results.json", JSON.stringify({ complete: true, items }))

    const ready = await Readiness.figures(root, "artifact")
    expect(ready.issues).toEqual([])
    expect(ready.progress).toEqual({
      designUnitCount: 1,
      requiredSlotCount: 4,
      completedSlotCount: 4,
      missingSlotCount: 0,
      completedDesignUnitIds: ["target"],
      remainingDesignUnitIds: [],
      nextMissingSlots: [],
      wordAllowed: true,
    })
    const approved = await Readiness.image(root, "artifact", items[0]!.pngPath!)
    expect(approved).toEqual({
      source: `flowchart TD\n  A["A"] --> B["B"]\n`,
      hash: items[0]!.sourceHash,
    })
    expect(await Readiness.image(root, "artifact", "artifact/04-diagrams/unapproved.png")).toEqual({
      issue: "PNG path is not recorded by a semantically valid, readable source-backed batch result",
    })
    const outline: Array<{ level: 1 | 2 | 3; title: string; paragraphIndex: number }> = [
      { level: 1, title: "target 目标模块详细设计", paragraphIndex: 1 },
    ]
    const paragraphs: Array<{ index: number; text: string; styleId?: string }> = [
      { index: 1, text: "target 目标模块详细设计", styleId: "Heading1" },
    ]
    for (let topic = 1; topic <= 14; topic++) {
      const heading = topic * 2
      outline.push({
        level: 2,
        title: `${topic}. 主题 ${topic}`,
        paragraphIndex: heading,
      })
      paragraphs.push(
        { index: heading, text: `${topic}. 主题 ${topic}`, styleId: "Heading2" },
        {
          index: heading + 1,
          text: `主题 ${topic} 的设计结论、机制、异常处理与源码依据说明。另含输入输出、分支条件、状态数据变化、实现约束与调试方法。`,
        },
      )
    }
    const complete = await Readiness.document(root, "artifact", {
      outline,
      paragraphs,
      images: views.map((view) => ({ visibleId: `target/${view}` })),
      paragraphsTruncated: false,
      tablesTruncated: false,
      truncated: false,
    })
    expect(complete.issues).toEqual([])
    const shallow = await Readiness.document(root, "artifact", {
      outline: [{ level: 1, title: "目标模块实现细节", paragraphIndex: 1 }],
      paragraphs: [{ index: 1, text: "目标模块实现细节", styleId: "Heading1" }],
      images: [],
      paragraphsTruncated: false,
      tablesTruncated: false,
      truncated: false,
    })
    expect(shallow.issues).toContain(
      "Word requires one Heading 1 design section containing the exact DesignUnit name Target; found 0",
    )
    expect(shallow.issues).toContain("Word has 0 images but the source-backed matrix requires at least 4")

    const source = path.join(root, "artifact/04-diagrams/target-code-flow.mmd")
    await fs.appendFile(source, "  B --> C\n")
    const stale = await Readiness.figures(root, "artifact")
    expect(stale.issues).toContain(
      "target:code-flow rendered result is stale relative to its Mermaid source or semantic claim",
    )
    await fs.writeFile(source, `flowchart TD\n  A["A"] --> B["B"]\n`)

    await fs.rm(path.join(root, "artifact/04-diagrams/target-code-flow.png"))
    const missing = await Readiness.figures(root, "artifact")
    expect(missing.issues).toContain("target:code-flow has a missing or invalid PNG")
    expect(missing.progress).toMatchObject({
      completedSlotCount: 3,
      missingSlotCount: 1,
      remainingDesignUnitIds: ["target"],
      nextMissingSlots: ["target:code-flow"],
      wordAllowed: false,
    })
  })

  test("discovers persisted batch results regardless of the model-chosen JSON filename", async () => {
    const root = await setup()
    await file(root, "artifact/05-enhanced-detail-design/units/target.md", unit())
    await Promise.all(
      ["resume-state.md", "review-notes.md", "continue-prompt.md"].map((name) =>
        file(root, `artifact/${name}`, checkpoint()),
      ),
    )
    const items = []
    for (const view of ["architecture", "business-flow", "code-flow", "data-lifecycle"]) {
      items.push(await figure(root, `target-${view}`, view))
    }
    await file(root, "artifact/04-diagrams/batch-result-v17-minimal.json", JSON.stringify({ complete: true, items }))

    const ready = await Readiness.figures(root, "artifact")
    expect(ready.issues).toEqual([])
    expect(ready.progress).toMatchObject({
      completedSlotCount: 4,
      missingSlotCount: 0,
      wordAllowed: true,
    })
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

  test("rejects a flow census that omits a confirmed DesignUnit owner", async () => {
    const root = await setup()
    const censusPath = path.join(root, "artifact/02-source-evidence/design-unit-census.json")
    const census = JSON.parse(await fs.readFile(censusPath, "utf8"))
    census.designUnits.push({ id: "child", name: "Child", kind: "confirmed-submodule", parentId: "target" })
    census.implementationUnits.push({
      path: "src/child.c",
      disposition: "confirmed-submodule",
      designUnitId: "child",
    })
    await fs.writeFile(censusPath, JSON.stringify(census))
    await file(root, "artifact/05-enhanced-detail-design/units/target.md", unit())
    await file(root, "artifact/05-enhanced-detail-design/units/child.md", unit("child"))

    const ready = await Readiness.prose(root, "artifact")
    expect(ready.issues).toContain("business-flow family census requires at least 2 covered rows; found 1")
    expect(ready.issues).toContain("business-flow family census has no covered local flow owned by DesignUnit child")
  })

  test("rejects malformed rows and empty semantic closure fields", async () => {
    const root = await setup()
    await file(root, "artifact/05-enhanced-detail-design/units/target.md", unit())
    const target = path.join(root, "artifact/03-control-flow-evidence/14-business-flow-family-census.csv")
    const text = await fs.readFile(target, "utf8")
    await fs.writeFile(target, text.replace("TERM-1", ""))

    const ready = await Readiness.prose(root, "artifact")
    expect(ready.issues).toContain("business-flow family census row 2 has an empty terminal_step_ids")
  })

  test("rejects placeholder essentials and an owner absent from participants", async () => {
    const root = await setup()
    await file(root, "artifact/05-enhanced-detail-design/units/target.md", unit())
    const target = path.join(root, "artifact/03-control-flow-evidence/14-business-flow-family-census.csv")
    const text = await fs.readFile(target, "utf8")
    await fs.writeFile(
      target,
      text.replace("TRIGGER-1", "N/A").replace(",target,N/A,N/A,N/A,N/A,TERM-1", ",peer,N/A,N/A,N/A,N/A,TERM-1"),
    )

    const ready = await Readiness.prose(root, "artifact")
    expect(ready.issues).toContain("business-flow family census row 2 must provide concrete entry_trigger")
    expect(ready.issues).toContain(
      "business-flow family census row 2 participating_units must include owning DesignUnit target",
    )
  })

  test("accepts readable focused replacements only after their split parent is resolved", async () => {
    const root = await setup()
    await file(root, "artifact/05-enhanced-detail-design/units/target.md", unit())
    await Promise.all(
      ["resume-state.md", "review-notes.md", "continue-prompt.md"].map((name) =>
        file(root, `artifact/${name}`, checkpoint()),
      ),
    )
    const items = []
    for (const view of ["architecture", "business-flow", "data-lifecycle"]) {
      const id = `target-${view}`
      items.push(await figure(root, id, view))
    }
    await file(
      root,
      "artifact/04-diagrams/target-code-flow.claims.json",
      JSON.stringify({
        version: 1,
        diagramId: "target-code-flow",
        diagramType: "code-flow",
        designUnitId: "target",
      }),
    )
    const children = await Promise.all(
      ["target-code-flow-FOCUS-a", "target-code-flow-FOCUS-b"].map((id) =>
        figure(root, id, "code-flow", { splitFromDiagramId: "target-code-flow" }),
      ),
    )
    await file(
      root,
      "artifact/04-diagrams/initial.results.json",
      JSON.stringify({
        generatedAt: 1,
        complete: false,
        pendingSplitDiagramIds: ["target-code-flow"],
        pendingSplitDetails: [
          {
            diagramId: "target-code-flow",
            missingNodes: [{ id: "A" }, { id: "B" }],
            missingEdges: [{ from: "A", to: "B", relation: "dependency" }],
          },
        ],
        items: [
          ...items,
          {
            diagramId: "target-code-flow",
            rendered: true,
            semanticStatus: "valid",
            wordFitStatus: "split-required",
            documentReady: false,
          },
        ],
      }),
    )
    const repair = {
      generatedAt: 2,
      complete: true,
      resolvedSplitDiagramIds: ["target-code-flow"],
      pendingSplitDiagramIds: [],
      items: children,
    }
    await file(root, "artifact/04-diagrams/repair.results.json", JSON.stringify(repair))

    const ready = await Readiness.figures(root, "artifact")
    expect(ready.issues).toEqual([])

    await file(
      root,
      "artifact/04-diagrams/later.results.json",
      JSON.stringify({
        generatedAt: 3,
        complete: false,
        resolvedSplitDiagramIds: [],
        pendingSplitDiagramIds: ["target-code-flow"],
        items: [],
      }),
    )
    const pending = await Readiness.figures(root, "artifact")
    expect(pending.issues).toContain(
      "split-required Diagram ID target-code-flow has no resolved readable replacement set",
    )
  })

  test("does not forget an unresolved split after a later process-local empty result", async () => {
    const root = await setup()
    await file(root, "artifact/05-enhanced-detail-design/units/target.md", unit())
    await Promise.all(
      ["resume-state.md", "review-notes.md", "continue-prompt.md"].map((name) =>
        file(root, `artifact/${name}`, checkpoint()),
      ),
    )
    await file(
      root,
      "artifact/04-diagrams/target-code-flow.claims.json",
      JSON.stringify({
        version: 1,
        diagramId: "target-code-flow",
        diagramType: "code-flow",
        designUnitId: "target",
      }),
    )
    await file(
      root,
      "artifact/04-diagrams/initial.results.json",
      JSON.stringify({
        generatedAt: 1,
        complete: false,
        pendingSplitDiagramIds: ["target-code-flow"],
        pendingSplitDetails: [
          {
            diagramId: "target-code-flow",
            missingNodes: [{ id: "A" }, { id: "B" }],
            missingEdges: [{ from: "A", to: "B", relation: "dependency" }],
          },
        ],
        items: [
          {
            diagramId: "target-code-flow",
            rendered: true,
            semanticStatus: "valid",
            wordFitStatus: "split-required",
            documentReady: false,
          },
        ],
      }),
    )
    await file(
      root,
      "artifact/04-diagrams/restarted.results.json",
      JSON.stringify({
        generatedAt: 2,
        complete: true,
        pendingSplitDiagramIds: [],
        resolvedSplitDiagramIds: [],
        items: [],
      }),
    )

    const ready = await Readiness.figures(root, "artifact")
    expect(ready.issues).toContain(
      "split-required Diagram ID target-code-flow has no resolved readable replacement set",
    )
    expect(ready.pendingSplits).toEqual([
      {
        diagramId: "target-code-flow",
        missingNodes: [{ id: "A" }, { id: "B" }],
        missingEdges: [{ from: "A", to: "B", relation: "dependency" }],
      },
    ])
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
  await file(
    root,
    "artifact/03-control-flow-evidence/14-business-flow-family-census.csv",
    [
      "flow_family_id,owning_design_unit,entry_trigger,input_business_object,entry_step_ids,participating_units,decision_edge_ids,async_handoff_edge_ids,wait_retry_timeout_cancel_edge_ids,failure_recovery_cleanup_edge_ids,terminal_step_ids,state_data_resource_effects,evidence_ids,diagram_ids,status",
      "FLOW-1,target,TRIGGER-1,OBJECT-1,STEP-1,target,N/A,N/A,N/A,N/A,TERM-1,EFFECT-1,SRC-1,target-business-flow,covered",
    ].join("\n"),
  )
  return root
}

function unit(name = "target") {
  return [
    `### ${name}`,
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

function checkpoint() {
  return [
    "SBDD_RULESET_REVISION=2026-07-source-semantic-v122",
    "flowCensusStatus: PASS",
    "flowCensusParseStatus: PASS",
    "missingTopicCount: 0",
  ].join("\n")
}

async function figure(root: string, id: string, view: string, extra: { splitFromDiagramId?: string } = {}) {
  const source = `flowchart TD\n  A["A"] --> B["B"]\n`
  const claim = JSON.stringify({
    version: 1,
    diagramId: id,
    diagramType: view,
    designUnitId: "target",
    ...extra,
  })
  const sourcePath = `artifact/04-diagrams/${id}.mmd`
  await file(root, sourcePath, source)
  await file(root, `artifact/04-diagrams/${id}.claims.json`, claim)
  await file(root, `artifact/04-diagrams/${id}.png`, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  return {
    diagramId: id,
    rendered: true,
    semanticStatus: "valid",
    sourcePath,
    sourceHash: createHash("sha256").update(source).digest("hex"),
    semanticEvidenceHash: createHash("sha256").update(claim).digest("hex"),
    pngPath: `artifact/04-diagrams/${id}.png`,
    wordFitStatus: "readable",
    documentReady: true,
  }
}

async function file(root: string, name: string, data: string | Buffer) {
  const target = path.join(root, name)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, data)
}
