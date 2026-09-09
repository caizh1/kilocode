import { chromium, expect } from "@playwright/test"

/** 将真实后端事件交给现有界面，并把用户实际点击产生的回答送回真实问题服务。 */
export async function specBrowser(
  session: { id: string },
  reply: (id: string, answers: string[][]) => Promise<void>,
  openFile?: (path: string) => Promise<void>,
  permission?: (id: string, response: "once" | "always" | "reject", sessionID: string) => Promise<void>,
) {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 420, height: 720 } })
  page.setDefaultTimeout(8000)
  const submitted: string[] = []
  await page.exposeFunction(
    "提交验收回答",
    async (message: {
      type: string
      requestID: string
      answers: string[][]
      filePath: string
      permissionId: string
      sessionID: string
      response: "once" | "always" | "reject"
    }) => {
      if (message.type === "openFile") return openFile?.(message.filePath)
      if (message.type === "permissionResponse")
        return permission?.(message.permissionId, message.response, message.sessionID)
      if (message.type !== "questionReply") return
      submitted.push(message.requestID)
      await reply(message.requestID, message.answers)
    },
  )
  await page.addInitScript(() => {
    Object.assign(window, {
      acquireVsCodeApi: () => ({
        postMessage: (message: unknown) => Reflect.get(window, "提交验收回答")(message),
        getState: () => undefined,
        setState: () => {},
      }),
    })
  })
  const replay = (messages: unknown[]) =>
    page.evaluate((messages) => {
      for (const data of messages) window.dispatchEvent(new MessageEvent("message", { data }))
    }, messages)
  const open = async () => {
    await page.goto("http://127.0.0.1:6007/iframe.html?id=chat-spec-execution--terminal&viewMode=story")
    await expect(page.locator("textarea.prompt-input")).toBeVisible({ timeout: 20000 })
    await replay([
      { type: "ready", serverInfo: { version: "1.2.17" }, workspaceDirectory: "/验收" },
      { type: "sessionCreated", session },
    ])
    await page.evaluate((id) => window.dispatchEvent(new CustomEvent("验收选择会话", { detail: id })), session.id)
    await replay([{ type: "messagesLoaded", sessionID: session.id, messages: [] }])
  }
  try {
    await open()
  } catch (error) {
    await browser.close()
    throw error
  }
  const card = page.locator('[data-component="question-dock"]')
  return {
    submitted,
    replay,
    open,
    async openPage(number: number) {
      await page.getByRole("link", { name: `查看第 ${number} 页`, exact: true }).click()
    },
    async missingImages() {
      await expect(page.locator('.document-artifact-card [data-kind="page-png"]')).toHaveCount(0)
    },
    async allowPermission() {
      const permission = page.locator('[data-component="permission-shortcuts"]')
      await expect(permission).toBeVisible()
      await permission.locator('[data-slot="permission-actions"] button').first().click()
    },
    async missingPermission() {
      await expect(page.locator('[data-component="permission-shortcuts"]')).toHaveCount(0)
    },
    async answer(value: string) {
      await expect(card).toBeVisible()
      await card.locator('[data-custom="true"]').click()
      await card.locator("input").fill(value)
      await card.locator('button[type="submit"]').click()
    },
    async choose(value: string) {
      if (process.env.CHIPMATE_SPEC_TRANSCRIPT_DIR)
        await page.screenshot({ path: `${process.env.CHIPMATE_SPEC_TRANSCRIPT_DIR}/${value}.png`, fullPage: true })
      await expect(card).toBeVisible()
      await card.locator('[data-slot="question-option"]').filter({ hasText: value }).click()
      await card.getByRole("button", { name: "提交", exact: true }).click()
    },
    async missing() {
      await expect(card).toHaveCount(0)
    },
    async finished() {
      await expect(card).toHaveCount(0)
      await page.locator("textarea.prompt-input").fill("普通 QA 回归")
      await expect(page.getByRole("button", { name: "发送", exact: true })).toBeEnabled()
    },
    close: () => browser.close(),
  }
}
