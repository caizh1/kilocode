import { afterEach, describe, expect, test } from "bun:test"
import type * as Tool from "@/tool/tool"
import * as Guard from "@/chipmate/skill/workflow-guard"
import { filter } from "@/chipmate/source-backed-design/visibility"
import { sourceBackedTurnId } from "@/chipmate/tool/source-backed-design-job"

const user = (id: string, text: string) => ({
  info: { id, role: "user" },
  parts: [{ type: "text", text }],
})

const tools = ["read", "write", "task", "render_mermaid_diagram", "create_word_document", "source_backed_design_job"].map(
  (id) => ({ id }) as Tool.Def,
)

describe("source-backed design 工具可见性", () => {
  afterEach(() => Guard.reset())

  test("普通 QA 的工具集合严格移除控制器且不改变其他工具", () => {
    const messages = [user("u1", "解释这个函数")]
    const visible = filter({ tools, sessionID: "ordinary", messages })
    expect(visible).toEqual(tools.slice(0, 5))
    visible.forEach((tool, index) => expect(tool).toBe(tools[index]))
  })

  test("精确加载 Skill 后才暴露控制器，普通问题立即退出", () => {
    const active = [user("u1", "生成完整详细设计")]
    Guard.activate("design", "source-backed-detail-design", active)
    expect(filter({ tools, sessionID: "design", messages: active }).map((tool) => tool.id)).toContain(
      "source_backed_design_job",
    )
    const ordinary = [...active, user("u2", "解释另一个函数")]
    expect(filter({ tools, sessionID: "design", messages: ordinary }).map((tool) => tool.id)).not.toContain(
      "source_backed_design_job",
    )
  })

  test("控制器任务绑定后隐藏其内部负责的 Word 与 Mermaid 组装工具", () => {
    const active = [user("u1", "生成完整详细设计")]
    Guard.activate("design", "source-backed-detail-design", active)
    Guard.bind("design", active, { root: ".chipmate-v2/artifacts/job-1", jobId: "job-1" })
    const visible = filter({ tools, sessionID: "design", messages: active }).map((tool) => tool.id)
    expect(visible).not.toContain("read")
    expect(visible).not.toContain("write")
    expect(visible).toContain("task")
    expect(visible).toContain("source_backed_design_job")
    expect(visible).not.toContain("render_mermaid_diagram")
    expect(visible).not.toContain("create_word_document")
  })

  test("新会话裸继续不可见，显式 Skill 命令可见", () => {
    const continuation = [user("u1", "继续")]
    expect(filter({ tools, sessionID: "bare", messages: continuation }).map((tool) => tool.id)).not.toContain(
      "source_backed_design_job",
    )
    Guard.armCommand("explicit", "source-backed-detail-design", "skill")
    Guard.sync("explicit", continuation)
    expect(filter({ tools, sessionID: "explicit", messages: continuation }).map((tool) => tool.id)).toContain(
      "source_backed_design_job",
    )
    expect(Guard.activation("explicit", continuation)).toBe("skill-command")
  })

  test("同一用户回合的多个工具步骤共享预算键，自动压缩记录不另起回合", () => {
    const messages = [
      { info: { id: "usr_1", role: "user" }, parts: [{ type: "text" }] },
      { info: { id: "asst_1", role: "assistant" }, parts: [{ type: "tool" }] },
      { info: { id: "compact_1", role: "user" }, parts: [{ type: "compaction" }] },
    ]
    expect(sourceBackedTurnId(messages, "asst_fallback")).toBe("usr_1")
    expect(sourceBackedTurnId([], "asst_fallback")).toBe("asst_fallback")
  })
})
