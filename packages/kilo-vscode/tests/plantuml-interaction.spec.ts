import { expect, test, type Page } from "@playwright/test"

const GLOBALS = "colorScheme:dark;theme:kilo-vscode;vscodeTheme:dark-modern"

function story(id: string) {
  return `/iframe.html?id=${id}&viewMode=story&globals=${GLOBALS}`
}

async function finish(page: Page, requestId: string) {
  await page.evaluate((id) => {
    window.dispatchEvent(
      new CustomEvent("kilo:plantuml-rendered", {
        detail: {
          type: "plantUmlRendered",
          requestId: id,
          ok: true,
          dataUrl:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
          width: 480,
          height: 280,
          issues: [],
        },
      }),
    )
  }, requestId)
}

test.describe("QA PlantUML", () => {
  test("shows rendering state immediately, replaces it with PNG, and contains syntax errors", async ({ page }) => {
    await page.addInitScript(() => {
      const target = window as Window & { plantUmlSources?: string[] }
      target.plantUmlSources = []
      window.addEventListener("kilo:render-plantuml", (event) => {
        const source = (event as CustomEvent<{ source?: string }>).detail?.source
        if (source) target.plantUmlSources?.push(source)
      })
    })
    await page.goto(story("chat--qa-plant-uml-complete"), { waitUntil: "load" })
    await expect(page.getByRole("status").first()).toContainText(/Rendering PlantUML|正在通过 ChipMate Server/)
    await expect(page.locator('[data-plantuml-state="rendered"]')).toHaveCount(2)
    await expect(page.locator('[data-plantuml-state="error"]')).toHaveCount(1)
    await expect(page.getByRole("button", { name: "Prepare repair" })).toBeVisible()
    expect(await page.evaluate(() => (window as Window & { plantUmlSources?: string[] }).plantUmlSources)).toEqual([
      "@startuml\nclass Controller\nController --> Service\n@enduml",
      "@startuml\nAlice -> Bob: 认证请求\n@enduml",
      "@startuml\nBroken ->\n@enduml",
    ])
  })

  test("renders once while streaming, preserves source, and reuses the completed cache", async ({ page }) => {
    await page.setViewportSize({ width: 420, height: 720 })
    await page.goto(story("chat--qa-plant-uml-streaming"), { waitUntil: "load" })
    const diagram = page.locator('[data-plantuml-state="rendering"]').first()
    const status = diagram.getByRole("status")
    await expect(status).toHaveText("正在通过 ChipMate Server 渲染 UML 图片…")
    await expect(diagram.locator("pre")).toBeVisible()
    await expect(diagram.locator('[data-slot="markdown-plantuml-actions"]')).toHaveCount(0)
    await expect(diagram).toHaveAttribute("data-plantuml-request-id", /\S+/)
    const request = await diagram.getAttribute("data-plantuml-request-id")
    expect(request).toBeTruthy()

    const bounds = await status.boundingBox()
    const card = await diagram.boundingBox()
    expect(bounds).not.toBeNull()
    expect(card).not.toBeNull()
    expect(bounds!.height).toBeGreaterThanOrEqual(46)
    expect(bounds!.height).toBeLessThanOrEqual(64)
    expect(bounds!.x).toBeGreaterThanOrEqual(card!.x)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(card!.x + card!.width + 1)

    await page.evaluate(() => {
      const target = window as Window & { plantUmlStreamNext?: () => void }
      target.plantUmlStreamNext?.()
      target.plantUmlStreamNext?.()
      target.plantUmlStreamNext?.()
    })
    await expect(page.locator('[data-component="text-part"]').first()).toContainText("继续生成说明。")
    await expect(diagram).toHaveAttribute("data-plantuml-request-id", request!)

    await page.evaluate(() => {
      const target = window as Window & { plantUmlStreamDuplicate?: () => void }
      target.plantUmlStreamDuplicate?.()
    })
    await expect(page.locator('[data-plantuml-state="rendering"]')).toHaveCount(2)
    expect(
      new Set(await page.locator('[data-plantuml-state="rendering"]').evaluateAll((items) =>
        items.map((item) => item.getAttribute("data-plantuml-request-id")),
      )).size,
    ).toBe(1)

    await finish(page, request!)
    await expect(page.locator('[data-plantuml-state="rendered"]')).toHaveCount(2)
    await expect(page.locator('[data-plantuml-state="rendered"] pre').first()).toBeHidden()
    await expect(page.locator('[data-slot="markdown-plantuml-actions"]').first()).toBeVisible()

    await page.evaluate(() => {
      const target = window as Window & { plantUmlStreamDuplicate?: () => void }
      target.plantUmlStreamDuplicate?.()
    })
    await expect(page.locator('[data-plantuml-state="rendered"]')).toHaveCount(3)
  })

  test("ignores an old result after complete streaming source changes", async ({ page }) => {
    await page.goto(story("chat--qa-plant-uml-streaming"), { waitUntil: "load" })
    const diagram = page.locator('[data-plantuml-state="rendering"]')
    await expect(diagram).toHaveAttribute("data-plantuml-request-id", /\S+/)
    const first = await diagram.getAttribute("data-plantuml-request-id")
    expect(first).toBeTruthy()
    await page.evaluate(() => {
      const target = window as Window & { plantUmlStreamChange?: () => void }
      target.plantUmlStreamChange?.()
    })
    await expect(page.locator('[data-plantuml-state="rendering"] pre')).toContainText("Controller --> Repository")
    await expect(diagram).not.toHaveAttribute("data-plantuml-request-id", first!)
    const second = await diagram.getAttribute("data-plantuml-request-id")
    expect(second).toBeTruthy()
    expect(second).not.toBe(first)

    await finish(page, first!)
    await expect(page.locator('[data-plantuml-state="rendering"]')).toHaveCount(1)
    await expect(page.locator('[data-plantuml-state="rendered"]')).toHaveCount(0)

    await finish(page, second!)
    await expect(page.locator('[data-plantuml-state="rendered"]')).toHaveCount(1)
  })

  test("renders when the session is idle even if the completion timestamp was missed", async ({ page }) => {
    await page.goto(story("chat--qa-plant-uml-idle-fallback"), { waitUntil: "load" })
    await expect(page.getByRole("status").first()).toContainText(/Rendering PlantUML|正在通过 ChipMate Server/)
    await expect(page.locator('[data-plantuml-state="rendered"]')).toHaveCount(2)
    await expect(page.locator('[data-plantuml-state="error"]')).toHaveCount(1)
  })

  test("announces a long server render after eight seconds", async ({ page }) => {
    test.setTimeout(20_000)
    await page.goto(story("chat--qa-plant-uml-long-wait"), { waitUntil: "load" })
    await expect(page.getByRole("status").first()).toContainText(/server is still rendering|服务器仍在渲染/, {
      timeout: 9_500,
    })
    await expect(page.locator('[data-plantuml-state="rendered"]')).toHaveCount(2, { timeout: 12_000 })
  })

  test("shows an error and keeps source after the server timeout", async ({ page }) => {
    await page.clock.install()
    await page.goto(story("chat--qa-plant-uml-timeout"), { waitUntil: "load" })
    await expect(page.locator('[data-plantuml-state="rendering"]')).toHaveCount(3)
    await page.clock.fastForward(60_000)
    await expect(page.locator('[data-plantuml-state="error"]')).toHaveCount(3)
    await expect(page.locator('[data-plantuml-state="error"] pre').first()).toBeVisible()
  })

  test("zooms, opens the viewer, toggles source, and downloads the original PNG data URL", async ({ page }) => {
    await page.goto(story("chat--qa-plant-uml-complete"), { waitUntil: "load" })
    const diagram = page.locator('[data-plantuml-state="rendered"]').first()
    await diagram.waitFor()
    const zoom = diagram.locator('[data-slot="markdown-plantuml-zoom-value"]')
    const before = await zoom.textContent()
    await diagram.getByRole("button", { name: "Zoom in" }).click()
    await expect(zoom).not.toHaveText(before ?? "")
    await diagram.getByRole("button", { name: "Show PlantUML source" }).click()
    await expect(diagram.locator("pre")).toBeVisible()

    await diagram.getByRole("button", { name: "Open diagram viewer" }).click()
    const viewer = page.getByRole("dialog")
    await expect(viewer).toBeVisible()
    await viewer.evaluate(async (el) => {
      await Promise.all(el.getAnimations().map((animation) => animation.finished))
    })
    const bounds = await viewer.boundingBox()
    const viewport = page.viewportSize()
    expect(bounds).not.toBeNull()
    expect(viewport).not.toBeNull()
    expect(bounds!.x).toBeLessThanOrEqual(5)
    expect(bounds!.y).toBeLessThanOrEqual(5)
    expect(bounds!.width).toBeGreaterThanOrEqual(viewport!.width - 10)
    expect(bounds!.height).toBeGreaterThanOrEqual(viewport!.height - 10)
    await page.keyboard.press("Escape")

    await page.evaluate(() => {
      ;(window as Window & { plantUmlSaved?: { dataUrl: string; filename: string } }).plantUmlSaved = undefined
      window.addEventListener(
        "kilo:save-image",
        (event) => {
          event.preventDefault()
          ;(window as Window & { plantUmlSaved?: { dataUrl: string; filename: string } }).plantUmlSaved = (
            event as CustomEvent<{ dataUrl: string; filename: string }>
          ).detail
        },
        { once: true },
      )
    })
    await diagram.getByRole("button", { name: "Download PNG" }).click()
    const saved = await page.evaluate(
      () => (window as Window & { plantUmlSaved?: { dataUrl: string; filename: string } }).plantUmlSaved,
    )
    expect(saved?.filename).toBe("plantuml-diagram.png")
    expect(saved?.dataUrl).toBe(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    )
  })

  test("keeps toolbar controls within a narrow QA card", async ({ page }) => {
    await page.setViewportSize({ width: 300, height: 900 })
    await page.goto(story("chat--qa-plant-uml-complete"), { waitUntil: "load" })
    const diagram = page.locator('[data-plantuml-state="rendered"]').first()
    const card = await diagram.boundingBox()
    const toolbar = await diagram.locator('[data-slot="markdown-plantuml-actions"]').boundingBox()
    expect(card).not.toBeNull()
    expect(toolbar).not.toBeNull()
    expect(toolbar!.x).toBeGreaterThanOrEqual(card!.x)
    expect(toolbar!.x + toolbar!.width).toBeLessThanOrEqual(card!.x + card!.width + 1)
  })
})
