import { expect, test, type Page } from "@playwright/test"

const STORY = "chat--qa-navigation-long-420"
const HEADER_STORY = "chat--task-header-with-todos"
const READONLY_HEADER_STORY = "chat--task-header-readonly-search"

async function load(page: Page, width = 420, theme = "dark-modern") {
  await page.setViewportSize({ width, height: 720 })
  const scheme = theme === "light-modern" || theme === "hc-light" ? "light" : "dark"
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" })
  const globals = `colorScheme:${scheme};theme:chipmate-vscode;vscodeTheme:${theme}`
  await page.goto(`/iframe.html?id=${STORY}&viewMode=story&globals=${globals}`, { waitUntil: "load" })
  await page.waitForSelector('[data-slot="conversation-navigator-trigger"]')
}

async function openInputs(page: Page) {
  await page.getByRole("button", { name: "对话导航", exact: true }).click()
  await expect(page.getByRole("tab", { name: "我的输入" })).toHaveAttribute("aria-selected", "true")
}

async function loadCompactHeader(page: Page, width: number, theme = "dark-modern") {
  await page.setViewportSize({ width, height: 720 })
  const scheme = theme === "light-modern" || theme === "hc-light" ? "light" : "dark"
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" })
  const globals = `colorScheme:${scheme};theme:chipmate-vscode;vscodeTheme:${theme}`
  await page.goto(`/iframe.html?id=${HEADER_STORY}&viewMode=story&globals=${globals}`, { waitUntil: "load" })
  await page.waitForSelector('[data-component="task-header"][data-qa-navigation-compact]')

  const expand = page.locator('[data-slot="task-header-expand"]')
  if ((await expand.getAttribute("aria-expanded")) === "true") await expand.click()
  await expect(page.locator('[data-component="task-header-graph"]')).toHaveCount(0)
}

async function conversationLayout(page: Page) {
  return page.evaluate(() => {
    const messages = document.querySelector<HTMLElement>(".chat-messages-wrapper")!.getBoundingClientRect()
    const input = document.querySelector<HTMLElement>(".chat-input")!.getBoundingClientRect()
    return {
      messagesTop: messages.top,
      messagesHeight: messages.height,
      inputTop: input.top,
      inputHeight: input.height,
    }
  })
}

test("对话导航以不挤占会话面积的锚定浮层展开", async ({ page }) => {
  for (const width of [380, 420]) {
    await load(page, width)
    const before = await conversationLayout(page)
    await openInputs(page)

    const geometry = await page.locator(".conversation-navigator-popover").evaluate((panel) => {
      const trigger = document.querySelector<HTMLElement>('[data-slot="conversation-navigator-trigger"]')!
      const panelBox = panel.getBoundingClientRect()
      const triggerBox = trigger.getBoundingClientRect()
      const list = panel.querySelector<HTMLElement>('[data-slot="conversation-navigator-list"]')!
      return {
        left: panelBox.left,
        right: panelBox.right,
        top: panelBox.top,
        width: panelBox.width,
        height: panelBox.height,
        triggerBottom: triggerBox.bottom,
        triggerRight: triggerBox.right,
        viewportWidth: document.documentElement.clientWidth,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        listScrolls: list.scrollHeight > list.clientHeight,
      }
    })
    const after = await conversationLayout(page)

    expect(geometry.width, `${width}px 浮层超过 360px`).toBeLessThanOrEqual(360)
    expect(geometry.height, `${width}px 浮层超过 220px`).toBeLessThanOrEqual(220)
    expect(geometry.left).toBeGreaterThanOrEqual(7)
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth - 7)
    expect(geometry.top).toBeGreaterThanOrEqual(geometry.triggerBottom)
    const rightAligned = Math.abs(geometry.right - geometry.triggerRight) <= 8
    const clampedToViewport = Math.abs(geometry.right - (geometry.viewportWidth - 12)) <= 4
    expect(
      rightAligned || clampedToViewport,
      `${width}px 浮层既未右侧锚定，也未执行视口避让：${JSON.stringify(geometry)}`,
    ).toBe(true)
    expect(geometry.overflow).toBeLessThanOrEqual(0)
    expect(geometry.listScrolls).toBe(true)
    expect(Math.abs(after.messagesTop - before.messagesTop)).toBeLessThanOrEqual(1)
    expect(Math.abs(after.messagesHeight - before.messagesHeight)).toBeLessThanOrEqual(1)
    expect(Math.abs(after.inputTop - before.inputTop)).toBeLessThanOrEqual(1)
    expect(Math.abs(after.inputHeight - before.inputHeight)).toBeLessThanOrEqual(1)
  }
})

