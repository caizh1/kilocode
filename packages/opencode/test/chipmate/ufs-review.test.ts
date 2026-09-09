import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import path from "node:path"
import { Permission } from "../../src/permission"
import { UfsReviewAgent } from "../../src/chipmate/ufs-review/agent"
import { lanes } from "../../src/chipmate/ufs-review/pipeline"
import { build, validate, type Draft } from "../../src/chipmate/ufs-review/report"
import { runReviewSession } from "../../src/chipmate/ufs-review/session-runner"
import { prepare, refresh, type Snapshot } from "../../src/chipmate/ufs-review/snapshot"
import type { Finding } from "../../src/chipmate/ufs-review/types"
import { tmpdir } from "../fixture/fixture"
import type { Agent } from "../../src/agent/agent"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect } from "effect"
import { SessionID } from "../../src/session/schema"

const rootAgent: Agent.Info = {
  name: UfsReviewAgent.ROOT,
  mode: "primary",
  native: true,
  options: { id: UfsReviewAgent.ROOT },
  permission: UfsReviewAgent.rules(),
}

describe("UFS Review Agent 隔离", () => {
  test("根 Agent 只开放审核和只读工具", () => {
    expect(Permission.evaluate("ufs_review", "*", rootAgent.permission).action).toBe("allow")
    expect(Permission.evaluate("ufs_review_validation", "*", rootAgent.permission).action).toBe("ask")
    expect(Permission.evaluate("read", "*", rootAgent.permission).action).toBe("allow")
    expect(Permission.evaluate("edit", "*", rootAgent.permission).action).toBe("deny")
    expect(Permission.evaluate("task", "*", rootAgent.permission).action).toBe("deny")
    expect(Permission.evaluate("codebase_analysis", "*", rootAgent.permission).action).toBe("deny")
    expect(Permission.evaluate("semantic_search", "*", rootAgent.permission).action).toBe("deny")
    expect(Permission.evaluate("document_search", "*", rootAgent.permission).action).toBe("deny")
    expect(Permission.evaluate("websearch", "*", rootAgent.permission).action).toBe("deny")
    expect(Permission.evaluate("skill", "*", rootAgent.permission).action).toBe("deny")
  })

  test("只注册 ufs-reviewer，并保留用户已有的 reviewer", () => {
    const custom = { name: "reviewer", mode: "primary", permission: [] } as unknown as Agent.Info
    const normal = Object.fromEntries(
      ["code", "ask", "plan", "ultra"].map((name) => [
        name,
        { name, mode: "primary", prompt: `${name}-prompt`, permission: [], options: {} } as unknown as Agent.Info,
      ]),
    )
    const agents: Record<string, Agent.Info> = { reviewer: custom, ...normal }
    UfsReviewAgent.install(agents)
    expect(agents.reviewer).toBe(custom)
    for (const [name, info] of Object.entries(normal)) expect(agents[name]).toBe(info)
    expect(agents[UfsReviewAgent.ROOT]?.displayName).toBe("Reviewer")
    expect(agents[UfsReviewAgent.ROOT]?.mode).toBe("primary")
    expect(UfsReviewAgent.names()).toEqual(["ufs-reviewer"])
    for (const old of [
      "ufs-review",
      "ufs-review-coordinator",
      "ufs-review-architecture",
      "ufs-review-behavior",
      "ufs-review-reliability",
      "ufs-review-verification",
    ])
      expect(agents[old]).toBeUndefined()
  })
})

