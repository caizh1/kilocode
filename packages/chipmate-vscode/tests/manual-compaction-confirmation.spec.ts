import { expect, test, type Page } from "@playwright/test"

const STORY = "chat--manual-compaction-confirmation"

async function load(page: Page, width = 420, theme = "dark-modern") {
  await page.setViewportSize({ width, height: 760 })
  const scheme = theme === "light-modern" || theme === "hc-light" ? "light" : "dark"
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" })
  const globals = `colorScheme:${scheme};theme:chipmate-vscode;vscodeTheme:${theme}`
  await page.goto(`/iframe.html?id=${STORY}&viewMode=story&globals=${globals}`, { waitUntil: "load" })
  await page.waitForSelector('[data-testid="manual-compaction-story"]')
}

async function openFromHeader(page: Page) {
  const trigger = page.getByRole("button", { name: "精简会话", exact: true })
  await expect(trigger).toBeEnabled()
  await trigger.click()
  await expect(page.getByRole("alertdialog")).toBeVisible()
  return trigger
}

test("人工精简在知情确认前不会执行，并支持取消、重开与焦点恢复", async ({ page }) => {
  await load(page)
  const trigger = await openFromHeader(page)
  const dialog = page.getByRole("alertdialog")
  const cancel = page.getByRole("button", { name: "取消", exact: true })
  const confirm = page.getByRole("button", { name: "确认并精简", exact: true })
  const acknowledgement = page.getByRole("checkbox", { name: "我已了解精简可能丢失细节" })

  await expect(cancel).toBeFocused()
  await expect(confirm).toBeDisabled()
  await expect(page.locator('[data-testid="manual-compaction-story"]')).toHaveAttribute("data-compact-count", "0")

  await page.locator('[data-testid="manual-compaction-overlay"]').click({ position: { x: 2, y: 2 }, force: true })
  await expect(dialog).toBeVisible()

  await page.locator(".manual-compaction-acknowledgement").click()
  await expect(acknowledgement).toBeChecked()
  await expect(confirm).toBeEnabled()
  await cancel.click()
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()

  await trigger.click()
  await expect(acknowledgement).not.toBeChecked()
  await page.locator(".manual-compaction-acknowledgement").click()
  await expect(acknowledgement).toBeChecked()
  await confirm.click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('[data-testid="manual-compaction-story"]')).toHaveAttribute("data-compact-count", "1")
})

test("Escape 与会话切换会安全取消，且不会精简新会话", async ({ page }) => {
  await load(page)
  const trigger = await openFromHeader(page)
  await page.keyboard.press("Escape")
  await expect(page.getByRole("alertdialog")).toHaveCount(0)
  await expect(trigger).toBeFocused()

  await trigger.click()
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("manualCompactionStoryState", { detail: { sessionID: "story-session-other" } }),
    )
  })
  await expect(page.getByRole("alertdialog")).toHaveCount(0)
  await expect(page.locator('[data-testid="manual-compaction-story"]')).toHaveAttribute("data-compact-count", "0")

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("manualCompactionStoryState", { detail: { status: "busy" } }))
  })
  await expect(page.getByRole("button", { name: "精简会话", exact: true })).toBeDisabled()
})

test("断线、空会话、无模型和只读状态不会开放人工精简", async ({ page }) => {
  await load(page)
  const trigger = page.getByRole("button", { name: "精简会话", exact: true })
  const setState = (detail: Record<string, boolean>) =>
    page.evaluate((state) => {
      window.dispatchEvent(new CustomEvent("manualCompactionStoryState", { detail: state }))
    }, detail)

  await openFromHeader(page)
  await setState({ connected: false })
  await expect(page.getByRole("alertdialog")).toHaveCount(0)
  await expect(trigger).toBeDisabled()

  await setState({ connected: true, hasMessages: false })
  await expect(trigger).toHaveCount(0)

  await setState({ hasMessages: true, hasModel: false })
  await expect(trigger).toBeDisabled()

  await setState({ hasModel: true, readonly: true })
  await expect(trigger).toHaveCount(0)
  await expect(page.locator('[data-testid="manual-compaction-story"]')).toHaveAttribute("data-compact-count", "0")
})

test("/compact 与顶部按钮共用同一确认流程", async ({ page }) => {
  await load(page)
  const input = page.locator("textarea.prompt-input")
  await input.fill("/compact")
  await input.press("Enter")

  await expect(page.getByRole("alertdialog")).toBeVisible()
  await expect(page.locator('[data-testid="manual-compaction-story"]')).toHaveAttribute("data-compact-count", "0")
  await page.locator(".manual-compaction-acknowledgement").click()
  await page.getByRole("button", { name: "确认并精简", exact: true }).click()
  await expect(page.locator('[data-testid="manual-compaction-story"]')).toHaveAttribute("data-compact-count", "1")
})

test("确认框在窄宽度、主题切换和等效 200% 缩放下不溢出", async ({ page }) => {
  for (const [width, theme] of [
    [420, "dark-modern"],
    [420, "light-modern"],
    [420, "hc-black"],
    [320, "dark-modern"],
    [210, "dark-modern"],
  ] as const) {
    await load(page, width, theme)
    await openFromHeader(page)
    const layout = await page.locator('[data-testid="manual-compaction-dialog"]').evaluate((dialog) => {
      const box = dialog.getBoundingClientRect()
      const flow = dialog.querySelector<HTMLElement>(".manual-compaction-flow")!
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        viewportWidth: document.documentElement.clientWidth,
        viewportHeight: document.documentElement.clientHeight,
        columns: getComputedStyle(flow).gridTemplateColumns.split(" ").length,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })

    expect(layout.left).toBeGreaterThanOrEqual(7)
    expect(layout.right).toBeLessThanOrEqual(layout.viewportWidth - 7)
    expect(layout.top).toBeGreaterThanOrEqual(7)
    expect(layout.bottom).toBeLessThanOrEqual(layout.viewportHeight - 7)
    expect(layout.overflow, `${width}px / ${theme} 出现横向溢出`).toBeLessThanOrEqual(0)
    expect(layout.columns, `${width}px 未按预期切换精简前后布局`).toBe(width < 360 ? 1 : 3)
  }
})
