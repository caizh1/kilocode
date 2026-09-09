import { test, expect, type Page } from "@playwright/test"

// 浏览器边界测试使用真实输入组件；文件对话框和编辑器由宿主测试另行覆盖。
async function request(page: Page, label: string) {
  await page.getByRole("button", { name: label, exact: true }).click()
  return page.evaluate(
    () =>
      (window as unknown as { 引用请求: { type: string; requestId: string; kind: string }[] }).引用请求
        .filter((item) => item.type === "requestFilePicker" || item.type === "requestEditorReference")
        .at(-1)!,
  )
}
async function result(page: Page, requestId: string, path: string) {
  await page.evaluate(
    ({ requestId, path }) =>
      window.dispatchEvent(new MessageEvent("message", { data: { type: "filePickerResult", requestId, path } })),
    { requestId, path },
  )
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const messages: unknown[] = []
    Object.assign(window, {
      引用请求: messages,
      acquireVsCodeApi: () => ({
        postMessage: (message: unknown) => messages.push(message),
        getState: () => ({
          sidebarSessionTabIDs: ["night-city-visual"],
          sidebarActiveSessionTabID: "night-city-visual",
        }),
        setState: () => {},
      }),
    })
  })
  await page.goto("/iframe.html?id=appearance-nightcity--chat&globals=skin:night-city")
  await expect(page.locator(".prompt-input")).toBeVisible()
})

test("四个入口真实发起请求，取消、重复和编辑后迟到结果不改写草稿", async ({ page }) => {
  const input = page.locator(".prompt-input")
  await input.fill("保留草稿 ")
  const first = await request(page, "引用文件")
  expect(first.kind).toBe("file")
  const folder = await request(page, "引用文件夹")
  expect(folder.kind).toBe("folder")
  await result(page, first.requestId, "/验收工作区/过期.c")
  await expect(input).toHaveValue("保留草稿 ")
  await result(page, folder.requestId, "")
  await expect(input).toHaveValue("保留草稿 ")
  const edited = await request(page, "引用文件")
  await input.fill("编辑后的草稿")
  await result(page, edited.requestId, "/验收工作区/迟到.c")
  await expect(input).toHaveValue("编辑后的草稿")
  const selection = await request(page, "引用选中代码")
  expect(selection).toMatchObject({ type: "requestEditorReference", kind: "selection" })
  await page.evaluate(
    (requestId) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "editorReferenceResult", requestId, error: "请先在编辑器中选择要引用的代码。" },
        }),
      ),
    selection.requestId,
  )
  await expect(page.getByText("请先在编辑器中选择要引用的代码。", { exact: true })).toBeVisible()
  const chooser = page.waitForEvent("filechooser")
  await page.getByRole("button", { name: "添加图片", exact: true }).click()
  await (
    await chooser
  ).setFiles({
    name: "验收.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    ),
  })
  await expect(page.locator(".image-attachment")).toHaveCount(1)
})

test("文件引用可插入、撤销和移除，短路径不能误删长路径", async ({ page }) => {
  const input = page.locator(".prompt-input")
  for (const path of ["abc", "a"]) {
    const pending = await request(page, "引用文件")
    await result(page, pending.requestId, `/验收工作区/${path}`)
    await expect(input).toHaveValue(new RegExp(`@${path}`))
  }
  await page.getByRole("button", { name: "上下文引用", exact: true }).click()
  await page.getByRole("button", { name: "移除引用 a", exact: true }).click()
  await expect(input).toHaveValue("@abc  ")
  await page.keyboard.press("Escape")
  await input.focus()
  await page.keyboard.press("ControlOrMeta+z")
  await expect(input).toHaveValue("@abc @a ")
})

test("选区引用进入上下文摘要，可移除且保留其他草稿", async ({ page }) => {
  const input = page.locator(".prompt-input")
  await input.fill("保留说明 ")
  const selected = await request(page, "引用选中代码")
  await page.evaluate(
    (requestId) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "editorReferenceResult",
            requestId,
            path: "/验收工作区/入口.c",
            text: "/验收工作区/入口.c:3-4\n```\nreturn 7;\n```",
          },
        }),
      ),
    selected.requestId,
  )
  await expect(page.getByRole("button", { name: "上下文引用", exact: true })).toHaveAttribute(
    "title",
    "上下文：1 项引用",
  )
  await page.getByRole("button", { name: "上下文引用", exact: true }).click()
  await page.getByRole("button", { name: "移除代码引用 /验收工作区/入口.c:3-4", exact: true }).click()
  await expect(input).toHaveValue("保留说明 \n\n")
})

test("150% 缩放下窄屏工具栏不溢出", async ({ page }) => {
  // 420×1056 物理像素在 150% 缩放下提供 280×704 CSS 像素。
  // 不使用 body.zoom，后者会连固定 100vh 夹具一起放大，不能代表宿主缩放。
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 280,
    height: 704,
    deviceScaleFactor: 1.5,
    mobile: false,
  })
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeInViewport()
  expect(
    await page.locator('[data-ui="qa-composer-footer"]').evaluate((e) => e.scrollWidth - e.clientWidth),
  ).toBeLessThanOrEqual(1)
})

