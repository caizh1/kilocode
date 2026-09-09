import { test, expect, chromium, type Page, type Frame } from "@playwright/test"

const endpoint = process.env.CHIPMATE_APPEARANCE_CDP
test.skip(!endpoint, "需要显式指定隔离 VS Code 开发宿主的本地调试地址。")

async function command(page: Page, title: string) {
  await page.keyboard.press("F1")
  const input = page.locator(".quick-input-widget input")
  await input.waitFor({ state: "visible" })
  await input.fill(`>${title}`)
  await page.getByRole("option", { name: title }).first().click()
  await input.waitFor({ state: "hidden" })
}

async function find(page: Page, selector: string): Promise<Frame> {
  for (let attempt = 0; attempt < 200; attempt++) {
    for (const frame of page.frames()) {
      if (
        !(await frame
          .locator(selector)
          .count()
          .catch(() => 0))
      )
        continue
      const id = new URL(frame.url()).searchParams.get("id")
      if (id && (await page.locator(`iframe.webview[name="${id}"]`).isVisible())) return frame
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`没有找到真实插件页面：${selector}`)
}

test("真实设置保存同步，保留草稿和组件，并适配窄屏", async ({}, info) => {
  const browser = await chromium.connectOverCDP(endpoint!)
  try {
    const page = browser.contexts()[0]!.pages()[0]!
    page.setDefaultTimeout(15_000)

    // 构建后重启隔离宿主，确保首屏资源注入与 Webview 使用同一份源码。
    await Promise.all([page.waitForEvent("domcontentloaded"), command(page, "Developer: Reload Window")])
    await page.locator(".monaco-workbench").waitFor({ state: "visible" })
    // 只在测试准备阶段刷新以重新附着开发宿主的跨进程 iframe。
    await command(page, "Developer: Reload Webviews")
    const openSettings = page.getByRole("tab", { name: /ChipMate Settings/ })
    if (await openSettings.count()) await openSettings.last().click()
    else await command(page, "ChipMate: Settings")
    const settings = await find(page, '[data-ui="settings-frame"]')
    const resource = await page
      .locator('[role="tab"][aria-selected="true"]')
      .filter({ hasText: "ChipMate Settings" })
      .getAttribute("data-resource-name")
    const settingsTab = page.locator(`[role="tab"][data-resource-name="${resource}"]`)
    await page.setViewportSize({ width: 1488, height: 1056 })
    console.log("已连接真实设置页面")
    await settings.getByRole("tab", { name: "显示", exact: true }).click()
    const select = settings.locator('[aria-label="界面皮肤"]')
    const choose = async (skin: "原皮肤" | "未来风") => {
      await select.click()
      await settings.getByRole("option", { name: skin, exact: true }).click()
    }
    if ((await settings.locator("html").getAttribute("data-chipmate-skin")) !== "night-city") {
      await choose("未来风")
      await settings.getByRole("button", { name: "保存", exact: true }).click()
    }
    await expect(settings.locator("html")).toHaveAttribute("data-chipmate-skin", "night-city")
    await command(page, "ChipMate: Agent Manager")
    const manager = await find(page, ".am-layout")
    const managerResource = await page
      .locator('[role="tab"][aria-selected="true"]')
      .filter({ hasText: "Agent Manager" })
      .getAttribute("data-resource-name")
    const managerTab = page.locator(`[role="tab"][data-resource-name="${managerResource}"]`)
    console.log("已连接真实工作台")
    const session = manager.locator(".am-tab:not([data-terminal])").filter({ hasText: "新建会话" }).first()
    if (await session.count()) await session.click()
    const input = manager.locator("textarea").first()
    const text = "未来风回归验收：未发送的中文草稿。"
    await input.fill(text)
    const node = await input.elementHandle()
    const chat = await manager.locator(".chat-view").elementHandle()
    await settingsTab.click()
    await choose("原皮肤")
    await expect(settings.locator("html")).toHaveAttribute("data-chipmate-skin", "night-city")
    await settings.getByRole("button", { name: "放弃", exact: true }).click()
    await expect(select).toHaveText(/未来风/)
    for (const [skin, expected] of [
      ["原皮肤", "default"],
      ["未来风", "night-city"],
    ] as const) {
      await choose(skin)
      await settings.getByRole("button", { name: "保存", exact: true }).click()
      await expect(settings.locator("html")).toHaveAttribute("data-chipmate-skin", expected)
      await managerTab.click()
      await expect(manager.locator("html")).toHaveAttribute("data-chipmate-skin", expected)
      expect(await node!.evaluate((element) => element.isConnected)).toBe(true)
      expect(await chat!.evaluate((element) => element.isConnected)).toBe(true)
      await expect(input).toHaveValue(text)
      await settingsTab.click()
    }
    for (const [label, motion] of [
      ["关闭", "off"],
      ["柔和", "subtle"],
      ["沉浸", "immersive"],
    ] as const) {
      console.log(`验证动效设置：${label}`)
      await settings.locator('[data-slot="radio-group-item-label"]').filter({ hasText: label }).click()
      await expect(settings.getByRole("radio", { name: label, exact: true })).toBeChecked()
      if (await settings.getByRole("button", { name: "保存", exact: true }).count()) {
        await settings.getByRole("button", { name: "保存", exact: true }).click()
      }
      await expect(settings.locator("html")).toHaveAttribute("data-chipmate-motion", motion)
      await expect(settings.locator(".night-city-header button")).toHaveCount(6)
      expect(await settings.locator("body").evaluate((element) => element.scrollTop)).toBe(0)
      await expect(settings.locator(".night-city-header")).toBeInViewport()
      if (motion === "off") {
        expect(
          await settings
            .locator("#chipmate-appearance-header")
            .evaluate((element) => getComputedStyle(element, "::after").animationName),
        ).toBe("none")
      }
    }
    await page.screenshot({ path: info.outputPath("设置-宽屏.png"), scale: "css" })
    for (const width of [800, 720, 600, 420, 320]) {
      // 主编辑区前有 48 像素原生活动栏；其余侧栏应在测试准备时关闭。
      await page.setViewportSize({ width: width + 48, height: 900 })
      await expect.poll(() => settings.locator("html").evaluate((element) => element.clientWidth)).toBe(width)
      const geometry = await settings.locator("html").evaluate((element) => ({
        width: element.clientWidth,
        overflow: element.scrollWidth - element.clientWidth,
      }))
      expect(geometry.width).toBe(width)
      expect(geometry.overflow).toBeLessThanOrEqual(1)
      const buttons = await settings
        .locator(".night-city-header button")
        .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON()))
      for (let index = 1; index < buttons.length; index++) {
        expect(buttons[index]!.left).toBeGreaterThanOrEqual(buttons[index - 1]!.right)
      }
      await choose("原皮肤")
      await expect(settings.getByRole("button", { name: "保存", exact: true })).toBeInViewport()
      await settings.getByRole("button", { name: "放弃", exact: true }).click()
      await page.screenshot({ path: info.outputPath(`设置-${width}.png`), scale: "css" })
    }
    await page.setViewportSize({ width: 1488, height: 1056 })
    await managerTab.click()
    const dock = await manager.locator(".prompt-input-container").boundingBox()
    expect(dock!.y + dock!.height).toBeLessThanOrEqual(1056)
    await page.screenshot({ path: info.outputPath("工作台-宽屏.png"), scale: "css" })
    await command(page, "View: Move Editor into Right Group")
    await command(page, "ChipMate: Settings")
    await expect(page.locator(".editor-group-container")).toHaveCount(2)
    await expect(page.locator("iframe.webview:visible")).toHaveCount(2)
    await expect((await find(page, ".am-layout")).locator(".prompt-input")).toBeVisible()
    await page.screenshot({ path: info.outputPath("聊天与设置双栏.png"), scale: "css" })
    await command(page, "View: Join All Editor Groups")
  } finally {
    await browser.close()
  }
})
