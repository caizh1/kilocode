import { test, expect, chromium, type Page, type Frame } from "@playwright/test"

const endpoint = process.env.CHIPMATE_APPEARANCE_CDP
const directory = process.env.CHIPMATE_APPEARANCE_WORKSPACE
test.skip(!endpoint || !directory, "需要显式指定隔离开发宿主及验收工作区。")

async function command(page: Page, title: string) {
  await page.keyboard.press("F1")
  const input = page.locator(".quick-input-widget input")
  await input.fill(`>${title}`)
  await page.getByRole("option", { name: title }).first().click()
  await input.waitFor({ state: "hidden" })
}
async function manager(page: Page): Promise<Frame> {
  await command(page, "Developer: Reload Webviews")
  await page.getByRole("tab", { name: "Agent Manager", exact: true }).last().click()
  let result: Frame | undefined
  await expect
    .poll(async () => {
      for (const frame of page.frames()) {
        if (
          !(await frame
            .locator(".am-layout")
            .count()
            .catch(() => 0))
        )
          continue
        const id = new URL(frame.url()).searchParams.get("id")
        if (id && (await page.locator(`iframe.webview[name="${id}"]`).isVisible())) result = frame
      }
      return !!result
    })
    .toBe(true)
  return result!
}

test("本机四种引用入口经过正式宿主，代码包含路径和选区", async ({}, info) => {
  const browser = await chromium.connectOverCDP(endpoint!)
  try {
    const page = browser.contexts()[0]!.pages()[0]!
    page.setDefaultTimeout(12_000)
    await page.setViewportSize({ width: 1488, height: 1056 })
    const frame = await manager(page)
    const input = frame.locator(".prompt-input")
    await input.fill("霓虹引用验收 ")
    const picker = page.locator(".quick-input-widget input")
    await frame.getByRole("button", { name: "引用文件", exact: true }).click()
    await picker.waitFor({ state: "visible" })
    await picker.fill(`${directory}/ufs_init.c`)
    await picker.press("Enter")
    await expect(input).toHaveValue(/@ufs_init\.c/)
    await frame.getByRole("button", { name: "引用文件夹", exact: true }).click()
    await picker.waitFor({ state: "visible" })
    await picker.press("Escape")
    await expect(input).toHaveValue(/@ufs_init\.c/)
    await frame.getByRole("button", { name: "引用文件夹", exact: true }).click()
    await picker.waitFor({ state: "visible" })
    await picker.fill(`${directory}/`)
    await picker.press("Enter")
    await expect(input).toHaveValue(new RegExp(`@${directory}`))

    // 从真实编辑器取得选区，聚焦 Webview 后仍使用此前编辑器。
    await page.keyboard.press("ControlOrMeta+p")
    await picker.fill(`${directory}/ufs_init.c`)
    await picker.press("Enter")
    await picker.waitFor({ state: "hidden" })
    await page
      .getByRole("tab", { name: /ufs_init.c/ })
      .last()
      .dblclick()
    await page.locator(".monaco-editor .view-lines").first().click()
    await page.keyboard.press("ControlOrMeta+a")
    await expect(page.locator(".monaco-editor .selected-text").first()).toBeVisible()
    await page.getByRole("tab", { name: "Agent Manager", exact: true }).last().click()
    await frame.getByRole("button", { name: "引用选中代码", exact: true }).click()
    await expect(input).toHaveValue(/ufs_init\.c:1-/)
    await expect(input).toHaveValue(/```/)
    await frame.getByRole("button", { name: "上下文引用", exact: true }).click()
    await frame.getByRole("button", { name: "添加当前文件", exact: true }).click()
    await expect(input).toHaveValue(/@ufs_init\.c[\s\S]*@ufs_init\.c/)
    const chooser = page.waitForEvent("filechooser")
    await frame.getByRole("button", { name: "添加图片", exact: true }).click()
    await (
      await chooser
    ).setFiles({
      name: "霓虹验收.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    })
    await expect(frame.locator(".image-attachment")).toHaveCount(1)
    await frame.locator(".image-attachment-remove").click()
    await expect(frame.locator(".image-attachment")).toHaveCount(0)
    await page.screenshot({ path: info.outputPath("真实引用入口.png") })
  } finally {
    await browser.close()
  }
})
