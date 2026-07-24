import { expect, test } from "@playwright/test"

const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"

test("batch Skill selection remains interactive after entering and reloading", async ({ page }) => {
  await page.goto(`/iframe.html?id=marketplace--batch-skill-selection&viewMode=story&globals=${GLOBALS}`, {
    waitUntil: "load",
  })

  const open = page.getByRole("button", { name: "批量上传" })
  await expect(page.getByRole("checkbox")).toHaveCount(0)
  await open.click()
  await expect(page.getByRole("checkbox")).toHaveCount(4)

  await page.locator('[data-component="checkbox"]').first().click()
  await expect(page.getByText("已选择 1 个 Skill")).toBeVisible()
  await expect(page.locator('.marketplace-card[data-selected="true"]')).toHaveCount(1)

  await page.getByRole("button", { name: "清空" }).click()
  await expect(page.locator('.marketplace-card[data-selected="true"]')).toHaveCount(0)
  await page.getByRole("button", { name: "取消" }).click()
  await expect(page.getByRole("checkbox")).toHaveCount(0)

  await page.reload({ waitUntil: "load" })
  await page.getByRole("button", { name: "批量上传" }).click()
  await expect(page.getByRole("checkbox")).toHaveCount(4)
})
