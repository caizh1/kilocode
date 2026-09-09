import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"
import { strToU8, zipSync } from "fflate"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

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

test("extension routes distinguish capability failures from a disabled market", async ({ page }) => {
  await page.route("**/api/v1/capabilities", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{" }),
  )
  await page.goto("/extensions")
  await expect(page.getByText(/无法读取插件市场能力/)).toBeVisible()
  await expect(page.getByRole("heading", { name: "VS Code 插件市场尚未启用" })).toHaveCount(0)
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
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "large-preview.vsix",
    mimeType: "application/vnd.microsoft.vscode.vsix",
    buffer: Buffer.alloc(8 * 1024 * 1024, 7),
  })
  await page.getByRole("button", { name: "开始批量上传" }).click()
  const progress = page.locator(".prominent-progress")
  await expect(progress).toBeVisible()
  const box = await progress.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(70)
  await expect(page.getByText(/\/ 8\.0 MB/)).toBeVisible()
  await expect(page.getByText("1 个发布成功", { exact: true })).toBeVisible()
})

test("batch publish reauthenticates inline and keeps the prepared queue", async ({ page }) => {
  const headers: string[] = []
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "x-csrf-token": "csrf-refreshed-e2e" },
    body: JSON.stringify({ id: "user-extension-reauth", displayName: "重新登录用户", firstSeenAt: new Date().toISOString() }),
  }))
  await page.route("**/api/v1/events/batch", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ accepted: 1 }) }),
  )
  await page.route("**/api/v1/extension-publications", (route) => {
    const request = route.request()
    headers.push(request.headers()["x-csrf-token"] ?? "")
    const stamp = new Date().toISOString()
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: request.headers()["x-publication-run-id"],
        ownerId: "user-extension-reauth",
        filename: "reauth.vsix",
        totalBytes: request.postDataBuffer()?.length ?? 0,
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
    name: "reauth.vsix",
    mimeType: "application/vnd.microsoft.vscode.vsix",
    buffer: Buffer.from("reauth"),
  })
  await page.getByRole("button", { name: "开始批量上传" }).click()
  await expect(page.getByRole("dialog").getByRole("heading", { name: "登录 ChipMate Market" })).toBeVisible()
  await expect(page).toHaveURL(/\/extensions\/publish$/)
  await page.getByLabel("用户名").fill("alice")
  await page.getByLabel("密码").fill("password")
  await page.getByRole("button", { name: "安全登录" }).click()
  await expect(page.getByText("1 个发布成功", { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/extensions\/publish$/)
  expect(headers).toEqual(["csrf-refreshed-e2e"])
})

