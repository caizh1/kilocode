import { expect, test, type Page } from "@playwright/test"

const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"

function story(id: string) {
  return `/iframe.html?id=${id}&viewMode=story&globals=${GLOBALS}`
}

async function load(page: Page, id: string) {
  await page.goto(story(id), { waitUntil: "load" })
  await page.waitForSelector("#storybook-root *", { state: "attached" })
}

test("Agent Console keeps one real Shell input across Agent and Shell modes", async ({ page }) => {
  await page.setViewportSize({ width: 1510, height: 614 })
  await load(page, "agentconsole--approval")

  const agent = page.getByRole("tab", { name: "Agent" })
  const shell = page.getByRole("tab", { name: "Shell" })
  await expect(agent).toHaveAttribute("aria-selected", "true")
  await shell.click()
  await expect(shell).toHaveAttribute("aria-selected", "true")
  await expect(page.getByText("Shell 命令将以当前用户身份直接执行，不经过 Agent 审批。")).toBeVisible()

  const input = page.locator(".xterm-helper-textarea")
  await expect(page.locator(".xterm-screen")).toHaveCount(1)
  await input.fill("printf still-mounted")
  await agent.click()
  await expect(page.locator('[data-component="agent-console"] textarea:not(.xterm-helper-textarea)')).toHaveCount(0)
  await expect(page.locator(".xterm-screen")).toHaveCount(1)
  await shell.click()
  await expect(page.locator(".xterm-screen")).toContainText("printf still-mounted")
})

test("Agent Console aligns compact tabs and renders readable shell output", async ({ page }) => {
  await page.setViewportSize({ width: 1510, height: 614 })
  await load(page, "agentconsole--approval")

  const shell = page.getByRole("tab", { name: "Shell" })
  const agent = page.getByRole("tab", { name: "Agent" })
  const workspace = page.locator('[data-slot="agent-console-workspace"]')
  const output = page.locator(".xterm-screen")
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
  await expect(output).toContainText("Typecheck passed")
  await expect(output).toContainText("Command failed")
  await expect(output).toHaveCSS("color", "rgb(255, 255, 255)")
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

test("Agent Console keeps the real terminal readable under a light VS Code theme", async ({ page }) => {
  await page.goto(
    "/iframe.html?id=agentconsole--approval&viewMode=story&globals=colorScheme:light;theme:kilo-vscode;vscodeTheme:light-modern",
    { waitUntil: "load" },
  )
  const console = page.locator('[data-component="agent-console"]')
  const screen = page.locator(".xterm-screen")
  await expect(console).toHaveCSS("background-color", "rgb(16, 17, 19)")
  await expect(screen).toHaveCSS("color", "rgb(255, 255, 255)")
})

test("Agent mode renders one inline real terminal without a detached input panel", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await load(page, "agentconsole--inline")

  const timeline = page.locator('[data-slot="agent-console-timeline"]')
  const shell = page.locator('[data-slot="agent-console-terminal"]')

  await expect(timeline).toBeVisible()
  await expect(shell).toBeVisible()
  await expect(shell.locator(".xterm-screen")).toContainText("/project $")
  await expect(page.locator('[data-component="agent-console"] textarea:not(.xterm-helper-textarea)')).toHaveCount(0)
  await expect(page.getByText("status ok", { exact: true })).toHaveCSS("color", "rgb(13, 188, 121)")
  await expect(page.getByText("one warning", { exact: true })).toHaveCSS("color", "rgb(205, 49, 49)")
  await expect(page.getByText("完成", { exact: true })).toHaveCount(0)
  await expect(page.getByText(/退出码 \d+/)).toHaveCount(0)
  await expect(shell).toHaveCSS("pointer-events", "auto")
  const [last, line] = await Promise.all([
    page.locator('[data-component="agent-console-terminal-activity"]').boundingBox(),
    shell.boundingBox(),
  ])
  expect(last).not.toBeNull()
  expect(line).not.toBeNull()
  expect(line!.y).toBeGreaterThanOrEqual(last!.y + last!.height)
  expect(line!.height).toBeLessThan(120)
})

test("streaming output updates the existing timeline DOM node", async ({ page }) => {
  await load(page, "agentconsole--inline")

  const run = page.locator('[data-component="agent-console-terminal-activity"][data-kind="run"]')
  await expect(run).toHaveCount(1)
  await run.evaluate((node) => node.setAttribute("data-stream-node", "stable"))
  await page.locator('[data-ui="agent-console-stream-chunk"]').evaluate((node: HTMLButtonElement) => node.click())

  await expect(run).toHaveAttribute("data-stream-node", "stable")
  await expect(run).toContainText("streamed tail")
})

test("Agent busy state keeps one prompt and exposes deterministic input status", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await load(page, "agentconsole--busy")

  await expect(page.locator(".xterm-screen")).toHaveCount(1)
  await expect(page.locator('[data-component="agent-console"] textarea:not(.xterm-helper-textarea)')).toHaveCount(0)
  await expect(page.getByText("Agent 执行中，Ctrl+C 可中断", { exact: true })).toBeVisible()
})

