import { afterEach, describe, expect, test } from "bun:test"
import { mkdir } from "fs/promises"
import { Effect, Layer, Schema } from "effect"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Database } from "@opencode-ai/core/database/database"
import { OpenApi } from "effect/unstable/httpapi"
import { DesignDocPaths } from "../../../src/chipmate/server/httpapi/groups/design-doc"
import { PublicApi } from "../../../src/server/routes/instance/httpapi/public"
import { Server } from "../../../src/server/server"
import { disposeAllInstances, seedProject, TestInstance, tmpdir } from "../../fixture/fixture"
import { testEffectShared } from "../../lib/effect"
import { resetDatabase } from "../../fixture/db"
import { artifact, DesignDocStore } from "../../../src/chipmate/design-doc/store"
import { DesignDocJob as DesignDocJobSchema } from "../../../src/chipmate/design-doc/domain"
import type { DesignDocJob } from "../../../src/chipmate/design-doc/domain"
import { MessageID } from "../../../src/session/schema"
import { discoverDesignDocModule, extractLifecycleEvidence } from "@chipmate/chipmate-indexing/design-doc"
import { buildEvidencePack } from "../../../src/chipmate/design-doc/evidence"
import { Session } from "../../../src/session/session"

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

function request(directory: string, target: string, init?: RequestInit) {
  const headers = new Headers(init?.headers)
  headers.set("x-chipmate-directory", directory)
  return Server.Default().app.request(target, {
    ...init,
    headers,
  })
}

