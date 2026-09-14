import { expect, test, type Page } from "@playwright/test"

const url = "/iframe.html?id=chat-审阅自动恢复--switching&viewMode=story"
const card = '[data-component="turn-changes"]'
const file = '[data-slot="turn-changes-file-name"]'
async function control(page: Page, type: string, sessionID?: string) {
  await page.evaluate((detail) => window.dispatchEvent(new CustomEvent("审阅验收", { detail })), { type, sessionID })
}
async function open(page: Page) {
  await page.goto(url)
  await page.getByRole("button", { name: "审阅", exact: true }).click()
  await page.locator(file).click()
  await expect(page.locator(card)).toContainText("会话甲 第 1 版")
}

for (const width of [280, 420])
  test(`宽度 ${width} 切回自动恢复文件，后台更新不弹错且不抢草稿`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 })
    await open(page)
    const input = page.getByRole("textbox", { name: "验收草稿" })
    await input.fill("第一行草稿\n第二行草稿")
    for (let n = 0; n < 10; n++) {
      await page.getByRole("button", { name: "会话乙", exact: true }).click()
      await expect(page.locator(card)).toContainText("本轮修改")
      const count = await page.locator("[data-recovery-fixture]").getAttribute("data-requests")
      await control(page, "后台更新", "会话甲")
      expect(await page.locator("[data-recovery-fixture]").getAttribute("data-requests")).toBe(count)
      await page.getByRole("button", { name: "会话甲", exact: true }).click()
      await expect(page.locator(card)).toContainText(`会话甲 第 ${n + 2} 版`)
      await expect(page.getByRole("button", { name: "收起审阅", exact: true })).toBeVisible()
      await expect(page.getByRole("button", { name: "撤销本轮", exact: true })).toBeEnabled()
      await expect(page.locator(card)).not.toContainText("会话乙")
      await expect(page.getByRole("alert")).toHaveCount(0)
    }
    await input.focus()
    await control(page, "后台更新")
    await expect(page.locator(card)).toContainText("会话甲 第 12 版")
    await expect(input).toBeFocused()
    await expect(input).toHaveValue("第一行草稿\n第二行草稿")
  })

test("延迟读取和断线重连期间禁用撤销，恢复后保持展开；删除轮次释放缓存", async ({ page }) => {
  await open(page)
  const revert = page.getByRole("button", { name: "撤销本轮", exact: true })
  await control(page, "延迟读取")
  await control(page, "后台更新")
  await expect(revert).toBeDisabled()
  await control(page, "断线")
  await control(page, "重连")
  await control(page, "释放读取")
  await expect(page.locator(card)).toContainText("会话甲 第 2 版")
  await expect(revert).toBeEnabled()
  await control(page, "删除轮次")
  await expect(page.locator(card)).toHaveCount(0)
  const count = await page.locator("[data-recovery-fixture]").getAttribute("data-requests")
  await control(page, "后台更新")
  expect(await page.locator("[data-recovery-fixture]").getAttribute("data-requests")).toBe(count)
  await control(page, "重新挂载")
  await expect(page.getByRole("button", { name: "审阅", exact: true })).toBeVisible()
  await expect(page.locator(file)).toHaveCount(0)
})

test("浅色主题和放大显示保留键盘审阅交互，图标及按钮不越界", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 720 })
  await open(page)
  await page.evaluate(() => {
    document.body.classList.add("vscode-light")
    document.body.style.zoom = "1.25"
  })
  const toggle = page.getByRole("button", { name: "收起审阅", exact: true })
  await toggle.focus()
  await page.keyboard.press("Enter")
  await expect(page.locator(file)).toHaveCount(0)
  await page.keyboard.press("Space")
  await expect(page.locator(card)).toContainText("会话甲 第 1 版")
  const overflow = await page.locator(card).evaluate((element) => {
    const box = element.getBoundingClientRect()
    return [...element.querySelectorAll("button")].some((button) => {
      const rect = button.getBoundingClientRect()
      return rect.left < box.left - 1 || rect.right > box.right + 1
    })
  })
  expect(overflow).toBe(false)
})

// 对应真实入口的稳定外层与可卸载聊天内层，防止历史页返回后创建空控制器。
test("聊天卸载后重新挂载复用外层轮次控制器", async ({ page }) => {
  await open(page)
  await control(page, "历史页面")
  await expect(page.locator(card)).toHaveCount(0)
  await control(page, "后台更新")
  await control(page, "重新挂载")
  await expect(page.locator(card)).toContainText("会话甲 第 2 版")
  await expect(page.getByRole("button", { name: "收起审阅", exact: true })).toBeVisible()
  await expect(page.locator(file)).toHaveAttribute("aria-expanded", "true")
})
