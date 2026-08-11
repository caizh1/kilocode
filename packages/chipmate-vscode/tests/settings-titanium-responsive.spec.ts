import { expect, test, type Page } from "@playwright/test"

const GLOBALS = "colorScheme:dark;theme:chipmate-vscode;vscodeTheme:dark-modern"
const WIDTHS = [360, 480, 560, 720, 900, 1200, 1450]

async function load(page: Page, width: number, theme = "dark-modern") {
  await page.setViewportSize({ width, height: 900 })
  const scheme = theme === "light-modern" || theme === "hc-light" ? "light" : "dark"
  await page.emulateMedia({ colorScheme: scheme })
  const globals = theme === "dark-modern" ? GLOBALS : `colorScheme:dark;theme:chipmate-vscode;vscodeTheme:${theme}`
  await page.goto(`/iframe.html?id=settings--settings-titanium-responsive&viewMode=story&globals=${globals}`, {
    waitUntil: "load",
  })
  await page.waitForSelector("[data-ui='settings-shell']", { state: "visible" })
}

test("Titanium Settings uses deterministic container layouts without overflow", async ({ page }) => {
  for (const width of WIDTHS) {
    await load(page, width)
    const layout = await page.locator("[data-ui='settings-shell']").evaluate((shell) => {
      const rect = (item: Element) => {
        const box = item.getBoundingClientRect()
        return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width }
      }
      const nav = shell.querySelector<HTMLElement>("[data-ui='settings-navigation']")!
      const mobile = shell.querySelector<HTMLElement>("[data-ui='settings-mobile-navigation']")!
      const content = shell.querySelector<HTMLElement>("[data-ui='settings-content']")!
      const brand = shell.querySelector<HTMLElement>(".settings-brand")!
      const actions = shell.querySelector<HTMLElement>(".settings-header-actions")!
      const visible = Array.from(shell.querySelectorAll<HTMLElement>("button, input, [role='tab'], [role='combobox']"))
        .map(rect)
        .filter((box) => box.width > 0)
      return {
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        shell: rect(shell),
        nav: rect(nav),
        mobile: rect(mobile),
        content: rect(content),
        brand: rect(brand),
        actions: rect(actions),
        navLabels: Array.from(nav.querySelectorAll<HTMLElement>(".label")).map(
          (label) => getComputedStyle(label).display,
        ),
        visible,
      }
    })

    expect(layout.documentWidth, `document overflow at ${width}px`).toBeLessThanOrEqual(layout.viewport)
    for (const control of layout.visible) {
      expect(control.left, `control escapes left at ${width}px`).toBeGreaterThanOrEqual(layout.shell.left - 1)
      expect(control.right, `control escapes right at ${width}px`).toBeLessThanOrEqual(layout.shell.right + 1)
    }

    if (width <= 719) {
      expect(layout.nav.width).toBe(0)
      expect(layout.mobile.width).toBeGreaterThan(0)
      expect(layout.mobile.bottom).toBeLessThanOrEqual(layout.content.top)
    } else if (width <= 1199) {
      expect(layout.nav.width).toBeCloseTo(216, 0)
      expect(layout.mobile.width).toBe(0)
      expect(layout.nav.right, `navigation overlaps content at ${width}px`).toBeLessThanOrEqual(layout.content.left)
      expect(new Set(layout.navLabels)).toEqual(new Set(["block"]))
    } else {
      expect(layout.nav.width).toBeCloseTo(232, 0)
      expect(layout.mobile.width).toBe(0)
      expect(layout.nav.right, `navigation overlaps content at ${width}px`).toBeLessThanOrEqual(layout.content.left)
      expect(new Set(layout.navLabels)).toEqual(new Set(["block"]))
    }

    if (width < 560) expect(layout.actions.top).toBeGreaterThan(layout.brand.top)
  }
})

