import { expect, test, type Page } from "@playwright/test"
import type { ExtensionMessage, Message, Part, WebviewMessage } from "../webview-ui/src/types/messages"

const sessionID = "ses_运行状态验收"
const userID = "msg_0001"
const assistantID = "msg_0002"
const time = 1788854400000
const assistant: Message = {
  id: assistantID,
  sessionID,
  role: "assistant",
  parentID: userID,
  createdAt: new Date(time + 1).toISOString(),
  time: { created: time + 1 },
}

async function receive(page: Page, ...messages: ExtensionMessage[]) {
  await page.evaluate((messages) => {
    for (const data of messages) window.dispatchEvent(new MessageEvent("message", { data }))
  }, messages)
}

async function requests(page: Page) {
  return page.evaluate(() => (window as unknown as { 状态验收请求: WebviewMessage[] }).状态验收请求)
}

async function load(page: Page, skin = "default", width = 420) {
  await page.setViewportSize({ width, height: 720 })
  await page.clock.install({ time: new Date(time) })
  await page.addInitScript(() => {
    const messages: unknown[] = []
    Object.assign(window, {
      状态验收请求: messages,
      acquireVsCodeApi: () => ({
        postMessage: (message: unknown) => messages.push(message),
        getState: () => undefined,
        setState: () => {},
      }),
    })
  })
  // 复用已有的真实 SessionProvider + ChatView 夹具，只模拟扩展宿主边界消息。
  await page.goto(`/iframe.html?id=chat-spec-execution--terminal&globals=skin:${skin}`)
  await expect(page.locator(".chat-view")).toBeVisible()
  await receive(page, {
    type: "sessionCreated",
    session: {
      id: sessionID,
      title: "运行状态验收",
      createdAt: new Date(time).toISOString(),
      updatedAt: new Date(time).toISOString(),
    },
  })
  await page.evaluate((id) => window.dispatchEvent(new CustomEvent("验收选择会话", { detail: id })), sessionID)
  await receive(
    page,
    { type: "connectionState", state: "connected" },
    {
      type: "messagesLoaded",
      sessionID,
      messages: [
        {
          id: userID,
          sessionID,
          role: "user",
          createdAt: new Date(time).toISOString(),
          time: { created: time },
          parts: [{ id: "prt_问题", messageID: userID, sessionID, type: "text", text: "请检查初始化逻辑。" }],
        },
        assistant,
      ],
    },
  )
  await expect(page.locator(".message-list")).toContainText("请检查初始化逻辑。")
}

async function part(page: Page, part: Part) {
  if (!part.messageID) throw new Error("验收消息片段缺少所属消息")
  await receive(page, { type: "partUpdated", sessionID, messageID: part.messageID, part })
}

for (const skin of ["default", "night-city"]) {
  test(`长错误不遮挡重试次数、倒计时和取消按钮 ${skin}`, async ({ page }, info) => {
    await load(page, skin, 200)
    const message = "模型连接失败，诊断编号较长。".repeat(120)
    await receive(page, { type: "sessionStatus", sessionID, status: "retry", attempt: 3, message, next: time + 8000 })
    const indicator = page.locator(".working-indicator")
    for (const selector of [".working-retry-attempt", ".working-retry-countdown", ".working-cancel"]) {
      await expect(indicator.locator(selector)).toBeVisible()
      await expect(indicator.locator(selector)).toBeInViewport()
      const rect = await indicator.locator(selector).evaluate((element) => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, viewport: innerWidth } })
      expect(rect.left).toBeGreaterThanOrEqual(0)
      expect(rect.right).toBeLessThanOrEqual(rect.viewport)
    }
    await expect(indicator.locator(".working-retry-countdown")).toHaveText("8 秒后")
    await page.screenshot({ path: info.outputPath(`长错误重试-${skin}.png`) })
    await indicator.locator(".working-cancel").click()
    expect((await requests(page)).filter((message) => message.type === "abort")).toEqual([{ type: "abort", sessionID }])
    await receive(page, { type: "sessionStatus", sessionID, status: "idle" })
    await expect(page.locator(".working-indicator-slot")).toHaveCount(0)
  })
}

