import { expect, test } from "@playwright/test"

const STORY = "chat--compaction-lifecycle-states"

async function open(
  page: import("@playwright/test").Page,
  options: { width?: number; theme?: string } = {},
) {
  const width = options.width ?? 420
  const theme = options.theme ?? "dark-modern"
  const scheme = theme === "light-modern" || theme === "hc-light" ? "light" : "dark"
  await page.setViewportSize({ width, height: 900 })
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" })
  const globals = `colorScheme:${scheme};theme:chipmate-vscode;vscodeTheme:${theme}`
  await page.goto(`/iframe.html?id=${STORY}&viewMode=story&globals=${globals}`)
  await page.waitForSelector(".compaction-status-card")
}

test("shows explicit running, success, failure, and interruption outcomes", async ({ page }) => {
  await open(page)

  const cards = page.locator(".compaction-status-card")
  await expect(cards).toHaveCount(5)
  await expect(cards.nth(0)).toContainText("Compacting session")
  await expect(cards.nth(1)).toContainText("Session compaction completed")
  await expect(cards.nth(2)).toContainText("Session automatically compacted")
  await expect(cards.nth(3)).toContainText("Session compaction failed")
  await expect(cards.nth(4)).toContainText("Session compaction interrupted")
  await expect(cards.nth(3)).toContainText("did not complete")
  await expect(cards.nth(4)).toContainText("did not complete")
})

test("keeps icons in normal flow and cards readable at narrow widths", async ({ page }) => {
  await open(page, { width: 320 })

  const layout = await page.locator(".compaction-status-card").evaluateAll((cards) =>
    cards.map((card) => {
      const box = card.getBoundingClientRect()
      const icon = card.querySelector<HTMLElement>('[data-component="icon"]')!
      return {
        left: box.left,
        right: box.right,
        viewport: document.documentElement.clientWidth,
        iconPosition: getComputedStyle(icon).position,
      }
    }),
  )

  expect(layout.every((item) => item.left >= 0 && item.right <= item.viewport)).toBe(true)
  expect(layout.every((item) => item.iconPosition !== "absolute")).toBe(true)
})

test("remains readable across themes and equivalent 200% zoom", async ({ page }) => {
  for (const [width, theme] of [
    [420, "dark-modern"],
    [420, "light-modern"],
    [420, "hc-black"],
    [320, "dark-modern"],
    [210, "dark-modern"],
  ] as const) {
    await open(page, { width, theme })
    const layout = await page.locator(".compaction-status-card").evaluateAll((cards) =>
      cards.map((card) => {
        const box = card.getBoundingClientRect()
        const icon = card.querySelector<HTMLElement>('[data-component="icon"]')!
        return {
          left: box.left,
          right: box.right,
          viewport: document.documentElement.clientWidth,
          iconPosition: getComputedStyle(icon).position,
          horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        }
      }),
    )

    expect(layout.every((item) => item.left >= 0 && item.right <= item.viewport)).toBe(true)
    expect(layout.every((item) => item.horizontalOverflow <= 0)).toBe(true)
    expect(layout.every((item) => item.iconPosition !== "absolute")).toBe(true)
  }
})
