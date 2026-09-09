import { expect, test, type Page } from "@playwright/test"

const STORY = "deepseek-harness-conversation--long-conversation-420"
const WINDOWS_STORY = "deepseek-harness-conversation--windows-standard-420"
const PROVIDER_REQUIRED_STORY = "deepseek-harness-conversation--provider-selection-required-420"
const NO_PROVIDER_STORY = "deepseek-harness-conversation--no-provider-420"
const PROVIDER_CONFIRM_STORY = "deepseek-harness-conversation--provider-switch-confirmation-420"

async function load(page: Page, width = 420, theme = "dark-modern") {
  await page.setViewportSize({ width, height: 720 })
  const scheme = theme === "light-modern" || theme === "hc-light" ? "light" : "dark"
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" })
  await page.goto(
    `/iframe.html?id=${STORY}&viewMode=story&globals=colorScheme:${scheme};theme:chipmate-vscode;vscodeTheme:${theme}`,
    { waitUntil: "load" },
  )
  await page.waitForSelector(".dsh-scroll-viewport", { state: "attached" })
}

async function loadStory(page: Page, story: string, width = 420) {
  await page.setViewportSize({ width, height: 720 })
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" })
  await page.goto(
    `/iframe.html?id=${story}&viewMode=story&globals=colorScheme:dark;theme:chipmate-vscode;vscodeTheme:dark-modern`,
    { waitUntil: "load" },
  )
  await page.waitForSelector(".dsh-scroll-viewport", { state: "attached" })
}

async function distanceFromBottom(page: Page) {
  return page
    .locator(".dsh-scroll-viewport")
    .evaluate((element) => Math.max(0, element.scrollHeight - element.clientHeight - element.scrollTop))
}

test("ChipMate DeepSeek Harness 长回答可滚动且不会被 Composer 裁剪", async ({ page }) => {
  await load(page)
  const scroll = page.locator(".dsh-scroll-viewport")
  const composer = page.locator("[data-ui='qa-composer']")

  const metrics = await scroll.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }))
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight)
  await expect(composer).toBeVisible()
  await expect(page.getByRole("log")).toHaveCount(1)
  await expect(page.locator(".dsh-scroll-viewport [aria-live]")).toHaveCount(0)

  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await expect.poll(() => distanceFromBottom(page)).toBeLessThanOrEqual(2)
  await expect(page.getByText("最后一条可见回答。", { exact: true })).toBeVisible()

  const bounds = await page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>(".dsh-scroll-viewport")!
    const dock = document.querySelector<HTMLElement>("[data-ui='qa-composer']")!
    return {
      scrollBottom: viewport.getBoundingClientRect().bottom,
      composerTop: dock.getBoundingClientRect().top,
    }
  })
  expect(bounds.scrollBottom).toBeLessThanOrEqual(bounds.composerTop + 1)
})

test("顶部任务头只显示当前官方会话标题", async ({ page }) => {
  await load(page)
  const header = page.locator("[data-deepseek-harness-header]")
  await expect(header).toBeVisible()
  const title = header.locator('[data-slot="task-header-title-label"]')
  await expect(title).toHaveText("官方会话：platform/driver gcc适配与单测代码审查")
  await expect(header.locator('[data-slot="task-header-stats"]')).toHaveCount(0)
  await expect(header.getByRole("button")).toHaveCount(0)

  await page.evaluate(() => window.dispatchEvent(new CustomEvent("chipmate:dsh-story-update-title")))
  await expect(title).toHaveText("官方会话：标题已更新")

  await page.evaluate(() => window.dispatchEvent(new CustomEvent("chipmate:dsh-story-mismatch-title")))
  await expect(title).toHaveText("正在打开官方会话…")
  await expect(header).not.toContainText("其他官方会话")
})

test("思考使用普通 QA 折叠组件且不暴露 think 标签", async ({ page }) => {
  await load(page)
  const reasoning = page.locator('[data-component="reasoning-part"]')
  await expect(reasoning).toHaveCount(2)
  await expect(page.locator("body")).not.toContainText("<think>")
  await expect(page.locator("body")).not.toContainText("branchUnavailable")
  await expect(page.locator("body")).not.toContainText("seq: 18")
  await expect(page.locator(".dsh-event")).toHaveCount(0)
  await expect(page.locator(".dsh-turn-meta")).toContainText("31.5 tokens/s")
  await expect(page.locator("[data-official-tool-view='terminal']")).toHaveCount(1)
  await expect(page.locator("[data-official-tool-view='diff']")).toHaveCount(1)
  await expect(page.locator("[data-official-tool-view='search']")).toHaveCount(1)
  await expect(page.locator("[data-official-tool-view='read']")).toHaveCount(1)
  await expect(page.locator("[data-official-tool-view='web']")).toHaveCount(1)
  await expect(reasoning.first()).toContainText("先确认约束，再逐项检查证据。")
  await expect(reasoning.nth(1)).toContainText("这是官方 reasoning 块")

  const trigger = reasoning.first().locator('[data-slot="collapsible-trigger"]')
  await trigger.focus()
  await expect(trigger).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await expect(reasoning.first()).not.toContainText("先确认约束，再逐项检查证据。")
})

