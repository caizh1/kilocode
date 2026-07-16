import { expect, test, type Page } from "@playwright/test"

const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"
const WIDTHS = [
  200, 240, 280, 300, 301, 320, 340, 341, 360, 380, 381, 420, 421, 480, 559, 560, 720, 939, 940, 960, 1200, 1450,
]
const COMPOSER_WIDTHS = [
  170, 200, 240, 280, 299, 300, 301, 340, 341, 559, 560, 619, 620, 621, 759, 760, 761, 859, 860, 861, 960, 1200, 1450,
]

async function load(
  page: Page,
  story: string,
  width: number,
  theme = "dark-modern",
  ready = "[data-ui='qa-composer']",
) {
  await page.setViewportSize({ width, height: 720 })
  const scheme = theme === "light-modern" || theme === "hc-light" ? "light" : "dark"
  await page.emulateMedia({ colorScheme: scheme })
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

async function resizeComposer(page: Page, width: number) {
  await page.locator("[data-ui='qa-composer']").evaluate((node, target) => {
    const composer = node as HTMLElement
    const style = getComputedStyle(composer)
    const chrome =
      Number.parseFloat(style.paddingLeft) +
      Number.parseFloat(style.paddingRight) +
      Number.parseFloat(style.borderLeftWidth) +
      Number.parseFloat(style.borderRightWidth)
    composer.style.width = `${target + chrome}px`
    composer.style.maxWidth = "none"
  }, width)
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
}

test("QA composer keeps every dense control in bounds without overlap", async ({ page }) => {
  for (const width of COMPOSER_WIDTHS) {
    await load(page, "prompt-input--qa-all-controls-send", 1500)
    await resizeComposer(page, width)

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
      const controls = Array.from(footer.querySelectorAll<HTMLButtonElement>("button"))
        .map((button) => ({ ...rect(button), centerX: 0, centerY: 0, ui: button.dataset.ui ?? "" }))
        .map((box) => ({
          ...box,
          centerX: box.left + box.width / 2,
          centerY: box.top + box.height / 2,
        }))
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
      const selectorElements = Array.from(selectors.querySelectorAll<HTMLButtonElement>("button")).filter(
        (button) => button.getBoundingClientRect().width > 0,
      )
      const actionElements = Array.from(actions.querySelectorAll<HTMLButtonElement>("button")).filter(
        (button) => button.getBoundingClientRect().width > 0,
      )
      const indexElements = Array.from(
        actions.querySelectorAll<HTMLButtonElement>("[data-ui='qa-indexing-actions'] button"),
      ).filter((button) => button.getBoundingClientRect().width > 0)
      const utilityElements = Array.from(
        actions.querySelectorAll<HTMLButtonElement>("[data-ui='qa-utility-actions'] button"),
      ).filter((button) => button.getBoundingClientRect().width > 0)
      const actionControls = actionElements
        .map((button) => ({ ...rect(button), ui: button.dataset.ui ?? "" }))
        .filter((box) => box.width > 0 && box.height > 0)
      const send = actions.querySelector<HTMLElement>("[data-ui='qa-action-submit']")!
      const index = Array.from(actions.querySelectorAll<HTMLButtonElement>(".prompt-indexing-button"))
      const status = Array.from(actions.querySelectorAll<HTMLElement>(".prompt-indexing-status-codicon"))
      const indexGroup = actions.querySelector<HTMLElement>("[data-ui='qa-indexing-actions']")!
      const utilityGroup = actions.querySelector<HTMLElement>("[data-ui='qa-utility-actions']")!
      const style = getComputedStyle(composer)
      const container =
        composer.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)
      const rows = (elements: HTMLElement[]) =>
        elements
          .map((item) => item.getBoundingClientRect().top + item.getBoundingClientRect().height / 2)
          .sort((a, b) => a - b)
          .reduce<number[]>((result, center) => {
            if (result.every((existing) => Math.abs(existing - center) > 2)) result.push(center)
            return result
          }, [])

      return {
        scrollWidth: composer.scrollWidth,
        clientWidth: composer.clientWidth,
        container,
        shell,
        selectors: rect(selectors),
        actions: rect(actions),
        controls,
        actionControls,
        overlaps: overlaps.length,
        labels: labels.map((label) => label.getBoundingClientRect().width > 0),
        indexLabels: Array.from(actions.querySelectorAll<HTMLElement>(".prompt-indexing-label")).map(
          (label) => getComputedStyle(label).display,
        ),
        modelClipped: model ? model.scrollWidth > model.clientWidth : false,
        send: rect(send),
        selectorRows: rows(selectorElements),
        actionRows: rows(actionElements),
        indexRows: rows(indexElements),
        utilityRows: rows(utilityElements),
        utilityCenters: utilityElements.map((item) => {
          const box = item.getBoundingClientRect()
          return box.left + box.width / 2
        }),
        indexGroup: rect(indexGroup),
        utilityGroup: rect(utilityGroup),
        statusVisible: status.every((mark) => {
          const box = mark.getBoundingClientRect()
          return box.width > 0 && box.height > 0
        }),
        summaryVisible: (() => {
          const summary = actions.querySelector<HTMLElement>("[data-ui='qa-indexing-summary']")
          if (!summary) return false
          const box = summary.getBoundingClientRect()
          return box.width > 0 && box.height > 0
        })(),
        indexSpacing: index.map((button) => {
          const label = button.querySelector<HTMLElement>(".prompt-indexing-label")!
          const buttonBox = button.getBoundingClientRect()
          const labelBox = label.getBoundingClientRect()
          const buttonStyle = getComputedStyle(button)
          return {
            left: buttonStyle.paddingLeft,
            right: buttonStyle.paddingRight,
            gap: buttonStyle.gap,
            shrink: buttonStyle.flexShrink,
            visible: getComputedStyle(label).display !== "none",
            trailing: buttonBox.right - labelBox.right,
          }
        }),
      }
    })

    expect(layout.container, `unexpected Composer width at ${width}px`).toBeCloseTo(width, 0)
    expect(layout.scrollWidth, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(layout.clientWidth)
    expect(layout.overlaps, `control overlap at ${width}px`).toBe(0)
    expect(layout.controls.length, `missing dense controls at ${width}px`).toBe(layout.container <= 300 ? 8 : 12)
    for (const control of layout.controls) {
      expect(control.left, `control escapes left edge at ${width}px`).toBeGreaterThanOrEqual(layout.shell.left - 1)
      expect(control.right, `control escapes right edge at ${width}px`).toBeLessThanOrEqual(layout.shell.right + 1)
    }

    expect(layout.labels, `selector label visibility at ${width}px`).toEqual([true, true, true])
    expect(layout.indexLabels, `index label visibility at ${width}px`).toEqual(
      layout.container <= 559 ? ["none", "none", "none"] : ["block", "block", "block"],
    )
    if (layout.container > 340) {
      expect(layout.modelClipped, `long model name is not ellipsized at ${width}px`).toBe(true)
    }

    expect(layout.selectorRows, `selector row count at ${width}px`).toHaveLength(1)
    expect(layout.indexRows, `index row count at ${width}px`).toHaveLength(1)
    expect(layout.utilityRows, `utility row count at ${width}px`).toHaveLength(1)

    if (layout.container <= 300) {
      expect(layout.actions.top).toBeGreaterThan(layout.selectors.top)
      expect(layout.actionRows, `extreme-narrow action row count at ${width}px`).toHaveLength(1)
      expect(
        Math.abs(layout.indexRows[0]! - layout.utilityRows[0]!),
        `extreme-narrow action center drift at ${width}px`,
      ).toBeLessThanOrEqual(2)
      expect(
        Math.abs(layout.send.left + layout.send.width / 2 - Math.max(...layout.utilityCenters)),
        `submit is not the final utility action at ${width}px`,
      ).toBeLessThanOrEqual(1.5)
      expect(layout.summaryVisible).toBe(true)
      continue
    }

    if (layout.container < 860) {
      expect(layout.actions.top).toBeGreaterThan(layout.selectors.top)
      expect(layout.actionRows, `two-line action row count at ${width}px`).toHaveLength(1)
      expect(
        Math.abs(layout.indexRows[0]! - layout.utilityRows[0]!),
        `action group center drift at ${width}px`,
      ).toBeLessThanOrEqual(2)
      expect(layout.indexGroup.right, `action groups overlap at ${width}px`).toBeLessThanOrEqual(
        layout.utilityGroup.left,
      )
      if (layout.container >= 560) {
        for (const spacing of layout.indexSpacing) {
          expect(spacing.visible).toBe(true)
          expect(spacing.left).toBe("10px")
          expect(spacing.right).toBe("12px")
          expect(spacing.gap).toBe("7px")
          expect(spacing.shrink).toBe("0")
          expect(spacing.trailing).toBeGreaterThanOrEqual(11)
        }
      } else {
        expect(layout.statusVisible).toBe(true)
      }
      continue
    }

    expect(layout.actionRows, `wide action row count at ${width}px`).toHaveLength(1)
    const line = layout.controls.map((control) => control.centerY)
    expect(Math.max(...line) - Math.min(...line), `single-line center drift at ${width}px`).toBeLessThanOrEqual(2)
  }
})

