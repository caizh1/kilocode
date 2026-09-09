import { expect, test } from "@playwright/test"

const url = "/iframe.html?id=chat-specintroduction--flow&viewMode=story"
const input = (page: import("@playwright/test").Page) => page.locator('textarea[aria-label="对话输入框"]')
const modal = (page: import("@playwright/test").Page) => page.getByRole("dialog")

test.beforeEach(async ({ page }) => {
  await page.goto(url)
  await expect(input(page)).toBeVisible()
})

for (const method of ["Enter", "Tab", "鼠标"]) {
  test(`首次${method}选择只补全并展示，关闭保留光标`, async ({ page }) => {
    await input(page).fill("/spec")
    await expect(modal(page)).toHaveCount(0)
    if (method === "鼠标") await page.getByRole("option", { name: "spec", exact: true }).click()
    else await input(page).press(method)
    await expect(modal(page)).toBeVisible()
    await expect(input(page)).toHaveValue("/spec ")
    await expect(page.getByLabel("本地消息记录")).not.toContainText("发送草稿")
    await page.getByRole("button", { name: "返回输入框" }).click()
    await expect(modal(page)).toHaveCount(0)
    await expect(input(page)).toBeFocused()
    expect(await input(page).evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd])).toEqual([
      6, 6,
    ])
    await expect(input(page)).toHaveValue("/spec ")
    await input(page).fill("/spec")
    await input(page).press("Tab")
    await expect(page.getByRole("button", { name: "查看流程图" })).toBeVisible()
    await expect(modal(page)).toHaveCount(0)
  })
}

test("草稿恢复、直接粘贴和重启不自动展示，手动查看可重复", async ({ page }) => {
  await page.getByRole("button", { name: "恢复草稿" }).click()
  await expect(modal(page)).toHaveCount(0)
  await page.getByRole("button", { name: "查看流程图" }).click()
  await expect(modal(page)).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(modal(page)).toHaveCount(0)
  await expect(input(page)).toHaveValue("/spec 已评审详设.docx")
  await page.reload()
  await input(page).fill("/spec")
  await input(page).press("Tab")
  await expect(page.getByRole("button", { name: "查看流程图" })).toBeVisible()
  await expect(modal(page)).toHaveCount(0)
  await input(page).fill("/spec 粘贴的资料")
  await page.getByRole("button", { name: "查看流程图" }).click()
  await expect(modal(page)).toBeVisible()
  await page.getByRole("button", { name: "关闭", exact: true }).click()
  await expect(input(page)).toBeFocused()
  await expect(input(page)).toHaveValue("/spec 粘贴的资料")
})

for (const change of ["切换会话", "发送", "删除命令", "隐藏面板"]) {
  test(`异步响应之前${change}取消展示`, async ({ page }) => {
    await page.getByRole("button", { name: "延迟响应：关闭" }).click()
    await input(page).fill("/spec")
    await input(page).press("Tab")
    await expect(page.getByLabel("本地消息记录")).toContainText("claim")
    if (change === "删除命令") await input(page).fill("普通问题")
    else if (change === "隐藏面板") await page.evaluate(() => window.dispatchEvent(new Event("blur")))
    else await page.getByRole("button", { name: change, exact: true }).click()
    await page.getByRole("button", { name: "送达响应" }).click()
    await expect(modal(page)).toHaveCount(0)
    await expect(page.getByLabel("本地消息记录")).not.toContainText("displayed")
  })
}

test("普通 QA、命令引用、其他命令与同名 Skill 无介绍请求", async ({ page }) => {
  for (const value of ["你好", "请介绍 /spec", "`/spec`", "/other"]) {
    await input(page).fill(value)
    if (value === "/other") await input(page).press("Tab")
    await expect(modal(page)).toHaveCount(0)
    await expect(page.getByRole("button", { name: "查看流程图" })).toHaveCount(0)
  }
  await page.getByRole("button", { name: "切换同名 Skill" }).click()
  await input(page).fill("/spec")
  await input(page).press("Tab")
  await expect(modal(page)).toHaveCount(0)
  await expect(page.getByRole("button", { name: "查看流程图" })).toHaveCount(0)
  await expect(page.getByLabel("本地消息记录")).not.toContainText("claim")
})

