import { expect, test } from "bun:test"
import { SessionOwnership } from "../../src/chipmate/editor-ownership"

test("排队请求和子会话保留同一窗口归属，结束后释放全部元数据", () => {
  const ownership = new SessionOwnership()
  const first = ownership.acquire("session", "window-a")
  const queued = ownership.acquire("session", "window-a")
  ownership.inherit("child", "session")
  ownership.inherit("grandchild", "child")
  expect(ownership.owner("grandchild")).toBe("window-a")
  expect(() => ownership.acquire("session", "window-b")).toThrow("另一个窗口")
  expect(() => ownership.acquire("child", "window-b")).toThrow("另一个窗口")
  first.release()
  first.release()
  expect(ownership.owner("session")).toBe("window-a")
  queued.release()
  expect(ownership.owner("session")).toBeUndefined()
  expect(ownership.owner("grandchild")).toBeUndefined()
  ownership.acquire("session", "window-b").release()
})

test("客户端退出只取消自己的执行，不取消其他窗口", async () => {
  const ownership = new SessionOwnership()
  const first = ownership.acquire("one", "window-a")
  const second = ownership.acquire("two", "window-b")
  let cancelled = false
  void second.cancelled.then(() => { cancelled = true })
  ownership.cancelClient("window-a")
  await first.cancelled
  expect(cancelled).toBe(false)
  first.release()
  expect(ownership.owner("two")).toBe("window-b")
  second.release()
})