for (const skin of ["default", "night-city"]) {
  for (const width of [200, 420]) {
    test(`完整聊天恢复等待、思考、输出、工具与重试状态 ${skin} ${width}`, async ({ page }, info) => {
      await load(page, skin, width)
      const slot = page.locator(".working-indicator-slot")
      const indicator = page.locator(".message-list .working-indicator")
      const text = indicator.locator(".working-text")
      await expect(slot).toHaveCount(0)
      await receive(page, { type: "sessionStatus", sessionID, status: "busy" })
      await expect(indicator).toBeVisible()
      await expect(text).toHaveText("Deep diving...")
      await page.clock.runFor(1100)
      await expect(indicator.locator(".working-elapsed")).toHaveText("1秒")
      await page.clock.runFor(1100)
      await expect(indicator.locator(".working-elapsed")).toHaveText("2秒")
      await expect(indicator).toBeInViewport()
      const bounds = await indicator.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return { left: rect.left, right: rect.right, viewport: innerWidth }
      })
      expect(bounds.left).toBeGreaterThanOrEqual(0)
      expect(bounds.right).toBeLessThanOrEqual(bounds.viewport)
      await page.screenshot({ path: info.outputPath("运行状态.png") })

      await part(page, {
        id: "prt_思考",
        messageID: assistantID,
        sessionID,
        type: "reasoning",
        text: "检查初始化顺序。",
        time: { start: time },
      })
      await expect(text).toHaveText(/思考/)
      const answer: Part = { id: "prt_回答", messageID: assistantID, sessionID, type: "text", text: "第一步检查参数。" }
      await part(page, answer)
      await expect(text).toHaveText("正在撰写回复…")
      await receive(page, {
        type: "partUpdated",
        sessionID,
        messageID: assistantID,
        part: answer,
        delta: { type: "text-delta", textDelta: "第二步初始化设备。" },
      })
      await expect(page.locator(".message-list")).toContainText("第一步检查参数。第二步初始化设备。")
      await expect(slot).toHaveCount(1)
      await part(page, {
        id: "prt_命令",
        messageID: assistantID,
        sessionID,
        type: "tool",
        callID: "call_命令",
        tool: "bash",
        state: { status: "running", input: { command: "pwd" }, title: "检查工作目录" },
      })
      await expect(text).toHaveText("正在运行命令")

      await receive(
        page,
        {
          type: "messageCreated",
          message: { ...assistant, finish: "stop", time: { created: time + 1, completed: time + 2200 } },
        },
        { type: "sessionStatus", sessionID, status: "idle" },
      )
      await expect(slot).toHaveCount(0)

      await receive(page, {
        type: "sessionStatus",
        sessionID,
        status: "retry",
        attempt: 1,
        message: "服务繁忙，等待重试",
        next: time + 60_000,
      })
      await expect(indicator.locator(".working-retry-attempt")).toHaveText("第 1 次重试")
      await expect(indicator.locator(".working-retry-countdown")).toHaveText(/\d+ 秒后/)
      await expect(text).toContainText("服务繁忙，等待重试")
      await expect(page.locator('[data-component="turn-changes-dock"]')).not.toContainText("服务繁忙")
      const countdown = await text.innerText()
      await page.clock.runFor(1100)
      await expect(text).not.toHaveText(countdown)
      await receive(page, { type: "sessionStatus", sessionID, status: "offline", message: "连接已断开，等待恢复" })
      await expect(text).toHaveText("连接已断开，等待恢复")
      await expect(indicator.locator(".working-cancel")).toHaveCount(0)
      await receive(page, {
        type: "sessionStatus",
        sessionID,
        status: "retry",
        attempt: 2,
        message: "等待重试",
        next: time + 60_000,
      })
      await indicator.locator(".working-cancel").click()
      await expect
        .poll(async () => (await requests(page)).filter((message) => message.type === "abort"))
        .toEqual([{ type: "abort", sessionID }])
      await receive(page, { type: "sessionStatus", sessionID, status: "idle" })
      await expect(slot).toHaveCount(0)
      await page.clock.runFor(2000)
      await expect(slot).toHaveCount(0)
    })
  }
}