test("发送可用时显示高亮光晕，禁用时降低亮度", async ({ page }) => {
  const button = page.getByRole("button", { name: "发送", exact: true })
  expect(Number(await button.evaluate((element) => getComputedStyle(element).opacity))).toBeLessThan(1)
  await page.locator(".prompt-input").fill("验收可用发送状态")
  await expect(button).toHaveAttribute("aria-disabled", "false")
  await expect.poll(() => button.evaluate((element) => getComputedStyle(element).opacity)).toBe("1")
  expect(await button.evaluate((element) => getComputedStyle(element).boxShadow)).toContain("255, 32, 204")
})

for (const width of [320, 420, 1488]) {
  test(`图标正常流布局且发送始终可见 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1056 })
    const send = page.getByRole("button", { name: "发送", exact: true })
    await expect(send).toBeInViewport()
    const icons = page.locator(".night-city-reference-actions .codicon")
    expect(await icons.evaluateAll((items) => items.map((item) => getComputedStyle(item).position))).not.toContain(
      "absolute",
    )
    expect(
      await page.locator('[data-ui="qa-composer-footer"]').evaluate((e) => e.scrollWidth - e.clientWidth),
    ).toBeLessThanOrEqual(1)
    await page.getByRole("button", { name: "更多选项", exact: true }).click()
    await expect(page.getByRole("menuitem", { name: "开启自动审批" })).toBeVisible()
    await expect(page.getByRole("menuitem", { name: "推理档位" })).toHaveCount(0)
  })
}

test("第三个选择器直接显示推理档位并更新真实状态", async ({ page }) => {
  await page.goto("/iframe.html?id=appearance-nightcity--reasoning-chat&globals=skin:night-city")
  const thinking = page.locator(".night-city-thinking button")
  await expect(thinking).toBeVisible()
  await expect(page.locator('[data-ui="qa-composer-selectors"] .prompt-selector-trigger:visible').nth(2)).toHaveClass(
    /prompt-selector-trigger--thinking/,
  )
  await thinking.click()
  await expect(page.getByRole("option", { name: /High/ })).toBeVisible()
  await page.getByRole("option", { name: /High/ }).click()
  await expect(thinking).toBeVisible()
  await expect(thinking).toContainText("High")
  await thinking.click()
  await expect(page.getByRole("option", { name: /High/ })).toHaveAttribute("aria-selected", "true")
})

test("切回原皮肤隐藏新增工具栏与图标，保留原推理选择器和输入节点", async ({ page }) => {
  await page.goto("/iframe.html?id=appearance-nightcity--reasoning-chat&globals=skin:night-city")
  const input = await page.locator(".prompt-input").elementHandle()
  await page.evaluate(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "appearanceChanged", appearance: { skin: "default", motion: "off" } },
      }),
    ),
  )
  for (const selector of [
    ".night-city-reference-actions",
    ".night-city-reference-summary",
    ".night-city-tab-icon",
    ".night-city-tab-add",
    ".night-city-send-icon",
  ]) {
    await expect(page.locator(selector).first()).toBeHidden()
  }
  await expect(page.locator(".night-city-thinking")).toBeVisible()
  expect(await input!.evaluate((element) => element.isConnected)).toBe(true)
})

test("选择器打开后切换 Tab，迟到文件结果不能污染另一份草稿", async ({ page }) => {
  const input = page.locator(".prompt-input")
  await input.fill("原会话草稿")
  const pending = await request(page, "引用文件")
  await page.getByRole("button", { name: "新建会话标签", exact: true }).click()
  await expect(input).not.toHaveValue("原会话草稿")
  await input.fill("新会话草稿")
  await result(page, pending.requestId, "/验收工作区/迟到.c")
  await expect(input).toHaveValue("新会话草稿")
  await page.getByRole("tab", { name: "UFS 初始化审查", exact: true }).click()
  await expect(input).toHaveValue("原会话草稿")
  await result(page, pending.requestId, "/验收工作区/迟到.c")
  await expect(input).toHaveValue("原会话草稿")
})

test("图片读取未结束时切换会话，读取完成不能写入其他草稿", async ({ page }) => {
  await page.evaluate(() => {
    const Reader = window.FileReader
    Object.assign(window, { 完成图片读取: () => {} })
    window.FileReader = class extends Reader {
      readAsDataURL(file: Blob) {
        Object.assign(window, { 完成图片读取: () => super.readAsDataURL(file) })
      }
    }
  })
  const chooser = page.waitForEvent("filechooser")
  await page.getByRole("button", { name: "添加图片", exact: true }).click()
  await (
    await chooser
  ).setFiles({ name: "迟到图片.png", mimeType: "image/png", buffer: Buffer.from("图片读取边界验收") })
  await page.getByRole("button", { name: "新建会话标签", exact: true }).click()
  await page.locator(".prompt-input").fill("新草稿")
  await page.evaluate(() => (window as unknown as { 完成图片读取: () => void }).完成图片读取())
  await expect(page.locator(".image-attachment")).toHaveCount(0)
  await page.getByRole("tab", { name: "UFS 初始化审查", exact: true }).click()
  await expect(page.locator(".image-attachment")).toHaveCount(0)
})