test("状态保存失败仍可关闭与发送，本次宿主不重复自动弹出", async ({ page }) => {
  await page.getByRole("button", { name: "保存失败：关闭" }).click()
  await input(page).fill("/spec")
  await input(page).press("Tab")
  await expect(modal(page)).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(modal(page)).toHaveCount(0)
  await input(page).fill("/spec")
  await input(page).press("Tab")
  await expect(page.getByRole("button", { name: "查看流程图" })).toBeVisible()
  await expect(modal(page)).toHaveCount(0)
  await page.getByRole("button", { name: "发送", exact: true }).click()
  await expect(input(page)).toHaveValue("")
})

for (const width of [1100, 320, 200]) {
  test(`${width}px 布局完整滚动与焦点边界`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await input(page).fill("/spec")
    await input(page).press("Tab")
    await expect(modal(page)).toBeVisible()
    const scroll = page.getByLabel("Spec 流程架构介绍")
    expect(await scroll.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    const bounds = await modal(page).boundingBox()
    expect(bounds!.width).toBeLessThanOrEqual(width)
    await scroll.focus()
    await page.keyboard.press("End")
    await expect(page.getByText("影响实现的依据不清楚时先提问；设计或计划变化时重新确认相关部分。")).toBeInViewport()
    await expect(page.getByRole("button", { name: "返回输入框" })).toBeInViewport()
    await page.keyboard.press("Tab")
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true)
  })
}

for (const theme of ["dark-modern", "light-modern", "hc-black", "hc-light"]) {
  test(`${theme} 主题及 200% 缩放下操作区完整`, async ({ page }) => {
    await page.goto(`${url}&globals=vscodeTheme:${theme}`)
    await page.setViewportSize({ width: 550, height: 450 })
    await input(page).fill("/spec")
    await input(page).press("Tab")
    await expect(modal(page)).toBeVisible()
    const scroll = page.getByLabel("Spec 流程架构介绍")
    expect(await scroll.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    await expect(page.getByRole("button", { name: "返回输入框" })).toBeInViewport()
    await scroll.focus()
    await page.keyboard.press("End")
    await expect(page.getByText("影响实现的依据不清楚时先提问；设计或计划变化时重新确认相关部分。")).toBeInViewport()
    await page.screenshot({ path: `../../.chipmate/qa/spec-introduction/${theme}-缩放.png` })
  })
}

test("宽屏视觉记录与本地请求边界", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 })
  await input(page).fill("/spec")
  await input(page).press("Tab")
  await expect(modal(page)).toBeVisible()
  await page.screenshot({ path: "../../.chipmate/qa/spec-introduction/宽屏.png" })
  const messages = await page.getByLabel("本地消息记录").textContent()
  expect(messages?.split("、").every((message) => ["requestCommands", "claim", "displayed"].includes(message))).toBe(
    true,
  )
})

test("低高度窄面板仍保留可用阅读区域", async ({ page }) => {
  await page.setViewportSize({ width: 200, height: 260 })
  await page.getByRole("button", { name: "恢复草稿" }).click()
  await page.getByRole("button", { name: "查看流程图" }).click()
  const scroll = page.getByLabel("Spec 流程架构介绍")
  expect((await scroll.boundingBox())!.height).toBeGreaterThan(60)
  await expect(page.getByRole("button", { name: "返回输入框" })).toBeInViewport()
  await scroll.focus()
  await page.keyboard.press("End")
  await expect(page.locator(".spec-introduction-inline-disclaimer")).toBeInViewport()
})

for (const remoteClock of ["-60000", "60000", "-28800000", "28800000", "omit"]) {
  test(`远程时间偏差 ${remoteClock} 不影响首次和手动展示`, async ({ page }) => {
    await page.goto(`${url}&remoteClock=${remoteClock}`)
    await input(page).fill("/spec")
    await input(page).press("Tab")
    await expect(modal(page)).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(modal(page)).toHaveCount(0)
    await page.getByRole("button", { name: "查看流程图", exact: true }).click()
    await expect(modal(page)).toBeVisible()
    await expect(page.locator(".spec-introduction-feedback")).toHaveCount(0)
  })
}