test("真实输入提交后、后端忙碌状态到达前显示提示，失败后清除占位", async ({ page }) => {
  await load(page)
  const input = page.locator("textarea.prompt-input")
  await input.fill("继续检查错误返回。")
  await input.press("Enter")
  await expect
    .poll(async () => (await requests(page)).filter((message) => message.type === "sendMessage").length)
    .toBe(1)
  await expect(page.locator(".working-text")).toHaveText("Deep diving...")
  await page.clock.runFor(1100)
  await expect(page.locator(".working-elapsed")).toHaveText("1秒")
  const sent = (await requests(page)).find((message) => message.type === "sendMessage")!
  if (sent.type !== "sendMessage") throw new Error("没有捕获正式发送请求")
  await receive(page, {
    type: "sendMessageFailed",
    sessionID,
    messageID: sent.messageID,
    text: sent.text,
    error: "验收发送失败",
  })
  await expect(page.locator(".working-indicator-slot")).toHaveCount(0)
})

test("会话切换、授权、提问和压缩保留原有状态显示边界", async ({ page }) => {
  await load(page)
  await receive(page, { type: "sessionStatus", sessionID, status: "busy" })
  const slot = page.locator(".working-indicator-slot")
  await expect(slot).toHaveCount(1)
  await receive(page, {
    type: "permissionRequest",
    permission: {
      id: "per_验收",
      sessionID,
      toolName: "bash",
      patterns: ["pwd"],
      always: ["pwd"],
      args: { command: "pwd" },
    },
  })
  await expect(slot).toHaveCount(0)
  await receive(page, { type: "permissionResolved", permissionID: "per_验收" })
  await expect(slot).toHaveCount(1)
  await receive(page, {
    type: "questionRequest",
    question: {
      id: "que_验收",
      sessionID,
      questions: [
        { header: "范围", question: "检查哪个模块？", options: [{ label: "初始化", description: "检查设备初始化" }] },
      ],
    },
  })
  await expect(slot).toHaveCount(0)
  await expect(page.getByText("检查哪个模块？", { exact: true })).toBeVisible()
  await receive(page, { type: "questionResolved", requestID: "que_验收" })
  await expect(slot).toHaveCount(1)
  await receive(page, {
    type: "suggestionRequest",
    suggestion: { id: "sug_验收", sessionID, text: "是否继续检查？", actions: [{ label: "继续", prompt: "继续检查" }] },
  })
  await expect(slot).toHaveCount(0)
  await receive(page, { type: "suggestionResolved", requestID: "sug_验收" })
  await expect(slot).toHaveCount(1)
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("验收选择会话", { detail: "ses_另一个会话" })))
  await receive(page, { type: "messagesLoaded", sessionID: "ses_另一个会话", messages: [] })
  await expect(slot).toHaveCount(0)
  await page.evaluate((id) => window.dispatchEvent(new CustomEvent("验收选择会话", { detail: id })), sessionID)
  await expect(slot).toHaveCount(1)
  const marker = "msg_0003"
  await receive(page, {
    type: "messageCreated",
    message: {
      id: marker,
      sessionID,
      role: "user",
      createdAt: new Date(time + 2).toISOString(),
      time: { created: time + 2 },
    },
  })
  await part(page, { id: "prt_压缩", messageID: marker, sessionID, type: "compaction", auto: true })
  await expect(slot).toHaveCount(0)
  await receive(page, { type: "sessionStatus", sessionID, status: "idle" })
  await expect(slot).toHaveCount(0)
})


