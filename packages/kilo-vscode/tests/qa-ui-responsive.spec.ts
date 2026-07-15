import { expect, test, type Page } from "@playwright/test"

const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"
const WIDTHS = [
  200, 240, 280, 300, 301, 320, 420, 421, 479, 480, 560, 600, 720, 899, 900, 901, 941, 942, 943, 960, 1200,
]

async function load(
  page: Page,
  story: string,
  width: number,
  theme = "dark-modern",
  ready = "[data-ui='qa-composer']",
) {
  await page.setViewportSize({ width, height: 720 })
  const globals = theme === "dark-modern" ? GLOBALS : `colorScheme:dark;theme:kilo-vscode;vscodeTheme:${theme}`
  await page.goto(`/iframe.html?id=${story}&viewMode=story&globals=${globals}`, { waitUntil: "load" })
  await page.waitForSelector(ready, { state: "attached" })
}

async function colors(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((item) => {
      const probe = (value: string) => {
        const child = document.createElement("span")
        child.style.color = value
        item.append(child)
        const color = getComputedStyle(child).color
        child.remove()
        return color
      }
      const style = getComputedStyle(item)
      return {
        border: style.borderColor,
        full: probe("var(--qa-glass-border-soft)"),
        control: probe("var(--qa-control-border)"),
        hover: probe("var(--qa-control-border-hover)"),
        background: style.backgroundColor,
        shadow: style.boxShadow,
        width: style.borderTopWidth,
      }
    })
}

test("QA composer keeps every dense control in bounds without overlap", async ({ page }) => {
  for (const width of WIDTHS) {
    await load(page, "prompt-input--qa-all-controls-send", width)

    const layout = await page.locator("[data-ui='qa-composer']").evaluate((composer) => {
      const rect = (element: Element) => {
        const box = element.getBoundingClientRect()
        return {
          left: box.left,
          top: box.top,
          right: box.right,
          bottom: box.bottom,
          width: box.width,
          height: box.height,
        }
      }
      const shell = rect(composer)
      const footer = composer.querySelector<HTMLElement>("[data-ui='qa-composer-footer']")!
      const selectors = composer.querySelector<HTMLElement>("[data-ui='qa-composer-selectors']")!
      const actions = composer.querySelector<HTMLElement>("[data-ui='qa-composer-actions']")!
      const indexing = composer.querySelector<HTMLElement>("[data-ui='qa-indexing-actions']")!
      const utility = composer.querySelector<HTMLElement>("[data-ui='qa-utility-actions']")!
      const controls = Array.from(footer.querySelectorAll<HTMLElement>("button"))
        .map(rect)
        .filter((box) => box.width > 0 && box.height > 0)
      const overlaps = controls.flatMap((first, index) =>
        controls
          .slice(index + 1)
          .filter(
            (second) =>
              first.left < second.right &&
              first.right > second.left &&
              first.top < second.bottom &&
              first.bottom > second.top,
          ),
      )
      const labels = Array.from(
        selectors.querySelectorAll<HTMLElement>(
          ".model-selector-trigger-label, .mode-switcher-trigger-label, .thinking-selector-trigger-label",
        ),
      )
      const model = selectors.querySelector<HTMLElement>(".model-selector-trigger-label")
      const send = actions.querySelector<HTMLElement>(".prompt-send-button")!
      const style = getComputedStyle(composer)
      const container =
        composer.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)

      return {
        viewport: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        container,
        shell,
        selectors: rect(selectors),
        actions: rect(actions),
        controls,
        overlaps: overlaps.length,
        labels: labels.map((label) => getComputedStyle(label).display),
        indexLabels: Array.from(actions.querySelectorAll<HTMLElement>(".prompt-indexing-label")).map(
          (label) => getComputedStyle(label).display,
        ),
        modelClipped: model ? model.scrollWidth > model.clientWidth : false,
        send: rect(send),
        indexing: rect(indexing),
        utility: rect(utility),
      }
    })

    expect(layout.scrollWidth, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(layout.viewport)
    expect(layout.overlaps, `control overlap at ${width}px`).toBe(0)
    expect(layout.controls.length, `missing dense controls at ${width}px`).toBe(11)
    for (const control of layout.controls) {
      expect(control.left, `control escapes left edge at ${width}px`).toBeGreaterThanOrEqual(layout.shell.left - 1)
      expect(control.right, `control escapes right edge at ${width}px`).toBeLessThanOrEqual(layout.shell.right + 1)
    }

    expect(layout.labels, `selector label visibility at ${width}px`).toEqual(
      layout.container <= 300 ? ["none", "none", "none"] : ["block", "block", "block"],
    )
    expect(layout.indexLabels, `index label visibility at ${width}px`).toEqual(
      layout.container <= 479 ? ["none", "none", "none"] : ["block", "block", "block"],
    )
    if (layout.container > 300) {
      expect(layout.modelClipped, `long model name is not ellipsized at ${width}px`).toBe(true)
    }

    if (layout.container <= 420) {
      expect(layout.actions.top).toBeGreaterThan(layout.selectors.top)
      expect(Math.abs(layout.indexing.top - layout.actions.top)).toBeLessThanOrEqual(1)
      expect(layout.utility.top).toBeGreaterThan(layout.indexing.top)
      expect(Math.abs(layout.send.top - layout.utility.top)).toBeLessThanOrEqual(1)
      expect(Math.abs(layout.send.right - layout.utility.right)).toBeLessThanOrEqual(2)
      continue
    }

    expect(Math.abs(layout.indexing.top - layout.utility.top)).toBeLessThanOrEqual(1)
    if (layout.container <= 899) {
      expect(layout.actions.top).toBeGreaterThan(layout.selectors.top)
      continue
    }

    expect(Math.abs(layout.actions.top - layout.selectors.top)).toBeLessThanOrEqual(2)
  }
})

