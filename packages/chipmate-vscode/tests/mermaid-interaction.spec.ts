import { expect, test } from "@playwright/test"

const GLOBALS = "colorScheme:dark;theme:chipmate-vscode;vscodeTheme:dark-modern"

function story(id: string) {
  return `/iframe.html?id=${id}&viewMode=story&globals=${GLOBALS}`
}

test.describe("QA Mermaid", () => {
  test("renders valid and mmd diagrams while containing invalid syntax", async ({ page }) => {
    await page.goto(story("chat--qa-mermaid-complete"), { waitUntil: "load" })
    await page.waitForSelector('[data-mermaid-state="rendered"]')
    await expect(page.locator('[data-mermaid-state="rendered"]')).toHaveCount(2)
    await expect(page.locator('[data-mermaid-state="error"]')).toHaveCount(1)
    await expect(page.getByRole("button", { name: "Prepare repair" })).toBeVisible()
  })

  test("keeps Mermaid source while a response is streaming", async ({ page }) => {
    await page.goto(story("chat--qa-mermaid-streaming"), { waitUntil: "load" })
    await expect(page.locator('[data-mermaid-state="rendered"]')).toHaveCount(0)
    await expect(page.locator('pre > code[data-lang="mermaid"]')).toHaveCount(3)
  })

  test("zooms, fits, opens the viewer, and toggles source", async ({ page }) => {
    await page.goto(story("chat--qa-mermaid-complete"), { waitUntil: "load" })
    const diagram = page.locator('[data-mermaid-state="rendered"]').first()
    const second = page.locator('[data-mermaid-state="rendered"]').nth(1)
    await diagram.waitFor()
    const value = diagram.locator('[data-slot="markdown-mermaid-zoom-value"]')
    const other = second.locator('[data-slot="markdown-mermaid-zoom-value"]')
    const initial = await value.textContent()
    const unchanged = await other.textContent()
    await diagram.getByRole("button", { name: "Zoom in" }).click()
    await expect(value).not.toHaveText(initial ?? "")
    await expect(other).toHaveText(unchanged ?? "")
    await diagram.getByRole("button", { name: "Fit diagram" }).click()
    await diagram.getByRole("button", { name: "Show Mermaid source" }).click()
    await expect(diagram.locator("pre")).toBeVisible()
    const opener = diagram.getByRole("button", { name: "Open diagram viewer" })
    await opener.click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText("Mermaid diagram")).toBeVisible()
    const viewer = dialog.locator('[data-slot="markdown-mermaid-zoom-value"]')
    const before = await viewer.textContent()
    const plus = dialog.getByRole("button", { name: "Zoom in" })
    await plus.click()
    await expect(viewer).not.toHaveText(before ?? "")
    for (let index = 0; index < 6; index++) await plus.click()
    const canvas = dialog.locator('[data-slot="markdown-mermaid-viewer-canvas"]')
    const box = await canvas.boundingBox()
    expect(box).not.toBeNull()
    await canvas.evaluate((element) => {
      element.scrollLeft = 0
    })
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.down()
    await page.mouse.move(box!.x + box!.width / 2 - 100, box!.y + box!.height / 2)
    await page.mouse.up()
    await expect.poll(() => canvas.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog")).toBeHidden()
    await expect(opener).toBeFocused()
  })

  test("prepares a repair draft without sending a message", async ({ page }) => {
    await page.goto(story("chat--qa-mermaid-complete"), { waitUntil: "load" })
    const before = await page.locator('[data-row="user"]').count()
    await page.getByRole("button", { name: "Prepare repair" }).click()
    const prompt = page.locator("textarea").last()
    await expect(prompt).toHaveValue(/Fix the Mermaid syntax error/)
    await expect(prompt).toHaveValue(/flowchart TD/)
    await expect(page.locator('[data-row="user"]')).toHaveCount(before)
  })

  test("emits SVG and PNG save events", async ({ page }) => {
    await page.goto(story("chat--qa-mermaid-complete"), { waitUntil: "load" })
    await page.waitForSelector('[data-mermaid-state="rendered"]')
    await page.evaluate(() => {
      ;(window as Window & { mermaidSaved?: { dataUrl: string; filename: string }[] }).mermaidSaved = []
      window.addEventListener("chipmate:save-image", (event) => {
        event.preventDefault()
        const detail = (event as CustomEvent<{ dataUrl: string; filename: string }>).detail
        ;(window as Window & { mermaidSaved?: { dataUrl: string; filename: string }[] }).mermaidSaved?.push(detail)
      })
    })
    const diagram = page.locator('[data-mermaid-state="rendered"]').first()
    await diagram.getByRole("button", { name: "Download" }).click()
    await page.getByRole("menuitem", { name: "Download SVG" }).focus()
    await page.keyboard.press("Enter")
    await page.waitForFunction(
      () => (window as Window & { mermaidSaved?: unknown[] }).mermaidSaved?.length === 1,
    )
    await diagram.getByRole("button", { name: "Download" }).click()
    await page.getByRole("menuitem", { name: "Download PNG" }).focus()
    await page.keyboard.press("Enter")
    await page.waitForFunction(
      () => (window as Window & { mermaidSaved?: unknown[] }).mermaidSaved?.length === 2,
    )
    const saved = await page.evaluate(
      () => (window as Window & { mermaidSaved?: { dataUrl: string; filename: string }[] }).mermaidSaved,
    )
    expect(saved?.[0]?.filename).toBe("mermaid-diagram.svg")
    expect(saved?.[0]?.dataUrl.startsWith("data:image/svg+xml;base64,")).toBe(true)
    expect(saved?.[1]?.filename).toBe("mermaid-diagram.png")
    expect(saved?.[1]?.dataUrl.startsWith("data:image/png;base64,")).toBe(true)
  })

  test("keeps controls inside the diagram at supported widths and themes", async ({ page }) => {
    for (const width of [300, 420, 560, 940]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(story("chat--qa-mermaid-complete"), { waitUntil: "load" })
      const diagram = page.locator('[data-mermaid-state="rendered"]').first()
      await diagram.waitFor()
      const card = await diagram.boundingBox()
      const toolbar = await diagram.locator('[data-slot="markdown-mermaid-actions"]').boundingBox()
      expect(card).not.toBeNull()
      expect(toolbar).not.toBeNull()
      expect(toolbar!.x).toBeGreaterThanOrEqual(card!.x)
      expect(toolbar!.x + toolbar!.width).toBeLessThanOrEqual(card!.x + card!.width + 1)
    }

    for (const globals of [
      "colorScheme:light;theme:chipmate-vscode;vscodeTheme:light-modern",
      "colorScheme:dark;theme:chipmate-vscode;vscodeTheme:dark-modern",
      "colorScheme:dark;theme:chipmate-vscode;vscodeTheme:hc-black",
    ]) {
      await page.goto(`/iframe.html?id=chat--qa-mermaid-complete&viewMode=story&globals=${globals}`, {
        waitUntil: "load",
      })
      await expect(page.locator('[data-mermaid-state="rendered"]')).toHaveCount(2)
      await expect(page.locator('[data-mermaid-state="error"]')).toHaveCount(1)
    }
  })
})