test("QA composer keeps sparse optional-control combinations deterministic", async ({ page }) => {
  for (const story of ["prompt-input--qa-indexing-standby", "prompt-input--qa-sparse-controls"]) {
    for (const width of [170, 299, 300, 301, 559, 560, 619, 620, 621, 759, 760, 761, 860, 1200]) {
      await load(page, story, 1500)
      await resizeComposer(page, width)
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
        const selectors = composer.querySelector<HTMLElement>("[data-ui='qa-composer-selectors']")!
        const actions = composer.querySelector<HTMLElement>("[data-ui='qa-composer-actions']")!
        const send = composer.querySelector<HTMLElement>("[data-ui='qa-action-submit']")!.getBoundingClientRect()
        const index = composer.querySelector<HTMLElement>("[data-ui='qa-indexing-actions']")
        const utility = composer.querySelector<HTMLElement>("[data-ui='qa-utility-actions']")!
        const actionControls = Array.from(actions.querySelectorAll<HTMLButtonElement>("button")).filter(
          (button) => button.getBoundingClientRect().width > 0,
        )
        const selectorControls = Array.from(selectors.querySelectorAll<HTMLButtonElement>("button")).filter(
          (button) => button.getBoundingClientRect().width > 0,
        )
        const utilityControls = Array.from(utility.querySelectorAll<HTMLButtonElement>("button")).filter(
          (button) => button.getBoundingClientRect().width > 0,
        )
        const rows = (items: HTMLElement[]) =>
          items
            .map((item) => item.getBoundingClientRect().top + item.getBoundingClientRect().height / 2)
            .sort((a, b) => a - b)
            .reduce<number[]>((result, center) => {
              if (result.every((existing) => Math.abs(existing - center) > 2)) result.push(center)
              return result
            }, [])
        const style = getComputedStyle(composer)
        const container =
          composer.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)
        const columns = getComputedStyle(selectors).gridTemplateColumns.split(" ").filter(Boolean).length
        const utilityCenters = utilityControls.map((button) => {
          const box = button.getBoundingClientRect()
          return box.left + box.width / 2
        })
        return {
          overlaps: overlaps.length,
          overflow: document.documentElement.scrollWidth > window.innerWidth,
          escaped: controls.some((button) => {
            const box = button.getBoundingClientRect()
            return box.left < shell.left - 1 || box.right > shell.right + 1
          }),
          container,
          columns,
          hasIndex: Boolean(index),
          selectorRows: rows(selectorControls),
          actionRows: rows(actionControls),
          sendCenter: send.left + send.width / 2,
          utilityEnd: Math.max(...utilityCenters),
        }
      })

      expect(layout.overlaps, `${story} overlaps at ${width}px`).toBe(0)
      expect(layout.overflow, `${story} overflows at ${width}px`).toBe(false)
      expect(layout.escaped, `${story} escapes at ${width}px`).toBe(false)
      expect(layout.columns, `${story} leaves blank selector tracks at ${width}px`).toBe(2)
      expect(layout.actionRows, `${story} action row count at ${width}px`).toHaveLength(1)
      expect(layout.selectorRows, `${story} selector row count at ${width}px`).toHaveLength(1)
      const threshold = layout.hasIndex ? 760 : 620
      if (layout.container < threshold) {
        expect(layout.actionRows[0], `${story} should use two toolbar rows at ${width}px`).toBeGreaterThan(
          layout.selectorRows[0]!,
        )
      } else {
        expect(
          Math.abs(layout.actionRows[0]! - layout.selectorRows[0]!),
          `${story} should use one toolbar row at ${width}px`,
        ).toBeLessThanOrEqual(2)
      }
      expect(
        Math.abs(layout.sendCenter - layout.utilityEnd),
        `${story} submit order at ${width}px`,
      ).toBeLessThanOrEqual(1.5)
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

test("QA extreme-narrow menus preserve indexing and optional actions", async ({ page }) => {
  await load(page, "prompt-input--qa-all-controls-send", 1500)
  await resizeComposer(page, 300)

  const summary = page.getByRole("button", { name: /^Indexing:/ })
  await expect(summary).toBeVisible()
  await expect(summary).toHaveAttribute("aria-busy", "true")
  await expect(page.locator(".prompt-indexing-button:visible")).toHaveCount(0)

  await summary.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("menuitem", { name: /CodeGraph Complete · 100%/ })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: /RAG In Progress · 63%/ })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: /Documents Error · 28%/ })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(summary).toBeFocused()

  const more = page.getByRole("button", { name: "More options" })
  await expect(more).toBeVisible()
  await more.focus()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("menuitem", { name: "Reset model to default" })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: /sandbox/i })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: /^Start voice input/ })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(more).toBeFocused()
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

  await load(page, "prompt-input--qa-indexing-standby", 850, "light-modern")
  const light = await colors(page, selector)
  expect(light.width).toBe("1px")
  expect(light.shadow).toContain("inset")
  expect(light.background).toBe("rgb(234, 244, 255)")
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

  await load(page, "prompt-input--qa-all-controls-send", 620)
  await expect(page.locator(".prompt-indexing-label").first()).toBeVisible()
  for (const button of await page.locator(".prompt-indexing-button").all()) {
    const box = await button.boundingBox()
    expect(box?.width).toBeGreaterThan(36)
    expect(box?.height).toBeCloseTo(36, 0)
  }

  await load(page, "prompt-input--qa-all-controls-send", 560)
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

  const hud = page.locator('[data-ui="qa-task-hud"]')
  const hudStyle = await hud.evaluate((item) => {
    const style = getComputedStyle(item)
    return {
      border: style.borderTopWidth,
      background: style.backgroundColor,
      shadow: style.boxShadow,
    }
  })
  expect(hudStyle.border).toBe("1px")
  expect(hudStyle.background).not.toBe("rgba(0, 0, 0, 0)")
  expect(hudStyle.shadow).toContain("inset")
  expect(hudStyle.shadow).not.toContain("30px")

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
    expect(style.right).toBe("0px")
    expect(style.left).toBe("0px")
    expect(style.background).toBe("rgba(0, 0, 0, 0)")
    expect(style.shadow).toBe("none")
  }
  expect(styles.filter((style) => style.top === "1px").length).toBeLessThanOrEqual(styles.length - 1)
  expect(styles.filter((style) => style.bottom === "1px").length).toBe(0)

  const text = page.locator('[data-component="tool-part-wrapper"][data-part-type="text"]').first()
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

  const shells = page.locator('[data-ui="qa-part-shell"][data-part-type="tool"]')
  expect(await shells.count()).toBeGreaterThan(0)
  for (const shell of await shells.all()) {
    expect(await shell.evaluate((item) => getComputedStyle(item).borderTopWidth)).toBe("0px")
  }

  for (const selector of ['[data-component="question-dock"]', '[data-component="suggest-bar"]']) {
    await expect(page.locator(selector).first()).toBeVisible()
    expect(
      await page
        .locator(selector)
        .first()
        .evaluate((item) => getComputedStyle(item).borderTopWidth),
    ).toBe("1px")
  }

  await load(page, "chat--qa-titanium-full-conversation", 960)
  const shell = page.locator('[data-ui="qa-part-shell"]:has(> .document-artifact-card)').first()
  const tool = shell.locator(':scope > [data-component="tool-part-wrapper"][data-tool]').first()
  await expect(tool).toBeVisible()
  expect(await tool.evaluate((item) => getComputedStyle(item).borderTopWidth)).toBe("0px")
  const artifact = page.locator(".document-artifact-card")
  await expect(artifact).toBeVisible()
  expect(await artifact.evaluate((item) => getComputedStyle(item).borderTopWidth)).toBe("1px")
  const artifactShell = artifact.locator('xpath=ancestor::*[@data-ui="qa-part-shell"][1]')
  expect(await artifactShell.evaluate((item) => getComputedStyle(item).borderTopWidth)).toBe("0px")
})