test("batch publish extracts VSIX locally and never uploads archives or unrelated files", async ({ page }) => {
  const sent: string[] = []
  const folder = resolve(".runtime/e2e-batch-folder")
  await rm(folder, { recursive: true, force: true })
  await mkdir(resolve(folder, "nested"), { recursive: true })
  await writeFile(resolve(folder, "nested", "folder-plugin.vsix"), "folder-vsix")
  await writeFile(resolve(folder, "notes.md"), "not-uploaded")
  await page.addInitScript(() => {
    sessionStorage.setItem("chipmate-market-session-active", "1")
    sessionStorage.setItem("chipmate-market-csrf", "csrf-batch-e2e")
  })
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "user-extension-batch", displayName: "批量上传者", firstSeenAt: new Date().toISOString() }),
    }),
  )
  await page.route("**/api/v1/events/batch", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ accepted: 1 }) }),
  )
  await page.route("**/api/v1/extension-publications", async (route) => {
    const request = route.request()
    const filename = decodeURIComponent(request.headers()["x-vsix-filename"] ?? "")
    sent.push(filename)
    expect(request.headers()["content-type"]).toContain("application/vnd.microsoft.vscode.vsix")
    const stamp = new Date().toISOString()
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: request.headers()["x-publication-run-id"],
        ownerId: "user-extension-batch",
        filename,
        totalBytes: request.postDataBuffer()?.length ?? 0,
        idempotencyKey: request.headers()["idempotency-key"],
        status: "PUBLISHED",
        stage: "complete",
        createdAt: stamp,
        updatedAt: stamp,
      }),
    })
  })
  const archive = zipSync({
    "linux/alpha.vsix": strToU8("alpha-vsix"),
    "windows/beta.vsix": strToU8("beta-vsix"),
    "docs/readme.txt": strToU8("not-uploaded"),
  })
  await page.goto("/extensions/publish")
  await page.locator('input[type="file"]').first().setInputFiles([
    {
      name: "release-bundle.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(archive.buffer, archive.byteOffset, archive.byteLength),
    },
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("also-not-uploaded") },
  ])
  await expect(page.getByText("2 个待上传", { exact: true })).toBeVisible()
  await expect(page.getByText("2 个已忽略", { exact: true })).toBeVisible()
  const accessibility = await new AxeBuilder({ page }).include(".extension-upload-grid").analyze()
  expect(accessibility.violations).toEqual([])
  await page.getByRole("button", { name: "开始批量上传" }).click()
  await expect(page.getByText("2 个发布成功", { exact: true })).toBeVisible()
  expect(sent.sort()).toEqual(["alpha.vsix", "beta.vsix"])
  await page.locator('input[type="file"]').nth(1).setInputFiles(folder)
  await expect(page.getByText("1 个待上传", { exact: true })).toBeVisible()
  await expect(page.getByText("1 个已忽略", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "开始批量上传" }).click()
  await expect(page.getByText("1 个发布成功", { exact: true })).toBeVisible()
  expect(sent.sort()).toEqual(["alpha.vsix", "beta.vsix", "folder-plugin.vsix"])
  await rm(folder, { recursive: true, force: true })
})

test("batch publish accepts more than twenty VSIX and keeps one request in flight", async ({ page }) => {
  const state = { active: 0, maximum: 0, sent: 0 }
  await page.addInitScript(() => {
    sessionStorage.setItem("chipmate-market-session-active", "1")
    sessionStorage.setItem("chipmate-market-csrf", "csrf-many-e2e")
  })
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ id: "user-extension-many", displayName: "批量上传者", firstSeenAt: new Date().toISOString() }),
  }))
  await page.route("**/api/v1/events/batch", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ accepted: 1 }) }),
  )
  await page.route("**/api/v1/extension-publications", async (route) => {
    state.active += 1
    state.maximum = Math.max(state.maximum, state.active)
    state.sent += 1
    await new Promise((resolve) => setTimeout(resolve, 10))
    const request = route.request()
    const stamp = new Date().toISOString()
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: request.headers()["x-publication-run-id"],
        ownerId: "user-extension-many",
        filename: decodeURIComponent(request.headers()["x-vsix-filename"] ?? ""),
        totalBytes: request.postDataBuffer()?.length ?? 0,
        idempotencyKey: request.headers()["idempotency-key"],
        status: "PUBLISHED",
        stage: "complete",
        createdAt: stamp,
        updatedAt: stamp,
      }),
    })
    state.active -= 1
  })
  await page.goto("/extensions/publish")
  await page.locator('input[type="file"]').first().setInputFiles(
    Array.from({ length: 41 }, (_, index) => ({
      name: `plugin-${index}.vsix`,
      mimeType: "application/vnd.microsoft.vscode.vsix",
      buffer: Buffer.from(String(index)),
    })),
  )
  await expect(page.getByText("41 个待上传", { exact: true })).toBeVisible()
  await expect(page.getByText("3 个逻辑批次", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "开始批量上传" }).click()
  await expect(page.getByText("41 个发布成功", { exact: true })).toBeVisible()
  expect(state.sent).toBe(41)
  expect(state.maximum).toBe(1)
})

