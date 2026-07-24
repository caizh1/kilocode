import { expect, test, type Page } from "@playwright/test"

const GLOBALS = "vscodeTheme:dark-modern"

async function load(page: Page, id: string, width: number) {
  await page.addInitScript(() => {
    const messages: unknown[] = []
    Object.defineProperty(window, "__chipmateMessages", { value: messages })
    Object.defineProperty(window, "acquireVsCodeApi", {
      value: () => ({
        postMessage: (message: unknown) => messages.push(message),
        getState: () => undefined,
        setState: () => {},
      }),
    })
  })
  await page.setViewportSize({ width, height: 760 })
  await page.goto(`/iframe.html?id=${id}&viewMode=story&globals=${GLOBALS}`, { waitUntil: "networkidle" })
}

async function respond(page: Page, models: Array<{ id: string; name: string }>) {
  const request = () =>
    page.evaluate(() => {
      const scope = window as unknown as { __chipmateMessages: Array<{ type?: string; requestId?: string }> }
      return scope.__chipmateMessages.findLast((message) => message.type === "fetchCustomProviderModels")?.requestId
    })
  await expect.poll(request).not.toBeUndefined()
  const requestId = await request()
  await page.evaluate(
    ({ id, result }) => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "customProviderModelsFetched", requestId: id, models: result },
        }),
      )
    },
    { id: requestId, result: models },
  )
}

for (const width of [420, 300]) {
  test(`key-only custom provider remains usable at ${width}px`, async ({ page }) => {
    await load(page, `settings--custom-provider-quick-${width}`, width)

    const key = page.getByLabel("API 密钥")
    await expect(key).toBeVisible()
    await expect(page.getByRole("button", { name: "保存并在 QA 中使用" })).toBeDisabled()
    await expect(page.locator("span", { hasText: /^推理 · low$/ })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    await key.fill("sk-test")
    await respond(page, [
      { id: "qwen-coder-30b0-preview", name: "Qwen Preview" },
      { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
      { id: "qwen-coder-30b0", name: "Qwen Coder 30B" },
    ])
    await expect(page.getByText("自动补全 · qwen-coder-30b0", { exact: true })).toBeVisible()
    await expect(page.getByText("保存 Provider 后将自动启用。", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "保存并在 QA 中使用" })).toBeEnabled()

    await page.getByRole("button", { name: "高级设置" }).click()
    await expect(page.getByLabel("提供商 ID")).toHaveValue("chipmate")
    await expect(page.getByLabel("基础 URL")).toHaveValue("https://api.example.com/v1")
    const values = () =>
      page.evaluate(() => Array.from(document.querySelectorAll<HTMLInputElement>("input"), (input) => input.value))
    await expect.poll(async () => (await values()).filter((value) => value === "deepseek-v4-flash").length).toBe(1)
    await expect.poll(async () => (await values()).filter((value) => value === "qwen-coder-30b0").length).toBe(1)
    await expect(page.getByRole("button", { name: "添加变体" })).toBeVisible()
    await expect(page.locator('input[value="medium"], input[value="high"], input[value="max"]')).toHaveCount(0)
  })

  test(`key-only custom provider warns when autocomplete is unavailable at ${width}px`, async ({ page }) => {
    await load(page, `settings--custom-provider-quick-${width}`, width)
    await page.getByLabel("API 密钥").fill("sk-test")
    await respond(page, [{ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }])

    await expect(page.getByText("服务端未返回自动补全模型 qwen-coder-30b0。", { exact: true })).toBeVisible()
    await expect(page.getByText("仍可保存 QA；现有自动补全设置不会改变。", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "保存并在 QA 中使用" })).toBeEnabled()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
}

test("public custom provider keeps the full form", async ({ page }) => {
  await load(page, "settings--custom-provider-public", 420)

  await expect(page.getByLabel("提供商 ID")).toBeVisible()
  await expect(page.getByRole("button", { name: "高级设置" })).toHaveCount(0)
})
