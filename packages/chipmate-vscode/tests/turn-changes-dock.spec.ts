import { expect, test, type Page } from "@playwright/test"

const url = "/iframe.html?id=chat-按需修改记录--running&viewMode=story"
const selectors = {
  dock: '[data-component="turn-changes-dock"]',
  drawer: '[data-slot="turn-changes-drawer"]',
  toggle: '[data-slot="turn-changes-toggle"]',
  prompt: '[data-ui="qa-composer"]',
  list: ".message-list",
}
async function geometry(page: Page) {
  return page.evaluate((s) => {
    const rect = (selector: string) => {
      const e = document.querySelector(selector) as HTMLElement
      const r = e.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom, left: r.left, width: r.width, height: r.height }
    }
    return {
      dock: rect(s.dock),
      drawer: rect(s.drawer),
      toggle: rect(s.toggle),
      prompt: rect(s.prompt),
      list: rect(s.list),
      padding: getComputedStyle(document.querySelector(s.list)!).paddingBottom,
    }
  }, selectors)
}
async function collapsed(page: Page) {
  await expect(page.locator(selectors.drawer)).toHaveCSS("visibility", "hidden")
  const r = await geometry(page)
  expect(r.drawer.height).toBe(0)
  expect(r.dock.height).toBeLessThanOrEqual(16)
  expect(r.toggle.height).toBe(16)
  expect(Math.abs(r.toggle.left + r.toggle.width / 2 - r.prompt.left - r.prompt.width / 2)).toBeLessThanOrEqual(1)
  expect(r.padding).toBe("8px")
  await expect(page.locator(".working-indicator-slot")).toHaveCount(0)
  await expect(page.locator('[data-component="turn-changes"]')).toHaveCount(0)
  return r
}
async function phase(page: Page, phase: string, idle?: boolean) {
  await page.evaluate((detail) => window.dispatchEvent(new CustomEvent("验收修改阶段", { detail })), { phase, idle })
}

for (const width of [280, 360])
  for (const height of [480, 640]) {
    test(`窄屏 ${width}×${height} 收起归零、展开不覆盖输入框并恢复高度`, async ({ page }) => {
      await page.setViewportSize({ width, height })
      await page.goto(url)
      await expect(page.locator(selectors.toggle)).toBeVisible()
      const before = await collapsed(page)
      await page.locator(selectors.toggle).click()
      await expect(page.locator(selectors.drawer)).toHaveCSS("visibility", "visible")
      const open = await geometry(page)
      expect(open.drawer.height).toBeGreaterThan(0)
      expect(open.drawer.height).toBeLessThanOrEqual(56)
      expect(Math.abs(open.prompt.top - before.prompt.top)).toBeLessThanOrEqual(1)
      expect(Math.abs(open.prompt.height - before.prompt.height)).toBeLessThanOrEqual(1)
      expect(Math.abs(before.list.height - open.list.height - open.drawer.height)).toBeLessThanOrEqual(1)
      expect(open.list.bottom).toBeLessThanOrEqual(open.drawer.top + 1)
      await page.locator(selectors.toggle).click()
      const after = await collapsed(page)
      expect(Math.abs(after.list.height - before.list.height)).toBeLessThanOrEqual(1)
    })
  }

test("阅读历史时展开收起不跳动，延迟收尾完成后结果留在消息中", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 })
  await page.goto(url)
  await expect(page.locator(selectors.toggle)).toBeVisible()
  await page.locator(selectors.list).hover()
  await page.mouse.wheel(0, -450)
  const list = page.locator(selectors.list)
  await expect.poll(() => list.evaluate((e) => e.scrollTop)).toBeGreaterThan(0)
  await expect(page.locator(".scroll-to-bottom-button")).toBeVisible()
  const top = await list.evaluate((e) => e.scrollTop)
  await page.locator(selectors.toggle).click()
  await expect(page.locator(selectors.drawer)).toHaveCSS("visibility", "visible")
  expect(Math.abs((await list.evaluate((e) => e.scrollTop)) - top)).toBeLessThanOrEqual(2)
  await page.locator(selectors.toggle).click()
  await collapsed(page)
  expect(Math.abs((await list.evaluate((e) => e.scrollTop)) - top)).toBeLessThanOrEqual(2)
  await phase(page, "settling", true)
  await expect(page.locator(selectors.toggle)).toBeVisible()
  await expect(page.locator('[data-component="turn-changes"]')).toHaveCount(0)
  await phase(page, "ready", true)
  await expect(page.locator(selectors.toggle)).toHaveCount(0)
  expect(Math.abs((await list.evaluate((e) => e.scrollTop)) - top)).toBeLessThanOrEqual(2)
  await page.locator(".scroll-to-bottom-button").click()
  await expect(page.locator('[data-component="turn-changes"]')).toBeVisible()
  await expect(page.locator('[data-slot="turn-changes-file"]')).toHaveCount(0)
  await page.getByRole("button", { name: "审阅", exact: true }).click()
  await expect(page.locator('[data-slot="turn-changes-file"]')).toHaveCount(1)
})

test("布局断言能识别收起仍占位和旧状态栏回归", async ({ page }) => {
  await page.goto(url)
  await expect(page.locator(selectors.toggle)).toBeVisible()
  await collapsed(page)
  const style = await page.addStyleTag({
    content: '[data-slot="turn-changes-drawer"] { min-height: 32px !important; }',
  })
  let detected = false
  try {
    await collapsed(page)
  } catch {
    detected = true
  }
  expect(detected).toBe(true)
  await style.evaluate((e) => e.remove())
  await collapsed(page)
  await page.evaluate(() => {
    const e = document.createElement("div")
    e.className = "working-indicator-slot"
    document.querySelector(".message-list-content")!.append(e)
  })
  await expect(page.locator(".working-indicator-slot")).toHaveCount(1)
  // 与正例相同的“旧状态组件数量为零”断言在该反例下必然不成立。
  expect((await page.locator(".working-indicator-slot").count()) === 0).toBe(false)
})

test("浅色放大显示保留多行草稿与输入焦点，支持键盘伸缩", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 })
  await page.goto(url)
  await page.evaluate(() => {
    document.body.classList.add("vscode-light")
    document.body.style.zoom = "1.25"
  })
  await expect(page.locator(selectors.toggle)).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new MessageEvent("message", { data: { type: "connectionState", state: "connected" } })))
  const input = page.locator("textarea.prompt-input")
  await input.fill("第一行草稿\n第二行草稿")
  await input.focus()
  await page.locator(selectors.toggle).click()
  await expect(input).toBeFocused()
  await expect(input).toHaveValue("第一行草稿\n第二行草稿")
  const toggle = page.locator(selectors.toggle)
  await toggle.focus()
  await page.keyboard.press("Space")
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await page.keyboard.press("Enter")
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await expect(toggle).toBeFocused()
})
