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

for (const width of [420, 300]) {
  test(`connected ChipMate is the first connected provider at ${width}px`, async ({ page }) => {
    await load(page, "settings--providers-internal-primary-only", width)

    const heading = page.getByRole("heading", { name: "已连接的提供商" })
    const chipmate = page.getByText("ChipMate", { exact: true })
    await expect(heading).toBeVisible()
    await expect(chipmate).toBeVisible()
    await expect(page.getByText("没有已连接的提供商", { exact: true })).toHaveCount(0)
    await expect(page.locator('svg[data-provider-brand="chipmate"]')).toHaveCount(1)

    const [headingBox, chipmateBox] = await Promise.all([heading.boundingBox(), chipmate.boundingBox()])
    expect(headingBox?.y).toBeLessThan(chipmateBox?.y ?? 0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
}

test("unconnected internal ChipMate stays configurable and does not suppress the empty state", async ({ page }) => {
  await load(page, "settings--providers-internal-primary-unconnected", 420)

  await expect(page.getByText("ChipMate", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "配置" })).toBeVisible()
  await expect(page.getByText("没有已连接的提供商", { exact: true })).toBeVisible()
  await expect(page.locator('svg[data-provider-brand="chipmate"]')).toHaveCount(1)
})

test("connected public ChipMate Gateway is listed without an empty state", async ({ page }) => {
  await load(page, "settings--providers-gateway-connected", 420)

  const heading = page.getByRole("heading", { name: "已连接的提供商" })
  const gateway = page.getByText("ChipMate Gateway", { exact: true })
  await expect(heading).toBeVisible()
  await expect(gateway).toBeVisible()
  await expect(page.getByText("没有已连接的提供商", { exact: true })).toHaveCount(0)
  await expect(page.locator('svg[data-provider-brand="chipmate"]')).toHaveCount(1)

  const [headingBox, gatewayBox] = await Promise.all([heading.boundingBox(), gateway.boundingBox()])
  expect(headingBox?.y).toBeLessThan(gatewayBox?.y ?? 0)
})

test("signed-out public ChipMate Gateway remains a connection entry", async ({ page }) => {
  await load(page, "settings--providers-configure", 420)

  await expect(page.getByText("ChipMate Gateway", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible()
  await expect(page.getByText("No connected providers", { exact: true })).toBeVisible()
})

async function saveAdditionalProvider(page: Page, providerID: string) {
  await page.getByLabel("提供商 ID").fill(providerID)
  await page.getByLabel("显示名称").fill(`${providerID} provider`)
  await page.getByLabel("基础 URL").fill(`https://${providerID}.example.com/v1`)
  await page.getByLabel("API 密钥").fill(`sk-${providerID}`)
  await page.getByLabel("ID", { exact: true }).fill(`${providerID}-chat`)
  await page.getByLabel("名称", { exact: true }).fill(`${providerID} chat`)
  await page.getByRole("button", { name: "提交" }).click()

  const message = () =>
    page.evaluate((id) => {
      const scope = window as unknown as {
        __chipmateMessages: Array<{ type?: string; requestId?: string; providerID?: string }>
      }
      return scope.__chipmateMessages.findLast((item) => item.type === "saveCustomProvider" && item.providerID === id)
    }, providerID)
  await expect.poll(message).not.toBeUndefined()
  const saved = await message()
  await page.evaluate((item) => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "providerConnected",
          requestId: item?.requestId,
          providerID: item?.providerID,
        },
      }),
    )
  }, saved)
  await expect(page.getByLabel("提供商 ID")).toHaveCount(0)
}

for (const width of [420, 300]) {
  test(`internal provider page can add multiple independent custom providers at ${width}px`, async ({ page }) => {
    await load(page, "settings--providers-internal-multiple", width)

    await expect(page.getByText("ChipMate", { exact: true })).toBeVisible()
    await expect(page.getByText("Internal Lab", { exact: true })).toBeVisible()
    await expect(page.getByText("没有已连接的提供商", { exact: true })).toHaveCount(0)
    await expect(page.locator('svg[data-provider-brand="chipmate"]')).toHaveCount(1)
    const labIcon = page
      .getByText("Internal Lab", { exact: true })
      .locator("xpath=..")
      .locator('svg[data-component="provider-icon"]:not([data-provider-brand]) use')
    await expect(labIcon).toHaveCount(1)
    expect(await labIcon.getAttribute("href")).toMatch(/#synthetic$/)
    await expect(page.getByText("热门提供商", { exact: true })).toHaveCount(0)
    await page.getByRole("button", { name: "编辑提供商" }).click()
    await expect(page.getByLabel("提供商 ID")).toHaveValue("lab")
    await expect(page.getByLabel("提供商 ID")).toBeDisabled()
    await expect(page.getByLabel("基础 URL")).toHaveValue("https://lab.example.com/v1")
    await expect(page.getByRole("button", { name: "高级设置" })).toHaveCount(0)
    await page.getByRole("button", { name: "返回" }).click()
    await page.getByRole("button", { name: "连接" }).click()

    await expect(page.getByLabel("提供商 ID")).toHaveValue("")
    await expect(page.getByLabel("基础 URL")).toHaveValue("")
    await expect(page.getByRole("button", { name: "高级设置" })).toHaveCount(0)
    await saveAdditionalProvider(page, "alpha")

    await page.getByRole("button", { name: "连接" }).click()
    await saveAdditionalProvider(page, "beta")

    const saves = await page.evaluate(() => {
      const scope = window as unknown as {
        __chipmateMessages: Array<{
          type?: string
          providerID?: string
          activateModelID?: string
          config?: { models?: Record<string, unknown> }
        }>
      }
      return scope.__chipmateMessages.filter((message) => message.type === "saveCustomProvider")
    })
    expect(saves.map((message) => message.providerID)).toEqual(["alpha", "beta"])
    expect(saves.map((message) => Object.keys(message.config?.models ?? {}))).toEqual([["alpha-chat"], ["beta-chat"]])
    expect(saves.every((message) => message.activateModelID === undefined)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
}