test("手动请求真实超时后给出反馈，旧响应不能影响重试", async ({ page }) => {
  await page.clock.install()
  await page.getByRole("button", { name: "恢复草稿" }).click()
  await page.getByRole("button", { name: "延迟响应：关闭" }).click()
  await page.getByRole("button", { name: "查看流程图", exact: true }).click()
  await expect(page.getByRole("button", { name: "正在加载…" })).toBeDisabled()
  await page.clock.runFor(15001)
  await expect(page.locator(".spec-introduction-feedback")).toHaveText("流程图响应超时，请重试。")
  await page.getByRole("button", { name: "重试查看流程图" }).click()
  await page.getByRole("button", { name: "送达响应" }).click()
  await expect(modal(page)).toBeVisible()
  expect(
    (await page.getByLabel("本地消息记录").textContent())?.split("、").filter((x) => x === "displayed"),
  ).toHaveLength(1)
})

test("自动请求超时不提示，不阻断输入", async ({ page }) => {
  await page.clock.install()
  await page.getByRole("button", { name: "延迟响应：关闭" }).click()
  await input(page).fill("/spec")
  await input(page).press("Tab")
  await page.clock.runFor(15001)
  await expect(page.locator(".spec-introduction-feedback")).toHaveCount(0)
  await input(page).fill("普通问题")
  await page.getByRole("button", { name: "送达响应" }).click()
  await expect(modal(page)).toHaveCount(0)
})

test("系统校时不导致本地请求提前过期", async ({ page }) => {
  await page.clock.install()
  await page.getByRole("button", { name: "恢复草稿" }).click()
  await page.getByRole("button", { name: "延迟响应：关闭" }).click()
  await page.getByRole("button", { name: "查看流程图", exact: true }).click()
  await page.clock.setSystemTime(new Date("2040-01-01T00:00:00Z"))
  await page.getByRole("button", { name: "送达响应" }).click()
  await expect(modal(page)).toBeVisible()
})

test("手动请求失焦判定失败有反馈，重试可恢复", async ({ page }) => {
  await page.getByRole("button", { name: "恢复草稿" }).click()
  await page.evaluate(() => Object.defineProperty(document, "hasFocus", { configurable: true, value: () => false }))
  await page.getByRole("button", { name: "查看流程图", exact: true }).click()
  await expect(page.locator(".spec-introduction-feedback")).toContainText("保持当前面板可见")
  await expect(modal(page)).toHaveCount(0)
  await page.evaluate(() => Reflect.deleteProperty(document, "hasFocus"))
  await page.getByRole("button", { name: "重试查看流程图" }).click()
  await expect(modal(page)).toBeVisible()
})

test("其他面板占用时手动查看提示原因，到期后可重试", async ({ page }) => {
  await page.clock.install()
  await page.getByRole("button", { name: "恢复草稿" }).click()
  await page.getByRole("button", { name: "其他面板占用" }).click()
  await page.getByRole("button", { name: "查看流程图", exact: true }).click()
  await expect(page.locator(".spec-introduction-feedback")).toContainText("其他面板")
  await page.clock.runFor(15001)
  await page.getByRole("button", { name: "重试查看流程图" }).click()
  await expect(modal(page)).toBeVisible()
})

test("手动请求期间继续编辑同一 Spec 草稿也取消旧展示", async ({ page }) => {
  await page.getByRole("button", { name: "恢复草稿" }).click()
  await page.getByRole("button", { name: "延迟响应：关闭" }).click()
  await page.getByRole("button", { name: "查看流程图", exact: true }).click()
  await input(page).fill("/spec 另一份设计.docx")
  await page.getByRole("button", { name: "送达响应" }).click()
  await expect(modal(page)).toHaveCount(0)
  await expect(page.locator(".spec-introduction-feedback")).toHaveCount(0)
  await expect(input(page)).toHaveValue("/spec 另一份设计.docx")
})
