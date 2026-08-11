import { expect, test, type Page } from "@playwright/test"

const GLOBALS = "colorScheme:dark;theme:chipmate-vscode;vscodeTheme:dark-modern"
const NAMES = [
  "Models",
  "Providers",
  "ChipMate Server",
  "Agent Behaviour",
  "Auto-Approve",
  "Browser",
  "Checkpoints",
  "Display",
  "Autocomplete",
  "Notifications",
  "Context",
  "Commit Message",
  "Experimental",
  "Language",
  "About ChipMate",
]

function story(page: Page) {
  return page.goto(`/iframe.html?id=settings--settings-panel&viewMode=story&globals=${GLOBALS}`, {
    waitUntil: "load",
  })
}

test.describe("settings tab accessibility", () => {
  test("exposes every page through one keyboard-accessible narrow picker", async ({ page }) => {
    await page.setViewportSize({ width: 420, height: 720 })
    await story(page)

    await expect(page.getByRole("tab")).toHaveCount(0)
    const trigger = page.getByRole("button", { name: "Current settings page: Models" })
    await expect(trigger).toBeVisible()
    await trigger.click()

    const options = page.getByRole("option")
    await expect(options).toHaveCount(NAMES.length)
    await expect(page.getByRole("option", { name: "Sandboxing" })).toHaveCount(0)
    for (const name of NAMES) {
      await expect(page.getByRole("option", { name, exact: true })).toBeVisible()
    }

    const models = page.getByRole("option", { name: "Models" })
    const providers = page.getByRole("option", { name: "Providers" })
    await expect(models).toHaveAttribute("aria-selected", "true")
    await expect(providers).toHaveAttribute("aria-selected", "false")
    await expect(page.getByRole("tabpanel", { name: "Models" })).toBeVisible()

    await page.getByRole("combobox", { name: "Search settings" }).focus()
    await page.keyboard.press("ArrowDown")
    await expect(providers).toBeFocused()
    await page.keyboard.press("Enter")
    await expect(page.getByRole("button", { name: "Current settings page: Providers" })).toBeVisible()
    await expect(page.getByRole("tabpanel", { name: "Providers" })).toBeVisible()

    await page.getByRole("button", { name: "Current settings page: Providers" }).click()
    const search = page.getByRole("combobox", { name: "Search settings" })
    await search.fill("commit")
    await expect(
      page
        .locator("[data-ui='settings-mobile-search-option'][data-kind='page']")
        .getByText("Commit Message", { exact: true }),
    ).toBeVisible()
    expect(await page.getByRole("option").count()).toBeGreaterThan(1)
  })

  test("shows sandboxing controls when the platform supports them", async ({ page }) => {
    await page.setViewportSize({ width: 420, height: 720 })
    await page.goto(`/iframe.html?id=settings--sandboxing-panel&viewMode=story&globals=${GLOBALS}`, {
      waitUntil: "load",
    })

    await expect(page.getByRole("tab")).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Current settings page: Sandboxing" })).toBeVisible()
    await expect(page.getByRole("tabpanel", { name: "Sandboxing" })).toBeVisible()
    const sandbox = page.getByRole("switch", { name: "Sandbox", exact: true })
    await expect(sandbox).toHaveAccessibleDescription(/restricts writes to the project and ChipMate state directories/)
    await expect(sandbox).not.toBeChecked()
    const network = page.getByRole("switch", { name: "Restrict Network Access" })
    await expect(network).toHaveAccessibleDescription(/MCP tools are unavailable while restricted/)
    await expect(network).toBeChecked()
    await expect(network).toBeDisabled()
    const host = page.getByRole("textbox", { name: "Allowed Network Destinations" })
    await expect(host).toBeDisabled()
    const path = page.getByRole("textbox", { name: "Additional Writable Paths" })
    await expect(path).toBeDisabled()
    const add = page.getByRole("button", { name: "Add" })
    await expect(add).toHaveCount(2)
    await expect(add.nth(0)).toBeDisabled()
    await expect(add.nth(1)).toBeDisabled()
    await page.locator('[data-slot="switch-control"]').nth(0).click()
    await expect(sandbox).toBeChecked()
    await expect(network).toBeEnabled()
    await expect(host).toBeEnabled()
    await expect(path).toBeEnabled()
    await page.locator('[data-slot="switch-control"]').nth(1).click()
    await expect(network).not.toBeChecked()
    await expect(host).toBeDisabled()
    await expect(path).toBeEnabled()
    await expect(page.locator(".settings-save-bar")).toBeVisible()
  })
})
