import { describe, expect, it, spyOn } from "bun:test"
import { commandIntroduction } from "../../src/shared/command-introduction"
import { CommandIntroductionStore, introductionStore } from "../../src/chipmate-provider/command-introduction"

function fixture() {
  let saved = false
  let fail = false
  let time = 0
  const storage = {
    get: <T>() => saved as T,
    update: async () => {
      if (fail) throw new Error("测试存储失败")
      saved = true
    },
  }
  const store = new CommandIntroductionStore(storage, () => time)
  const owner = {}
  const send = (action: "claim" | "displayed" | "release", id = "1", manual = false, from = owner) =>
    store.handle(from, { type: "commandIntroduction", introduction: "spec", requestID: id, action, manual })
  return {
    store,
    storage,
    send,
    saved: () => saved,
    fail: () => {
      fail = true
    },
    advance: () => {
      time += 15001
    },
  }
}

describe("命令介绍的来源隔离", () => {
  it("只标记内置 Spec 模板", () => {
    const template = "<chipmate-spec-command>\n内容"
    expect(commandIntroduction({ name: "spec", source: "command", template })).toBe("spec")
    for (const command of [
      { name: "spec", source: "skill", template },
      { name: "spec", source: "command", template: "自定义模板" },
      { name: "other", source: "command", template },
      { name: "spec", source: "mcp", template },
      { name: "spec", source: "command", template: undefined },
    ])
      expect(commandIntroduction(command)).toBeUndefined()
  })
})

describe("介绍状态与宿主内互斥", () => {
  it("申请不等于展示，取消后仍可首次展示", async () => {
    const f = fixture()
    expect((await f.send("claim"))?.granted).toBe(true)
    expect(f.saved()).toBe(false)
    await f.send("release")
    expect((await f.send("claim", "2"))?.granted).toBe(true)
  })
  it("真实展示后跨实例保留，手动查看仍可打开", async () => {
    const f = fixture()
    await f.send("claim")
    await f.send("displayed")
    expect(f.saved()).toBe(true)
    expect((await f.send("claim", "2"))?.granted).toBe(false)
    const restarted = new CommandIntroductionStore(f.storage)
    expect(
      (
        await restarted.handle(
          {},
          { type: "commandIntroduction", introduction: "spec", action: "claim", requestID: "3" },
        )
      )?.granted,
    ).toBe(false)
    expect((await f.send("claim", "4", true))?.granted).toBe(true)
  })
  it("旧回答与其他面板不能确认，重复申请不能占用", async () => {
    const f = fixture()
    await f.send("claim")
    await f.send("displayed", "过期编号")
    await f.send("displayed", "1", false, {})
    expect(f.saved()).toBe(false)
    expect((await f.send("claim", "2", false, {}))?.granted).toBe(false)
    await f.send("release", "过期编号")
    expect((await f.send("claim", "3"))?.granted).toBe(false)
  })
  it("保存失败不重复弹出且不抛错", async () => {
    const f = fixture()
    f.fail()
    const log = spyOn(console, "warn").mockImplementation(() => {})
    try {
      await f.send("claim")
      await f.send("displayed")
      expect((await f.send("claim", "2"))?.granted).toBe(false)
      expect(log).toHaveBeenCalledTimes(1)
    } finally {
      log.mockRestore()
    }
  })
  it("面板销毁释放申请，失联申请到期可恢复", async () => {
    const f = fixture()
    const owner = {}
    await f.send("claim", "1", false, owner)
    f.store.release(owner)
    expect((await f.send("claim", "2"))?.granted).toBe(true)
    f.advance()
    expect((await f.send("claim", "3", false, {}))?.granted).toBe(true)
  })
  it("过期展示通知不保存已展示状态，也不占用下一次请求", async () => {
    const f = fixture()
    await f.send("claim")
    f.advance()
    await f.send("displayed")
    expect(f.saved()).toBe(false)
    expect((await f.send("claim", "新请求"))?.granted).toBe(true)
    await f.send("displayed", "1")
    expect(f.saved()).toBe(false)
  })
  it("系统时钟前后跳变不会改变宿主内的占用期限", async () => {
    const store = new CommandIntroductionStore({ get: () => undefined, update: async () => {} })
    const owner = {}
    const claim = (id: string) =>
      store.handle(owner, {
        type: "commandIntroduction",
        introduction: "spec",
        action: "claim",
        requestID: id,
        manual: true,
      })
    const clock = spyOn(Date, "now")
    try {
      clock.mockReturnValue(0)
      expect((await claim("首次"))?.granted).toBe(true)
      clock.mockReturnValue(9999999999999)
      expect((await claim("前跳"))?.granted).toBe(false)
      clock.mockReturnValue(-9999999999999)
      expect((await claim("后跳"))?.granted).toBe(false)
    } finally {
      clock.mockRestore()
    }
  })
  it("同一 profile 共享状态，不同存储独立", () => {
    const f = fixture()
    expect(introductionStore(f.storage)).toBe(introductionStore(f.storage))
    expect(introductionStore(f.storage)).not.toBe(introductionStore(fixture().storage))
  })
})