describe("Reviewer 私有 Session", () => {
  test("继承模型与推理等级，并以 metadata 和显式只读工具隔离角色", async () => {
    const created: Array<Record<string, unknown>> = []
    const prompted: Array<Record<string, unknown>> = []
    const report = { summary: "完成", findings: [], unverifiedRisks: [], validationCommands: [] }
    const assistant = {
      id: "msg_assistant",
      sessionID: "ses_child",
      role: "assistant",
      parentID: "msg_user",
      time: { created: 1, completed: 2 },
      providerID: "provider",
      modelID: "model",
      mode: UfsReviewAgent.ROOT,
      agent: UfsReviewAgent.ROOT,
      path: { cwd: "/workspace", root: "/workspace" },
      cost: 0,
      tokens: { input: 10, output: 4, reasoning: 2, cache: { read: 3, write: 1 } },
      structured: report,
    } as SessionV1.Assistant
    const sessions = {
      create: (input?: Record<string, unknown>) => {
        created.push(input ?? {})
        return Effect.succeed({ id: SessionID.make("ses_child"), directory: "/workspace" } as never)
      },
      messages: () =>
        Effect.succeed([
          {
            info: assistant,
            parts: [
              {
                type: "tool",
                tool: "read",
                state: { status: "completed", input: { filePath: "/workspace/ufs.c" } },
              },
            ],
          } as unknown as SessionV1.WithParts,
        ]),
    }
    const prompts = {
      cancel: () => Effect.void,
      resolvePromptParts: () => Effect.succeed([]),
      prompt: (input: Record<string, unknown>) => {
        prompted.push(input)
        return Effect.succeed({ info: assistant, parts: [] } as SessionV1.WithParts)
      },
    }
    const result = await Effect.runPromise(
      runReviewSession({
        sessions: sessions as never,
        prompts: prompts as never,
        parentID: SessionID.make("ses_parent"),
        role: "architecture",
        title: "架构审核",
        prompt: "审核冻结范围",
        model: { providerID: "provider", modelID: "model", variant: "high" },
        runID: "run-1",
        attempt: 1,
      }),
    )
    expect(created[0]).toMatchObject({
      agent: "ufs-reviewer",
      model: { providerID: "provider", id: "model", variant: "high" },
      metadata: { ufsReviewRunID: "run-1", ufsReviewRole: "architecture", ufsReviewAttempt: 1 },
    })
    expect(prompted[0]).toMatchObject({
      agent: "ufs-reviewer",
      variant: "high",
      tools: { "*": false, read: true, grep: true, glob: true, list: true, bash: true },
    })
    expect((prompted[0]?.tools as Record<string, boolean>).task).not.toBe(true)
    const rules = (created[0]?.permission ?? []) as Agent.Info["permission"]
    expect(Permission.evaluate("ufs_review", "*", rules).action).toBe("deny")
    expect(Permission.evaluate("task", "*", rules).action).toBe("deny")
    expect(Permission.evaluate("edit", "*", rules).action).toBe("deny")
    expect(Permission.evaluate("StructuredOutput", "*", rules).action).toBe("allow")
    expect(result.report).toEqual(report)
    expect(result.telemetry.filesRead).toEqual(["ufs.c"])
    expect(result.telemetry.usage).toEqual({ input: 10, output: 4, reasoning: 2, cacheRead: 3, cacheWrite: 1 })
  })

  test("协调器没有源码工具", () => {
    expect(UfsReviewAgent.roleTools("coordinator")).toEqual({ "*": false, StructuredOutput: true })
    expect(Permission.evaluate("read", "*", UfsReviewAgent.roleRules("coordinator")).action).toBe("deny")
    expect(Permission.evaluate("StructuredOutput", "*", UfsReviewAgent.roleRules("coordinator")).action).toBe("allow")
  })
})

describe("UFS Review 调度和快照", () => {
  test("按强度和规模选择 2 到 4 路", () => {
    const snapshot = {
      files: [{ path: "src/plain.c" }],
      additions: 10,
      deletions: 2,
    } as Snapshot
    expect(lanes(snapshot, "quick").map((item) => item.id)).toEqual(["architecture", "behavior"])
    expect(lanes(snapshot, "standard").length).toBe(2)
    expect(lanes({ ...snapshot, additions: 120 }, "standard").length).toBe(3)
    expect(lanes({ ...snapshot, files: [{ path: "src/ufs_dma.c" }] } as Snapshot, "standard").length).toBe(4)
    expect(lanes(snapshot, "deep").length).toBe(4)
  })

  test("未提交范围包含 tracked 和 untracked，并能检测源码漂移", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "ufs.c"), "int ufs_init(void) { return 0; }\n")
        await $`git add ufs.c`.cwd(dir).quiet()
        await $`git commit -m init`.cwd(dir).quiet()
      },
    })
    await Bun.write(path.join(tmp.path, "ufs.c"), "int ufs_init(void) { return 1; }\n")
    await Bun.write(path.join(tmp.path, "ufs_queue.c"), "int ufs_queue(void) { return 0; }\n")

    const snapshot = await prepare(tmp.path, { scope: { kind: "uncommitted" }, effort: "standard" })
    expect(snapshot.files.map((file) => file.path)).toEqual(["ufs.c", "ufs_queue.c"])
    expect(snapshot.additions).toBeGreaterThan(0)

    await Bun.write(path.join(tmp.path, "ufs.c"), "int ufs_init(void) { return 2; }\n")
    expect((await refresh(snapshot)).fingerprint).not.toBe(snapshot.fingerprint)
  })

  test("已暂存与 Commit 范围从对应 Git 内容源固定快照", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "ufs.c"), "int version(void) { return 0; }\n")
        await $`git add ufs.c`.cwd(dir).quiet()
        await $`git commit -m base`.cwd(dir).quiet()
      },
    })
    await Bun.write(path.join(tmp.path, "ufs.c"), "int version(void) { return 1; }\n")
    await $`git add ufs.c`.cwd(tmp.path).quiet()
    const staged = await prepare(tmp.path, { scope: { kind: "staged" }, effort: "standard" })

    await Bun.write(path.join(tmp.path, "ufs.c"), "int version(void) { return 2; }\n")
    expect((await refresh(staged)).fingerprint).toBe(staged.fingerprint)

    await $`git commit -m staged`.cwd(tmp.path).quiet()
    const sha = (await $`git rev-parse HEAD`.cwd(tmp.path).text()).trim()
    const committed = await prepare(tmp.path, { scope: { kind: "commit", sha }, effort: "standard" })
    expect(committed.files[0]?.hash).toBe(staged.files[0]?.hash)
  })
})