test("DSH 思考强度使用官方 Off、High、Max 并支持键盘选择", async ({ page }) => {
  await load(page)
  const trigger = page.getByRole("button", { name: "推理强度：High" })
  await expect(trigger).toBeVisible()
  await trigger.click()
  await expect(page.getByRole("option")).toHaveText(["Off", "High", "Max"])
  await expect(page.getByRole("option", { name: "High" })).toBeFocused()
  await page.keyboard.press("End")
  await expect(page.getByRole("option", { name: "Max" })).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("button", { name: "推理强度：Max" })).toBeVisible()

  await page.setViewportSize({ width: 200, height: 720 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(200)
})

test("流式输出在底部自动跟随，用户上滑后暂停并可恢复", async ({ page }) => {
  await load(page)
  const scroll = page.locator(".dsh-scroll-viewport")

  await scroll.evaluate((element) => {
    element.scrollTop = Math.max(1, element.scrollHeight - element.clientHeight - 220)
    element.dispatchEvent(new Event("scroll", { bubbles: true }))
  })
  const paused = await distanceFromBottom(page)
  await expect(page.getByRole("button", { name: "回到底部" })).toBeVisible()

  await page.evaluate(() => window.dispatchEvent(new CustomEvent("chipmate:dsh-story-append")))
  await expect(page.getByText(/新增流式内容/)).toBeAttached()
  await expect.poll(() => distanceFromBottom(page)).toBeGreaterThanOrEqual(paused - 2)

  await page.getByRole("button", { name: "回到底部" }).click()
  await expect.poll(() => distanceFromBottom(page)).toBeLessThanOrEqual(2)

  await scroll.evaluate((element) => {
    element.scrollTop = Math.max(1, element.scrollHeight - element.clientHeight - 180)
    element.dispatchEvent(new Event("scroll", { bubbles: true }))
  })
  await page.locator("[data-ui='qa-composer'] textarea").fill("继续")
  await page.getByRole("button", { name: "发送", exact: true }).click()
  await expect.poll(() => distanceFromBottom(page)).toBeLessThanOrEqual(2)
})

test("窄栏和 VS Code 主题下保持单一纵向滚动区", async ({ page }) => {
  for (const theme of ["dark-modern", "light-modern", "hc-black", "hc-light"]) {
    await load(page, 200, theme)
    const scroll = page.locator(".dsh-scroll-viewport")
    await expect(scroll).toBeVisible()
    expect(await scroll.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true)
    await expect(page.locator("[data-ui='qa-composer']")).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(200)
  }
})

test("Windows 平台展示官方标准模式且 Runtime Context 保持折叠", async ({ page }) => {
  await loadStory(page, WINDOWS_STORY)
  await expect(page.locator(".dsh-inline-status")).toContainText("标准模式 · 已就绪")
  const context = page.locator(".dsh-context-disclosure")
  await expect(context).toHaveCount(1)
  await expect(context.locator("summary")).toContainText("官方运行上下文")
  await expect(context).not.toHaveAttribute("open", "")
})

test("只显示已配置直连凭据的 Provider且隐藏项无法搜索", async ({ page }) => {
  await loadStory(page, PROVIDER_REQUIRED_STORY)
  await expect(page.locator(".dsh-provider-selection-status")).toContainText("请选择已配置直连 NewAPI 凭据的 Provider")
  await page.getByRole("button", { name: /ChipMate DeepSeek Harness 模型/ }).click()
  await expect(page.getByRole("treeitem", { name: /DeepSeek Gateway/ })).toHaveCount(0)
  await expect(page.getByText("内部 Gateway", { exact: true })).toHaveCount(0)
  await expect(page.getByRole("treeitem", { name: /DeepSeek Host Only/ })).toBeVisible()
  await page.getByRole("combobox").fill("DeepSeek Gateway")
  await expect(page.getByRole("treeitem", { name: /DeepSeek Gateway/ })).toHaveCount(0)
})

test("无可用 Provider时显示紧凑空状态并在配置后进入列表", async ({ page }) => {
  await loadStory(page, NO_PROVIDER_STORY)
  const status = page.locator(".dsh-provider-selection-status")
  await expect(status).toContainText("未找到已配置直连 NewAPI 凭据的 Provider")
  await expect(status).not.toContainText("内部 Gateway")
  await expect(page.getByRole("button", { name: "打开 Provider 设置" })).toBeVisible()
  await expect(page.locator("[data-ui='qa-composer'] textarea")).toBeDisabled()
  await expect(page.getByRole("treeitem", { name: /DeepSeek Gateway/ })).toHaveCount(0)

  await page.evaluate(() => window.dispatchEvent(new CustomEvent("chipmate:dsh-story-configure-provider")))
  await page.getByRole("button", { name: /ChipMate DeepSeek Harness 模型/ }).click()
  await expect(page.getByRole("treeitem", { name: /DeepSeek Host Only/ })).toBeVisible()
  await expect(page.getByRole("treeitem", { name: /DeepSeek Gateway/ })).toHaveCount(0)

  await page.evaluate(() => window.dispatchEvent(new CustomEvent("chipmate:dsh-story-invalidate-provider")))
  await expect(page.getByRole("treeitem", { name: /DeepSeek Host Only/ })).toHaveCount(0)
  await expect(status).toContainText("未找到已配置直连 NewAPI 凭据的 Provider")
})

test("活动任务跨 Provider 切换显示模态确认，Escape 安全取消", async ({ page }) => {
  await loadStory(page, PROVIDER_CONFIRM_STORY)
  const dialog = page.getByRole("alertdialog")
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText("切换官方 DSH Provider")
  await expect(page.getByRole("button", { name: "取消" })).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(dialog).toBeVisible()
})