test("QA composer keeps sparse optional-control combinations deterministic", async ({ page }) => {
  for (const story of ["prompt-input--qa-indexing-standby", "prompt-input--default-420"]) {
    for (const width of [320, 560, 960]) {
      await load(page, story, width)
      const layout = await page.locator("[data-ui='qa-composer']").evaluate((composer) => {
        const controls = Array.from(composer.querySelectorAll<HTMLElement>("button")).filter(
          (button) => button.getBoundingClientRect().width > 0,
        )
        const overlaps = controls.flatMap((first, index) => {
          const a = first.getBoundingClientRect()
          return controls.slice(index + 1).filter((second) => {
            const b = second.getBoundingClientRect()
            return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
          })
        })
        const shell = composer.getBoundingClientRect()
        const send = composer.querySelector<HTMLElement>(".prompt-send-button")!.getBoundingClientRect()
        const utility = composer.querySelector<HTMLElement>("[data-ui='qa-utility-actions']")!.getBoundingClientRect()
        return {
          overlaps: overlaps.length,
          overflow: document.documentElement.scrollWidth > window.innerWidth,
          escaped: controls.some((button) => {
            const box = button.getBoundingClientRect()
            return box.left < shell.left - 1 || box.right > shell.right + 1
          }),
          compact: shell.width <= 420,
          sendRight: send.right,
          utilityRight: utility.right,
        }
      })

      expect(layout.overlaps, `${story} overlaps at ${width}px`).toBe(0)
      expect(layout.overflow, `${story} overflows at ${width}px`).toBe(false)
      expect(layout.escaped, `${story} escapes at ${width}px`).toBe(false)
      if (layout.compact) {
        expect(Math.abs(layout.sendRight - layout.utilityRight)).toBeLessThanOrEqual(2)
      }
    }
  }
})

test("QA composer exposes semantic send, speech, and busy stop actions", async ({ page }) => {
  await load(page, "prompt-input--qa-all-controls-send", 420)
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible()
  await expect(page.getByRole("button", { name: /^Start voice input/ })).toBeVisible()
  await expect(page.locator(".prompt-send-button .codicon-send")).toBeVisible()

  await load(page, "prompt-input--qa-all-controls-stop", 420)
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible()
  await expect(page.locator(".prompt-stop-button .codicon-debug-stop")).toBeVisible()
  await expect(page.locator(".prompt-send-button")).toHaveCount(0)
})

