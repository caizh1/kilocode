import { expect, test } from "@playwright/test"

async function load(page: import("@playwright/test").Page, story: string, width: number) {
  await page.setViewportSize({ width, height: 720 })
  await page.goto(`/iframe.html?id=${story}&viewMode=story`, { waitUntil: "load" })
  await page.waitForSelector(".session-surface-bar, .session-surface-deleted")
}

test("主编辑区 owner 在宽布局中呈现写入入口并可一键收回侧栏", async ({ page }) => {
  await load(page, "chat-session-surface--main-owner", 1000)
  await expect(page.getByText("当前界面拥有会话操作权")).toBeVisible()
  await expect(page.getByRole("button", { name: "收回侧栏" })).toBeVisible()
  await expect(page.locator("textarea.prompt-input")).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1000)
})

test("侧栏取得 owner token 后显示欢迎页和输入框，不再停留在初始化中", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 720 })
  await page.goto("/iframe.html?id=chat-session-surface--sidebar-owner&viewMode=story", { waitUntil: "load" })
  await expect(page.locator("textarea.prompt-input")).toBeVisible()
  await expect(page.getByText("初始化中...", { exact: true })).toHaveCount(0)
})

test("侧栏镜像态在 200px 下禁用全部写入口且按钮正常换行", async ({ page }) => {
  await load(page, "chat-session-surface--sidebar-mirror", 200)
  await expect(page.getByText(/实时镜像/)).toBeVisible()
  await expect(page.getByRole("button", { name: "前往主区" })).toBeVisible()
  await expect(page.getByRole("button", { name: "收回侧栏" })).toBeVisible()
  await expect(page.locator("textarea.prompt-input")).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(200)
})

test("打开中和删除终态使用明确状态且删除后不显示会话与输入区", async ({ page }) => {
  await load(page, "chat-session-surface--opening-main", 800)
  await expect(page.getByText("正在准备主编辑区…")).toBeVisible()
  await load(page, "chat-session-surface--deleted-main", 800)
  await expect(page.getByText("会话已删除", { exact: true })).toBeVisible()
  await expect(page.locator(".chat-messages-wrapper")).toBeHidden()
  await expect(page.locator(".chat-input")).toBeHidden()
})

test("普通切换等待 500ms 草稿 ACK，期间不提前清空输入或切换会话", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 720 })
  await page.goto("/iframe.html?id=chat-session-surface--draft-switch-barrier&viewMode=story", { waitUntil: "load" })
  const input = page.getByRole("textbox", { name: "会话草稿" })
  const state = page.locator('[data-ui="draft-switch-state"]')
  const draft = `中文草稿-${"字".repeat(2048)}`
  await expect(state).toHaveAttribute("data-active", "session:story-session-a")
  await input.fill(draft)
  await page.getByRole("button", { name: "切换到 B" }).click()

  await page.waitForTimeout(200)
  await expect(state).toHaveAttribute("data-status", "waiting")
  await expect(state).toHaveAttribute("data-active", "session:story-session-a")
  await expect(input).toHaveValue(draft)

  await expect(state).toHaveAttribute("data-status", "switched")
  await expect(state).toHaveAttribute("data-active", "session:story-session-b")
})