test("Windows IME candidate Enter is not routed until the following Enter", async ({ page }) => {
  await load(page, "agentconsole--ime")

  const input = page.locator(".xterm-helper-textarea")
  const count = page.locator('[data-ui="agent-console-ime-captures"]')
  await input.focus()

  // Windows can deliver the Enter data before compositionend.
  await input.dispatchEvent("compositionstart")
  await page.keyboard.press("Enter")
  await input.dispatchEvent("compositionend", { data: "你" })
  await expect(count).toHaveText("0")
  await page.keyboard.press("Enter")
  await expect(count).toHaveText("1")

  // Chromium can also deliver compositionend before the candidate Enter.
  await input.dispatchEvent("compositionstart")
  await input.dispatchEvent("compositionend", { data: "好" })
  await page.keyboard.press("Enter")
  await expect(count).toHaveText("1")
  await page.keyboard.press("Enter")
  await expect(count).toHaveText("2")
})

test("mode switching has no opacity fade or blank duplicate input layer", async ({ page }) => {
  await load(page, "agentconsole--route-timeout")

  const terminal = page.locator('[data-slot="agent-console-terminal"]')
  const activity = page.locator('[data-slot="agent-console-activity"]')
  await expect(terminal).toHaveCSS("transition-duration", "0s")
  await expect(activity).toHaveCSS("transition-duration", "0s")
  await expect(page.locator(".xterm-screen")).toHaveCount(1)
})

test("shell startup failure leaves connecting state and exposes restart", async ({ page }) => {
  await load(page, "agentconsole--inline")

  await page.evaluate(() => {
    window.postMessage({ type: "agentConsole.terminal.error", message: "backend startup failed" }, "*")
  })

  await expect(page.locator('[data-slot="agent-console-input-error"]')).toHaveText("backend startup failed")
  await expect(page.getByText("Shell 正在连接…", { exact: true })).toBeHidden()
  const restart = page.getByRole("button", { name: "重启", exact: true })
  await expect(restart).toBeVisible()

  await restart.click()
  await expect(page.getByText("Shell 正在连接…", { exact: true })).toBeVisible()
  await expect(page.locator('[data-slot="agent-console-input-error"]')).toBeHidden()
})

test("high-risk permission edit rejects the original surface without creating a second input", async ({ page }) => {
  await load(page, "agentconsole--approval")

  const card = page.locator('[data-component="permission-shortcuts"]')
  await expect(card).toHaveAttribute("data-severity", "high")
  await expect(card).toContainText("sudo rm -rf /tmp/example")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await card.getByRole("button", { name: "修改" }).click()

  await expect(card).toBeHidden()
  await expect(page.locator(".xterm-screen")).toContainText("sudo rm -rf /tmp/example")
  await expect(page.locator('[data-component="agent-console"] textarea:not(.xterm-helper-textarea)')).toHaveCount(0)
})