test("QA idle controls use refined glass borders while focus and high contrast remain explicit", async ({ page }) => {
  await load(page, "prompt-input--qa-indexing-standby", 850)
  const selector = '[data-ui="qa-composer-selectors"] [data-component="button"]'
  const action = '.prompt-indexing-button[data-tone="muted"]'
  const idle = await colors(page, selector)
  const standby = await colors(page, action)

  expect(idle.width).toBe("1px")
  expect(idle.border).toBe(idle.control)
  expect(idle.border).not.toBe("rgb(111, 195, 223)")
  expect(idle.shadow).toContain("inset")
  expect(standby.border).toBe(standby.control)
  expect(standby.border).not.toBe("rgb(111, 195, 223)")

  const button = page.locator(selector).first()
  const before = idle.border
  await button.hover()
  await expect.poll(() => button.evaluate((item) => getComputedStyle(item).borderColor)).not.toBe(before)

  await load(page, "prompt-input--qa-indexing-standby", 850)
  const keyboard = page.locator(selector).first()
  for (let index = 0; index < 20; index++) {
    await page.keyboard.press("Tab")
    if (await keyboard.evaluate((item) => item === document.activeElement)) break
  }
  await expect(keyboard).toBeFocused()
  await expect
    .poll(() =>
      keyboard.evaluate((item) => {
        const style = getComputedStyle(item)
        return { width: style.outlineWidth, offset: style.outlineOffset }
      }),
    )
    .toEqual({ width: "2px", offset: "2px" })

  await load(page, "prompt-input--qa-indexing-standby", 850, "hc-black")
  const contrast = await colors(page, selector)
  expect(contrast.border).toBe(contrast.full)
  expect(contrast.shadow).toBe("none")
})

test("QA indexing controls expose persistent labels, complete, progress, warning, and error states", async ({
  page,
}) => {
  await load(page, "prompt-input--qa-all-controls-send", 850)

  const complete = page.getByRole("button", { name: "CodeGraph index: Complete, 100%" })
  const indexing = page.getByRole("button", { name: "RAG index: In Progress, 63%" })
  const error = page.getByRole("button", { name: "Documents index: Error, 28%, 2 errors, 0 stale" })

  await expect(complete).toHaveAttribute("data-state", "complete")
  await expect(complete).toHaveAttribute("data-tone", "success")
  await expect(complete).toHaveAttribute("data-progress", "100")
  await expect(complete.locator(".codicon-check")).toBeVisible()

  await expect(indexing).toHaveAttribute("data-state", "indexing")
  await expect(indexing).toHaveAttribute("data-tone", "warning")
  await expect(indexing).toHaveAttribute("data-progress", "63")
  await expect(indexing).toHaveAttribute("aria-busy", "true")
  await expect(indexing.locator(".codicon-sync")).toBeVisible()

  await expect(error).toHaveAttribute("data-state", "error")
  await expect(error).toHaveAttribute("data-tone", "error")
  await expect(error.locator(".codicon-error")).toBeVisible()
  await expect(complete.locator(".prompt-indexing-label")).toHaveText("CodeGraph")
  await expect(indexing.locator(".prompt-indexing-label")).toHaveText("RAG")
  await expect(error.locator(".prompt-indexing-label")).toHaveText("Documents")

  const buttons = page.locator(".prompt-indexing-button")
  const styles = await buttons.evaluateAll((items) =>
    items.map((item) => {
      const box = item.getBoundingClientRect()
      return {
        border: getComputedStyle(item).borderColor,
        width: box.width,
        height: box.height,
      }
    }),
  )
  expect(new Set(styles.map((style) => style.border)).size).toBe(3)
  for (const style of styles) {
    expect(style.width).toBeGreaterThanOrEqual(36)
    expect(style.height).toBeCloseTo(36, 0)
  }

  await page.waitForTimeout(180)
  const border = await indexing.evaluate((item) => getComputedStyle(item).borderColor)
  await indexing.hover()
  await expect.poll(() => indexing.evaluate((item) => getComputedStyle(item).borderColor)).toBe(border)

  await page.emulateMedia({ reducedMotion: "reduce" })
  expect(
    await indexing.locator(".prompt-indexing-status-codicon").evaluate((item) => getComputedStyle(item).animationName),
  ).toBe("none")
  await page.emulateMedia({ reducedMotion: "no-preference" })

  await load(page, "prompt-input--qa-all-controls-send", 560)
  await expect(page.locator(".prompt-indexing-label").first()).toBeVisible()
  for (const button of await page.locator(".prompt-indexing-button").all()) {
    const box = await button.boundingBox()
    expect(box?.width).toBeGreaterThan(36)
    expect(box?.height).toBeCloseTo(36, 0)
  }

  await load(page, "prompt-input--qa-all-controls-send", 480)
  await expect(page.locator(".prompt-indexing-label").first()).toBeHidden()
  for (const button of await page.locator(".prompt-indexing-button").all()) {
    const box = await button.boundingBox()
    expect(box?.width).toBeCloseTo(36, 0)
  }

  await load(page, "prompt-input--qa-indexing-warning", 420)
  const warnings = page.locator('.prompt-indexing-button[data-state="complete"][data-tone="warning"]')
  await expect(warnings).toHaveCount(2)
  await expect(warnings.locator(".codicon-warning")).toHaveCount(2)
  await expect(page.locator('.prompt-indexing-button[data-tone="success"] .codicon-check')).toHaveCount(1)

  await load(page, "prompt-input--qa-indexing-standby", 420)
  await expect(page.locator('.prompt-indexing-button[data-tone="muted"]')).toHaveCount(3)
  await expect(page.locator(".prompt-indexing-button .codicon-circle-outline")).toHaveCount(3)
})

