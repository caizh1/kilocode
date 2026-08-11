import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

const GLOBALS = "colorScheme:dark;theme:chipmate-vscode;vscodeTheme:dark-modern"
const RULES = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"]

async function load(page: Page, id: string, width = 420) {
  await page.setViewportSize({ width, height: 900 })
  await page.goto(`/iframe.html?id=${id}&viewMode=story&globals=${GLOBALS}`, { waitUntil: "load" })
  await page.waitForSelector("#storybook-root *", { state: "attached" })
}

async function input(page: Page, value: string) {
  await page.locator("textarea.prompt-input").evaluate((element, text) => {
    element.value = text
    element.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }))
  }, value)
}

test("shows balanced review scope with prominent unsupported risks", async ({ page }) => {
  await load(page, "prompt-input--embedded-review-boundary-420")

  const card = page.locator('[data-ui="embedded-review-boundary"]')
  await expect(card).toBeVisible()
  await expect(card.getByText("可检查", { exact: true })).toBeVisible()
  await expect(card.getByText("不检查 · 需人工审查", { exact: true })).toBeVisible()
  await expect(card.getByText("6 类盲区", { exact: true })).toBeVisible()
  await expect(card.getByText("以下风险不会被本次审查覆盖", { exact: true })).toBeVisible()
  await expect(card.getByText("并发与中断", { exact: true })).toBeVisible()
  await expect(card.getByText("需求符合性", { exact: true })).toBeVisible()
  await expect(card.getByText("PASS 不代表整体安全，仍须人工复核、编译和硬件验证。", { exact: true })).toBeVisible()

  const result = await new AxeBuilder({ page })
    .include('[data-ui="embedded-review-boundary"]')
    .withTags(RULES)
    .analyze()
  const details = result.violations.map((item) => `${item.id}: ${item.help}`).join("\n")
  expect(result.violations, details).toEqual([])
})

test("keeps the PASS warning visible when details are collapsed", async ({ page }) => {
  await load(page, "prompt-input--embedded-review-boundary-420")

  const toggle = page.getByRole("button", { name: "收起审查范围" })
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await toggle.click()

  await expect(page.getByText("不检查 · 需人工审查", { exact: true })).toHaveCount(0)
  await expect(page.getByText("PASS 不代表整体安全，仍须人工复核、编译和硬件验证。", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "展开审查范围" })).toHaveAttribute("aria-expanded", "false")
})

test("appears only after the embedded review command is explicit", async ({ page }) => {
  await load(page, "prompt-input--default-420")

  await input(page, "/embedded-revie")
  await expect(page.locator('[data-ui="embedded-review-boundary"]')).toHaveCount(0)

  await input(page, "/embedded-review uncommitted")
  await expect(page.locator('[data-ui="embedded-review-boundary"]')).toBeVisible()

  await input(page, "Explain /embedded-review")
  await expect(page.locator('[data-ui="embedded-review-boundary"]')).toHaveCount(0)
})

test("contains the narrow sidebar without horizontal overflow", async ({ page }) => {
  await load(page, "prompt-input--embedded-review-boundary-240", 240)

  const overflow = await page.locator("#storybook-root").evaluate((root) => ({
    client: root.clientWidth,
    scroll: root.scrollWidth,
  }))
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client)
  await expect(page.getByText("6 类盲区", { exact: true })).toBeVisible()
  await expect(page.getByText("需求符合性", { exact: true })).toBeVisible()
})
