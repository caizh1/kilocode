import { expect, test, type Page } from "@playwright/test"

const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"

function story(id: string) {
  return `/iframe.html?id=${id}&viewMode=story&globals=${GLOBALS}`
}

async function load(page: Page, id: string) {
  await page.goto(story(id), { waitUntil: "load" })
  await page.waitForSelector("#storybook-root *", { state: "attached" })
}

test("Agent Console exposes explicit Agent and Shell input modes", async ({ page }) => {
  await page.setViewportSize({ width: 1510, height: 614 })
  await load(page, "agentmanager--agent-console-approval")

  const agent = page.getByRole("tab", { name: "Agent" })
  const shell = page.getByRole("tab", { name: "Shell" })
  await expect(agent).toHaveAttribute("aria-selected", "true")
  await shell.click()
  await expect(shell).toHaveAttribute("aria-selected", "true")
  await expect(page.getByText("Shell commands run immediately without Agent approval.")).toBeVisible()
  await expect(page.getByRole("textbox", { name: "Enter shell command..." })).toBeFocused()
})

test("high-risk permission edit rejects the original surface and prefills the Agent prompt", async ({ page }) => {
  await load(page, "composite-webview--dangerous-bash-permission")

  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText("sudo rm -rf /tmp/example")
  await dialog.getByRole("button", { name: "Edit" }).click()

  await expect(dialog).toBeHidden()
  await expect(page.locator("textarea.prompt-input")).toHaveValue("sudo rm -rf /tmp/example")
})
