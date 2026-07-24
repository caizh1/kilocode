import { expect, test } from "@playwright/test"
import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import JSZip from "jszip"

const evidence = resolve(".runtime/design-qa/evidence/extension-market")

test("extension upload explains automatic updates and renders the immutable build conflict", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("chipmate-market-session-active", "1")
    sessionStorage.setItem("chipmate-market-csrf", "csrf-extension-publish")
  })
  await page.route("**/api/v1/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "market-alice-000000000000000000000000000000000000",
        displayName: "Alice",
        firstSeenAt: "2026-07-22T00:00:00.000Z",
        lastSeenAt: "2026-07-22T00:00:00.000Z",
      }),
    })
  })
  const existing = "a".repeat(64)
  const incoming = "b".repeat(64)
  await page.route("**/api/v1/extension-publications", async (route) => {
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        code: "EXTENSION_VERSION_CONFLICT",
        message: "同一扩展版本和平台已存在 SHA-256 不同的构建，未保存本次上传。",
        conflict: {
          extensionId: "chipmate.chipmate",
          version: "1.2.3",
          target: "darwin-arm64",
          existing: {
            id: "extension-existing",
            filename: "chipmate-1.2.3-darwin-arm64.vsix",
            sha256: existing,
            publishedAt: "2026-07-22T00:00:00.000Z",
            source: "web",
            canDelete: true,
          },
          incoming: { filename: "chipmate-1.2.3-rebuild-darwin-arm64.vsix", sha256: incoming },
        },
      }),
    })
  })
  const zip = new JSZip()
  zip.file("extension/package.json", JSON.stringify({ publisher: "chipmate", name: "chipmate", version: "1.2.3" }))
  zip.file("extension.vsixmanifest", '<PackageManifest><Metadata><Identity Publisher="chipmate" Id="chipmate" Version="1.2.3" TargetPlatform="darwin-arm64" /></Metadata></PackageManifest>')
  const data = await zip.generateAsync({ type: "nodebuffer" })

  await page.goto("/extensions/publish")
  await expect(page.getByText(/上传成功后立即进入客户端自动更新通道/)).toBeVisible()
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "chipmate-1.2.3-rebuild-darwin-arm64.vsix",
    mimeType: "application/vnd.microsoft.vscode.vsix",
    buffer: data,
  })
  await page.getByRole("button", { name: "开始批量上传" }).click()
  await expect(page.getByRole("heading", { name: "同版本构建冲突" })).toBeVisible()
  await expect(page.getByText(existing, { exact: true })).toBeVisible()
  await expect(page.getByText(incoming, { exact: true })).toBeVisible()
  await expect(page.getByText("提升版本后重新打包上传（推荐）", { exact: true })).toBeVisible()
  await expect(page.getByText("在“我的插件”下架原版本后重试", { exact: true })).toBeVisible()
  await mkdir(evidence, { recursive: true })
  for (const size of [{ width: 1_484, height: 1_060 }, { width: 1_440, height: 1_024 }, { width: 1_050, height: 1_024 }]) {
    await page.setViewportSize(size)
    await expect(page.locator("html")).toHaveJSProperty("scrollWidth", size.width)
    await page.screenshot({
      path: resolve(evidence, `extension-upload-conflict-${size.width}x${size.height}.png`),
      fullPage: true,
    })
  }
})
