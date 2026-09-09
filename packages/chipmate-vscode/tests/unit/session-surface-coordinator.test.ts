import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SessionSurfaceCoordinator } from "../../src/services/session-surface/coordinator"
import {
  isSessionSurfaceMutation,
  type SessionSurfaceDraftContent,
  type SessionSurfaceExtensionMessage,
  type SessionSurfaceKey,
} from "../../src/shared/session-surface"

const temporary: string[] = []
const key: SessionSurfaceKey = { kind: "session", id: "session-a" }

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function coordinator() {
  const directory = await mkdtemp(join(tmpdir(), "chipmate-session-surface-"))
  temporary.push(directory)
  return {
    directory,
    value: new SessionSurfaceCoordinator({ globalStorageUri: { fsPath: directory } } as never),
  }
}

function surface(id: string, kind: "sidebar" | "main-editor", pinnedKey?: SessionSurfaceKey) {
  const messages: SessionSurfaceExtensionMessage[] = []
  return {
    messages,
    registration: { id, kind, pinnedKey, post: (message: SessionSurfaceExtensionMessage) => messages.push(message) },
  }
}

function token(messages: SessionSurfaceExtensionMessage[]) {
  return messages.findLast((message) => message.type === "sessionSurface.state")?.type === "sessionSurface.state"
    ? messages.findLast((message) => message.type === "sessionSurface.state")!.state.token
    : undefined
}

function content(text: string, image = false): SessionSurfaceDraftContent {
  return {
    boxId: "prompt:session-a",
    text,
    reviewComments: [],
    images: image
      ? [{ id: "image-a", filename: "evidence.png", mime: "image/png", dataUrl: "data:image/png;base64,aGVsbG8=" }]
      : [],
    references: ["src/main.ts:10"],
    inputScrollTop: 12,
  }
}

