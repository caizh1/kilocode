import { expect, test, type Page } from "@playwright/test"

type Theme = "dark-modern" | "light-modern" | "hc-black" | "hc-light"

const SIDEBAR_STORY = "prompt-input--qa-auto-approve-disabled-420"
const AGENT_MANAGER_STORY = "agentmanager--readable-chat-420"

function story(id: string, theme: Theme) {
  const scheme = theme === "light-modern" || theme === "hc-light" ? "light" : "dark"
  return `/iframe.html?id=${id}&viewMode=story&globals=colorScheme:${scheme};theme:chipmate-vscode;vscodeTheme:${theme}`
}

async function installHost(page: Page) {
  await page.addInitScript(() => {
    const messages: unknown[] = []
    Object.defineProperty(window, "__chipmateAutoApproveMessages", {
      configurable: true,
      value: messages,
    })
    Object.defineProperty(window, "acquireVsCodeApi", {
      configurable: true,
      value: () => ({
        postMessage: (message: unknown) => messages.push(structuredClone(message)),
        getState: () => undefined,
        setState: () => {},
      }),
    })
  })
}

async function load(page: Page, id: string, width: number, theme: Theme) {
  await page.setViewportSize({ width, height: 720 })
  await page.goto(story(id, theme), { waitUntil: "load" })
  await page.waitForSelector("#storybook-root *", { state: "attached" })
}

async function sendState(page: Page, active: boolean) {
  await page.evaluate((value) => {
    window.dispatchEvent(new MessageEvent("message", { data: { type: "autoApproveState", active: value } }))
  }, active)
}

async function recordedToggle(page: Page) {
  return page.evaluate(() =>
    (
      window as typeof window & {
        __chipmateAutoApproveMessages: Array<{ type?: string }>
      }
    ).__chipmateAutoApproveMessages.some((message) => message.type === "toggleAutoApprove"),
  )
}

async function iconColor(page: Page) {
  return page
    .locator('[data-ui="qa-action-auto-approve"] [data-slot="icon-svg"]')
    .evaluate((icon) => getComputedStyle(icon).color)
}

test("auto-approve waits for the authoritative host state and exposes the enabled semantics", async ({ page }) => {
  await installHost(page)
  await load(page, SIDEBAR_STORY, 420, "dark-modern")

  const button = page.locator('[data-ui="qa-action-auto-approve"]')
  const indicator = button.locator(".prompt-status-indicator")
  await expect(button).toHaveAttribute("aria-pressed", "false")
  await expect(button).toHaveAccessibleName("Enable auto-approve")
  await expect(indicator).toHaveCSS("visibility", "hidden")

  const disabledBox = await button.boundingBox()
  const disabledColor = await iconColor(page)
  await button.click()

  await expect.poll(() => recordedToggle(page)).toBe(true)
  await expect(button).toHaveAttribute("aria-pressed", "false")
  await expect(indicator).toHaveCSS("visibility", "hidden")

  await sendState(page, true)
  await expect(button).toHaveAttribute("aria-pressed", "true")
  await expect(button).toHaveAccessibleName("Disable auto-approve")
  await expect(indicator).toHaveCSS("visibility", "visible")

  const enabledBox = await button.boundingBox()
  const enabledColor = await iconColor(page)
  const indicatorColor = await indicator.evaluate((item) => getComputedStyle(item).backgroundColor)
  expect(enabledColor).not.toBe(disabledColor)
  expect(indicatorColor).toBe(enabledColor)
  expect(enabledBox?.width).toBe(disabledBox?.width)
  expect(enabledBox?.height).toBe(disabledBox?.height)

  await button.hover()
  await expect(
    page.getByText("Auto-approve is enabled. Permission prompts will be approved automatically."),
  ).toBeVisible()
  expect(await iconColor(page)).toBe(enabledColor)

  await button.focus()
  await page.keyboard.press("Tab")
  await page.keyboard.press("Shift+Tab")
  await expect(button).toBeFocused()
  const outline = await button.evaluate((item) => {
    const style = getComputedStyle(item)
    return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) }
  })
  expect(outline.style).not.toBe("none")
  expect(outline.width).toBeGreaterThan(0)
  expect(await iconColor(page)).toBe(enabledColor)

  await sendState(page, false)
  await expect(button).toHaveAttribute("aria-pressed", "false")
  await expect(button).toHaveAccessibleName("Enable auto-approve")
  await expect(indicator).toHaveCSS("visibility", "hidden")
  expect(await iconColor(page)).toBe(disabledColor)
})

const themes: Array<{ theme: Theme; width: number }> = [
  { theme: "dark-modern", width: 420 },
  { theme: "light-modern", width: 420 },
  { theme: "hc-black", width: 420 },
  { theme: "hc-light", width: 420 },
  { theme: "dark-modern", width: 200 },
  { theme: "hc-black", width: 200 },
]

for (const entry of themes) {
  test(`auto-approve remains distinct in ${entry.theme} at ${entry.width}px`, async ({ page }) => {
    await installHost(page)
    await load(page, SIDEBAR_STORY, entry.width, entry.theme)

    const button = page.locator('[data-ui="qa-action-auto-approve"]')
    const indicator = button.locator(".prompt-status-indicator")
    const disabledBox = await button.boundingBox()
    const disabledColor = await iconColor(page)

    await sendState(page, true)
    await expect(button).toHaveAttribute("aria-pressed", "true")
    await expect(indicator).toHaveCSS("visibility", "visible")

    const enabledBox = await button.boundingBox()
    const enabledColor = await iconColor(page)
    expect(enabledColor).not.toBe(disabledColor)
    expect(enabledBox?.width).toBe(disabledBox?.width)
    expect(enabledBox?.height).toBe(disabledBox?.height)

    if (entry.theme === "hc-black" || entry.theme === "hc-light") {
      await expect(indicator).not.toHaveCSS("box-shadow", "none")
    }
    if (entry.width === 200) {
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(entry.width)
    }
  })
}

test("Agent Manager consumes the same authoritative auto-approve state", async ({ page }) => {
  await installHost(page)
  await load(page, AGENT_MANAGER_STORY, 420, "dark-modern")

  const button = page.locator('[data-ui="qa-action-auto-approve"]')
  const indicator = button.locator(".prompt-status-indicator")
  const disabledColor = await iconColor(page)
  await expect(button).toHaveAttribute("aria-pressed", "false")

  await sendState(page, true)
  await expect(button).toHaveAttribute("aria-pressed", "true")
  await expect(button).toHaveAccessibleName("Disable auto-approve")
  await expect(indicator).toHaveCSS("visibility", "visible")
  expect(await iconColor(page)).not.toBe(disabledColor)
})