test("QA reading surfaces stay borderless while semantic cards retain boundaries", async ({ page }) => {
  await load(page, "chat--qa-aligned-conversation-surface", 560)
  await page.locator('[data-component="task-header-graph"]').waitFor()

  const panels = page.locator(
    '[data-component="task-header"], [data-component="task-header-graph"], [data-component="task-header-todos"]',
  )
  const styles = await panels.evaluateAll((items) =>
    items.map((item) => {
      const style = getComputedStyle(item)
      return {
        top: style.borderTopWidth,
        right: style.borderRightWidth,
        bottom: style.borderBottomWidth,
        left: style.borderLeftWidth,
        background: style.backgroundColor,
        shadow: style.boxShadow,
      }
    }),
  )

  expect(styles.length).toBeGreaterThanOrEqual(2)
  for (const style of styles) {
    expect(style.top).toBe("0px")
    expect(style.right).toBe("0px")
    expect(style.left).toBe("0px")
    expect(style.background).toBe("rgba(0, 0, 0, 0)")
    expect(style.shadow).toBe("none")
  }
  expect(styles.filter((style) => style.bottom === "1px")).toHaveLength(1)
  expect(styles.at(-1)?.bottom).toBe("1px")

  const text = page.locator('[data-component="tool-part-wrapper"][data-part-type="text"]')
  await expect(text).toBeVisible()
  const reading = await text.evaluate((item) => {
    const style = getComputedStyle(item)
    return {
      border: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
      background: style.backgroundColor,
      shadow: style.boxShadow,
    }
  })
  expect(reading.border).toEqual(["0px", "0px", "0px", "0px"])
  expect(reading.background).toBe("rgba(0, 0, 0, 0)")
  expect(reading.shadow).toBe("none")

  for (const selector of [
    '[data-component="tool-part-wrapper"][data-part-type="tool"]',
    '[data-component="question-dock"]',
    '[data-component="suggest-bar"]',
  ]) {
    await expect(page.locator(selector).first()).toBeVisible()
    expect(
      await page
        .locator(selector)
        .first()
        .evaluate((item) => getComputedStyle(item).borderTopWidth),
    ).toBe("1px")
  }
})

