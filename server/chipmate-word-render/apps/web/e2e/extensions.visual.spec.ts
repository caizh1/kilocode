import { expect, test } from "@playwright/test"
import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"

const evidence = resolve(".runtime/design-qa/evidence/extension-market")

test("capture extension market design QA evidence in installed Chrome", async ({ page }, info) => {
  test.skip(info.project.name !== "chrome", "Design QA evidence is accepted only from installed macOS Chrome.")
  await mkdir(evidence, { recursive: true })
  await expect
    .poll(async () => {
      const response = await page.request.get("/api/v1/extensions?limit=40")
      if (!response.ok()) return 0
      return ((await response.json()) as { items: unknown[] }).items.length
    })
    .toBeGreaterThanOrEqual(4)

  await page.setViewportSize({ width: 1_484, height: 1_060 })
  await page.goto("/extensions")
  await expect(page.getByRole("heading", { name: /发现团队可信赖的/ })).toBeVisible()
  await shot(page, "01-extension-home-1484x1060.png")

  await page.goto("/extensions/ramaxel.cpp-hybrid")
  await expect(page.getByRole("heading", { name: "C/C++ Hybrid Retrieval", exact: true })).toBeVisible()
  await shot(page, "02-extension-detail-1484x1060.png")
  await page.getByRole("combobox", { name: "目标平台" }).selectOption("linux-x64")
  await page.getByRole("button", { name: "下载 VSIX", exact: true }).click()
  await expect(page.getByRole("heading", { name: "检测到同版本不同 SHA" })).toBeVisible()
  await shot(page, "03-extension-sha-conflict-1484x1060.png")

  await page.goto("/extensions/publish")
  await expect(page.getByRole("heading", { name: "上传 VS Code 插件", exact: true })).toBeVisible()
  await shot(page, "04-extension-upload-idle-1484x1060.png")

  await page.goto("/extensions/analytics")
  await expect(page.getByRole("heading", { name: "插件市场分析", exact: true })).toBeVisible()
  await shot(page, "05-extension-analytics-1484x1060.png")

  await page.goto("/status")
  await expect(page.getByText("VS Code 插件市场", { exact: true })).toBeVisible()
  await shot(page, "06-extension-service-status-1484x1060.png")

  const stamp = new Date().toISOString()
  const summary = {
    id: "ramaxel.cpp-hybrid",
    publisher: "ramaxel",
    name: "cpp-hybrid",
    displayName: "C/C++ Hybrid Retrieval",
    description: "Graph + BM25 构建",
    version: "2.4.0-beta.2",
    engineVscode: "^1.95.0",
    categories: ["Programming Languages"],
    keywords: ["C++"],
    targets: ["linux-x64"],
    uploader: "E2E 上传者",
    systemPlugin: false,
    prerelease: true,
    downloads: 1284,
    favorites: 92,
    rating: 4.8,
    ratingCount: 28,
    updatedAt: stamp,
  }
  const artifact = {
    id: "extension-visual-artifact",
    extensionId: summary.id,
    version: summary.version,
    target: "linux-x64",
    sha256: "a".repeat(64),
    size: 92 * 1024 * 1024,
    filename: "cpp-hybrid-2.4.0-beta.2-linux-x64.vsix",
    uploader: { id: "user-extension-e2e", displayName: "E2E 上传者" },
    source: "web",
    prerelease: true,
    conflict: true,
    downloads: 1284,
    publishedAt: stamp,
    status: "published",
    downloadUrl: "/api/v1/extensions/ramaxel.cpp-hybrid/artifacts/extension-visual-artifact/download",
  }
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "user-extension-e2e", displayName: "E2E 上传者", firstSeenAt: stamp }),
    }),
  )
  await page.route("**/api/v1/events/batch", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ accepted: 1 }) }),
  )
  await page.route("**/api/v1/me/extensions/uploads", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([artifact]) }),
  )
  await page.route("**/api/v1/me/extensions/favorites", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([summary]) }),
  )
  await page.route("**/api/v1/me/extensions/reviews", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ userId: "user-extension-e2e", userName: "E2E 上传者", extensionId: summary.id, artifactId: artifact.id, rating: 5, comment: "召回证据清晰。", createdAt: stamp, updatedAt: stamp }]),
    }),
  )
  await page.evaluate(() => {
    sessionStorage.setItem("chipmate-market-session-active", "1")
    sessionStorage.removeItem("chipmate-market-csrf")
  })
  await page.goto("/extensions/me")
  await expect(page.getByRole("heading", { name: "我的插件中心", exact: true })).toBeVisible()
  await shot(page, "07-extension-center-1484x1060.png")

  await page.route("**/api/v1/extension-publications", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 4_000))
    const request = route.request()
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: request.headers()["x-publication-run-id"],
        ownerId: "user-extension-e2e",
        filename: "cpp-hybrid-2.5.0-linux-x64.vsix",
        totalBytes: 16 * 1024 * 1024,
        idempotencyKey: request.headers()["idempotency-key"],
        status: "PUBLISHED",
        stage: "complete",
        createdAt: stamp,
        updatedAt: stamp,
      }),
    })
  })
  await page.goto("/extensions/publish")
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "cpp-hybrid-2.5.0-linux-x64.vsix",
    mimeType: "application/vnd.microsoft.vscode.vsix",
    buffer: Buffer.alloc(16 * 1024 * 1024, 9),
  })
  await expect(page.getByText("1 个待上传", { exact: true })).toBeVisible()
  await page.waitForTimeout(500)
  await shot(page, "08-extension-upload-review-1484x1060.png")
  await page.getByRole("button", { name: "开始批量上传" }).click()
  await expect(page.locator(".prominent-progress")).toBeVisible()
  await page.waitForTimeout(500)
  await shot(page, "09-extension-upload-progress-1484x1060.png")
  await expect(page.getByText("1 个发布成功", { exact: true })).toBeVisible({ timeout: 15_000 })

  for (const size of [
    { width: 1_440, height: 1_024 },
    { width: 1_050, height: 1_024 },
  ]) {
    await page.setViewportSize(size)
    await page.goto("/extensions")
    await expect(page.getByRole("heading", { name: /发现团队可信赖的/ })).toBeVisible()
    await shot(page, `extension-home-${size.width}x${size.height}.png`)
    await page.goto("/extensions/publish")
    await expect(page.getByRole("heading", { name: "上传 VS Code 插件", exact: true })).toBeVisible()
    await shot(page, `extension-upload-idle-${size.width}x${size.height}.png`)
  }
})

async function shot(page: import("@playwright/test").Page, name: string) {
  await page.screenshot({ path: resolve(evidence, name), animations: "allow" })
}