test("narrow Settings exposes one grouped searchable page picker", async ({ page }) => {
  await load(page, 420)

  await expect(page.locator("[data-ui='settings-navigation']")).toBeHidden()
  await expect(page.locator("[data-ui='settings-search']")).toBeHidden()
  const trigger = page.locator("[data-ui='settings-mobile-trigger']")
  await expect(trigger).toBeVisible()
  await trigger.click()

  const search = page.locator("[data-ui='settings-mobile-search']")
  const menu = page.locator("[data-ui='settings-mobile-menu']")
  await expect(search).toBeVisible()
  await expect(page.locator("[data-ui='settings-mobile-search']:visible")).toHaveCount(1)
  await expect(menu.getByText("连接与模型", { exact: true })).toBeVisible()
  await expect(menu.getByText("知识库与索引", { exact: true })).toBeVisible()
  await expect(menu.getByText("自动化与安全", { exact: true })).toBeVisible()
  await expect(menu.getByText("体验与系统", { exact: true })).toBeVisible()

  await search.fill("服务器")
  const option = page.locator("[data-ui='settings-mobile-search-option'][data-kind='page']", {
    hasText: "ChipMate 服务器",
  })
  await expect(option).toBeVisible()
  await expect(
    page.locator("[data-ui='settings-mobile-search-option'][data-kind='field']", { hasText: "服务器地址" }),
  ).toBeVisible()
  await option.click()

  await expect(trigger).toContainText("ChipMate 服务器")
  await expect(page.locator("[data-ui='settings-content']:visible")).toContainText("ChipMate 服务器")
})

test("update failure exposes raw details and log actions without narrow overflow", async ({ page }) => {
  await page.addInitScript(() => {
    const messages: unknown[] = []
    Object.defineProperty(window, "__chipmateUpdateMessages", { configurable: true, value: messages })
    Object.defineProperty(window, "__chipmateUpdateCopied", { configurable: true, writable: true, value: "" })
    Object.defineProperty(window, "acquireVsCodeApi", {
      configurable: true,
      value: () => ({
        postMessage: (message: unknown) => messages.push(message),
        getState: () => undefined,
        setState: () => {},
      }),
    })
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          Object.defineProperty(window, "__chipmateUpdateCopied", {
            configurable: true,
            writable: true,
            value,
          })
        },
      },
    })
  })
  for (const width of [900, 420]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(`/iframe.html?id=settings--settings-chipmate-update-error&viewMode=story&globals=${GLOBALS}`, {
      waitUntil: "load",
    })

    const error = page.locator("[data-ui='chipmate-update-error']")
    await expect(error).toBeVisible()
    await expect(error).toContainText("检查阶段失败")
    await expect(error).toContainText("错误码：availability")
    await expect(page.locator("[data-ui='chipmate-update-error-message']")).toContainText(
      "暂时无法连接 ChipMate Server",
    )
    await expect(page.locator("[data-ui='chipmate-update-retry']")).toBeVisible()
    await expect(page.locator("[data-ui='chipmate-update-copy-error']")).toBeVisible()
    await expect(page.locator("[data-ui='chipmate-update-show-log']")).toBeVisible()
    await expect(error).not.toContainText("sk-provider-secret")
    await expect(error).not.toContainText("token=private")
    await page.locator("[data-ui='chipmate-update-copy-error']").click()
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __chipmateUpdateCopied: string }).__chipmateUpdateCopied,
        ),
      )
      .toContain("错误码：availability")
    const copied = await page.evaluate(
      () => (window as unknown as { __chipmateUpdateCopied: string }).__chipmateUpdateCopied,
    )
    expect(copied).not.toContain("sk-provider-secret")
    expect(copied).not.toContain("token=private")
    await page.locator("[data-ui='chipmate-update-show-log']").click()
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            window as unknown as {
              __chipmateUpdateMessages: Array<{ type?: string }>
            }
          ).__chipmateUpdateMessages.some((message) => message.type === "showChipmateUpdateLog"),
        ),
      )
      .toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    expect(
      await error.evaluate((item) => item.scrollWidth <= item.clientWidth + 1),
      `update error actions overflow at ${width}px`,
    ).toBe(true)
  }
})

