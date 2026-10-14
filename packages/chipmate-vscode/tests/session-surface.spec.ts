import { expect, test } from "@playwright/test"

async function load(page: import("@playwright/test").Page, story: string, width: number) {
  await page.setViewportSize({ width, height: 720 })
  await page.goto(`/iframe.html?id=${story}&viewMode=story`, { waitUntil: "load" })
  await page.waitForSelector(".session-surface-bar, .session-surface-deleted")
}

test("主编辑区 owner 在宽布局中呈现写入入口并可一键收回侧栏", async ({ page }) => {
  await load(page, "chat-session-surface--main-owner", 1000)
  await expect(page.getByText("当前界面拥有会话操作权")).toBeVisible()
  await expect(page.getByRole("button", { name: "收回侧栏" })).toBeVisible()
  await expect(page.locator("textarea.prompt-input")).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1000)
})

test("侧栏取得 owner token 后显示欢迎页和输入框，不再停留在初始化中", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 720 })
  await page.goto("/iframe.html?id=chat-session-surface--sidebar-owner&viewMode=story", { waitUntil: "load" })
  await expect(page.locator("textarea.prompt-input")).toBeVisible()
  await expect(page.getByText("初始化中...", { exact: true })).toHaveCount(0)
})

test("侧栏镜像态在 200px 下禁用全部写入口且按钮正常换行", async ({ page }) => {
  await load(page, "chat-session-surface--sidebar-mirror", 200)
  await expect(page.getByText(/实时镜像/)).toBeVisible()
  await expect(page.getByRole("button", { name: "前往主区" })).toBeVisible()
  await expect(page.getByRole("button", { name: "收回侧栏" })).toBeVisible()
  await expect(page.locator("textarea.prompt-input")).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(200)
})

test("打开中和删除终态使用明确状态且删除后不显示会话与输入区", async ({ page }) => {
  await load(page, "chat-session-surface--opening-main", 800)
  await expect(page.getByText("正在准备主编辑区…")).toBeVisible()
  await load(page, "chat-session-surface--deleted-main", 800)
  await expect(page.getByText("会话已删除", { exact: true })).toBeVisible()
  await expect(page.locator(".chat-messages-wrapper")).toBeHidden()
  await expect(page.locator(".chat-input")).toBeHidden()
})

test("普通切换等待 500ms 草稿 ACK，期间不提前清空输入或切换会话", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 720 })
  await page.goto("/iframe.html?id=chat-session-surface--draft-switch-barrier&viewMode=story", { waitUntil: "load" })
  const input = page.getByRole("textbox", { name: "会话草稿" })
  const state = page.locator('[data-ui="draft-switch-state"]')
  const draft = `中文草稿-${"字".repeat(2048)}`
  await expect(state).toHaveAttribute("data-active", "session:story-session-a")
  await input.fill(draft)
  await page.getByRole("button", { name: "切换到 B" }).click()

  await page.waitForTimeout(200)
  await expect(state).toHaveAttribute("data-status", "waiting")
  await expect(state).toHaveAttribute("data-active", "session:story-session-a")
  await expect(input).toHaveValue(draft)

  await expect(state).toHaveAttribute("data-status", "switched")
  await expect(state).toHaveAttribute("data-active", "session:story-session-b")
})

test("QA-005 实际输入组件恢复完整中文空格引用，后续输入不会拆断文件绑定", async ({ page }) => {
  await page.addInitScript(() => {
    const requests: unknown[] = []
    Object.assign(window, { 草稿验收请求: requests, acquireVsCodeApi: () => ({
      postMessage: (message: { type: string; key?: unknown; clientSeq?: number }) => {
        requests.push(message)
        // 按真实宿主协议确认草稿保存，避免未确认本地改动遮住后续快照。
        if (message.type === "sessionSurface.draft.update") queueMicrotask(() => window.dispatchEvent(new MessageEvent("message", { data: {
          type: "sessionSurface.draft.ack", key: message.key, clientSeq: message.clientSeq, revision: message.clientSeq,
        } })))
      }, getState: () => undefined, setState: () => {},
    }) })
  })
  await page.goto("/iframe.html?id=chat-session-surface--sidebar-owner&viewMode=story")
  const input = page.locator("textarea.prompt-input")
  await expect(input).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new MessageEvent("message", { data: { type: "connectionState", state: "connected" } })))
  const text = "请检查 @中文 目录/同名 文件.ts 梧桐962 🌲"
  const reference = "@中文 目录/同名 文件.ts"
  await page.evaluate(({ text, reference }) => window.dispatchEvent(new MessageEvent("message", { data: {
    type: "sessionSurface.draft.snapshot",
    draft: { schemaVersion: 1, key: { kind: "session", id: "story-session" }, revision: 2, updatedAt: 2, content: {
      boxId: "prompt:story-session", text, reviewComments: [], images: [], references: [reference], inputScrollTop: 0,
    } },
  } })), { text, reference })
  await expect(input).toHaveValue(text).catch(async (error) => {
    console.log("草稿回归宿主请求", await page.evaluate(() => (window as unknown as { 草稿验收请求: unknown[] }).草稿验收请求))
    throw error
  })
  await input.fill(`${text}，保留绑定。`)
  await expect.poll(() => page.evaluate(() => {
    const messages = (window as unknown as { 草稿验收请求: Array<{ type: string; content?: { references: string[]; text: string } }> }).草稿验收请求
    return messages.filter((message) => message.type === "sessionSurface.draft.update").at(-1)?.content
  })).toMatchObject({ text: `${text}，保留绑定。`, references: [reference] })
})
