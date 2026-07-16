import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

const issues = new WeakMap<Page, string[]>()

test.beforeEach(async ({ page }) => {
  const found: string[] = []
  issues.set(page, found)
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") found.push(`${msg.type()}: ${msg.text()}`)
  })
  page.on("pageerror", (err) => found.push(`pageerror: ${err.message}`))
})

test.afterEach(async ({ page }) => {
  expect(issues.get(page) ?? []).toEqual([])
})

async function waitForCatalog(page: Page) {
  await expect
    .poll(async () => {
      const response = await page.request.get("/api/v1/extensions?limit=40")
      if (!response.ok()) return 0
      return ((await response.json()) as { items: unknown[] }).items.length
    })
    .toBeGreaterThanOrEqual(4)
}

test("extension directory follows approved copy, accessibility, and desktop geometry", async ({ page }) => {
  await waitForCatalog(page)
  for (const size of [
    { width: 1_484, height: 1_060 },
    { width: 1_440, height: 1_024 },
    { width: 1_050, height: 1_024 },
  ]) {
    await page.setViewportSize(size)
    await page.goto("/extensions")
    await expect(page.getByRole("heading", { name: /发现团队可信赖的/ })).toBeVisible()
    await expect(page.getByRole("button", { name: "发布插件", exact: true })).toBeVisible()
    await expect(page.getByText("上传新技能", { exact: true })).toHaveCount(0)
    await expect(page.getByText(/所有插件.*病毒审计/)).toHaveCount(0)
    const geometry = await page.locator("html").evaluate((node) => ({
      overflow: node.scrollWidth > node.clientWidth + 1,
      controls: [...document.querySelectorAll(".topbar nav button")].every((button) => {
        const box = button.getBoundingClientRect()
        return box.left >= 0 && box.right <= innerWidth + 1 && box.width > 0 && box.height > 0
      }),
      cards: [...document.querySelectorAll(".extension-card")].every((card) => {
        const box = card.getBoundingClientRect()
        return box.left >= 0 && box.right <= innerWidth + 1 && box.width > 0 && box.height > 0
      }),
    }))
    expect(geometry.overflow, `${size.width}x${size.height} horizontal overflow`).toBe(false)
    expect(geometry.controls, `${size.width}x${size.height} topbar controls`).toBe(true)
    expect(geometry.cards, `${size.width}x${size.height} card containment`).toBe(true)
  }

  await page.setViewportSize({ width: 1_484, height: 1_060 })
  await page.goto("/extensions")
  const scan = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze()
  expect(scan.violations).toEqual([])
})

test("extension detail requires a target and explicit SHA conflict consent", async ({ page }) => {
  await waitForCatalog(page)
  await page.goto("/extensions/ramaxel.cpp-hybrid")
  await expect(page.getByRole("heading", { name: "C/C++ Hybrid Retrieval", exact: true })).toBeVisible()
  await expect(page.getByRole("combobox", { name: "目标平台" })).toHaveValue("")
  await page.getByRole("combobox", { name: "目标平台" }).selectOption("linux-x64")
  await page.getByRole("button", { name: "下载 VSIX", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("heading", { name: "检测到同版本不同 SHA" })).toBeVisible()
  await expect(dialog.getByRole("radio", { checked: true })).toHaveCount(0)
  await expect(dialog.getByRole("button", { name: "下载所选 VSIX" })).toBeDisabled()
  await expect(dialog.locator("code").first()).toHaveText(/^[a-f0-9]{64}$/)
  await dialog.getByRole("radio").first().check()
  await dialog.getByRole("checkbox").check()
  await expect(dialog.getByRole("button", { name: "下载所选 VSIX" })).toBeEnabled()
})

test("publish page exposes a prominent real XHR upload progress state", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("chipmate-market-session-active", "1")
    sessionStorage.setItem("chipmate-market-csrf", "csrf-e2e")
  })
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "user-extension-e2e", displayName: "E2E 上传者", firstSeenAt: new Date().toISOString() }),
    }),
  )
  await page.route("**/api/v1/events/batch", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ accepted: 1 }) }),
  )
  await page.route("**/api/v1/extension-publications", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 450))
    const request = route.request()
    const stamp = new Date().toISOString()
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: request.headers()["x-publication-run-id"],
        ownerId: "user-extension-e2e",
        filename: "large-preview.vsix",
        totalBytes: 8 * 1024 * 1024,
        idempotencyKey: request.headers()["idempotency-key"],
        status: "PUBLISHED",
        stage: "complete",
        createdAt: stamp,
        updatedAt: stamp,
      }),
    })
  })
  await page.goto("/extensions/publish")
  await expect(page.getByRole("heading", { name: "上传 VS Code 插件", exact: true })).toBeVisible()
  await expect(page.getByText("上传新技能", { exact: true })).toHaveCount(0)
  await page.locator('input[type="file"]').setInputFiles({
    name: "large-preview.vsix",
    mimeType: "application/vnd.microsoft.vscode.vsix",
    buffer: Buffer.alloc(8 * 1024 * 1024, 7),
  })
  await page.getByRole("button", { name: "开始上传并发布" }).click()
  const progress = page.locator(".prominent-progress")
  await expect(progress).toBeVisible()
  const box = await progress.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(70)
  await expect(page.getByText(/\/ 8\.0 MB/)).toBeVisible()
  await expect(page.getByText("插件发布成功", { exact: true })).toBeVisible()
})

test("extension analytics and service status expose public and operational data", async ({ page }) => {
  await waitForCatalog(page)
  await page.goto("/extensions/analytics")
  await expect(page.getByRole("heading", { name: "插件市场分析", exact: true })).toBeVisible()
  await expect(page.getByText("30 天增长", { exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "最近动态", exact: true })).toBeVisible()
  await page.goto("/status")
  await expect(page.getByText("VS Code 插件市场", { exact: true })).toBeVisible()
})
