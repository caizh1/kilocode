import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import * as Guard from "@/kilocode/skill/workflow-guard"

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
    const blocked = await Guard.stage(
      "s1",
      first,
      workspace,
      path.join(root, "04-diagrams/target-architecture.mmd"),
    )
    expect(blocked).toContain("initial source-backed turn")
    const checkpoint = await Guard.checkpoint(
      "s1",
      first,
      workspace,
      path.join(root, "resume-state.md"),
      "phase: prose_complete\nmissingTopicCount: 0",
    )
    expect(checkpoint).toContain("claims prose readiness")

    const history = [
      ...first,
      loaded("a1"),
      declared("a2", ".kilo/artifacts/task-1"),
      user("u2", "继续"),
    ]
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
})