describe("DesignDoc HttpApi 合约", () => {
  test("公开 Job 控制路由和进度事件", () => {
    const spec = OpenApi.fromApi(PublicApi)
    const paths = JSON.stringify(spec.paths)
    for (const value of Object.values(DesignDocPaths)) {
      expect(paths).toContain(value.replace(/:([A-Za-z0-9_]+)/g, "{$1}"))
    }
    expect(JSON.stringify(spec)).toContain("design_doc.job.updated")
  })

  test("对证据不足的模块持久化 blocked，而不是启动模型或静默成功", async () => {
    await using workspace = await tmpdir()
    await Bun.write(
      `${workspace.path}/state.ts`,
      `export type State = "idle" | "done"\nexport const state: State = "idle"\n`,
    )
    const created = await request(workspace.path, DesignDocPaths.create, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetPath: ".",
        model: { providerID: "test", modelID: "never-called" },
      }),
    })
    expect(created.status).toBe(202)
    const job = await decodeJob(created)
    expect(job.config.retryPolicy.timeoutMs).toBe(300_000)

    const terminal = await waitForJob(workspace.path, job.id)
    expect(terminal.status).toBe("blocked")
    expect(terminal.lastError?.code).toBe("INSUFFICIENT_EVIDENCE")
    expect(terminal.workItems[0]?.attempts).toHaveLength(0)
    expect(terminal.artifacts.some((item) => item.kind === "evidence-pack")).toBe(true)
  })

  test("创建 structure Job 时使用独立证据类型并在无依赖时确定性阻塞", async () => {
    await using workspace = await tmpdir()
    await Bun.write(`${workspace.path}/one.ts`, "export const one = 1\n")
    await Bun.write(`${workspace.path}/two.ts`, "export const two = 2\n")
    const created = await request(workspace.path, DesignDocPaths.create, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetPath: ".",
        artifactType: "structure",
        model: { providerID: "test", modelID: "never-called" },
      }),
    })
    expect(created.status).toBe(202)
    const job = await decodeJob(created)

    expect(job.config.artifactTypes).toEqual(["structure"])
    expect(job.workItems[0]?.artifactType).toBe("structure")
    const terminal = await waitForJob(workspace.path, job.id)
    expect(terminal.status).toBe("blocked")
    expect(terminal.lastError?.code).toBe("INSUFFICIENT_EVIDENCE")
    expect(terminal.workItems[0]?.attempts).toHaveLength(0)
    expect(terminal.workItems[0]?.evidencePackPath).toMatch(/^work-items\/WI-[^/]+\/evidence\.json$/)
  })

  test("创建 code-structure Job 时在没有受支持声明时确定性阻塞", async () => {
    await using workspace = await tmpdir()
    await Bun.write(`${workspace.path}/value.ts`, "export const value = 1\n")
    const created = await request(workspace.path, DesignDocPaths.create, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetPath: ".",
        artifactType: "code-structure",
        model: { providerID: "test", modelID: "never-called" },
      }),
    })
    expect(created.status).toBe(202)
    const job = await decodeJob(created)

    expect(job.config.artifactTypes).toEqual(["code-structure"])
    expect(job.workItems[0]?.artifactType).toBe("code-structure")
    const terminal = await waitForJob(workspace.path, job.id)
    expect(terminal.status).toBe("blocked")
    expect(terminal.lastError?.code).toBe("INSUFFICIENT_EVIDENCE")
    expect(terminal.workItems[0]?.attempts).toHaveLength(0)
    expect(terminal.workItems[0]?.evidencePackPath).toMatch(/^work-items\/WI-[^/]+\/evidence\.json$/)
  })

  test("持久化模型回退策略并允许显式单项升级模型重试", async () => {
    await using workspace = await tmpdir()
    await Bun.write(`${workspace.path}/value.ts`, "export const value = 1\n")
    const created = await request(workspace.path, DesignDocPaths.create, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetPath: ".",
        artifactType: "code-structure",
        model: { providerID: "deepseek", modelID: "deepseek-v4-flash" },
        modelFallbacks: [
          { fromAttempt: 3, model: { providerID: "deepseek", modelID: "deepseek-v4-flash-strong" } },
        ],
      }),
    })
    const job = await decodeJob(created)
    expect(job.config.modelPolicy.fallbacks[0]?.fromAttempt).toBe(3)
    const terminal = await waitForJob(workspace.path, job.id)

    const retried = await request(
      workspace.path,
      DesignDocPaths.retry.replace(":jobID", job.id).replace(":workItemID", terminal.workItems[0]!.id),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: { providerID: "deepseek", modelID: "deepseek-v4-flash-upgraded" } }),
      },
    )
    expect(retried.status).toBe(202)
    const value = await decodeJob(retried)
    expect(value.workItems[0]?.modelOverride?.modelID).toBe("deepseek-v4-flash-upgraded")
    expect(value.workItems[0]?.retryCursor).toBe(0)
  })

  test("一个产物证据不足不会跳过其他独立 WorkItem", async () => {
    await using workspace = await tmpdir()
    await Bun.write(`${workspace.path}/value.ts`, "export const value = 1\n")
    const created = await request(workspace.path, DesignDocPaths.create, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetPath: ".",
        artifactTypes: ["structure", "code-structure"],
        model: { providerID: "test", modelID: "never-called" },
      }),
    })
    const job = await decodeJob(created)
    const terminal = await waitForJob(workspace.path, job.id)

    expect(terminal.status).toBe("blocked")
    expect(terminal.workItems.map((item) => item.status)).toEqual(["blocked", "blocked"])
    expect(terminal.workItems.every((item) => item.attempts.length === 0)).toBe(true)
    expect(terminal.artifacts.filter((item) => item.kind === "evidence-pack")).toHaveLength(2)
  })

  test("接受有界并发并确保每个 WorkItem 只被调度一次", async () => {
    await using workspace = await tmpdir()
    await Bun.write(`${workspace.path}/value.ts`, "export const value = 1\n")
    const created = await request(workspace.path, DesignDocPaths.create, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetPath: ".",
        artifactTypes: ["structure", "code-structure"],
        concurrency: 2,
        model: { providerID: "test", modelID: "never-called" },
      }),
    })
    expect(created.status).toBe(202)
    const job = await decodeJob(created)
    expect(job.config.concurrency).toBe(2)
    const terminal = await waitForJob(workspace.path, job.id)

    expect(terminal.workItems).toHaveLength(2)
    expect(new Set(terminal.workItems.map((item) => item.id)).size).toBe(2)
    expect(terminal.workItems.every((item) => item.attempts.length === 0)).toBe(true)
    expect(terminal.artifacts.filter((item) => item.kind === "evidence-pack")).toHaveLength(2)
  })

  test("递归调度不为无直属源码的根节点创建重复 WorkItem", async () => {
    await using workspace = await tmpdir()
    await mkdir(`${workspace.path}/child`)
    await Bun.write(`${workspace.path}/child/value.ts`, "export const value = 1\n")
    const created = await request(workspace.path, DesignDocPaths.create, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetPath: ".",
        artifactTypes: ["code-structure"],
        recursive: true,
        model: { providerID: "test", modelID: "never-called" },
      }),
    })
    expect(created.status).toBe(202)
    const job = await decodeJob(created)
    const terminal = await waitForJob(workspace.path, job.id)

    expect(terminal.workItems).toHaveLength(1)
    expect(terminal.workItems[0]?.moduleID).not.toBe("pending")
    expect(terminal.artifacts.filter((item) => item.kind === "evidence-pack")).toHaveLength(1)
  })

  test("重启恢复把遗留 running WorkItem 重新发现并确定性阻塞", async () => {
    await using workspace = await tmpdir()
    await Bun.write(
      `${workspace.path}/state.ts`,
      `export type State = "idle" | "done"\nexport const state: State = "idle"\n`,
    )
    const job = persistedJob(workspace.path, `recover-${Date.now()}`)
    await DesignDocStore.create(job)

    const terminal = await waitForJob(workspace.path, job.id)
    expect(terminal.status).toBe("blocked")
    expect(terminal.lastError?.code).toBe("INSUFFICIENT_EVIDENCE")
    expect(terminal.workItems[0]?.attempts).toHaveLength(0)
  })

  test("暂停会中断活动 Attempt，恢复后使用持久状态重新执行", async () => {
    await using workspace = await tmpdir()
    await Bun.write(
      `${workspace.path}/state.ts`,
      `export type State = "idle" | "done"\nexport const state: State = "idle"\n`,
    )
    const job = persistedJob(workspace.path, `pause-${Date.now()}`, true)
    await DesignDocStore.create(job)

    const pausedResponse = await request(workspace.path, DesignDocPaths.pause.replace(":jobID", job.id), {
      method: "POST",
    })
    expect(pausedResponse.status).toBe(200)
    const paused = await decodeJob(pausedResponse)
    expect(paused.status).toBe("paused")
    expect(paused.workItems[0]?.status).toBe("retryable")
    expect(paused.workItems[0]?.attempts[0]?.status).toBe("interrupted")

    const resumedResponse = await request(workspace.path, DesignDocPaths.resume.replace(":jobID", job.id), {
      method: "POST",
    })
    expect(resumedResponse.status).toBe(202)
    const terminal = await waitForJob(workspace.path, job.id)
    expect(terminal.status).toBe("blocked")
    expect(terminal.workItems[0]?.attempts[0]?.status).toBe("interrupted")
  })

  test("读取旧 completed Job 时清除晚到失败留下的终态错误", async () => {
    await using workspace = await tmpdir()
    const job = persistedJob(workspace.path, `completed-${Date.now()}`)
    const stale = {
      severity: "error" as const,
      code: "MODEL_RESPONSE_ERROR",
      message: "晚到的中断回调",
      evidenceIDs: [],
      sourcePaths: [],
      retryable: false,
    }
    job.status = "completed"
    job.lastError = stale
    job.workItems[0]!.status = "passed"
    job.workItems[0]!.failure = stale
    job.progress = { total: 1, pending: 0, running: 0, passed: 1, failed: 0, blocked: 0, cancelled: 0 }
    await DesignDocStore.create(job)

    const response = await request(workspace.path, DesignDocPaths.get.replace(":jobID", job.id))
    const normalized = await decodeJob(response)

    expect(response.status).toBe(200)
    expect(normalized.status).toBe("completed")
    expect(normalized.lastError).toBeUndefined()
    expect(normalized.workItems[0]?.failure).toBeUndefined()
  })
})

