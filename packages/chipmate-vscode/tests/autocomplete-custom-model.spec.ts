import { expect, test } from "@playwright/test"

for (const width of [300, 420]) {
  test(`custom autocomplete model picker works at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 760 })
    await page.goto("/iframe.html?id=settings--models-autocomplete-custom&viewMode=story&globals=vscodeTheme:dark-modern")

    const selection = page.locator('button[title="deployment/alpha"]')
    await expect(selection).toContainText("Primary deployment")
    await expect(selection).toContainText("Production FIM alias")
    await selection.press("Enter")
    await expect(page.getByRole("treeitem", { name: /Production FIM alias/ })).toBeVisible()
    await expect(page.getByRole("treeitem", { name: /Same ID elsewhere/ })).toBeVisible()
    await expect(page.getByRole("treeitem", { name: /Chat only/ })).toHaveCount(0)
    await expect(page.getByText("Secondary deployment", { exact: true })).toBeVisible()
    await page.getByRole("treeitem", { name: /Same ID elsewhere/ }).dblclick()
    await expect(page.locator('button[title="deployment/alpha"]')).toContainText("Secondary deployment")
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
}

test("unavailable saved model stays visible without falling back to a builtin", async ({ page }) => {
  await page.goto("/iframe.html?id=settings--models-autocomplete-unavailable&viewMode=story&globals=vscodeTheme:light-modern")
  await expect(page.getByRole("status")).toContainText("primary / deployment/removed")
  await expect(page.getByRole("button", { name: /primary \/ deployment\/removed/ })).toBeVisible()
})
