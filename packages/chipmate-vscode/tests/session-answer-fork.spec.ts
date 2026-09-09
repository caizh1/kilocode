import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

const stories = {
  ready: "chat--qa-session-answer-fork",
  english: "chat--qa-session-answer-fork-english",
  traditional: "chat--qa-session-answer-fork-traditional-chinese",
  busy: "chat--qa-session-answer-fork-busy",
  readonly: "chat--qa-session-answer-fork-readonly",
  disconnected: "chat--qa-session-answer-fork-disconnected",
}

async function load(page: Page, story: string, width = 420, theme = "dark-modern") {
  await page.setViewportSize({ width, height: 720 })
  const scheme = theme === "light-modern" || theme === "hc-light" ? "light" : "dark"
  const globals = `colorScheme:${scheme};theme:chipmate-vscode;vscodeTheme:${theme}`
  await page.goto(`/iframe.html?id=${story}&viewMode=story&globals=${globals}`, { waitUntil: "load" })
  await page.waitForSelector('[data-story="session-answer-fork"]')
}

function forkButton(page: Page, name = "从此回答分支") {
  return page.getByRole("button", { name, exact: true })
}

test("同一轮多条模型记录只显示一个入口，并使用最后回答作为包含边界", async ({ page }) => {
  await load(page, stories.ready)
  const button = forkButton(page)
  await expect(button).toHaveCount(1)
  await expect(button).toBeEnabled()
  await button.focus()
  await page.keyboard.press("Enter")

  const surface = page.locator('[data-story="session-answer-fork"]')
  await expect(surface).toHaveAttribute("data-clicks", "1")
  await expect(surface).toHaveAttribute("data-boundary", "fork-assistant-002")
  await expect(button).toBeDisabled()
  await expect(button).toHaveAttribute("aria-busy", "true")

  for (let attempt = 0; attempt < 20; attempt += 1) await button.evaluate((element) => element.click())
  await expect(surface).toHaveAttribute("data-clicks", "1")

  await expect(page.getByText("仍在复制会话，请稍候", { exact: true })).toHaveCount(0)
  await page.locator('[data-component="tooltip-trigger"]').filter({ has: button }).hover()
  await expect(page.getByText("仍在复制会话，请稍候", { exact: true })).toBeVisible()
})

test("窄宽度和高对比度下分支与复制按钮保持正常 flex 流且不重叠", async ({ page }) => {
  for (const [width, theme] of [
    [240, "dark-modern"],
    [320, "hc-black"],
    [420, "hc-light"],
  ] as const) {
    await load(page, stories.ready, width, theme)
    const layout = await page.locator('[data-slot="assistant-copy-wrapper"]').evaluate((wrapper) => {
      const buttons = [...wrapper.querySelectorAll<HTMLElement>('button[data-component="icon-button"]')].map((item) =>
        item.getBoundingClientRect(),
      )
      const style = getComputedStyle(wrapper)
      return {
        buttons: buttons.length,
        display: style.display,
        position: style.position,
        overlap:
          buttons.length >= 2 &&
          buttons[0]!.left < buttons[1]!.right &&
          buttons[0]!.right > buttons[1]!.left &&
          buttons[0]!.top < buttons[1]!.bottom &&
          buttons[0]!.bottom > buttons[1]!.top,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })
    expect(layout.buttons).toBe(2)
    expect(layout.display).toBe("flex")
    expect(layout.position).not.toBe("absolute")
    expect(layout.overlap).toBe(false)
    expect(layout.overflow).toBeLessThanOrEqual(0)
  }
})

test("忙碌、只读和断线状态保持入口可见但禁用并提供原因", async ({ page }) => {
  for (const [story, reason] of [
    [stories.busy, "回答仍在生成，完成后可创建分支"],
    [stories.readonly, "只读会话不能创建分支"],
    [stories.disconnected, "连接恢复后可创建分支"],
  ] as const) {
    await load(page, story)
    const button = forkButton(page)
    await expect(button).toHaveCount(1)
    await expect(button).toBeDisabled()
    await page.locator('[data-component="tooltip-trigger"]').filter({ has: button }).hover()
    await expect(page.getByText(reason, { exact: true })).toBeVisible()
  }
})

test("英文、简体中文和繁体中文入口具有可访问名称", async ({ page }) => {
  for (const [story, label] of [
    [stories.english, "Fork from this response"],
    [stories.ready, "从此回答分支"],
    [stories.traditional, "從此回答分支"],
  ] as const) {
    await load(page, story)
    await expect(forkButton(page, label)).toBeVisible()
  }

  await load(page, stories.ready, 320, "hc-black")
  const accessibility = await new AxeBuilder({ page })
    .include('[data-slot="assistant-copy-wrapper"]')
    .withTags(["wcag2a", "wcag2aa"])
    .analyze()
  expect(accessibility.violations.filter((item) => ["critical", "serious"].includes(item.impact ?? ""))).toEqual([])
})
