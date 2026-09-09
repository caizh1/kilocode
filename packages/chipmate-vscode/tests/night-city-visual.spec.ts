import { test, expect } from "@playwright/test"

for (const width of [320, 420]) {
  test(`侧栏不重复导航且换肤保留输入 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1056 })
    await page.goto("/iframe.html?id=appearance-nightcity--sidebar-chat&globals=skin:night-city")
    const header = page.locator("#chipmate-appearance-header")
    await expect(header).toBeHidden()
    await expect(page.getByRole("navigation", { name: "ChipMate 导航" })).toHaveCount(0)
    expect(await header.evaluate((element) => element.getBoundingClientRect().height)).toBe(0)
    const input = page.locator(".prompt-input")
    await input.fill("导航修复草稿")
    const node = await input.elementHandle()
    for (const skin of ["default", "night-city"]) {
      await page.evaluate(
        (skin) =>
          window.dispatchEvent(
            new MessageEvent("message", {
              data: { type: "appearanceChanged", appearance: { skin, motion: "immersive" } },
            }),
          ),
        skin,
      )
      await expect(header).toBeHidden()
      await expect(input).toHaveValue("导航修复草稿")
      expect(await node!.evaluate((element) => element.isConnected)).toBe(true)
    }
    await page.goto("/iframe.html?id=appearance-nightcity--reasoning-chat&globals=skin:night-city")
    await expect(page.getByRole("navigation", { name: "ChipMate 导航" })).toBeVisible()
  })
}

for (const width of [320, 420, 1488]) {
  test(`聊天布局、焦点与动效 ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1056 })
    await page.goto("/iframe.html?id=appearance-nightcity--chat&globals=skin:night-city")
    await expect(page.locator(".night-city-message-identity").first()).toBeVisible()
    expect(await page.locator("html").evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1)
    await expect(page.locator(".prompt-input-container")).toBeInViewport()
    const buttons = page.locator(".night-city-header button")
    await buttons.first().focus()
    expect(await buttons.first().evaluate((e) => getComputedStyle(e).outlineStyle)).toBe("solid")
    const header = page.locator("#chipmate-appearance-header")
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.evaluate(() => (document.body.dataset.vscodeThemeId = "验收主题"))
    expect(await header.evaluate((e) => getComputedStyle(e, "::after").animationName)).toBe("night-city-scan")
    const first = await header.evaluate((e) => getComputedStyle(e, "::after").backgroundPosition)
    await expect.poll(() => header.evaluate((e) => getComputedStyle(e, "::after").backgroundPosition)).not.toBe(first)
    await page.evaluate(() => document.body.classList.add("vscode-reduce-motion"))
    expect(await header.evaluate((e) => getComputedStyle(e, "::after").animationName)).toBe("none")
    await page.evaluate(() => document.body.classList.remove("vscode-reduce-motion"))
    await page.screenshot({ path: info.outputPath(`聊天-${width}.png`) })
    await page.evaluate(() =>
      window.dispatchEvent(new MessageEvent("message", { data: { type: "appearanceVisibility", visible: false } })),
    )
    expect(await header.evaluate((e) => getComputedStyle(e, "::after").animationName)).toBe("none")
    await page.evaluate(() =>
      window.dispatchEvent(new MessageEvent("message", { data: { type: "appearanceVisibility", visible: true } })),
    )
    expect(await header.evaluate((e) => getComputedStyle(e, "::after").animationPlayState)).toBe("running")
    // 保留同一个真实组件节点，验证外观消息不重建正文。
    const message = await page.locator(".vscode-session-turn").first().elementHandle()
    await page.evaluate(() => {
      document.body.classList.add("vscode-light")
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "appearanceChanged", appearance: { skin: "default", motion: "off" } },
        }),
      )
    })
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light")
    await expect(page.locator(".night-city-message-identity").first()).toBeHidden()
    expect(await message!.evaluate((e) => e.isConnected)).toBe(true)
  })
}

