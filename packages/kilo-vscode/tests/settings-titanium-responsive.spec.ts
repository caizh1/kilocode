import { expect, test, type Page } from "@playwright/test"

const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"
const WIDTHS = [360, 480, 560, 720, 900, 1200, 1450]

async function load(page: Page, width: number, theme = "dark-modern") {
  await page.setViewportSize({ width, height: 900 })
  const scheme = theme === "light-modern" || theme === "hc-light" ? "light" : "dark"
  await page.emulateMedia({ colorScheme: scheme })
  const globals = theme === "dark-modern" ? GLOBALS : `colorScheme:dark;theme:kilo-vscode;vscodeTheme:${theme}`
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
    expect(layout.nav.right, `navigation overlaps content at ${width}px`).toBeLessThanOrEqual(layout.content.left)
    for (const control of layout.visible) {
      expect(control.left, `control escapes left at ${width}px`).toBeGreaterThanOrEqual(layout.shell.left - 1)
      expect(control.right, `control escapes right at ${width}px`).toBeLessThanOrEqual(layout.shell.right + 1)
    }

    if (width <= 719) {
      expect(layout.nav.width).toBeCloseTo(56, 0)
      expect(new Set(layout.navLabels)).toEqual(new Set(["none"]))
    } else if (width <= 1199) {
      expect(layout.nav.width).toBeCloseTo(216, 0)
      expect(new Set(layout.navLabels)).toEqual(new Set(["block"]))
    } else {
      expect(layout.nav.width).toBeCloseTo(232, 0)
      expect(new Set(layout.navLabels)).toEqual(new Set(["block"]))
    }

    if (width < 560) expect(layout.actions.top).toBeGreaterThan(layout.brand.top)
  }
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
  await expect(page.getByText(/Kilo Gateway/)).toHaveCount(0)
})

test("Light and High Contrast keep accessible material fallbacks", async ({ page }) => {
  await load(page, 900, "light-modern")
  const light = page.locator("[data-ui='settings-shell']")
  await expect(light).toBeVisible()
  await expect(page.locator("[data-ui='settings-navigation']")).toHaveCSS("width", "176px")
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

test("Light Settings locks navigation widths at every responsive boundary", async ({ page }) => {
  for (const width of [360, 480, 559, 560, 561, 719, 720, 721, 900, 1199, 1200, 1201, 1450]) {
    await load(page, width, "light-modern")
    const nav = page.locator("[data-ui='settings-navigation']")
    const expected = width <= 719 ? 56 : width <= 1199 ? 176 : 216
    await expect(nav, `light navigation width at ${width}px`).toHaveCSS("width", `${expected}px`)
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