const shared = testEffectShared(Layer.mergeAll(Session.defaultLayer, Database.defaultLayer))

shared.instance("重启后从真实 Session 消息恢复 structured 候选并直接重新校验", () =>
  Effect.gen(function* () {
    yield* seedProject
    const { directory } = yield* TestInstance
    yield* Effect.promise(() =>
      Bun.write(
        `${directory}/state.ts`,
        `export type State = "idle" | "running"
let state: State = "idle"
export function run() {
  if (state === "idle") state = "running"
}
`,
      ),
    )

    const sessions = yield* Session.Service
    const session = yield* sessions.create({ title: "DesignDoc recovery fixture" })
    const now = Date.now()
    yield* sessions.updateMessage({
      id: MessageID.ascending(),
      sessionID: session.id,
      role: "assistant",
      mode: "design-doc-worker",
      agent: "design-doc-worker",
      path: { cwd: directory, root: directory },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: "never-called",
      providerID: "test",
      parentID: MessageID.ascending(),
      time: { created: now, completed: now },
      finish: "end_turn",
      structured: { invalid: true },
    } as unknown as SessionV1.Assistant)

    const sessionMessages = yield* Effect.promise(async () => request(directory, `/session/${session.id}/message`))
    expect(sessionMessages.status).toBe(200)
    expect(JSON.stringify(yield* Effect.promise(() => sessionMessages.json()))).toContain(
      '"structured":{"invalid":true}',
    )

    const module = yield* Effect.promise(() => discoverDesignDocModule({ workspace: directory, targetPath: "." }))
    const extraction = yield* Effect.promise(() => extractLifecycleEvidence(module))
    const job = persistedJob(directory, `structured-${Date.now()}`, true)
    job.config.retryPolicy.maxAttempts = 1
    job.workItems[0]!.attempts[0]!.sessionID = session.id
    yield* Effect.promise(() => DesignDocStore.create(job))
    const pack = buildEvidencePack({
      extraction,
      workItemID: job.workItems[0]!.id,
      ...job.config.evidenceBudget,
    })
    const metadata = yield* Effect.promise(() =>
      DesignDocStore.writeJSON(directory, job.id, `work-items/${job.workItems[0]!.id}/evidence.json`, pack),
    )
    yield* Effect.promise(() =>
      DesignDocStore.update(directory, job.id, 0, (current) => {
        current.workItems[0]!.evidencePackPath = metadata.path
        current.artifacts.push(
          artifact({
            ...metadata,
            id: `ART-${current.workItems[0]!.id}-EVIDENCE`,
            workItemID: current.workItems[0]!.id,
            kind: "evidence-pack",
            status: "candidate",
          }),
        )
        return current
      }),
    )

    const terminal = yield* Effect.promise(() => waitForJob(directory, job.id))
    const item = terminal.workItems[0]!
    expect(terminal.status).toBe("blocked")
    expect(item.attempts).toHaveLength(1)
    expect(item.attempts[0]?.status).toBe("completed")
    expect(item.candidateArtifactPath).toMatch(/candidate\.json$/)
    expect(item.validationReportPath).toMatch(/validation\.json$/)
    expect(item.failure?.code).toBe("SCHEMA_INVALID")
  }),
)