test("普通 QA 常驻导航保持紧凑双行并保留全部入口", async ({ page }) => {
  for (const [width, theme] of [
    [380, "dark-modern"],
    [420, "dark-modern"],
    [420, "light-modern"],
    [420, "hc-black"],
  ] as const) {
    await loadCompactHeader(page, width, theme)

    const layout = await page.locator('[data-component="task-header"]').evaluate((header) => {
      const todos = document.querySelector<HTMLElement>(
        '[data-component="task-header-todos"][data-qa-navigation-compact]',
      )!
      const title = header.querySelector<HTMLElement>('[data-slot="task-header-title-label"]')!
      const navigation = header.querySelector<HTMLElement>('[data-slot="conversation-navigator-trigger"]')!
      const top = header.getBoundingClientRect()
      const bottom = todos.getBoundingClientRect()
      const titleStyle = getComputedStyle(title)
      return {
        headerHeight: top.height,
        totalHeight: bottom.bottom - top.top,
        separated: top.bottom <= bottom.top,
        titleSingleLine: titleStyle.whiteSpace === "nowrap",
        titleClipped: title.scrollWidth > title.clientWidth,
        navigationHeight: navigation.getBoundingClientRect().height,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })

    expect(layout.headerHeight, `${width}px / ${theme} 标题行过高`).toBeLessThanOrEqual(32)
    expect(layout.totalHeight, `${width}px / ${theme} 常驻区超过 58px`).toBeLessThanOrEqual(58)
    expect(layout.separated).toBe(true)
    expect(layout.titleSingleLine).toBe(true)
    expect(layout.titleClipped).toBe(true)
    expect(layout.navigationHeight).toBeGreaterThanOrEqual(24)
    expect(layout.overflow, `${width}px / ${theme} 出现横向溢出`).toBeLessThanOrEqual(0)
  }

  await loadCompactHeader(page, 420)
  const navigation = page.locator('[data-slot="conversation-navigator-trigger"]')
  await navigation.focus()
  await expect(navigation).toBeFocused()
  await navigation.click()
  await expect(page.locator('[data-component="conversation-navigator"]')).toBeVisible()
  await navigation.click()
  await expect(page.locator('[data-component="conversation-navigator"]')).toHaveCount(0)

  const todos = page.locator('[data-slot="task-header-todos-trigger"]')
  await todos.focus()
  await expect(todos).toBeFocused()
  await todos.click()
  await expect(page.locator('[data-slot="task-header-todos-list"]')).toBeVisible()
  await todos.click()
  await expect(page.locator('[data-slot="task-header-todos-list"]')).toHaveCount(0)
})

test("紧凑导航在极窄及 150% 缩放等效宽度下安全换行且不溢出", async ({ page }) => {
  for (const width of [200, 280, 300, 420]) {
    await loadCompactHeader(page, width)
    const bounds = await page.evaluate(() => {
      const header = document.querySelector<HTMLElement>('[data-component="task-header"]')!
      const todos = document.querySelector<HTMLElement>('[data-component="task-header-todos"]')!
      const navigation = document.querySelector<HTMLElement>('[data-slot="conversation-navigator-trigger"]')!
      return {
        headerLeft: header.getBoundingClientRect().left,
        headerRight: header.getBoundingClientRect().right,
        todosLeft: todos.getBoundingClientRect().left,
        todosRight: todos.getBoundingClientRect().right,
        navigationRight: navigation.getBoundingClientRect().right,
        viewport: document.documentElement.clientWidth,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })

    expect(bounds.headerLeft).toBeGreaterThanOrEqual(0)
    expect(bounds.todosLeft).toBeGreaterThanOrEqual(0)
    expect(bounds.headerRight).toBeLessThanOrEqual(bounds.viewport)
    expect(bounds.todosRight).toBeLessThanOrEqual(bounds.viewport)
    expect(bounds.navigationRight).toBeLessThanOrEqual(bounds.viewport)
    expect(bounds.overflow, `${width}px 出现横向溢出`).toBeLessThanOrEqual(0)
  }
})

test("只读会话保留原有全文搜索且不挂载导航浮层", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 720 })
  await page.goto(`/iframe.html?id=${READONLY_HEADER_STORY}&viewMode=story`, { waitUntil: "load" })

  const search = page.getByRole("button", { name: "搜索聊天" })
  await expect(search).toBeVisible()
  await expect(page.locator('[data-slot="conversation-navigator-trigger"]')).toHaveCount(0)
  await search.click()
  await expect(page.getByRole("textbox", { name: "搜索聊天" })).toBeFocused()
  await expect(page.locator('[data-component="conversation-navigator"]')).toHaveCount(0)
})

