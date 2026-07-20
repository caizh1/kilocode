import { expect, test, type Page } from "@playwright/test"

const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"

async function load(page: Page, id: string, width: number) {
  await page.setViewportSize({ width, height: 720 })
  await page.goto(`/iframe.html?id=${id}&viewMode=story&globals=${GLOBALS}`, { waitUntil: "load" })
  await page.waitForSelector("#storybook-root *", { state: "attached" })
}

test("chat model selector renders a non-clearable empty state at supported widths", async ({ page }) => {
  for (const width of [200, 300, 420]) {
    await load(page, `prompt-input--no-model-${width}`, width)

    const trigger = page.getByRole("button", { name: "Select model: No model selected" })
    await expect(trigger).toBeVisible()
    await expect(trigger).toBeEnabled()
    await trigger.focus()
    await trigger.press("Enter")
    await expect(page.getByRole("combobox", { name: /No model selected.*Search models/ })).toBeFocused()
    await expect(page.getByRole("treeitem", { name: "Not set" })).toHaveCount(0)
    await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll")
  }
})

test("chat model selector localizes the empty state", async ({ page }) => {
  const cases = [
    ["prompt-input--no-model-420", "Select model: No model selected"],
    ["prompt-input--no-model-zh-420", "选择模型: 未选择模型"],
    ["prompt-input--no-model-zht-420", "選擇模型: 未選擇模型"],
  ] as const

  for (const [id, name] of cases) {
    await load(page, id, 420)
    await expect(page.getByRole("button", { name })).toBeVisible()
  }
})

test("legacy Kilo Auto Free selection keeps its id but uses ChipMate branding", async ({ page }) => {
  await load(page, "prompt-input--legacy-auto-free-420", 420)

  await expect(page.getByRole("button", { name: "Select model: ChipMate Auto Free" })).toBeVisible()
  await expect(page.getByText("Kilo Auto Free", { exact: true })).toHaveCount(0)
})
