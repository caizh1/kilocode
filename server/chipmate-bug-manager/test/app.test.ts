import assert from "node:assert/strict"
import { after, before, describe, test } from "node:test"
import { build } from "../src/app.js"
import { Store } from "../src/db.js"
import { hashPassword } from "../src/security.js"

const worker = "chipmate-worker-token-for-tests-000000000000"
const store = new Store(":memory:")
store.seedVersion("1.0.10")
const state: {
  app?: Awaited<ReturnType<typeof build>>
  reporter?: { cookie: string; csrf: string }
  maintainer?: { cookie: string; csrf: string }
  admin?: { cookie: string; csrf: string }
} = {}

async function login(username: string, password: string) {
  const response = await state.app!.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username, password },
  })
  assert.equal(response.statusCode, 200)
  const header = response.headers["set-cookie"]
  const cookie = Array.isArray(header) ? header[0] : header
  assert.ok(cookie)
  const body = response.json<{ csrf: string }>()
  return { cookie: cookie.split(";")[0]!, csrf: body.csrf }
}

function headers(session: { cookie: string; csrf: string }) {
  return {
    cookie: session.cookie,
    "x-csrf-token": session.csrf,
  }
}

async function workerStage(run: number, stage: string, result: Record<string, unknown> = {}) {
  const response = await state.app!.inject({
    method: "POST",
    url: `/api/worker/runs/${run}/result`,
    headers: { authorization: `Bearer ${worker}` },
    payload: { owner: "mac-runner", result: { stage, ...result } },
  })
  assert.equal(response.statusCode, 200)
  return response
}

before(async () => {
  store.createUser("reporter", await hashPassword("reporter-password"), "reporter")
  store.createUser("maintainer", await hashPassword("maintainer-password"), "maintainer")
  store.createUser("admin", await hashPassword("administrator-password"), "admin")
  state.app = await build({ store, workerToken: worker, secureCookie: false, logger: false })
  state.reporter = await login("reporter", "reporter-password")
  state.maintainer = await login("maintainer", "maintainer-password")
  state.admin = await login("admin", "administrator-password")
})

after(async () => {
  await state.app?.close()
  store.close()
})

