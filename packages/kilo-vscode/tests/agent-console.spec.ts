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
  const output = page.getByText("ChipMate local shell", { exact: true })
  const error = page.getByText("Command failed", { exact: true })
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

test("Agent output is pure white on the terminal activity surface", async ({ page }) => {
  await load(page, "agentconsole--approval")

  const output = page.getByText(
    "这个操作会递归删除目录内容，并且使用 sudo 提权。执行后通常无法恢复，因此需要你的明确批准。",
    { exact: true },
  )
  await expect(output).toBeVisible()
  await expect(output).toHaveCSS("color", "rgb(255, 255, 255)")
  await expect(output).toHaveCSS("opacity", "1")
})

test("Agent Console keeps typed input pure white under a light VS Code theme", async ({ page }) => {
  await page.goto(
    "/iframe.html?id=agentconsole--approval&viewMode=story&globals=colorScheme:light;theme:kilo-vscode;vscodeTheme:light-modern",
    { waitUntil: "load" },
  )
  const input = page.getByRole("textbox", { name: "Agent Console 输入" })
  const console = page.locator('[data-component="agent-console"]')
  await input.evaluate((node: HTMLTextAreaElement) => {
    node.value = "test"
  })
  await expect(console).toHaveCSS("background-color", "rgb(16, 17, 19)")
  await expect(input).toHaveCSS("color", "rgb(255, 255, 255)")
  await expect(input).toHaveCSS("-webkit-text-fill-color", "rgb(255, 255, 255)")
})

test("Agent mode renders one inline terminal timeline without a detached input panel", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await load(page, "agentconsole--inline")

  const timeline = page.locator('[data-slot="agent-console-timeline"]')
  const prompt = page.locator('[data-component="agent-console-prompt"]')
  const input = page.getByRole("textbox", { name: "Agent Console 输入" })
  const shell = page.locator('[data-slot="agent-console-terminal"]')

  await expect(timeline).toBeVisible()
  await expect(prompt).toBeVisible()
  await expect(prompt).toContainText("/project")
  await expect(page.getByText("status ok", { exact: true })).toHaveCSS("color", "rgb(13, 188, 121)")
  await expect(page.getByText("one warning", { exact: true })).toHaveCSS("color", "rgb(205, 49, 49)")
  await expect(page.getByText("完成", { exact: true })).toBeVisible()
  await expect(shell).toHaveCSS("opacity", "0")
  await expect(prompt).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
  await expect(input).toHaveCSS("color", "rgb(255, 255, 255)")
  const [last, line] = await Promise.all([page.getByText("完成", { exact: true }).boundingBox(), prompt.boundingBox()])
  expect(last).not.toBeNull()
  expect(line).not.toBeNull()
  expect(line!.y).toBeGreaterThanOrEqual(last!.y + last!.height)
  expect(line!.y - (last!.y + last!.height)).toBeLessThan(80)
  expect(line!.y).toBeLessThan(560)
  expect(await prompt.evaluate((node) => node.parentElement?.getAttribute("data-slot"))).toBe(
    "agent-console-timeline-content",
  )
})

test("Agent prompt remains editable while submission is blocked", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await load(page, "agentconsole--busy")

  const input = page.getByRole("textbox", { name: "Agent Console 输入" })
  await expect(input).toBeEnabled()
  await expect(page.locator('[data-component="agent-console-prompt"]')).toHaveAttribute("data-submit", "blocked")
  await input.fill("下一条问题先保留在这里")
  await expect(input).toHaveValue("下一条问题先保留在这里")
  await expect(page.getByText("Agent 执行中，Ctrl+C 可中断", { exact: true })).toBeVisible()
})

test("input routing timeout unlocks submission and preserves the draft", async ({ page }) => {
  await load(page, "agentconsole--route-timeout")

  const input = page.getByRole("textbox", { name: "Agent Console 输入" })
  await input.fill("不会因为响应丢失而卡死")
  await input.press("Enter")
  await expect(page.getByText("正在识别…", { exact: true })).toBeVisible()
  await expect(page.getByText("输入分流超时，内容已保留，请重试。", { exact: true })).toBeVisible()
  await expect(input).toHaveValue("不会因为响应丢失而卡死")
})

test("shell startup failure leaves connecting state and exposes restart", async ({ page }) => {
  await load(page, "agentconsole--inline")

  await page.evaluate(() => {
    window.postMessage({ type: "agentConsole.terminal.error", message: "backend startup failed" }, "*")
  })

  await expect(page.locator('[data-slot="agent-console-input-error"]')).toHaveText("backend startup failed")
  await expect(page.getByText("Shell 正在连接…", { exact: true })).toBeHidden()
  const restart = page.getByRole("button", { name: "重启 Shell" })
  await expect(restart).toBeVisible()

  await restart.click()
  await expect(page.getByText("Shell 正在连接…", { exact: true })).toBeVisible()
  await expect(page.locator('[data-slot="agent-console-input-error"]')).toBeHidden()
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