test("QA task HUD and message flow stay deterministic across chat widths", async ({ page }) => {
  for (const width of WIDTHS) {
    await load(page, "chat--qa-titanium-full-conversation", width, "dark-modern", '[data-ui="qa-task-hud"]')
    await page.locator('[data-slot="task-header-todos-trigger"]').click()

    const layout = await page.locator('[data-ui="qa-task-hud"]').evaluate((hud) => {
      const box = hud.getBoundingClientRect()
      const list = hud.querySelector<HTMLElement>('[data-slot="task-header-todos-list"]')!
      const panels = Array.from(
        hud.querySelectorAll<HTMLElement>(
          '[data-component="task-header"], [data-component="task-header-graph"], [data-component="task-header-todos"]',
        ),
      )
      const shells = Array.from(document.querySelectorAll<HTMLElement>('[data-ui="qa-part-shell"]'))
      return {
        viewport: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        left: box.left,
        right: box.right,
        columns: getComputedStyle(list).gridTemplateColumns.split(" ").filter(Boolean).length,
        innerBorders: panels.map((panel) => {
          const style = getComputedStyle(panel)
          return [style.borderRightWidth, style.borderLeftWidth]
        }),
        shellBorders: shells.map((shell) => getComputedStyle(shell).borderTopWidth),
      }
    })

    expect(layout.scrollWidth, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(layout.viewport)
    expect(layout.left, `HUD escapes left edge at ${width}px`).toBeGreaterThanOrEqual(0)
    expect(layout.right, `HUD escapes right edge at ${width}px`).toBeLessThanOrEqual(layout.viewport)
    expect(layout.columns, `todo column count at ${width}px`).toBe(width >= 940 ? 2 : 1)
    expect(layout.innerBorders.every((edges) => edges.every((edge) => edge === "0px"))).toBe(true)
    expect(layout.shellBorders.every((edge) => edge === "0px")).toBe(true)
  }
})

test("QA task HUD reads as an integrated context strip across target widths and themes", async ({ page }) => {
  for (const width of [300, 360, 420, 560, 720, 940, 1200]) {
    await load(page, "chat--qa-task-hud-integrated-1280", width, "dark-modern", '[data-ui="qa-task-hud"]')

    const layout = await page.locator('[data-ui="qa-task-hud"]').evaluate((hud) => {
      const rect = (item: Element) => {
        const box = item.getBoundingClientRect()
        return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width }
      }
      const intersects = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) =>
        a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
      const title = hud.querySelector<HTMLElement>('[data-slot="task-header-title"]')!
      const stats = hud.querySelector<HTMLElement>('[data-slot="task-header-stats"]')!
      const metrics = hud.querySelector<HTMLElement>('[data-slot="task-header-metrics"]')!
      const actions = hud.querySelector<HTMLElement>('[data-slot="task-header-actions"]')!
      const value = hud.querySelector<HTMLElement>('[data-slot="task-header-context-value"]')!
      const unit = hud.querySelector<HTMLElement>('[data-slot="task-header-context-unit"]')!
      const compact = hud.querySelector<HTMLElement>('[data-slot="task-header-context-compact"]')!
      const content = document.querySelector<HTMLElement>('.message-list-content')!
      const sections = Array.from(hud.children).filter((item) => item.getBoundingClientRect().height > 0)
      const style = getComputedStyle(hud)
      const titleBox = rect(title)
      const statsBox = rect(stats)
      const metricsBox = rect(metrics)
      const actionsBox = rect(actions)
      return {
        viewport: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        hud: rect(hud),
        content: rect(content),
        radius: style.borderRadius,
        shadow: style.boxShadow,
        blur: style.backdropFilter,
        titleStatsOverlap: intersects(titleBox, statsBox),
        metricsActionsOverlap: intersects(metricsBox, actionsBox),
        value: getComputedStyle(value).display,
        unit: getComputedStyle(unit).display,
        compact: getComputedStyle(compact).display,
        dividers: sections.map((item) => {
          const css = getComputedStyle(item)
          return { top: css.borderTopWidth, bottom: css.borderBottomWidth }
        }),
      }
    })

    expect(layout.scrollWidth, `document overflow at ${width}px`).toBeLessThanOrEqual(layout.viewport)
    expect(layout.hud.left, `HUD escapes left at ${width}px`).toBeGreaterThanOrEqual(0)
    expect(layout.hud.right, `HUD escapes right at ${width}px`).toBeLessThanOrEqual(layout.viewport)
    expect(Math.abs(layout.hud.left - layout.content.left), `left flow alignment at ${width}px`).toBeLessThanOrEqual(12)
    expect(Math.abs(layout.hud.right - layout.content.right), `right flow alignment at ${width}px`).toBeLessThanOrEqual(12)
    expect(layout.shadow, `lightweight inset material at ${width}px`).toContain("inset")
    expect(layout.shadow, `no large HUD shadow at ${width}px`).not.toContain("30px")
    expect(layout.radius).toBe(width <= 300 ? "10px" : "12px")
    expect(layout.titleStatsOverlap, `title/stats overlap at ${width}px`).toBe(false)
    expect(layout.metricsActionsOverlap, `metrics/actions overlap at ${width}px`).toBe(false)
    expect(layout.dividers[0]).toEqual({ top: "0px", bottom: "0px" })
    expect(layout.dividers.slice(1).every((divider) => divider.top === "1px" && divider.bottom === "0px")).toBe(
      true,
    )

    if (width <= 300) {
      expect(layout.value).toBe("none")
      expect(layout.unit).toBe("none")
      expect(layout.compact).not.toBe("none")
      continue
    }
    expect(layout.value).not.toBe("none")
    expect(layout.unit).not.toBe("none")
    expect(layout.compact).toBe("none")
  }

  await load(page, "chat--qa-task-hud-integrated-light-1280", 1200, "light-modern", '[data-ui="qa-task-hud"]')
  const light = await page.locator('[data-ui="qa-task-hud"]').evaluate((item) => getComputedStyle(item).boxShadow)
  expect(light).toContain("inset")
  expect(light).not.toContain("30px")

  await load(page, "chat--qa-task-hud-integrated-contrast", 420, "hc-black", '[data-ui="qa-task-hud"]')
  const contrast = await page.locator('[data-ui="qa-task-hud"]').evaluate((item) => {
    const style = getComputedStyle(item)
    return { border: style.borderTopWidth, shadow: style.boxShadow, blur: style.backdropFilter }
  })
  expect(contrast).toEqual({ border: "1px", shadow: "none", blur: "none" })
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