async function waitForJob(directory: string, jobID: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await request(directory, DesignDocPaths.get.replace(":jobID", jobID))
    const job = await decodeJob(response)
    if (["blocked", "failed", "completed", "cancelled"].includes(job.status)) return job
    await Bun.sleep(20)
  }
  throw new Error("等待 DesignDoc Job 终态超时")
}

async function decodeJob(response: Response) {
  return Schema.decodeUnknownPromise(DesignDocJobSchema)(await response.json())
}

function persistedJob(workspace: string, id: string, withAttempt = false): DesignDocJob {
  const now = Date.now()
  return {
    schemaVersion: 1,
    id,
    revision: 0,
    status: "running",
    workspace,
    config: {
      targetPath: ".",
      artifactTypes: ["lifecycle"],
      languages: ["typescript", "tsx"],
      concurrency: 1,
      recursive: false,
      evidenceBudget: { maxItems: 64, maxPromptBytes: 49_152, maxSnippetCharacters: 800 },
      retryPolicy: { maxAttempts: 3, timeoutMs: 120_000, backoffMs: [0, 500, 1_000], retryableCodes: [] },
      modelPolicy: {
        primary: { providerID: "test", modelID: "never-called" },
        fallbacks: [],
        structuredOutput: "tool-json-schema",
      },
      renderer: "mermaid",
    },
    workItems: [
      {
        id: "WI-recovery",
        moduleID: "pending",
        artifactType: "lifecycle",
        status: "running",
        dependencies: [],
        attempts: withAttempt
          ? [
              {
                number: 1,
                kind: "generate",
                sessionID: "ses_interrupted",
                model: { providerID: "test", modelID: "never-called" },
                status: "running",
                startedAt: now,
              },
            ]
          : [],
        artifactIDs: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
    artifacts: [],
    progress: { total: 1, pending: 0, running: 1, passed: 0, failed: 0, blocked: 0, cancelled: 0 },
    createdAt: now,
    updatedAt: now,
  }
}
