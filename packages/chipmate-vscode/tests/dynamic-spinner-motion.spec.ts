import { expect, test } from "@playwright/test"

const story = "/iframe.html?id=labs-tool-call-lab--working-indicator-zh&viewMode=story"

test("VS Code motion setting overrides the raw operating-system preference", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto(story, { waitUntil: "load" })

  const spinner = page.locator('.working-indicator [data-component="spinner"]').first()
  await expect(spinner).toHaveAttribute("data-spinner-variant", "reduced")

  const probe = page.locator('[data-motion-probe="true"]')
  await page.evaluate(() => {
    const shell = document.createElement("div")
    shell.className = "chat-view"
    shell.dataset.ui = "qa-shell"
    const root = document.createElement("span")
    root.dataset.component = "spinner"
    root.dataset.spinnerVariant = "orbital"
    root.dataset.motionProbe = "true"
    const motion = document.createElement("span")
    motion.dataset.slot = "spinner-motion"
    const signal = document.createElement("span")
    signal.dataset.motion = "signal"
    const capsule = document.createElement("img")
    capsule.dataset.layer = "capsule"
    capsule.dataset.index = "2"
    capsule.alt = ""
    signal.append(capsule)
    motion.append(signal)
    root.append(motion)
    shell.append(root)
    document.body.append(shell)
  })
  const capsule = probe.locator('[data-layer="capsule"]')
  await expect(probe.locator('[data-slot="spinner-motion"]')).toHaveCSS("display", "none")
  await expect(capsule).toHaveCSS("animation-duration", "1e-05s")
  await expect(capsule).toHaveCSS("animation-iteration-count", "1")

  await page.evaluate(() => document.body.setAttribute("data-vscode-theme-id", "Default Dark Modern"))
  await expect(spinner).not.toHaveAttribute("data-spinner-variant", "reduced")
  await expect(probe.locator('[data-slot="spinner-motion"]')).toHaveCSS("display", "grid")
  await expect(capsule).toHaveCSS("animation-duration", "1.2s")
  await expect(capsule).toHaveCSS("animation-iteration-count", "infinite")
  const firstTransform = await capsule.evaluate((element) => getComputedStyle(element).transform)
  await page.waitForTimeout(120)
  const secondTransform = await capsule.evaluate((element) => getComputedStyle(element).transform)
  expect(secondTransform).not.toBe(firstTransform)

  await page.evaluate(() => document.body.classList.add("vscode-reduce-motion"))
  await expect(spinner).toHaveAttribute("data-spinner-variant", "reduced")
  await expect(probe.locator('[data-slot="spinner-motion"]')).toHaveCSS("display", "none")
  await expect(capsule).toHaveCSS("animation-duration", "1e-05s")
  await expect(capsule).toHaveCSS("animation-iteration-count", "1")

  await page.evaluate(() => document.body.classList.remove("vscode-reduce-motion"))
  await expect(spinner).not.toHaveAttribute("data-spinner-variant", "reduced")
  await expect(probe.locator('[data-slot="spinner-motion"]')).toHaveCSS("display", "grid")
  await expect(capsule).toHaveCSS("animation-duration", "1.2s")
  await expect(capsule).toHaveCSS("animation-iteration-count", "infinite")
})

test("伸缩记录栏遵循 VS Code 动效设置", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/iframe.html?id=chat-按需修改记录--running&viewMode=story")
  const drawer = page.locator('[data-slot="turn-changes-drawer"]')
  await expect(drawer).toHaveCSS("transition-duration", "1e-05s")
  await page.evaluate(() => document.body.setAttribute("data-vscode-theme-id", "Default Dark Modern"))
  await expect(drawer).toHaveCSS("transition-duration", "0.15s, 0.15s")
  await page.evaluate(() => document.body.classList.add("vscode-reduce-motion"))
  await expect(drawer).toHaveCSS("transition-duration", "1e-05s")
})