describe("UFS Review 确定性报告门禁", () => {
  test("无有效 P0/P1 时 PASS，A1 只触发架构门禁", async () => {
    await using tmp = await tmpdir()
    const source = "int ufs_recover(int state) {\n  return state == 1 ? 0 : -1;\n}\n"
    await Bun.write(path.join(tmp.path, "ufs.c"), source)
    const snapshot = await prepare(tmp.path, { scope: { kind: "module", path: "ufs.c" }, effort: "standard" })
    const architecture: Finding = {
      id: "arch-1",
      lane: "architecture",
      severity: "A1",
      locations: [{ path: "ufs.c", line: 1 }],
      trigger: "每次增加恢复状态都必须同时修改同一函数中的策略和硬件返回映射",
      causalChain: "恢复策略与返回映射集中在同一分支，新增状态会同时传播到策略选择和错误翻译，无法独立验证",
      impact: "持续扩展时人工无法隔离审核恢复策略，显著增加错误恢复回归风险",
      evidence: ["int ufs_recover(int state)"],
      counterEvidenceChecked: ["已检查当前文件，没有独立策略表或可替换接口"],
      confidence: "high",
      remediation: "分离恢复策略与硬件返回映射",
      recheck: "分别单测策略和映射接口",
    }
    const checked = await validate(snapshot, {
      summary: "架构问题",
      findings: [architecture],
      unverifiedRisks: [],
      validationCommands: [],
    })
    const report = build({
      runId: "run-1",
      startedAt: 1,
      scope: snapshot.scope,
      scopeLabel: snapshot.scopeLabel,
      effort: "standard",
      snapshot,
      finalFingerprint: snapshot.fingerprint,
      lanes: [],
      validation: [],
      runStatus: "COMPLETE",
      findings: checked.findings,
      unverifiedRisks: checked.unverifiedRisks,
    })
    expect(report.verdict).toBe("PASS")
    expect(report.architectureGate).toBe("NEEDS REWORK")
    expect(report.approvable).toBe(false)
  })

  test("证据摘录不存在的 P1 降级为未验证风险", async () => {
    await using tmp = await tmpdir()
    await Bun.write(path.join(tmp.path, "ufs.c"), "int safe(void) { return 0; }\n")
    const snapshot = await prepare(tmp.path, { scope: { kind: "module", path: "ufs.c" }, effort: "standard" })
    const candidate = {
      id: "p1-1",
      lane: "behavior",
      severity: "P1",
      locations: [{ path: "ufs.c", line: 1 }],
      trigger: "支持范围内执行恢复流程时触发",
      causalChain: "命令完成后错误状态被清除，随后重试复用错误描述符并造成不可恢复的数据损坏",
      impact: "可能造成设备数据完整性破坏",
      evidence: ["这段原文并不存在于源码"],
      counterEvidenceChecked: ["检查过状态 guard，没有保护"],
      confidence: "high",
      remediation: "增加状态保护",
      recheck: "注入错误并重试",
    } as const satisfies Finding
    const draft: Draft = { summary: "候选问题", findings: [candidate], unverifiedRisks: [], validationCommands: [] }
    const checked = await validate(snapshot, draft)
    expect(checked.findings).toEqual([])
    expect(checked.unverifiedRisks[0]).toContain("确定性校验")
  })

  test("P1 证据必须来自问题所定位的同一范围文件", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(path.join(dir, "a.c"), "int safe_a(void) { return 0; }\n")
        await Bun.write(path.join(dir, "b.c"), "int safe_b(void) { return 0; }\n")
        await $`git add a.c b.c`.cwd(dir).quiet()
        await $`git commit -m init`.cwd(dir).quiet()
      },
    })
    await Bun.write(path.join(tmp.path, "a.c"), "int safe_a(void) { return 1; }\n")
    await Bun.write(path.join(tmp.path, "b.c"), "int unsafe_descriptor(void) { return 0; }\n")
    const snapshot = await prepare(tmp.path, { scope: { kind: "uncommitted" }, effort: "standard" })
    const candidate = {
      id: "p1-cross-file",
      lane: "behavior",
      severity: "P1",
      locations: [{ path: "a.c", line: 1 }],
      trigger: "支持范围内完成描述符后进入错误恢复路径",
      causalChain: "描述符完成状态被错误复用，恢复路径继续提交失效地址并导致后续命令访问错误存储位置",
      impact: "造成命令完成状态与实际数据位置不一致",
      evidence: ["int unsafe_descriptor(void)"],
      counterEvidenceChecked: ["已检查恢复 guard 与完成状态，没有覆盖该路径"],
      confidence: "high",
      remediation: "隔离描述符完成和复用状态",
      recheck: "注入完成与恢复竞态",
    } as const satisfies Finding
    const checked = await validate(snapshot, {
      summary: "跨文件错误证据",
      findings: [candidate],
      unverifiedRisks: [],
      validationCommands: [],
    })
    expect(checked.findings).toEqual([])
    expect(checked.unverifiedRisks).toHaveLength(1)
  })
})
