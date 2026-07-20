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
  await load(page, "agentconsole--approval")

  const agent = page.getByRole("tab", { name: "Agent" })
  const shell = page.getByRole("tab", { name: "Shell" })
  await expect(agent).toHaveAttribute("aria-selected", "true")
  await shell.click()
  await expect(shell).toHaveAttribute("aria-selected", "true")
  await expect(page.getByText("Shell 命令将以当前用户身份直接执行，不经过 Agent 审批。")).toBeVisible()

  const input = page.getByRole("textbox", { name: "输入 Shell 命令" })
  await input.fill("printf 'still mounted'")
  await agent.click()
  await shell.click()
  await expect(input).toHaveValue("printf 'still mounted'")
})

test("high-risk permission edit rejects the original surface and prefills the Agent prompt", async ({ page }) => {
  await load(page, "agentconsole--approval")

  const card = page.locator('[data-component="permission-shortcuts"]')
  await expect(card).toHaveAttribute("data-severity", "high")
  await expect(card).toContainText("sudo rm -rf /tmp/example")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await card.getByRole("button", { name: "修改" }).click()

  await expect(card).toBeHidden()
  await expect(page.locator("textarea.prompt-input")).toHaveValue("sudo rm -rf /tmp/example")
})
