import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import * as Guard from "@/kilocode/skill/workflow-guard"
import { KiloSessionPrompt } from "@/kilocode/session/prompt"
import { SessionID } from "@/session/schema"

const user = (id: string, text: string) => ({
  info: { id, role: "user" },
  parts: [{ type: "text", text }],
})

const declared = (id: string, root: string) => ({
  info: { id, role: "assistant" },
  parts: [
    {
      type: "tool",
      tool: "declare_artifact",
      state: { status: "completed", metadata: { artifactDir: root } },
    },
  ],
})

const controlled = (id: string, root: string, jobId: string) => ({
  info: { id, role: "assistant" },
  parts: [
    {
      type: "tool",
      tool: "source_backed_design_job",
      state: { status: "completed", metadata: { artifactDir: root, jobId, failed: false } },
    },
  ],
})

const loaded = (id: string) => ({
  info: { id, role: "assistant" },
  parts: [
    {
      type: "tool",
      tool: "skill",
      state: {
        status: "completed",
        input: { name: "source-backed-detail-design" },
        metadata: { name: "source-backed-detail-design" },
      },
    },
  ],
})

const compacted = (id: string) => ({
  info: { id, role: "user" },
  parts: [{ type: "compaction", auto: true }],
})

describe("source-backed workflow guard", () => {
  afterEach(() => Guard.reset())

  test("blocks shell only in the loaded skill turn and uninterrupted continuation turns", () => {
    const first = [user("u1", "生成完整详细设计")]
    Guard.activate("s1", "source-backed-detail-design", first)
    expect(Guard.shell("s1", first)).toBe(true)
    expect(Guard.mutation("s1", first, "/workspace", "/workspace/.kilo/artifacts/manual/file.md")).toContain(
      "declare_artifact",
    )
    Guard.declare("s1", first, ".kilo/artifacts/task-1")
    expect(Guard.mutation("s1", first, "/workspace", "/workspace/.kilo/artifacts/task-1/file.md")).toBeUndefined()
    expect(Guard.mutation("s1", first, "/workspace", "/workspace/.kilo/artifacts/other/file.md")).toContain(
      ".kilo/artifacts/task-1",
    )

    const continued = [...first, user("u2", "继续"), user("u3", "continue")]
    expect(Guard.shell("s1", continued)).toBe(true)
    expect(Guard.mutation("s1", continued, "/workspace", "/workspace/.kilo/artifacts/task-1/next.md")).toBeUndefined()
  })

  test("does not affect another skill, another session, or a later ordinary QA turn", () => {
    const first = [user("u1", "生成完整详细设计")]
    Guard.activate("s1", "another-skill", first)
    expect(Guard.shell("s1", first)).toBe(false)
    expect(Guard.mutation("s1", first, "/workspace", "/workspace/source.c")).toBeUndefined()

    Guard.activate("s1", "source-backed-detail-design", first)
    expect(Guard.shell("s2", first)).toBe(false)
    const ordinary = [...first, user("u2", "解释这个函数")]
    expect(Guard.shell("s1", ordinary)).toBe(false)
    expect(Guard.mutation("s1", ordinary, "/workspace", "/workspace/source.c")).toBeUndefined()
    expect(Guard.shell("s1", [...ordinary, user("u3", "继续")])).toBe(false)
  })

  test("only raises the agent step limit for an exactly active source-backed workflow", () => {
    const session = SessionID.make("ses_source_backed_steps")
    const first = [user("u1", "生成完整详细设计")]
    expect(KiloSessionPrompt.sourceBackedStepLimit(session, first as never, 4)).toBe(4)
    expect(KiloSessionPrompt.sourceBackedStepLimit(session, first as never)).toBe(Infinity)

    Guard.activate(session, "source-backed-detail-design", first)
    expect(KiloSessionPrompt.sourceBackedStepLimit(session, first as never, 4)).toBe(32)
    expect(KiloSessionPrompt.sourceBackedStepLimit(session, first as never, 48)).toBe(48)

    const ordinary = [...first, user("u2", "解释这个函数")]
    expect(KiloSessionPrompt.sourceBackedStepLimit(session, ordinary as never, 4)).toBe(4)
  })

  test("recovers the loaded workflow and declared root without another skill call after a process restart", () => {
    const first = [user("u1", "生成完整详细设计")]
    Guard.activate("s1", "source-backed-detail-design", first)
    Guard.declare("s1", first, ".kilo/artifacts/task-1")
    Guard.reset()

    const continued = [...first, loaded("a1"), declared("a2", ".kilo/artifacts/task-1"), user("u2", "继续")]
    expect(Guard.shell("s1", continued)).toBe(true)
    expect(Guard.mutation("s1", continued, "/workspace", "/workspace/.kilo/artifacts/task-1/next.md")).toBeUndefined()
    expect(Guard.mutation("s1", continued, "/workspace", "/workspace/.kilo/artifacts/task-2/next.md")).toContain(
      ".kilo/artifacts/task-1",
    )
  })

  test("进程重启后从控制器输出恢复任务绑定，不扫描 artifact", () => {
    const history = [
      user("u1", "生成完整详细设计"),
      loaded("a1"),
      controlled("a2", ".chipmate-v2/artifacts/job-1", "job-1"),
      user("u2", "继续"),
    ]
    Guard.reset()
    Guard.sync("s1", history)
    expect(Guard.sourceBacked("s1", history)).toBe(true)
    expect(Guard.root("s1", history)).toBe(".chipmate-v2/artifacts/job-1")
    expect(Guard.job("s1", history)).toBe("job-1")
  })

  test("显式 Skill 命令写入的 revision 标记可在新 CLI 进程中恢复同会话任务", () => {
    const history = [
      user("u1", "SBDD_JOB_REVISION=2026-08-chunked-v1\n生成完整详细设计"),
      controlled("a1", ".chipmate-v2/artifacts/job-1", "job-1"),
      user("u2", "继续"),
    ]
    Guard.reset()
    Guard.sync("s1", history)
    expect(Guard.sourceBacked("s1", history)).toBe(true)
    expect(Guard.root("s1", history)).toBe(".chipmate-v2/artifacts/job-1")
    expect(Guard.job("s1", history)).toBe("job-1")
  })

  test("keeps the restored root when a compacted tool window retains only the continuation user", () => {
    const history = [
      user("u1", "生成完整详细设计"),
      loaded("a1"),
      declared("a2", ".kilo/artifacts/task-1"),
      user("u2", "继续"),
    ]
    Guard.activate("s1", "source-backed-detail-design", history)
    const compacted = [user("u2", "继续")]
    expect(Guard.shell("s1", compacted)).toBe(true)
    expect(Guard.mutation("s1", compacted, "/workspace", "/workspace/.kilo/artifacts/task-1/next.md")).toBeUndefined()
    expect(Guard.mutation("s1", compacted, "/workspace", "/workspace/.kilo/artifacts/task-2/next.md")).toContain(
      ".kilo/artifacts/task-1",
    )
    expect(Guard.artifact("s1", compacted, "/workspace", "/workspace/.kilo/artifacts/task-1/review.md")).toBeUndefined()
    expect(Guard.artifact("s1", compacted, "/workspace", "/workspace/src/module.c")).toBeUndefined()
    expect(Guard.artifact("s1", compacted, "/workspace", "/workspace/.kilo/artifacts/task-2/review.md")).toContain(
      ".kilo/artifacts/task-1",
    )
  })

  test("synchronizes a continuation from full history before compacted tool messages are used", () => {
    const history = [
      user("u1", "生成完整详细设计"),
      loaded("a1"),
      declared("a2", ".kilo/artifacts/task-1"),
      user("u2", "继续"),
    ]
    Guard.sync("s1", history)
    const compacted = [user("u2", "继续")]
    expect(Guard.shell("s1", compacted)).toBe(true)
    expect(Guard.mutation("s1", compacted, "/workspace", "/workspace/.kilo/artifacts/task-1/next.md")).toBeUndefined()
  })

  test("ignores automatic compaction user records when synchronizing and evaluating an active continuation", () => {
    const first = user("u1", "生成完整详细设计")
    const history = [
      first,
      loaded("a1"),
      declared("a2", ".kilo/artifacts/task-1"),
      user("u2", "继续"),
      compacted("c1"),
      user("u3", "继续"),
    ]
    Guard.sync("s1", history)
    expect(Guard.sourceBacked("s1", [user("u3", "继续"), compacted("c2")])).toBe(true)
    expect(Guard.root("s1", [user("u3", "继续"), compacted("c2")])).toBe(".kilo/artifacts/task-1")
    expect(
      Guard.mutation(
        "s1",
        [user("u3", "继续"), compacted("c2")],
        "/workspace",
        "/workspace/.kilo/artifacts/task-2/file.md",
      ),
    ).toContain(".kilo/artifacts/task-1")
  })

  test("keeps the synchronized workflow when compacted tool context retains only stale non-continuation history", () => {
    const first = user("u1", "生成完整详细设计")
    const history = [
      first,
      loaded("a1"),
      declared("a2", ".kilo/artifacts/task-1"),
      user("u2", "继续"),
      user("u3", "继续"),
    ]
    Guard.sync("s1", history)
    expect(Guard.sourceBacked("s1", [first])).toBe(true)
    expect(Guard.root("s1", [first])).toBe(".kilo/artifacts/task-1")
    expect(Guard.shell("s1", [first])).toBe(true)
  })

  test("does not synchronize after an intervening ordinary user turn", () => {
    const history = [
      user("u1", "生成完整详细设计"),
      loaded("a1"),
      declared("a2", ".kilo/artifacts/task-1"),
      user("u2", "解释另一个函数"),
      user("u3", "继续"),
    ]
    Guard.sync("s1", history)
    expect(Guard.shell("s1", [user("u3", "继续")])).toBe(false)
  })

  test("does not recover from a continuation word without prior source-backed skill evidence", () => {
    const messages = [user("u1", "普通问题"), declared("a1", ".kilo/artifacts/task-1"), user("u2", "继续")]
    expect(Guard.shell("s1", messages)).toBe(false)
    expect(Guard.mutation("s1", messages, "/workspace", "/workspace/source.c")).toBeUndefined()
  })

  test("delegates controller-owned diagram files to the job validator instead of the legacy stage gate", async () => {
    const messages = [user("u1", "生成完整详细设计")]
    Guard.activate("s1", "source-backed-detail-design", messages)
    Guard.bind("s1", messages, { root: ".chipmate-v2/artifacts/job-1", jobId: "job-1" })
    expect(
      await Guard.stage(
        "s1",
        messages,
        "/workspace",
        "/workspace/.chipmate-v2/artifacts/job-1/04-diagrams/specs/unit-architecture.json",
      ),
    ).toBeUndefined()
  })

  test("blocks diagram authoring until all separate prose topics are ready", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "sbdd-stage-"))
    const root = path.join(workspace, ".kilo/artifacts/task-1")
    await fs.mkdir(path.join(root, "02-source-evidence"), { recursive: true })
    await fs.writeFile(
      path.join(root, "02-source-evidence/design-unit-census.json"),
      JSON.stringify({
        version: 1,
        targetDesignUnitId: "target",
        designUnits: [{ id: "target", name: "Target", kind: "target" }],
      }),
    )
    const first = [user("u1", "生成完整详细设计")]
    Guard.activate("s1", "source-backed-detail-design", first)
    Guard.declare("s1", first, ".kilo/artifacts/task-1")
    const blocked = await Guard.stage("s1", first, workspace, path.join(root, "04-diagrams/target-architecture.mmd"))
    expect(blocked).toContain("initial source-backed turn")
    const checkpoint = await Guard.checkpoint(
      "s1",
      first,
      workspace,
      path.join(root, "resume-state.md"),
      "phase: prose_complete\nmissingTopicCount: 0",
    )
    expect(checkpoint).toContain("claims prose readiness")

    const history = [...first, loaded("a1"), declared("a2", ".kilo/artifacts/task-1"), user("u2", "继续")]
    Guard.sync("s1", history)
    const incomplete = await Guard.stage(
      "s1",
      [user("u2", "继续")],
      workspace,
      path.join(root, "04-diagrams/target-architecture.mmd"),
    )
    expect(incomplete).toContain("fourteen separate prose topics")
    expect(await Guard.stage("s1", first, workspace, path.join(root, "resume-state.md"))).toBeUndefined()
    await fs.rm(workspace, { recursive: true, force: true })
  })

  test("requires an owner-complete flow census and all durable checkpoints before diagrams", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "sbdd-stage-ready-"))
    const root = path.join(workspace, ".kilo/artifacts/task-1")
    await fs.mkdir(path.join(root, "02-source-evidence"), { recursive: true })
    await fs.mkdir(path.join(root, "03-control-flow-evidence"), { recursive: true })
    await fs.mkdir(path.join(root, "05-enhanced-detail-design/units"), { recursive: true })
    await fs.writeFile(
      path.join(root, "02-source-evidence/design-unit-census.json"),
      JSON.stringify({
        version: 1,
        targetDesignUnitId: "target",
        targetSourceRoot: "src",
        designUnits: [
          { id: "target", name: "Target", kind: "target" },
          { id: "child", name: "Child", kind: "confirmed-submodule", parentId: "target" },
        ],
        implementationUnits: [
          { path: "src/target.c", disposition: "target", designUnitId: "target" },
          { path: "src/child.c", disposition: "confirmed-submodule", designUnitId: "child" },
        ],
      }),
    )
    await Promise.all(
      ["target", "child"].map((name) =>
        fs.writeFile(path.join(root, `05-enhanced-detail-design/units/${name}.md`), prose(name)),
      ),
    )
    const header =
      "flow_family_id,owning_design_unit,entry_trigger,input_business_object,entry_step_ids,participating_units,decision_edge_ids,async_handoff_edge_ids,wait_retry_timeout_cancel_edge_ids,failure_recovery_cleanup_edge_ids,terminal_step_ids,state_data_resource_effects,evidence_ids,diagram_ids,status"
    await fs.writeFile(
      path.join(root, "03-control-flow-evidence/14-business-flow-family-census.csv"),
      [header, "FLOW-1,target,TRIGGER-1,OBJECT-1,STEP-1,target,N/A,N/A,N/A,N/A,TERM-1,EFFECT-1,SRC-1,,covered"].join(
        "\n",
      ),
    )

    const first = [user("u1", "生成完整详细设计")]
    Guard.activate("s1", "source-backed-detail-design", first)
    Guard.declare("s1", first, ".kilo/artifacts/task-1")
    const history = [...first, loaded("a1"), declared("a2", ".kilo/artifacts/task-1"), user("u2", "继续")]
    Guard.sync("s1", history)
    const target = path.join(root, "04-diagrams/target-architecture.mmd")
    const missing = await Guard.stage("s1", [user("u2", "继续")], workspace, target)
    expect(missing).toContain("no covered local flow owned by DesignUnit child")
    const rejected = await Guard.checkpoint(
      "s1",
      [user("u2", "继续")],
      workspace,
      path.join(root, "resume-state.md"),
      "flowCensusStatus: PASS",
    )
    expect(rejected).toContain("claims prose readiness")

    await fs.appendFile(
      path.join(root, "03-control-flow-evidence/14-business-flow-family-census.csv"),
      "\nFLOW-2,child,TRIGGER-2,OBJECT-2,STEP-2,child,N/A,N/A,N/A,N/A,TERM-2,EFFECT-2,SRC-2,,covered",
    )
    const durable = await Guard.stage("s1", [user("u2", "继续")], workspace, target)
    expect(durable).toContain("missing required checkpoint file resume-state.md")
    await Promise.all(
      ["resume-state.md", "review-notes.md", "continue-prompt.md"].map((name) =>
        fs.writeFile(path.join(root, name), checkpoint()),
      ),
    )
    expect(await Guard.stage("s1", [user("u2", "继续")], workspace, target)).toBeUndefined()
    await fs.rm(workspace, { recursive: true, force: true })
  })
})

function prose(name: string) {
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