describe("SessionSurfaceCoordinator", () => {
  it("在主区交接、原生关闭和旧消息到达时始终只有一个有效 owner", async () => {
    const { value } = await coordinator()
    const sidebar = surface("sidebar", "sidebar")
    const main = surface("main:a", "main-editor", key)
    value.registerSurface(sidebar.registration)
    value.bindSurface("sidebar", key)
    value.registerSurface(main.registration)

    const sidebarToken = token(sidebar.messages)
    expect(sidebarToken).toBeDefined()
    value.prepareMain(key)
    value.claimMain(key, "main:a")
    const mainToken = token(main.messages)
    expect(mainToken).toBeDefined()
    expect(value.stateForSurface("sidebar")?.token).toBeUndefined()
    expect(
      value.authorize("sidebar", { type: "sendMessage", sessionID: "session-a", sessionSurfaceToken: sidebarToken }),
    ).toBeFalse()
    expect(
      value.authorize("main:a", { type: "sendMessage", sessionID: "session-a", sessionSurfaceToken: mainToken }),
    ).toBeTrue()
    expect(
      value.authorize("main:a", { type: "sendMessage", sessionID: "session-b", sessionSurfaceToken: mainToken }),
    ).toBeFalse()

    value.unregisterSurface("main:a")
    expect(value.stateForSurface("sidebar")?.token).toBeDefined()
    expect(
      value.authorize("main:a", { type: "abort", sessionID: "session-a", sessionSurfaceToken: mainToken }),
    ).toBeFalse()
  })

  it("连续一百次打开和关闭不会接受重复面板或遗留主区 token", async () => {
    const { value } = await coordinator()
    const sidebar = surface("sidebar", "sidebar")
    value.registerSurface(sidebar.registration)
    value.bindSurface("sidebar", key)

    for (let index = 0; index < 100; index++) {
      const id = `main:${index}`
      const main = surface(id, "main-editor", key)
      const panel = { index }
      value.registerSurface(main.registration)
      value.prepareMain(key)
      expect(value.registerPanel(key, panel as never, id)).toBeTrue()
      expect(value.registerPanel(key, { duplicate: index } as never, `${id}:duplicate`)).toBeFalse()
      value.claimMain(key, id)
      expect(value.stateForSurface("sidebar")?.token).toBeUndefined()
      expect(value.stateForSurface(id)?.token).toBeDefined()
      value.releasePanel(key, panel as never)
      value.unregisterSurface(id)
      expect(value.stateForSurface("sidebar")?.token).toBeDefined()
    }
  })

  it("交接后必须等新 owner 确认当前 epoch，旧 ready 不能提前结束切换", async () => {
    const { value } = await coordinator()
    const sidebar = surface("sidebar", "sidebar")
    const main = surface("main:a", "main-editor", key)
    value.registerSurface(sidebar.registration)
    value.bindSurface("sidebar", key)
    value.registerSurface(main.registration)
    await value.handleMessage("main:a", { type: "sessionSurface.ready", key, draftRevision: 0 })

    const claimed = value.claimMain(key, "main:a")
    const epoch = claimed.token?.epoch
    expect(epoch).toBeDefined()
    let ready = false
    const pending = value.waitForSurfaceReady("main:a", key, 0, epoch).then(() => {
      ready = true
    })

    await value.handleMessage("main:a", {
      type: "sessionSurface.ready",
      key,
      draftRevision: 0,
      ownershipEpoch: epoch! - 1,
    })
    await Promise.resolve()
    expect(ready).toBeFalse()

    await value.handleMessage("main:a", {
      type: "sessionSurface.ready",
      key,
      draftRevision: 0,
      ownershipEpoch: epoch,
    })
    await pending
    expect(ready).toBeTrue()
  })

  it("owner 明确报告无法刷新时立即结束等待，不再卡到超时", async () => {
    const { value } = await coordinator()
    const sidebar = surface("sidebar", "sidebar")
    value.registerSurface(sidebar.registration)
    value.bindSurface("sidebar", key)
    const owner = token(sidebar.messages)
    expect(owner).toBeDefined()
    await value.handleMessage("sidebar", {
      type: "sessionSurface.ready",
      key,
      draftRevision: 0,
      ownershipEpoch: owner!.epoch,
    })

    const pending = value.flushOwner(key)
    for (let index = 0; index < 4; index++) await Promise.resolve()
    expect(sidebar.messages.findLast((message) => message.type === "sessionSurface.draft.flushRequested")).toEqual({
      type: "sessionSurface.draft.flushRequested",
      key,
    })
    await value.handleMessage("sidebar", { type: "sessionSurface.draft.flushFailed", key })

    await expect(pending).rejects.toThrow("草稿未能保存，已保留当前输入")
  })

  it("过期 token 的刷新请求会立即拒绝扩展侧等待并保留当前界面", async () => {
    const { value } = await coordinator()
    const sidebar = surface("sidebar", "sidebar")
    value.registerSurface(sidebar.registration)
    value.bindSurface("sidebar", key)
    const owner = token(sidebar.messages)
    expect(owner).toBeDefined()
    await value.handleMessage("sidebar", {
      type: "sessionSurface.ready",
      key,
      draftRevision: 0,
      ownershipEpoch: owner!.epoch,
    })

    const pending = value.flushOwner(key)
    for (let index = 0; index < 4; index++) await Promise.resolve()
    await value.handleMessage("sidebar", {
      type: "sessionSurface.draft.flush",
      key,
      clientSeq: 0,
      token: { ...owner!, epoch: owner!.epoch - 1 },
    })

    await expect(pending).rejects.toThrow("草稿所有权已变化，已保留当前输入")
  })

  it("切换等待中草稿升级为会话时会迁移 ready 与刷新请求", async () => {
    const { value } = await coordinator()
    const draft: SessionSurfaceKey = { kind: "draft", id: "main-pending:promotion" }
    const session: SessionSurfaceKey = { kind: "session", id: "created-during-switch" }
    const sidebar = surface("sidebar", "sidebar")
    value.registerSurface(sidebar.registration)
    value.bindSurface("sidebar", draft)
    const owner = token(sidebar.messages)
    expect(owner).toBeDefined()

    const pending = value.flushOwner(draft)
    await Promise.resolve()
    value.promote(draft, session)
    await value.handleMessage("sidebar", {
      type: "sessionSurface.ready",
      key: session,
      draftRevision: 0,
      ownershipEpoch: owner!.epoch,
    })
    for (let index = 0; index < 4; index++) await Promise.resolve()

    expect(sidebar.messages.findLast((message) => message.type === "sessionSurface.draft.flushRequested")).toEqual({
      type: "sessionSurface.draft.flushRequested",
      key: session,
    })
    await value.handleMessage("sidebar", {
      type: "sessionSurface.draft.flush",
      key: session,
      clientSeq: 0,
      token: owner,
    })
    await pending
    expect(value.resolveKey(draft)).toEqual(session)
  })

  it("草稿升级后收到旧 key 会立即把 Webview 重定向到新会话", async () => {
    const { value } = await coordinator()
    const draft: SessionSurfaceKey = { kind: "draft", id: "main-pending:stale-selection" }
    const session: SessionSurfaceKey = { kind: "session", id: "promoted-session" }
    const sidebar = surface("sidebar", "sidebar")
    value.registerSurface(sidebar.registration)
    value.bindSurface("sidebar", draft)
    value.promote(draft, session)
    sidebar.messages.length = 0

    await value.handleMessage("sidebar", { type: "sessionSurface.active", key: draft })

    expect(value.keyForSurface("sidebar")).toEqual(session)
    expect(sidebar.messages).toContainEqual({ type: "sessionSurface.select", key: session })
  })

  it("图片只按 SHA-256 blob 持久化，主快照损坏时恢复上一份有效草稿", async () => {
    const { directory, value } = await coordinator()
    const sidebar = surface("sidebar", "sidebar")
    value.registerSurface(sidebar.registration)
    value.bindSurface("sidebar", key)
    const owner = token(sidebar.messages)
    expect(owner).toBeDefined()

    await value.handleMessage("sidebar", {
      type: "sessionSurface.draft.update",
      key,
      clientSeq: 1,
      token: owner,
      content: content("第一版", true),
    })
    await value.handleMessage("sidebar", {
      type: "sessionSurface.draft.update",
      key,
      clientSeq: 2,
      token: owner,
      content: content("第二版", true),
    })

    const draftDirectory = join(directory, "session-surface-drafts")
    const files = await readdir(draftDirectory)
    const current = files.find((file) => file.endsWith(".json"))
    expect(current).toBeDefined()
    const raw = await readFile(join(draftDirectory, current!), "utf8")
    expect(raw).not.toContain("aGVsbG8=")
    expect((await readdir(join(draftDirectory, "blobs"))).length).toBe(1)

    await writeFile(join(draftDirectory, current!), "损坏的快照")
    value.dispose()
    const restored = new SessionSurfaceCoordinator({ globalStorageUri: { fsPath: directory } } as never)
    const snapshot = await restored.draftSnapshot(key)
    expect(snapshot.revision).toBe(1)
    expect(snapshot.content.text).toBe("第一版")
    expect(snapshot.content.images[0]?.sha256).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824")
    expect(snapshot.content.images[0]?.dataUrl).toBe("data:image/png;base64,aGVsbG8=")
  })

  it("草稿 token 不能跨会话复用", async () => {
    const { value } = await coordinator()
    const sidebar = surface("sidebar", "sidebar")
    value.registerSurface(sidebar.registration)
    value.bindSurface("sidebar", key)
    const owner = token(sidebar.messages)
    const other: SessionSurfaceKey = { kind: "session", id: "session-b" }
    await value.handleMessage("sidebar", {
      type: "sessionSurface.draft.update",
      key: other,
      clientSeq: 1,
      token: owner,
      content: content("不应写入"),
    })
    expect((await value.draftSnapshot(other)).revision).toBe(0)
  })

  it("空草稿已是 revision 1 时，立即更新并切换不会让 active 越过草稿队列", async () => {
    const { value } = await coordinator()
    const sidebar = surface("sidebar", "sidebar")
    const other: SessionSurfaceKey = { kind: "session", id: "session-b" }
    value.registerSurface(sidebar.registration)
    value.bindSurface("sidebar", key)
    const owner = token(sidebar.messages)
    expect(owner).toBeDefined()

    await value.handleMessage("sidebar", {
      type: "sessionSurface.draft.update",
      key,
      clientSeq: 1,
      token: owner,
      content: content(""),
    })
    const update = value.handleMessage("sidebar", {
      type: "sessionSurface.draft.update",
      key,
      clientSeq: 2,
      token: owner,
      content: content("输入后立即切换"),
    })
    const activate = value.handleMessage("sidebar", { type: "sessionSurface.active", key: other })
    await Promise.all([update, activate])

    expect(await value.draftSnapshot(key)).toMatchObject({ revision: 2, content: { text: "输入后立即切换" } })
    expect(
      sidebar.messages.some((message) => message.type === "sessionSurface.draft.rejected" && message.clientSeq === 2),
    ).toBeFalse()
    expect(value.keyForSurface("sidebar")).toEqual(other)
  })

  it("首次磁盘读取完成时二次检查内存，不能覆盖并发写入的新草稿", async () => {
    const { value } = await coordinator()
    let release: ((draft: Awaited<ReturnType<SessionSurfaceCoordinator["draftSnapshot"]>>) => void) | undefined
    const loading = new Promise<Awaited<ReturnType<SessionSurfaceCoordinator["draftSnapshot"]>>>((resolve) => {
      release = resolve
    })
    const internal = value as unknown as {
      loadPersistedDraft: () => Promise<Awaited<ReturnType<SessionSurfaceCoordinator["draftSnapshot"]>>>
    }
    internal.loadPersistedDraft = () => loading
    const sidebar = surface("sidebar", "sidebar")
    value.registerSurface(sidebar.registration)
    value.bindSurface("sidebar", key)
    const owner = token(sidebar.messages)
    expect(owner).toBeDefined()

    await value.handleMessage("sidebar", {
      type: "sessionSurface.draft.update",
      key,
      clientSeq: 1,
      token: owner,
      content: content("内存中的新草稿"),
    })
    release?.({ schemaVersion: 1, key, revision: 1, updatedAt: 1, content: content("磁盘旧草稿") })
    for (let index = 0; index < 8; index++) await Promise.resolve()

    expect(await value.draftSnapshot(key)).toMatchObject({ revision: 1, content: { text: "内存中的新草稿" } })
    expect(sidebar.messages.findLast((message) => message.type === "sessionSurface.draft.snapshot")).toMatchObject({
      type: "sessionSurface.draft.snapshot",
      draft: { content: { text: "内存中的新草稿" } },
    })
  })

  it("持久化失败时回滚 revision 并拒绝 ACK，已保存草稿保持不变", async () => {
    const { value } = await coordinator()
    const sidebar = surface("sidebar", "sidebar")
    value.registerSurface(sidebar.registration)
    value.bindSurface("sidebar", key)
    const owner = token(sidebar.messages)
    expect(owner).toBeDefined()
    await value.handleMessage("sidebar", {
      type: "sessionSurface.draft.update",
      key,
      clientSeq: 1,
      token: owner,
      content: content("已保存草稿"),
    })
    const internal = value as unknown as { persistDraft: () => Promise<void> }
    internal.persistDraft = async () => {
      throw new Error("注入磁盘失败")
    }

    await value.handleMessage("sidebar", {
      type: "sessionSurface.draft.update",
      key,
      clientSeq: 2,
      token: owner,
      content: content("不应覆盖"),
    })

    expect(await value.draftSnapshot(key)).toMatchObject({ revision: 1, content: { text: "已保存草稿" } })
    expect(sidebar.messages.findLast((message) => message.type === "sessionSurface.draft.rejected")).toMatchObject({
      type: "sessionSurface.draft.rejected",
      clientSeq: 2,
    })
    expect(
      sidebar.messages.some((message) => message.type === "sessionSurface.draft.ack" && message.clientSeq === 2),
    ).toBeFalse()
  })

  it("当前 token 不能提交另一个 pending draft 的发送请求", async () => {
    const { value } = await coordinator()
    const sidebar = surface("sidebar", "sidebar")
    const current: SessionSurfaceKey = { kind: "draft", id: "sidebar-pending:a" }
    value.registerSurface(sidebar.registration)
    value.bindSurface("sidebar", current)
    const owner = token(sidebar.messages)

    expect(
      value.authorize("sidebar", {
        type: "sendMessage",
        draftID: "sidebar-pending:b",
        messageID: "message-b",
        sessionSurfaceToken: owner,
      }),
    ).toBeFalse()
    expect(sidebar.messages.findLast((message) => message.type === "sessionSurface.mutationRejected")).toMatchObject({
      type: "sessionSurface.mutationRejected",
      key: current,
      messageID: "message-b",
      reason: "target-mismatch",
    })
  })

  it("后端只清空发送时的精确 revision，不能覆盖发送后继续输入的新草稿", async () => {
    const { value } = await coordinator()
    const sidebar = surface("sidebar", "sidebar")
    value.registerSurface(sidebar.registration)
    value.bindSurface("sidebar", key)
    const owner = token(sidebar.messages)
    expect(owner).toBeDefined()

    await value.handleMessage("sidebar", {
      type: "sessionSurface.draft.update",
      key,
      clientSeq: 1,
      token: owner,
      content: content("已发送内容"),
    })
    await value.acceptDraft("sidebar", key, 1)
    expect((await value.draftSnapshot(key)).content.text).toBe("")

    await value.handleMessage("sidebar", {
      type: "sessionSurface.draft.update",
      key,
      clientSeq: 2,
      token: owner,
      content: content("下一份草稿"),
    })
    await value.acceptDraft("sidebar", key, 2)
    expect((await value.draftSnapshot(key)).content.text).toBe("下一份草稿")
  })

  it("侧栏切换会话后旧会话 token 即使 epoch 数值曾相同也会失效", async () => {
    const { value } = await coordinator()
    const sidebar = surface("sidebar", "sidebar")
    const other: SessionSurfaceKey = { kind: "session", id: "session-b" }
    value.registerSurface(sidebar.registration)
    value.bindSurface("sidebar", key)
    const old = token(sidebar.messages)
    value.bindSurface("sidebar", other)
    expect(
      value.authorize("sidebar", {
        type: "sendMessage",
        sessionID: "session-a",
        sessionSurfaceToken: old,
      }),
    ).toBeFalse()
    const rejected = sidebar.messages.findLast((message) => message.type === "sessionSurface.mutationRejected")
    expect(rejected).toMatchObject({
      type: "sessionSurface.mutationRejected",
      key: other,
      mutationType: "sendMessage",
      reason: "target-mismatch",
    })
    if (rejected?.type !== "sessionSurface.mutationRejected") throw new Error("缺少 mutationRejected")
    expect(rejected.state.key).toEqual(other)
    expect(rejected.state.token).toEqual(value.stateForSurface("sidebar")?.token)
  })

  it("发送相关入口统一接受 surface owner 校验，镜像拒绝不会下发 token", async () => {
    expect(["sendMessage", "sendCommand", "importAndSend", "createSession"].every(isSessionSurfaceMutation)).toBeTrue()
    expect(isSessionSurfaceMutation("clearSession")).toBeFalse()
    expect(isSessionSurfaceMutation("loadMessages")).toBeFalse()

    const { value } = await coordinator()
    const sidebar = surface("sidebar", "sidebar")
    const main = surface("main:a", "main-editor", key)
    value.registerSurface(sidebar.registration)
    value.bindSurface("sidebar", key)
    const old = token(sidebar.messages)
    value.registerSurface(main.registration)
    value.prepareMain(key)
    value.claimMain(key, "main:a")

    expect(
      value.authorize("sidebar", {
        type: "sendCommand",
        sessionID: key.id,
        messageID: "message-a",
        sessionSurfaceToken: old,
      }),
    ).toBeFalse()
    const rejected = sidebar.messages.findLast((message) => message.type === "sessionSurface.mutationRejected")
    expect(rejected).toMatchObject({
      type: "sessionSurface.mutationRejected",
      key,
      mutationType: "sendCommand",
      messageID: "message-a",
      reason: "invalid-token",
      state: { token: undefined },
    })
  })

  it("pending key 迁移后按新会话 key 释放面板并回收 owner", async () => {
    const { value } = await coordinator()
    const pending: SessionSurfaceKey = { kind: "draft", id: "main-pending:a" }
    const session: SessionSurfaceKey = { kind: "session", id: "created-a" }
    const sidebar = surface("sidebar", "sidebar")
    const main = surface("main:a", "main-editor", pending)
    const panel = { id: "panel-a" }
    value.registerSurface(sidebar.registration)
    value.bindSurface("sidebar", pending)
    value.registerSurface(main.registration)
    value.registerPanel(pending, panel as never, "main:a")
    value.claimMain(pending, "main:a")

    value.promote(pending, session, { title: "已创建会话" })
    expect(value.keyForSurface("main:a")).toEqual(session)
    expect(value.panel(session)).toBe(panel)
    value.releasePanelFor(panel as never)
    expect(value.stateForSurface("sidebar")?.key).toEqual(session)
    expect(value.stateForSurface("sidebar")?.token).toBeDefined()
  })

  it("官方 DSH 全局只保留一个 lease，并校验 taskId 后才接受 projection", async () => {
    const { value } = await coordinator()
    const sidebar = surface("sidebar", "sidebar")
    value.registerSurface(sidebar.registration)
    value.bindSurface("sidebar", key)
    const sidebarToken = token(sidebar.messages)
    expect(
      value.authorize("sidebar", {
        type: "chipmateDeepSeekHarness.activate",
        taskId: "task-a",
        sessionSurfaceToken: sidebarToken,
      }),
    ).toBeTrue()
    expect(value.canUseDshTransport("sidebar")).toBeTrue()

    const detached = value.detachDshOwner(key)
    expect(sidebar.messages.findLast((message) => message.type === "sessionSurface.dsh.detachRequested")).toEqual({
      type: "sessionSurface.dsh.detachRequested",
      key,
      taskId: "task-a",
    })
    expect(
      value.authorize("sidebar", {
        type: "chipmateDeepSeekHarness.detached",
        taskId: "task-a",
        sessionSurfaceToken: sidebarToken,
      }),
    ).toBeTrue()
    await detached
    expect(value.canUseDshTransport("sidebar")).toBeTrue()

    const projection = value.waitForDshProjection("sidebar", key)
    expect(
      value.authorize("sidebar", {
        type: "chipmateDeepSeekHarness.projectionReady",
        taskId: "wrong-task",
        sessionId: "official-a",
        connectionGeneration: 1,
        sessionSurfaceToken: sidebarToken,
      }),
    ).toBeFalse()
    expect(
      value.authorize("sidebar", {
        type: "chipmateDeepSeekHarness.projectionReady",
        taskId: "task-a",
        sessionId: "official-a",
        connectionGeneration: 1,
        sessionSurfaceToken: sidebarToken,
      }),
    ).toBeTrue()
    await projection

    const other: SessionSurfaceKey = { kind: "session", id: "session-b" }
    const main = surface("main:b", "main-editor", other)
    value.registerSurface(main.registration)
    value.claimMain(other, "main:b")
    const mainToken = token(main.messages)
    expect(
      value.authorize("main:b", {
        type: "chipmateDeepSeekHarness.activate",
        taskId: "task-b",
        sessionSurfaceToken: mainToken,
      }),
    ).toBeTrue()
    expect(value.canUseDshTransport("main:b")).toBeTrue()
    expect(value.canUseDshTransport("sidebar")).toBeFalse()
  })
})