test("导航浮层按触发器、外部点击、收起按钮和 Escape 恢复正确焦点", async ({ page }) => {
  await load(page)
  const trigger = page.getByRole("button", { name: "对话导航", exact: true })
  const prompt = page.locator("textarea.prompt-input")

  await openInputs(page)
  await trigger.click()
  await expect(page.locator('[data-component="conversation-navigator"]')).toHaveCount(0)
  await expect(trigger).toBeFocused()

  await openInputs(page)
  await page.locator('[data-slot="conversation-navigator-collapse"]').click()
  await expect(page.locator('[data-component="conversation-navigator"]')).toHaveCount(0)
  await expect(prompt).toBeFocused()

  await openInputs(page)
  const timeline = page.getByRole("button", { name: "Toggle timeline" })
  await timeline.click()
  await expect(page.locator('[data-component="conversation-navigator"]')).toHaveCount(0)
  await expect(timeline).toBeFocused()

  await openInputs(page)
  const filter = page.getByRole("textbox", { name: "筛选我的输入…" })
  await filter.focus()
  await filter.press("Escape")
  await expect(page.locator('[data-component="conversation-navigator"]')).toHaveCount(0)
  await expect(prompt).toBeFocused()
})

test("重新打开导航保留真实选中项、恢复远距离位置并在切换会话后重置", async ({ page }) => {
  await load(page)
  await openInputs(page)
  await expect(page.getByText("160 条输入")).toBeVisible({ timeout: 5_000 })
  await expect(page.getByText("正在载入更早输入…")).toHaveCount(0)

  const filter = page.getByRole("textbox", { name: "筛选我的输入…" })
  await filter.fill("第 159 个历史问题")
  await page.locator('[data-slot="conversation-navigator-entry"]').filter({ hasText: "第 159 个历史问题" }).click()
  await expect(page.locator('[data-component="conversation-navigator"]')).toHaveCount(0)

  await openInputs(page)
  const selected = page.locator('[data-slot="conversation-navigator-entry"][data-selected]')
  await expect(selected).toHaveCount(1)
  await expect(selected).toContainText("第 159 个历史问题")
  await expect(selected).toHaveAttribute("aria-current", "location")
  const latest = page.locator('[data-slot="conversation-navigator-entry"]').filter({ hasText: "所有用户输入都要收录" })
  await expect(latest).toBeVisible()
  await expect(latest).not.toHaveAttribute("data-selected", "")

  await page.getByRole("textbox", { name: "筛选我的输入…" }).fill("第 1 个历史问题")
  await page.locator('[data-slot="conversation-navigator-entry"]').filter({ hasText: "第 1 个历史问题" }).click()
  await openInputs(page)
  const distant = page
    .locator('[data-slot="conversation-navigator-entry"][data-selected]')
    .filter({ hasText: "第 1 个历史问题" })
  await expect(distant).toBeVisible()
  await expect(distant).toHaveAttribute("aria-current", "location")

  await page.evaluate(() => window.dispatchEvent(new Event("qaNavigationSwitchSession")))
  await expect(page.locator('[data-component="conversation-navigator"]')).toHaveCount(0)
  await openInputs(page)
  const reset = page.locator('[data-slot="conversation-navigator-entry"][data-selected]')
  await expect(reset).toHaveCount(1)
  await expect(reset).toContainText("所有用户输入都要收录")
})