for (const story of [
  "agentmanager--full-screen-diff-with-changes",
  "agentmanager--diff-panel-with-diffs",
  "marketplace--mixed-list-with-items",
  "composite-webview--bash-with-permission",
  "chat--question-dock-single",
]) {
  test(`共享页面保留业务内容：${story}`, async ({ page }, info) => {
    await page.goto(`/iframe.html?id=${story}&globals=skin:night-city`)
    await expect(page.locator("#storybook-root")).toBeVisible()
    await expect(page.locator("html")).toHaveAttribute("data-chipmate-skin", "night-city")
    expect(await page.locator("html").evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: info.outputPath(`${story}.png`) })
  })
}

test("忙碌会话中仅保存外观不触发中断确认或模型配置更新", async ({ page }) => {
  await page.addInitScript(() => {
    const messages: unknown[] = []
    Object.assign(window, {
      appearanceRequests: messages,
      acquireVsCodeApi: () => ({
        postMessage: (message: unknown) => messages.push(message),
        getState: () => undefined,
        setState: () => {},
      }),
    })
  })
  await page.goto("/iframe.html?id=appearance-nightcity--busy-settings&globals=skin:night-city")
  await expect(page.locator(".settings-shell")).toBeVisible()
  await page.evaluate(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "configLoaded",
          config: {},
          features: { indexing: false, sandboxControls: false },
          settings: { "appearance.skin": "night-city", "appearance.motion": "immersive" },
        },
      }),
    ),
  )
  await page.locator('[aria-label="界面皮肤"]').click()
  await page.getByRole("option", { name: "原皮肤", exact: true }).click()
  await page.getByRole("button", { name: "保存", exact: true }).click()
  await expect(page.getByText("一个会话正在运行，将被中断", { exact: true })).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              appearanceRequests: { type: string }[]
            }
          ).appearanceRequests.filter((message) => message.type === "updateAppearance").length,
      ),
    )
    .toBe(1)
  const requests = await page.evaluate(() =>
    (
      window as unknown as {
        appearanceRequests: { type: string }[]
      }
    ).appearanceRequests.map((message) => message.type),
  )
  expect(requests).not.toContain("updateConfig")
  expect(requests).not.toContain("updateSetting")
})

test("静态历史不逐条测量高度，后续展开收起仍保持正确", async ({ page }) => {
  await page.addInitScript(() => {
    const read = Element.prototype.getBoundingClientRect
    Object.assign(window, { historyMeasurements: 0 })
    Element.prototype.getBoundingClientRect = function () {
      if (this.parentElement?.getAttribute("data-slot") === "night-city-static-expansion") {
        const state = window as unknown as { historyMeasurements: number }
        state.historyMeasurements += 1
      }
      return read.call(this)
    }
  })
  await page.goto("/iframe.html?id=appearance-nightcity--static-expansion&globals=skin:night-city")
  const box = page.locator('[data-slot="night-city-static-expansion"]')
  await expect(box).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { historyMeasurements: number }).historyMeasurements)).toBe(0)
  const height = (await box.boundingBox())!.height
  await page.getByRole("button", { name: "增加正文" }).click()
  await expect.poll(async () => (await box.boundingBox())!.height).toBeGreaterThan(height)
  await page.getByRole("button", { name: "切换展开" }).click()
  await expect.poll(async () => (await box.boundingBox())!.height).toBeLessThan(1)
  await page.getByRole("button", { name: "切换展开" }).click()
  await expect.poll(async () => (await box.boundingBox())!.height).toBeGreaterThan(height)
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.getByRole("button", { name: "切换展开" }).click()
  await expect.poll(async () => (await box.boundingBox())!.height).toBeLessThan(1)
})