test("QA user messages use one content-sized bubble for short, medium, and long text", async ({ page }) => {
  for (const width of [300, 420, 560]) {
    await load(page, "chat--qa-user-message-lengths", width, "dark-modern", '[data-story="qa-message-lengths"]')

    const layout = await page.locator('[data-story="qa-message-lengths"]').evaluate((root) => {
      const box = (item: Element) => {
        const rect = item.getBoundingClientRect()
        return {
          left: rect.left,
          right: rect.right,
          width: rect.width,
          height: rect.height,
        }
      }
      const turns = Array.from(root.querySelectorAll<HTMLElement>(".vscode-session-turn-user"))
      return {
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        rows: turns.map((turn) => {
          const bubble = turn.querySelector<HTMLElement>('[data-slot="user-message-text"]')!
          const actions = turn.querySelector<HTMLElement>('[data-slot="user-message-copy-wrapper"]')!
          const style = getComputedStyle(turn)
          const actionStyle = getComputedStyle(actions)
          return {
            outer: box(turn),
            bubble: box(bubble),
            actions: box(actions),
            border: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
            background: style.backgroundColor,
            shadow: style.boxShadow,
            actionOpacity: actionStyle.opacity,
            actionPointer: actionStyle.pointerEvents,
            clipped: bubble.scrollHeight > bubble.clientHeight + 1 || bubble.scrollWidth > bubble.clientWidth + 1,
          }
        }),
      }
    })

    expect(layout.overflow, `horizontal overflow at ${width}px`).toBe(false)
    expect(layout.rows, `missing message length states at ${width}px`).toHaveLength(3)
    for (const row of layout.rows) {
      expect(row.border).toEqual(["0px", "0px", "0px", "0px"])
      expect(row.background).toBe("rgba(0, 0, 0, 0)")
      expect(row.shadow).toBe("none")
      expect(row.bubble.width).toBeLessThanOrEqual(row.outer.width * 0.78 + 2)
      expect(Math.abs(row.bubble.right - row.outer.right)).toBeLessThanOrEqual(1)
      expect(Math.abs(row.actions.right - row.bubble.right)).toBeLessThanOrEqual(1)
      expect(row.actions.width).toBeLessThan(row.bubble.width)
      expect(row.actionOpacity).toBe("0.62")
      expect(row.actionPointer).toBe("auto")
      expect(row.clipped).toBe(false)
    }

    expect(layout.rows[0]!.bubble.width).toBeLessThan(layout.rows[1]!.bubble.width - 20)
    expect(layout.rows[1]!.bubble.width).toBeLessThanOrEqual(layout.rows[2]!.bubble.width + 1)
    expect(layout.rows[2]!.bubble.height).toBeGreaterThan(layout.rows[1]!.bubble.height)
  }

  await load(page, "chat--qa-user-message-lengths", 420, "dark-modern", '[data-story="qa-message-lengths"]')
  const first = page.locator('[data-component="user-message"]').first()
  const actions = first.locator('[data-slot="user-message-copy-wrapper"]')
  await first.hover()
  await expect.poll(() => actions.evaluate((item) => getComputedStyle(item).opacity)).toBe("1")

  const copy = first.getByRole("button", { name: "Copy message" })
  await copy.focus()
  await expect(copy).toBeFocused()
  await expect.poll(() => actions.evaluate((item) => getComputedStyle(item).opacity)).toBe("1")
})

test("QA user message queued and busy states retain their existing semantics", async ({ page }) => {
  await load(
    page,
    "chat--message-list-tool-to-queued-user-spacing",
    420,
    "dark-modern",
    '[data-slot="user-message-text"]',
  )

  const queued = page.locator('[data-slot="user-message-text"][data-queued]')
  await expect(queued).toHaveCount(2)
  for (const item of await queued.all()) {
    await expect.poll(() => item.evaluate((node) => getComputedStyle(node).opacity)).toBe("0.6")
  }

  const disabled = page.locator(
    '.vscode-session-turn-user[data-revert-disabled] [data-component="icon-button"][data-icon="arrow-left"]',
  )
  await expect(disabled).toBeVisible()
  await expect.poll(() => disabled.evaluate((item) => getComputedStyle(item).opacity)).toBe("0.4")
  await expect.poll(() => disabled.evaluate((item) => getComputedStyle(item).cursor)).toBe("not-allowed")
})