test("stopping a batch aborts the active upload and never starts queued artifacts", async ({ page }) => {
  const state = { sent: 0 }
  await page.addInitScript(() => {
    sessionStorage.setItem("chipmate-market-session-active", "1")
    sessionStorage.setItem("chipmate-market-csrf", "csrf-cancel-e2e")
  })
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ id: "user-extension-cancel", displayName: "取消测试用户", firstSeenAt: new Date().toISOString() }),
  }))
  await page.route("**/api/v1/events/batch", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ accepted: 1 }) }),
  )
  await page.route("**/api/v1/extension-publications/*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ status: "CANCELLED", stage: "complete" }),
  }))
  await page.route("**/api/v1/extension-publications", async (route) => {
    state.sent += 1
    await new Promise((resolve) => setTimeout(resolve, 5_000))
    await route.fulfill({ status: 499, contentType: "application/json", body: JSON.stringify({ code: "UPLOAD_CANCELLED" }) }).catch(() => undefined)
  })
  await page.goto("/extensions/publish")
  await page.locator('input[type="file"]').first().setInputFiles(
    Array.from({ length: 3 }, (_, index) => ({
      name: `cancel-${index}.vsix`,
      mimeType: "application/vnd.microsoft.vscode.vsix",
      buffer: Buffer.alloc(256 * 1024, index),
    })),
  )
  await page.getByRole("button", { name: "开始批量上传" }).click()
  await expect.poll(() => state.sent).toBe(1)
  await page.getByRole("button", { name: "停止剩余上传" }).click()
  await expect(page.getByText("3 个取消", { exact: true })).toBeVisible({ timeout: 10_000 })
  expect(state.sent).toBe(1)
})

test("extension analytics and service status expose public and operational data", async ({ page }) => {
  await waitForCatalog(page)
  const day = 24 * 60 * 60 * 1_000
  const now = Date.now()
  const stamp = (offset: number) => new Date(now + offset * day).toISOString().slice(0, 10)
  const state = {
    trend: [
      { date: stamp(-5), downloads: 2, favorites: 0 },
      { date: stamp(-2), downloads: 1, favorites: 0 },
      { date: stamp(-1), downloads: 17, favorites: 0 },
      { date: stamp(0), downloads: 3, favorites: 0 },
    ],
  }
  await page.route("**/api/v1/analytics/extensions/overview", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      totals: { downloads: 23, favorites: 0, rating: 0, active: 21, growth30d: 100 },
      trend: state.trend,
      downloads: [],
      ratings: [],
      targets: [],
      activity: [],
    }),
  }))
  await page.goto("/extensions/analytics")
  await expect(page.getByRole("heading", { name: "插件市场分析", exact: true })).toBeVisible()
  await expect(page.getByText("30 天增长", { exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { name: "最近动态", exact: true })).toBeVisible()
  await expect(page.getByRole("list", { name: "最近30天下载趋势，合计 23 次，单日峰值 17 次" })).toBeVisible()
  await expect(page.locator(".trend-bar")).toHaveCount(30)
  for (const [offset, downloads, expected] of [[-5, 2, 11.7647], [-2, 1, 8], [-1, 17, 100], [0, 3, 17.6471]] as const) {
    const bar = page.getByRole("listitem", { name: `${stamp(offset)}，${downloads} 次下载`, exact: true })
    await expect(bar).toHaveAttribute("title", `${stamp(offset)}：${downloads} 次下载`)
    expect(await bar.evaluate((node) => Number.parseFloat((node as HTMLElement).style.height))).toBeCloseTo(expected, 3)
  }
  expect(await page.getByRole("listitem", { name: `${stamp(-3)}，0 次下载`, exact: true }).evaluate((node) => (node as HTMLElement).style.height)).toBe("0%")

  state.trend = []
  await page.reload()
  await expect(page.getByText("近30天暂无下载", { exact: true })).toBeVisible()
  await expect(page.locator(".trend-bar")).toHaveCount(0)
  await page.goto("/status")
  await expect(page.getByText("VS Code 插件市场", { exact: true })).toBeVisible()
})