test("Settings search locates a child setting without entering edit mode", async ({ page }) => {
  await load(page, 1200)

  const search = page.locator("[data-ui='settings-search']")
  await search.fill("嵌入维度")
  const result = page.locator("[data-ui='settings-search-option']", { hasText: "向量维度" })
  await expect(result).toBeVisible()
  await expect(result).toContainText("知识库与索引 › 索引")
  await result.click()

  const row = page.locator('[data-setting-search-title="向量维度"][data-search-target="true"]')
  await expect(page.locator("[data-ui='settings-content']:visible")).toContainText("索引")
  await expect(row).toBeVisible()
  await expect(row).toBeInViewport()
  await expect(search).toHaveValue("嵌入维度")
  await expect(row.locator("input")).not.toBeFocused()
  expect(await row.evaluate((item) => !item.contains(document.activeElement))).toBe(true)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  await expect(page.locator("[data-ui='settings-save-bar']")).toHaveCount(0)

  const input = row.locator("input")
  await input.fill("3072")
  await page.locator("[data-ui='settings-page-title']").click()
  await expect(page.locator("[data-ui='settings-save-bar']")).toBeVisible()
  await page.getByRole("button", { name: "保存", exact: true }).click()
  await expect(page.locator("[data-ui='settings-save-bar']")).toHaveCount(0)
  await expect(input).toHaveValue("3072")

  await search.fill("embedding dimension")
  await expect(page.locator("[data-ui='settings-search-option']", { hasText: "向量维度" })).toBeVisible()
})

test("narrow child search closes the picker and highlights the setting without focusing it", async ({ page }) => {
  await load(page, 420)

  const trigger = page.locator("[data-ui='settings-mobile-trigger']")
  await trigger.click()
  const search = page.locator("[data-ui='settings-mobile-search']")
  await search.fill("嵌入维度")
  const result = page.locator("[data-ui='settings-mobile-search-option']", { hasText: "向量维度" })
  await expect(result).toBeVisible()
  const ids = await page
    .locator("[id^='settings-'][id*='-option-']")
    .evaluateAll((items) => items.map((item) => item.id))
  expect(new Set(ids).size).toBe(ids.length)

  await search.press("Escape")
  await expect(page.locator("[data-ui='settings-mobile-menu']")).toHaveCount(0)

  await trigger.click()
  await page.locator("[data-ui='settings-mobile-search']").fill("嵌入维度")
  await result.click()

  await expect(trigger).toContainText("索引")
  const row = page.locator('[data-setting-search-title="向量维度"][data-search-target="true"]')
  await expect(row).toBeVisible()
  await expect(row).toBeInViewport()
  await expect(row.locator("input")).not.toBeFocused()
  await expect(page.locator("[data-ui='settings-save-bar']")).toHaveCount(0)
})

test("every Settings tab remains reachable in the Titanium shell", async ({ page }) => {
  await load(page, 900)
  const tabs = page.locator("[data-ui='settings-nav-item']")
  const count = await tabs.count()
  expect(count).toBeGreaterThanOrEqual(15)

  for (let index = 0; index < count; index++) {
    const tab = tabs.nth(index)
    await tab.click()
    await expect(tab).toHaveAttribute("data-selected", "")
    const content = page.locator("[data-ui='settings-content']:visible")
    await expect(content).toHaveCount(1)
    expect(
      await content.evaluate((item) => item.scrollWidth <= item.clientWidth + 1),
      `tab ${index} overflows its content panel`,
    ).toBe(true)
  }
})

