import { expect, test, type Page } from "@playwright/test"

const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"
const SIZES = [
  { width: 420, height: 480 },
  { width: 420, height: 720 },
  { width: 800, height: 720 },
]

async function load(page: Page, width: number, height: number, failed: boolean) {
  await page.setViewportSize({ width, height })
  await page.goto(`/iframe.html?id=marketplace--local-import-glass&viewMode=story&globals=${GLOBALS}`, {
    waitUntil: "load",
  })
  await page.waitForSelector(".local-skill-import__candidate")
  await page.evaluate((failed) => {
    const statuses = ["installed", "unchanged", "skipped", "failed"]
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "localSkillImportResult",
          result: {
            token: "storybook-import-token",
            scope: "project",
            activation: failed
              ? {
                  status: "failed",
                  phase: "post-refresh-verification",
                  missingIds: ["iar-gcc-01-baseline-report", "iar-gcc-02-cmake-bootstrap"],
                }
              : { status: "ready" },
            items: Array.from({ length: 24 }, (_, index) => {
              const status = statuses[index % statuses.length]
              return {
                id: `iar-gcc-${String(index + 1).padStart(2, "0")}-long-portable-skill-name`,
                status,
                error: status === "failed" ? "测试失败信息必须保持在对应结果行内。" : undefined,
              }
            }),
          },
        },
      }),
    )
  }, failed)
  await page.waitForSelector(".local-skill-import__result-list")
}

for (const size of SIZES) {
  for (const failed of [false, true]) {
    test(`batch Skill import ${failed ? "activation failure" : "success"} remains aligned at ${size.width}x${size.height}`, async ({
      page,
    }) => {
      await load(page, size.width, size.height, failed)

      const layout = await page.locator(".local-skill-import").evaluate((root) => {
        const result = root.querySelector<HTMLElement>(".local-skill-import__result")!
        const list = root.querySelector<HTMLElement>(".local-skill-import__result-list")!
        const rows = Array.from(list.children) as HTMLElement[]
        const rects = rows.map((row) => row.getBoundingClientRect())
        const shell = root.getBoundingClientRect()
        const first = rects[0]!
        const overlaps = rects.slice(1).filter((rect, index) => rect.top < rects[index]!.bottom - 0.5)
        const escaped = rows.filter((row) => {
          const item = row.getBoundingClientRect()
          const status = row.querySelector<HTMLElement>("span")?.getBoundingClientRect()
          if (!status) return true
          return status.left < item.left - 0.5 || status.right > item.right + 0.5
        })

        return {
          count: rows.length,
          scrollable: root.scrollHeight > root.clientHeight,
          horizontal: root.scrollWidth - root.clientWidth,
          firstVisible: first.top >= shell.top - 0.5 && first.top >= result.getBoundingClientRect().top - 0.5,
          overlaps: overlaps.length,
          escaped: escaped.length,
        }
      })

      expect(layout.count).toBe(24)
      expect(layout.scrollable).toBe(true)
      expect(layout.horizontal).toBeLessThanOrEqual(1)
      expect(layout.firstVisible).toBe(true)
      expect(layout.overlaps).toBe(0)
      expect(layout.escaped).toBe(0)
      if (failed) {
        await expect(page.locator(".local-skill-import__notice.activation")).toContainText("iar-gcc-01-baseline-report")
      }

      const done = page.locator(".local-skill-import__result .local-skill-import__actions button")
      await page.locator(".local-skill-import").evaluate((root) => {
        root.scrollTop = root.scrollHeight
      })
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))

      const visible = await done.evaluate((button) => {
        const root = button.closest<HTMLElement>(".local-skill-import")!
        const shell = root.getBoundingClientRect()
        const action = button.getBoundingClientRect()
        return action.top >= shell.top - 0.5 && action.bottom <= shell.bottom + 0.5
      })
      expect(visible).toBe(true)
    })
  }
}