test("我的输入自动加载完整历史、中文筛选并完成 20/20 稳定 ID 居中跳转", async ({ page }) => {
  await load(page)
  await openInputs(page)

  await expect(page.getByText("正在载入更早输入…")).toBeVisible()
  await expect(page.getByText("160 条输入")).toBeVisible({ timeout: 5_000 })
  await expect(page.getByText("正在载入更早输入…")).toHaveCount(0)

  const targets = Array.from({ length: 20 }, (_, index) => 1 + index * 8)
  for (const number of targets) {
    const filter = page.getByRole("textbox", { name: "筛选我的输入…" })
    await filter.fill(`第 ${number} 个历史问题`)
    const entry = page
      .locator('[data-slot="conversation-navigator-entry"]')
      .filter({ hasText: `第 ${number} 个历史问题` })
    await expect(entry).toHaveCount(1)
    await entry.click()

    await expect(page.locator('[data-component="conversation-navigator"]')).toHaveCount(0)
    const target = page.locator(`[data-message="navigation-user-${number}"]`)
    await expect(target).toHaveAttribute("data-navigation-active", "")
    await expect(target).toBeFocused()
    await expect
      .poll(
        () =>
          target.evaluate((element) => {
            const box = element.getBoundingClientRect()
            const scroller = element.closest<HTMLElement>(".message-list")!
            const list = scroller.getBoundingClientRect()
            const targetCenter = box.top + box.height / 2
            const listCenter = list.top + list.height / 2
            const distance = Math.abs(targetCenter - listCenter)
            const limitedByStart = scroller.scrollTop <= 1 && targetCenter < listCenter
            const limitedByEnd =
              scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 1 && targetCenter > listCenter
            return distance < 120 || limitedByStart || limitedByEnd
          }),
        { message: `第 ${number} 个历史问题既未居中，也未落在滚动边界允许的最近位置` },
      )
      .toBe(true)

    if (number !== targets.at(-1)) await openInputs(page)
  }

  const before = await page.locator(".message-list").evaluate((element) => element.scrollTop)
  await page.evaluate(() => window.dispatchEvent(new Event("qaNavigationStreamTick")))
  await page.waitForTimeout(350)
  const after = await page.locator(".message-list").evaluate((element) => element.scrollTop)
  expect(Math.abs(after - before)).toBeLessThan(2)
})

test("双页签、全文搜索回归、Command 入口和 Escape 焦点恢复", async ({ page }) => {
  await load(page)

  await page.evaluate(() => window.dispatchEvent(new Event("focusTranscriptSearch")))
  const searchTab = page.getByRole("tab", { name: "全文搜索" })
  await expect(searchTab).toHaveAttribute("aria-selected", "true")
  const search = page.getByRole("textbox", { name: "搜索聊天" })
  await expect(search).toBeFocused()
  await page.evaluate(() => window.dispatchEvent(new Event("focusTranscriptSearch")))
  await expect(page.locator('[data-component="conversation-navigator"]')).toHaveCount(0)
  await page.evaluate(() => window.dispatchEvent(new Event("focusTranscriptSearch")))
  await expect(search).toBeFocused()
  await search.fill("第 160 个问题")
  await expect(page.locator('[data-slot="transcript-search-counter"]')).toHaveText("1 / 1")
  await page.getByRole("button", { name: "下一个匹配项" }).click()
  await expect(page.locator("[data-search-active]")).toHaveCount(1)

  await page.getByRole("tab", { name: "我的输入" }).click()
  await expect(page.getByRole("tab", { name: "我的输入" })).toHaveAttribute("aria-selected", "true")
  await page.getByRole("textbox", { name: "筛选我的输入…" }).press("Escape")
  await expect(page.locator('[data-component="conversation-navigator"]')).toHaveCount(0)
  await expect(page.locator("textarea.prompt-input")).toBeFocused()
})

test("420/200、浅色、高对比和减少动效均无横向溢出", async ({ page }) => {
  for (const [width, theme] of [
    [420, "dark-modern"],
    [200, "dark-modern"],
    [280, "dark-modern"],
    [300, "dark-modern"],
    [420, "light-modern"],
    [420, "hc-black"],
  ] as const) {
    await load(page, width, theme)
    await openInputs(page)
    await expect(page.locator('[data-component="conversation-navigator"]')).toBeVisible()
    const layout = await page.locator(".conversation-navigator-popover").evaluate((panel) => {
      const box = panel.getBoundingClientRect()
      return {
        left: box.left,
        right: box.right,
        height: box.height,
        viewport: document.documentElement.clientWidth,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })
    expect(layout.left, `${width}px / ${theme} 浮层越过左侧安全边距`).toBeGreaterThanOrEqual(7)
    expect(layout.right, `${width}px / ${theme} 浮层越过右侧安全边距：${JSON.stringify(layout)}`).toBeLessThanOrEqual(
      layout.viewport - 7,
    )
    expect(layout.height, `${width}px / ${theme} 浮层超过 220px`).toBeLessThanOrEqual(220)
    expect(layout.overflow, `${width}px / ${theme} 出现横向溢出`).toBeLessThanOrEqual(0)
    const motion = await page
      .locator(".vscode-session-turn[data-navigation-active] .vscode-session-turn-user")
      .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).animationName))
    expect(motion.every((value) => value === "none")).toBe(true)
  }
})