test("Models settings uses ChipMate Gateway branding", async ({ page }) => {
  await page.goto(`/iframe.html?id=settings--settings-titanium-models&viewMode=story&globals=${GLOBALS}`, {
    waitUntil: "load",
  })
  await page.waitForSelector("[data-ui='settings-shell']", { state: "visible" })

  await expect(
    page.getByText("隐藏提供商可能会使用您的提示词进行训练的 ChipMate Gateway 模型。", { exact: true }),
  ).toBeVisible()
  await expect(page.getByText(/ChipMate Gateway/)).toHaveCount(0)
})

test("Light and High Contrast keep accessible material fallbacks", async ({ page }) => {
  await load(page, 900, "light-modern")
  const light = page.locator("[data-ui='settings-shell']")
  await expect(light).toBeVisible()
  await expect(page.locator("[data-ui='settings-navigation']")).toHaveCSS("width", "216px")
  await expect(page.locator("[data-ui='settings-content']")).toHaveCSS("background-color", "rgba(255, 255, 255, 0.72)")

  await load(page, 900, "hc-black")
  const panel = page.locator("[data-ui='settings-content']").first()
  const style = await panel.evaluate((item) => {
    const css = getComputedStyle(item)
    return { border: css.borderTopWidth, blur: css.backdropFilter, shadow: css.boxShadow }
  })
  expect(style.border).toBe("1px")
  expect(style.blur).toBe("none")
  expect(style.shadow).toBe("none")
})

test("scrolling Settings surfaces use static glass without flattening material", async ({ page }) => {
  await load(page, 900)
  await page.locator('[data-ui="settings-nav-item"][data-value="indexing"]').click()

  const material = await page.locator("[data-ui='settings-shell']").evaluate((shell) => {
    const style = (item: Element) => {
      const css = getComputedStyle(item)
      return {
        blur: css.backdropFilter,
        background: css.backgroundColor,
        border: css.borderTopWidth,
        shadow: css.boxShadow,
      }
    }
    const content = shell.querySelector<HTMLElement>("[data-ui='settings-content']:not([hidden])")!
    const cards = Array.from(content.querySelectorAll<HTMLElement>("[data-component='card']")).map(style)
    return { content: style(content), cards }
  })

  expect(material.content.blur).toBe("none")
  expect(material.content.background).not.toBe("rgba(0, 0, 0, 0)")
  expect(material.content.border).toBe("1px")
  expect(material.content.shadow).not.toBe("none")
  expect(material.cards.length).toBeGreaterThan(0)
  for (const card of material.cards) {
    expect(card.blur).toBe("none")
    expect(card.background).not.toBe("rgba(0, 0, 0, 0)")
    expect(card.border).toBe("1px")
    expect(card.shadow).not.toBe("none")
  }
})

test("Light Settings locks navigation widths at every responsive boundary", async ({ page }) => {
  for (const width of [360, 480, 559, 560, 561, 719, 720, 721, 900, 1199, 1200, 1201, 1450]) {
    await load(page, width, "light-modern")
    const nav = page.locator("[data-ui='settings-navigation']")
    if (width <= 719) {
      await expect(nav, `light navigation visibility at ${width}px`).toHaveCSS("display", "none")
    } else {
      const expected = width <= 1199 ? 216 : 232
      await expect(nav, `light navigation width at ${width}px`).toHaveCSS("width", `${expected}px`)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  }
})

test("Settings close control fires once per mouse or keyboard activation", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 })
  await page.goto(`/iframe.html?id=settings--settings-close-interaction&viewMode=story&globals=${GLOBALS}`, {
    waitUntil: "load",
  })

  const close = page.getByRole("button", { name: "关闭设置" })
  const result = page.locator("[data-ui='settings-close-result']")
  await expect(close).toBeVisible()
  await expect(page.getByRole("button", { name: "打开项目配置" })).toBeVisible()
  await expect(page.getByRole("button", { name: "打开全局配置" })).toBeVisible()

  await close.click()
  await expect(result).toHaveText("1")
  await close.focus()
  await page.keyboard.press("Enter")
  await expect(result).toHaveText("2")
  await page.keyboard.press("Space")
  await expect(result).toHaveText("3")
})