test("长会话基准保持全部数据且只挂载可见行", async ({ page }) => {
  await page.goto("/iframe.html?id=performance-lowend--long-history&globals=skin:night-city")
  const rows = page.locator(".message-list-turns")
  await expect(rows).toHaveAttribute("data-loaded-messages", "1000")
  await expect(rows).toHaveAttribute("data-row-count", "1500")
  expect(await page.locator(".message-list").evaluate((element) => element.clientHeight)).toBeLessThan(1056)
  await expect
    .poll(() => rows.evaluate((element) => element.firstElementChild?.childElementCount ?? 0))
    .toBeLessThan(100)
  await page.getByRole("button", { name: "历史记录", exact: true }).click()
  await expect(page.locator('[data-ui="low-end-history-screen"]')).toBeVisible()
  await page.locator(".history-view-header button").first().click()
  await expect(rows).toHaveAttribute("data-loaded-messages", "1000")
  await expect
    .poll(() => rows.evaluate((element) => element.firstElementChild?.childElementCount ?? 0))
    .toBeLessThan(100)
})

for (const width of [320, 420, 600, 720, 800, 1488]) {
  test(`未来风紧凑输入比例与真实容器断点 ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1056 })
    await page.goto("/iframe.html?id=appearance-nightcity--reasoning-chat&globals=skin:night-city")
    const input = page.locator(".prompt-input")
    await expect(input).toBeVisible()
    await input.fill("")
    const composer = page.locator(".prompt-input-container")
    const height = (await composer.boundingBox())!.height
    expect(height).toBeLessThanOrEqual(width >= 720 ? 165 : 205)
    await expect(page.getByRole("button", { name: "发送", exact: true })).toBeInViewport()
    expect(await composer.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1)
    await expect(page.locator('[data-ui="qa-composer-selectors"] .prompt-selector-trigger:visible')).toHaveCount(3)
    const context = page.getByRole("button", { name: "上下文引用", exact: true })
    await expect(context).toBeVisible()
    await expect(context.locator(".night-city-context-count")).toHaveCount(0)
    await page.screenshot({ path: info.outputPath(`比例-${width}.png`) })
    // 受控旧布局必须触发同一高度门禁，不能通过修改基准掩盖回归。
    await composer.evaluate((e) => e.style.setProperty("min-height", "300px", "important"))
    expect((await composer.boundingBox())!.height).toBeGreaterThan(width >= 720 ? 165 : 205)
  })
}

test("原版首屏及宿主主题变化不自动启用未来风", async ({ page }) => {
  await page.goto("/iframe.html?id=chat--question-dock-single&globals=skin:default")
  await expect(page.locator("html")).toHaveAttribute("data-chipmate-skin", "default")
  await page.evaluate(() => {
    document.body.classList.add("vscode-light")
    document.body.dataset.vscodeThemeId = "验收浅色主题"
    window.dispatchEvent(new Event("resize"))
  })
  await expect(page.locator("html")).toHaveAttribute("data-chipmate-skin", "default")
  await expect(page.getByRole("navigation", { name: "ChipMate 导航" })).toHaveCount(0)
  await page.reload()
  await expect(page.locator("html")).toHaveAttribute("data-chipmate-skin", "default")
})

for (const width of [320, 420, 600, 720, 800, 1488]) {
  test(`设置导航与保存区域 ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1056 })
    await page.goto("/iframe.html?id=appearance-nightcity--busy-settings&globals=skin:night-city")
    await expect(page.locator(".settings-shell")).toBeVisible()
    const navigation = page.locator(".settings-navigation")
    if (width >= 600) {
      await expect(navigation).toBeVisible()
      await expect(navigation.locator("[data-slot=tabs-trigger] .label").first()).toBeVisible()
      expect((await navigation.boundingBox())!.width).toBeLessThanOrEqual(width >= 1000 ? 224 : 148)
    } else {
      await expect(navigation).toBeHidden()
      await page.locator(".settings-mobile-navigation button").first().click()
      const popup = page.locator(".settings-nav-popup")
      await expect(popup).toBeVisible()
      const box = (await popup.boundingBox())!
      expect(box.width).toBeLessThanOrEqual(320)
      expect(box.height).toBeLessThanOrEqual(528)
    }
    expect(await page.locator("html").evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: info.outputPath(`设置-${width}.png`) })
  })
}
