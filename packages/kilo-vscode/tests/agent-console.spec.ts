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

test("Agent Console aligns compact tabs and renders readable shell output", async ({ page }) => {
  await page.setViewportSize({ width: 1510, height: 614 })
  await load(page, "agentconsole--approval")

  const shell = page.getByRole("tab", { name: "Shell" })
  const agent = page.getByRole("tab", { name: "Agent" })
  const workspace = page.locator('[data-slot="agent-console-workspace"]')
  const output = page.getByText("/project\nLinux 6.8.0 x86_64", { exact: true })
  const error = page.getByText("terminal connection error", { exact: true })
  const [shellBox, agentBox, workspaceBox] = await Promise.all([
    shell.boundingBox(),
    agent.boundingBox(),
    workspace.boundingBox(),
  ])

  expect(shellBox).not.toBeNull()
  expect(agentBox).not.toBeNull()
  expect(workspaceBox).not.toBeNull()
  expect(shellBox!.height).toBe(agentBox!.height)
  expect(Math.abs(shellBox!.y - agentBox!.y)).toBeLessThanOrEqual(1)
  expect(
    Math.abs(shellBox!.y + shellBox!.height / 2 - (workspaceBox!.y + workspaceBox!.height / 2)),
  ).toBeLessThanOrEqual(1)
  await expect(output).toHaveCSS("color", "rgb(255, 255, 255)")
  await expect(error).toHaveCSS("color", "rgb(241, 76, 76)")
  expect(
    await page
      .locator('[data-slot="agent-console-mode"] [data-slot="tabs-list"]')
      .evaluate((node) => getComputedStyle(node, "::after").display),
  ).toBe("none")

  await page.setViewportSize({ width: 640, height: 614 })
  const narrow = await workspace.boundingBox()
  expect(narrow).not.toBeNull()
  expect(narrow!.x + narrow!.width).toBeLessThanOrEqual(640)
})

test("high-risk permission edit rejects the original surface and prefills the Agent prompt", async ({ page }) => {
  await load(page, "agentconsole--approval")

  const card = page.locator('[data-component="permission-shortcuts"]')
  await expect(card).toHaveAttribute("data-severity", "high")
  await expect(card).toContainText("sudo rm -rf /tmp/example")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await card.getByRole("button", { name: "修改" }).click()

  await expect(card).toBeHidden()
  await expect(page.getByRole("textbox", { name: "Agent Console 输入" })).toHaveValue("sudo rm -rf /tmp/example")
})