test("QA-023 停止移除待回答问题且拒绝旧问题回流，下一任务可正常提问", async ({ page }) => {
  await load(page)
  await receive(page, { type: "sessionStatus", sessionID, status: "busy" })
  const question = {
    id: "que_P2停止验收", sessionID,
    questions: [{ header: "范围", question: "停止后不应继续等待的问题", options: [{ label: "模块甲", description: "只处理模块甲" }] }],
  }
  await receive(page, { type: "questionRequest", question })
  await expect(page.getByText("停止后不应继续等待的问题", { exact: true })).toBeVisible()
  // 等待提问时输入框允许追加消息，使用聊天已有的 Esc 停止入口。
  await page.locator("textarea.prompt-input").focus()
  await page.keyboard.press("Escape")
  await expect(page.getByText("停止后不应继续等待的问题", { exact: true })).toHaveCount(0)
  expect((await requests(page)).filter((message) => message.type === "abort")).toHaveLength(1)
  await receive(page, { type: "questionRequest", question })
  await expect(page.getByText("停止后不应继续等待的问题", { exact: true })).toHaveCount(0)
  await receive(page, { type: "sessionStatus", sessionID, status: "idle" }, { type: "sessionStatus", sessionID, status: "busy" })
  await receive(page, { type: "questionRequest", question: { ...question, id: "que_P2恢复验收", questions: [{ ...question.questions[0]!, question: "恢复后新的问题" }] } })
  await expect(page.getByText("恢复后新的问题", { exact: true })).toBeVisible()
})

test("QA-023 停止撤下权限卡片，旧审批不回流，新任务可重新审批", async ({ page }) => {
  await load(page)
  await receive(page, { type: "sessionStatus", sessionID, status: "busy" })
  const permission = { id: "per_P2停止", sessionID, toolName: "bash", patterns: ["touch 停止验收"], always: ["touch *"], args: { command: "touch 停止验收" } }
  await receive(page, { type: "permissionRequest", permission })
  const allow = page.getByRole("button", { name: "允许一次", exact: true })
  await expect(allow).toBeVisible()
  await page.locator(".prompt-stop-button").click()
  await expect(allow).toHaveCount(0)
  expect((await requests(page)).filter((message) => message.type === "abort")).toHaveLength(1)
  await receive(page, { type: "sessionStatus", sessionID, status: "idle" }, { type: "sessionStatus", sessionID, status: "busy" }, { type: "permissionRequest", permission })
  await expect(allow).toHaveCount(0)
  await receive(page, { type: "permissionRequest", permission: { ...permission, id: "per_P2恢复" } })
  await expect(allow).toBeVisible()
  await allow.click()
  expect((await requests(page)).filter((message) => message.type === "permissionResponse")).toEqual([
    expect.objectContaining({ permissionId: "per_P2恢复", response: "once" }),
  ])
})

test("QA-043 仅聊天区域取得焦点时上报，外部页面控件不冒充聊天", async ({ page }) => {
  await load(page)
  const count = async () => (await requests(page)).filter((message) => message.type === "chatSurfaceFocused").length
  const before = await count()
  await page.locator("textarea.prompt-input").click()
  await expect.poll(count).toBeGreaterThan(before)
  const after = await count()
  await page.evaluate(() => {
    const button = document.createElement("button")
    button.textContent = "聊天外设置控件"
    document.body.append(button)
  })
  await page.getByRole("button", { name: "聊天外设置控件" }).click()
  expect(await count()).toBe(after)
})

for (const width of [200, 420]) {
  test(`QA-024/040 低高度长输入保留消息区，底部发送入口可滚动到达 ${width}`, async ({ page }, info) => {
    await load(page, "default", width)
    await page.setViewportSize({ width, height: 260 })
    await page.locator("textarea.prompt-input").fill("中文极限输入 🌲 ".repeat(200))
    const sizes = await page.locator(".chat-view").evaluate((element) => {
      const input = element.querySelector(".chat-input")!.getBoundingClientRect()
      const messages = element.querySelector(".chat-messages-wrapper")!.getBoundingClientRect()
      const total = element.getBoundingClientRect()
      return { input: input.height, messages: messages.height, total: total.height }
    })
    expect(sizes.input).toBeLessThanOrEqual(sizes.total * 0.6 + 1)
    expect(sizes.messages).toBeGreaterThan(24)
    const send = page.getByRole("button", { name: "发送", exact: true })
    await send.scrollIntoViewIfNeeded()
    await expect(send).toBeInViewport()
    await page.screenshot({ path: info.outputPath(`低高度聊天-${width}.png`) })
  })
}