describe("ChipMate Bug 管理接口", () => {
  test("向登录用户明确返回执行器离线状态", async () => {
    const response = await state.app!.inject({
      method: "GET",
      url: "/api/runner/status",
      headers: { cookie: state.reporter!.cookie },
    })
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.json(), {
      online: false,
      mode: null,
      workers: 0,
      queued: 0,
      connectedAt: null,
    })
  })

  test("拒绝没有 CSRF 的写请求", async () => {
    const response = await state.app!.inject({
      method: "POST",
      url: "/api/bugs",
      headers: { cookie: state.reporter!.cookie },
      payload: {},
    })
    assert.equal(response.statusCode, 403)
    assert.equal(response.json<{ error: string }>().error, "CSRF 校验失败")
  })

  test("报告者提交 Bug 后自动排队，但不能手工重启修复", async () => {
    const create = await state.app!.inject({
      method: "POST",
      url: "/api/bugs",
      headers: headers(state.reporter!),
      payload: {
        title: "索引状态不会结束",
        description: "完成扫描后仍然显示正在索引。",
        reproduction: "打开项目并等待扫描结束。",
        expected: "状态切换为已完成。",
        actual: "一直显示正在索引。",
        environment: "Windows 11 ARM，VS Code 稳定版。",
        component: "RAG",
        severity: "high",
      },
    })
    assert.equal(create.statusCode, 201)
    const created = create.json<{ bug: { id: number }; run: { id: number; stage: string; release_version: string } }>()
    const bug = created.bug
    assert.equal(created.run.stage, "queued")
    assert.equal(created.run.release_version, "1.0.11")
    const trigger = await state.app!.inject({
      method: "POST",
      url: `/api/bugs/${bug.id}/trigger`,
      headers: headers(state.reporter!),
      payload: {},
    })
    assert.equal(trigger.statusCode, 403)
  })

  test("自动创建的任务由 Worker 单一领取", async () => {
    const create = await state.app!.inject({
      method: "POST",
      url: "/api/bugs",
      headers: headers(state.reporter!),
      payload: {
        title: "更新提示未刷新",
        description: "打开更新面板后看不到新版本。",
        reproduction: "发布新包，再打开更新面板。",
        expected: "显示最新版本。",
        actual: "仍然显示当前版本。",
        environment: "Windows 11 ARM。",
        component: "界面",
        severity: "medium",
      },
    })
    assert.equal(create.statusCode, 201)
    const created = create.json<{ bug: { id: number }; run: { id: number; release_version: string } }>()
    const run = created.run
    const lease = await state.app!.inject({
      method: "POST",
      url: `/api/worker/runs/${run.id}/lease`,
      headers: { authorization: `Bearer ${worker}` },
      payload: { owner: "mac-runner" },
    })
    assert.equal(lease.statusCode, 200)
    const duplicate = await state.app!.inject({
      method: "POST",
      url: `/api/worker/runs/${run.id}/lease`,
      headers: { authorization: `Bearer ${worker}` },
      payload: { owner: "second-runner" },
    })
    assert.equal(duplicate.statusCode, 409)
    await workerStage(run.id, "diagnosing")
    const update = await state.app!.inject({
      method: "POST",
      url: `/api/worker/runs/${run.id}/result`,
      headers: { authorization: `Bearer ${worker}` },
      payload: {
        owner: "mac-runner",
        result: { stage: "testing", summary: "已完成修复，正在测试。", tokenCount: 3200 },
      },
    })
    assert.equal(update.statusCode, 200)
    const logs = await state.app!.inject({
      method: "POST",
      url: `/api/worker/runs/${run.id}/logs`,
      headers: { authorization: `Bearer ${worker}` },
      payload: {
        owner: "mac-runner",
        logs: [{
          stage: "testing",
          kind: "codex",
          level: "success",
          message: "Codex 已完成修改，token=private-value",
          summary: "已修复状态同步问题。Bearer private-session",
          detail: "$ bun test\n{\"token\":\"json-private\"}\npassword=private-value\n全部测试通过",
        }],
      },
    })
    assert.equal(logs.statusCode, 200)
    const inserted = logs.json<{ logs: Array<{ message: string; summary: string; detail: string }> }>().logs[0]!
    assert.equal(inserted.message, "Codex 已完成修改，token=[已脱敏]")
    assert.equal(inserted.summary, "已修复状态同步问题。Bearer [已脱敏]")
    assert.equal(
      inserted.detail,
      "$ bun test\n{\"token\":\"[已脱敏]\"}\npassword=[已脱敏]\n全部测试通过",
    )
    const detail = await state.app!.inject({
      method: "GET",
      url: `/api/bugs/${created.bug.id}`,
      headers: { cookie: state.reporter!.cookie },
    })
    const saved = detail.json<{
      runs: Array<{ logs: Array<{ id: number; message: string; detail: string }> }>
    }>().runs[0]!.logs
    assert.equal(saved.length, 1)
    assert.equal(saved[0]!.message, "Codex 已完成修改，token=[已脱敏]")
    assert.equal(
      saved[0]!.detail,
      "$ bun test\n{\"token\":\"[已脱敏]\"}\npassword=[已脱敏]\n全部测试通过",
    )
  })

  test("关键模块必须经过管理员审批", async () => {
    const create = await state.app!.inject({
      method: "POST",
      url: "/api/bugs",
      headers: headers(state.reporter!),
      payload: {
        title: "登录状态异常",
        description: "登录后会立刻退出。",
        reproduction: "输入账号密码并登录。",
        expected: "保持登录状态。",
        actual: "立即返回登录页面。",
        environment: "内部部署环境。",
        component: "auth",
        severity: "critical",
      },
    })
    const run = create.json<{ run: { id: number } }>().run
    await state.app!.inject({
      method: "POST",
      url: `/api/worker/runs/${run.id}/lease`,
      headers: { authorization: `Bearer ${worker}` },
      payload: { owner: "mac-runner" },
    })
    await workerStage(run.id, "diagnosing")
    await workerStage(run.id, "testing")
    await workerStage(run.id, "reviewing")
    const bypass = await state.app!.inject({
      method: "POST",
      url: `/api/worker/runs/${run.id}/result`,
      headers: { authorization: `Bearer ${worker}` },
      payload: { owner: "mac-runner", result: { stage: "packaging" } },
    })
    assert.equal(bypass.statusCode, 409)
    const wait = await state.app!.inject({
      method: "POST",
      url: `/api/worker/runs/${run.id}/result`,
      headers: { authorization: `Bearer ${worker}` },
      payload: {
        owner: "mac-runner",
        result: { stage: "approval_wait", summary: "认证修复已通过测试。", requiresApproval: true },
      },
    })
    assert.equal(wait.statusCode, 200)
    const forbidden = await state.app!.inject({
      method: "POST",
      url: `/api/runs/${run.id}/approve`,
      headers: headers(state.maintainer!),
      payload: {},
    })
    assert.equal(forbidden.statusCode, 403)
    const approved = await state.app!.inject({
      method: "POST",
      url: `/api/runs/${run.id}/approve`,
      headers: headers(state.admin!),
      payload: {},
    })
    assert.equal(approved.statusCode, 200)
    assert.equal(approved.json<{ run: { stage: string } }>().run.stage, "packaging")
  })

  test("发布阶段拒绝取消，避免外部发布完成后状态倒退", async () => {
    const create = await state.app!.inject({
      method: "POST",
      url: "/api/bugs",
      headers: headers(state.reporter!),
      payload: {
        title: "发布取消边界",
        description: "验证发布阶段不能再承诺取消。",
        reproduction: "将任务推进到发布阶段。",
        expected: "取消请求被拒绝。",
        actual: "测试准备中。",
        environment: "自动化测试。",
        component: "编辑器",
        severity: "low",
      },
    })
    const run = create.json<{ run: { id: number } }>().run
    await state.app!.inject({
      method: "POST",
      url: `/api/worker/runs/${run.id}/lease`,
      headers: { authorization: `Bearer ${worker}` },
      payload: { owner: "mac-runner" },
    })
    await workerStage(run.id, "diagnosing")
    await workerStage(run.id, "testing")
    await workerStage(run.id, "reviewing")
    await workerStage(run.id, "packaging")
    await workerStage(run.id, "validating")
    await workerStage(run.id, "publishing")
    const cancel = await state.app!.inject({
      method: "POST",
      url: `/api/runs/${run.id}/cancel`,
      headers: headers(state.admin!),
      payload: {},
    })
    assert.equal(cancel.statusCode, 409)
  })

  test("发布结果必须同时包含 Windows 和 Linux", async () => {
    const create = await state.app!.inject({
      method: "POST",
      url: "/api/bugs",
      headers: headers(state.reporter!),
      payload: {
        title: "普通发布验证",
        description: "用于验证双平台发布门禁。",
        reproduction: "运行自动化测试。",
        expected: "同时记录两个平台。",
        actual: "测试准备中。",
        environment: "自动化测试。",
        component: "编辑器",
        severity: "low",
      },
    })
    const run = create.json<{ run: { id: number; release_version: string } }>().run
    await state.app!.inject({
      method: "POST",
      url: `/api/worker/runs/${run.id}/lease`,
      headers: { authorization: `Bearer ${worker}` },
      payload: { owner: "mac-runner" },
    })
    await workerStage(run.id, "diagnosing")
    await workerStage(run.id, "testing")
    await workerStage(run.id, "reviewing")
    await workerStage(run.id, "packaging")
    await workerStage(run.id, "validating")
    await workerStage(run.id, "publishing")
    const windows = {
      version: run.release_version,
      platform: "win32-x64-baseline",
      name: `chipmate-${run.release_version}-win32-x64-baseline.vsix`,
      size: 10,
      sha256: "a".repeat(64),
      url: `/files/chipmate/${run.release_version}/win32-x64-baseline/chipmate-${run.release_version}-win32-x64-baseline.vsix`,
    }
    await workerStage(run.id, "publishing", { artifacts: [windows] })
    const release = await state.app!.inject({
      method: "POST",
      url: `/api/worker/runs/${run.id}/result`,
      headers: { authorization: `Bearer ${worker}` },
      payload: {
        owner: "mac-runner",
        result: {
          stage: "released",
          artifacts: [windows],
        },
      },
    })
    assert.equal(release.statusCode, 400)
    const detail = await state.app!.inject({
      method: "GET",
      url: `/api/bugs/${create.json<{ bug: { id: number } }>().bug.id}`,
      headers: { cookie: state.reporter!.cookie },
    })
    assert.equal(detail.json<{ runs: Array<{ artifacts: unknown[] }> }>().runs[0]!.artifacts.length, 1)
  })
})
