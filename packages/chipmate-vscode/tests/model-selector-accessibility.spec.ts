import { expect, test, type Page } from "@playwright/test"

const GLOBALS = "colorScheme:dark;theme:chipmate-vscode;vscodeTheme:dark-modern"

function story(id: string, theme = "dark-modern") {
  const scheme = theme === "light-modern" || theme === "hc-light" ? "light" : "dark"
  const globals = theme === "dark-modern" ? GLOBALS : `colorScheme:${scheme};theme:chipmate-vscode;vscodeTheme:${theme}`
  return `/iframe.html?id=${id}&viewMode=story&globals=${globals}`
}

async function load(page: Page, id: string, theme?: string) {
  await page.goto(story(id, theme), { waitUntil: "load" })
  await page.waitForSelector("#storybook-root *", { state: "attached" })
}

test("model selector exposes combobox relationships and active option movement", async ({ page }) => {
  await load(page, "shared--model-selector-accessible")

  await page.getByRole("button", { name: "Review model: Alpha" }).click()
  const combobox = page.getByRole("combobox", { name: "Review model: Alpha. Search models" })
  const tree = page.getByRole("tree", { name: "Review model" })
  const alpha = page.getByRole("treeitem", { name: "Alpha" })
  const bravo = page.getByRole("treeitem", { name: "Bravo" })

  await expect(combobox).toBeFocused()
  await expect(combobox).toHaveAttribute("aria-expanded", "true")
  await expect(combobox).toHaveAttribute("aria-haspopup", "tree")
  await expect(combobox).toHaveAttribute("aria-controls", await tree.getAttribute("id"))
  await expect(combobox).toHaveAttribute("aria-activedescendant", await alpha.getAttribute("id"))
  await expect(combobox).toHaveAccessibleDescription("Choose the model used for code review tasks.")
  await expect(alpha.locator("button")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Add to favorites: Alpha" })).toBeVisible()
  await expect(page.locator(".model-selector-group-label").nth(0)).toContainText("Auto Models")
  await expect(page.locator(".model-selector-group-label").nth(1)).toContainText("Recommended")
  const auto = page.getByRole("treeitem", { name: /ChipMate Auto Efficient/ })
  await expect(auto).toBeVisible()
  await expect(auto.locator(".model-selector-auto-icon")).toHaveAttribute(
    "aria-label",
    "Routes each request to the cheapest model that gets the job done, based on continuously benchmarked accuracy and cost.",
  )
  await expect(page.getByRole("treeitem", { name: "Omega" })).toBeVisible()

  await combobox.press("ArrowDown")
  await expect(combobox).toBeFocused()
  await expect(combobox).toHaveAttribute("aria-activedescendant", await bravo.getAttribute("id"))

  const collapse = page.getByRole("button", { name: "Collapse", exact: true })
  const controls = await collapse.getAttribute("aria-controls")
  const preview = page.locator(`[id="${controls}"]`)
  await expect(collapse).toHaveAttribute("aria-expanded", "true")
  await expect(preview).toHaveAttribute("aria-hidden", "false")
  await expect(preview.getByRole("button", { name: "Add to favorites" })).toBeVisible()
  const listBeforePreview = await tree.evaluate((el, id) => {
    const node = document.getElementById(id!)
    return !!node && !!(el.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)
  }, controls)
  const treeBox = await tree.boundingBox()
  const previewBox = await preview.boundingBox()
  expect(listBeforePreview).toBe(true)
  expect(previewBox!.y).toBeLessThan(treeBox!.y)
  await collapse.click()
  const expand = page.getByRole("button", { name: "Expand" })
  await expect(expand).toHaveAttribute("aria-controls", controls!)
  await expect(expand).toHaveAttribute("aria-expanded", "false")
  await expect(preview).toHaveAttribute("aria-hidden", "true")
  await expect(preview.locator("button, a, [tabindex]")).toHaveCount(0)
})

test("prompt selector stays compact and guides first-time custom provider setup", async ({ page }) => {
  await load(page, "shared--model-selector-custom-provider-setup")

  await page.getByRole("button", { name: /Select model/ }).click()
  const body = page.locator(".model-selector-body")
  const preview = page.locator(".model-selector-preview")

  await expect(page.locator(".model-selector-setup")).toContainText("Add a custom provider by base URL.")
  await expect(page.getByRole("button", { name: "Manage models" })).toBeVisible()
  await expect(page.locator(".model-selector-splitter")).toHaveCount(0)
  await expect(page.locator(".model-preview")).toHaveCount(0)
  await expect(preview).toHaveAttribute("aria-hidden", "true")
  await expect.poll(async () => (await preview.boundingBox())?.height).toBe(0)
  await expect.poll(async () => (await body.boundingBox())?.height).toBeLessThanOrEqual(300)
  await expect(page.getByRole("button", { name: /^(Expand|Collapse)$/ })).toHaveCount(0)

  const gateway = page.getByRole("treeitem", { name: "ChipMate", exact: true })
  await expect(page.getByRole("treeitem", { name: "Auto Models" })).toHaveAttribute("aria-expanded", "false")
  await expect(page.getByRole("treeitem", { name: "Recommended" })).toHaveAttribute("aria-expanded", "false")
  await expect(gateway).toHaveAttribute("aria-expanded", "false")
  await expect(page.getByRole("treeitem", { name: "NVIDIA" })).toHaveAttribute("aria-expanded", "false")
  await expect(page.getByRole("treeitem", { name: "Internal Lab" })).toHaveAttribute("aria-expanded", "false")

  await gateway.click()
  await expect(gateway).toHaveAttribute("aria-expanded", "true")
  await expect(page.getByRole("treeitem", { name: "Alpha" })).toBeVisible()
})

test("prompt selector opens provider setup when the offline model catalog is empty", async ({ page }) => {
  await load(page, "shared--model-selector-custom-provider-empty-catalog")

  const trigger = page.getByRole("button", { name: "Select model: No providers" })
  await expect(trigger).toBeEnabled()
  await trigger.click()

  await expect(page.locator(".model-selector-setup")).toContainText("Add a custom provider by base URL.")
  await expect(page.getByRole("button", { name: "Manage models" })).toBeVisible()
  await expect(page.locator(".model-selector-splitter, .model-preview")).toHaveCount(0)
})

test("prompt selector initially expands only configured custom providers", async ({ page }) => {
  await load(page, "shared--model-selector-custom-provider-groups")

  await page.getByRole("button", { name: /Intranet Chat/ }).click()

  await expect(page.getByRole("treeitem", { name: "Favorites" })).toHaveAttribute("aria-expanded", "false")
  await expect(page.getByRole("treeitem", { name: "Auto Models" })).toHaveAttribute("aria-expanded", "false")
  await expect(page.getByRole("treeitem", { name: "Recommended" })).toHaveAttribute("aria-expanded", "false")
  await expect(page.getByRole("treeitem", { name: "ChipMate", exact: true })).toHaveAttribute("aria-expanded", "false")
  await expect(page.getByRole("treeitem", { name: "NVIDIA" })).toHaveAttribute("aria-expanded", "false")
  await expect(page.getByRole("treeitem", { name: "Internal Lab" })).toHaveAttribute("aria-expanded", "true")
  await expect(page.getByRole("treeitem", { name: "Intranet Chat" })).toBeVisible()

  const gateway = page.getByRole("treeitem", { name: "ChipMate", exact: true })
  await gateway.click()
  await expect(gateway).toHaveAttribute("aria-expanded", "true")
  await expect(page.getByRole("treeitem", { name: "Alpha" })).toBeVisible()
})

test("auto efficient details show server description and model choices", async ({ page }) => {
  await load(page, "shared--model-selector-accessible")

  await page.getByRole("button", { name: "Review model: Alpha" }).click()
  await page.getByRole("treeitem", { name: /ChipMate Auto Efficient/ }).click()

  const preview = page.locator(".model-selector-preview")
  await expect(preview).toContainText(
    "Routes each request to the cheapest model that gets the job done, based on continuously benchmarked accuracy and cost.",
  )
  await expect(preview).toContainText("Model choices")
  await expect(preview).toContainText("google/gemini-2.5-flash")
  await expect(preview).toContainText("anthropic/claude-sonnet-4.6")
  await expect(preview).not.toContainText("openai/gpt-5.5")
})

test("typing a provider initial moves the active descendant to matching results", async ({ page }) => {
  await load(page, "shared--model-selector-accessible")

  await page.getByRole("button", { name: "Review model: Alpha" }).click()
  const combobox = page.getByRole("combobox", { name: "Review model: Alpha. Search models" })
  await combobox.fill("N")

  const nova = page.getByRole("treeitem", { name: "Nova" })
  await expect(nova).toBeVisible()
  await expect(combobox).toHaveAttribute("aria-activedescendant", await nova.getAttribute("id"))
  await expect(page.getByRole("treeitem", { name: "NVIDIA" })).toHaveAttribute("aria-expanded", "true")
})

test("provider groups collapse, expand, and skip their model rows", async ({ page }) => {
  await load(page, "shared--model-selector-accessible")

  await page.getByRole("button", { name: "Review model: Alpha" }).click()
  const combobox = page.getByRole("combobox", { name: "Review model: Alpha. Search models" })
  const chipmate = page.getByRole("treeitem", { name: "ChipMate", exact: true })
  const nvidia = page.getByRole("treeitem", { name: "NVIDIA" })

  await combobox.press("ArrowDown")
  await combobox.press("ArrowLeft")
  await expect(combobox).toHaveAttribute("aria-activedescendant", await chipmate.getAttribute("id"))
  await combobox.press("ArrowLeft")
  await expect(chipmate).toHaveAttribute("aria-expanded", "false")
  await expect(page.getByRole("treeitem", { name: "Bravo" })).toBeHidden()

  await combobox.press("ArrowDown")
  await expect(combobox).toHaveAttribute("aria-activedescendant", await nvidia.getAttribute("id"))
  await combobox.press("ArrowLeft")
  await expect(nvidia).toHaveAttribute("aria-expanded", "false")
  await combobox.press("ArrowRight")
  await expect(nvidia).toHaveAttribute("aria-expanded", "true")
  await combobox.press("ArrowRight")
  await expect(combobox).toHaveAttribute(
    "aria-activedescendant",
    await page.getByRole("treeitem", { name: "Nemotron" }).getAttribute("id"),
  )
})

test("active descendant always identifies a visible tree item", async ({ page }) => {
  await load(page, "shared--model-selector-accessible")

  await page.getByRole("button", { name: "Review model: Alpha" }).click()
  const combobox = page.getByRole("combobox", { name: "Review model: Alpha. Search models" })
  const active = async () => {
    await expect.poll(() => combobox.getAttribute("aria-activedescendant")).toBeTruthy()
    const id = await combobox.getAttribute("aria-activedescendant")
    await expect(page.locator(`[id="${id}"]`)).toBeVisible()
  }

  await active()
  await combobox.press("ArrowDown")
  await active()
  await combobox.press("ArrowLeft")
  await active()
  await combobox.press("ArrowRight")
  await active()
  await combobox.fill("N")
  await active()
  await combobox.press("ArrowLeft")
  await combobox.press("ArrowDown")
  await combobox.press("ArrowLeft")
  await active()
  await combobox.fill("no matching model")
  await active()
})

test("expanded preview waits for explicit pointer selection", async ({ page }) => {
  await load(page, "shared--model-selector-accessible")

  await page.getByRole("button", { name: "Review model: Alpha" }).click()
  await expect(page.locator(".model-selector-preview")).toContainText("Alpha")
  await page.getByRole("treeitem", { name: "Bravo" }).hover()
  await page.waitForTimeout(250)
  await expect(page.locator(".model-selector-preview")).toContainText("Alpha")
  await page.getByRole("treeitem", { name: "Bravo" }).click()

  await expect(page.getByTestId("model-selector-value")).toHaveText("alpha")
  await expect(page.getByRole("combobox", { name: "Review model: Alpha. Search models" })).toBeVisible()
  await expect(page.locator(".model-selector-preview")).toContainText("Bravo")

  await page.getByRole("button", { name: "Select: Bravo" }).click()
  await expect(page.getByTestId("model-selector-value")).toHaveText("bravo")
})

test("selected favorite remains selected when its duplicate group is collapsed", async ({ page }) => {
  await load(page, "shared--model-selector-selected-favorite")

  await page.getByRole("button", { name: "Review model: Alpha" }).click()
  const combobox = page.getByRole("combobox", { name: "Review model: Alpha. Search models" })
  const alpha = page.getByRole("treeitem", { name: "Alpha" })
  const favorites = page.getByRole("treeitem", { name: "Favorites" })
  await expect(alpha.first()).toHaveAttribute("aria-selected", "true")
  await expect.poll(() => favorites.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("solid")

  await favorites.click()
  await expect(alpha).toHaveCount(1)
  await expect(alpha).toHaveAttribute("aria-selected", "true")
  await expect(combobox).toHaveAttribute("aria-activedescendant", await favorites.getAttribute("id"))
})

test("large catalogs keep the rendered tree bounded and navigate to distant models", async ({ page }) => {
  await load(page, "shared--model-selector-large-catalog")

  await page.getByRole("button", { name: "Select model: Provider 0 / Model 300" }).click()
  const combobox = page.getByRole("combobox", { name: "Select model: Provider 0 / Model 300. Search models" })
  const tree = page.getByRole("tree", { name: "Select model" })

  // The window mounts before we measure it, yet stays far smaller than the catalog.
  await expect.poll(() => tree.getByRole("treeitem").count()).toBeGreaterThan(0)
  await expect.poll(() => tree.getByRole("treeitem").count()).toBeLessThan(50)

  // Reaching a distant model scrolls it into the mounted window and activates it.
  await combobox.fill("Model 599")
  const last = page.getByRole("treeitem", { name: "Model 599" })
  await expect(last).toBeVisible()
  await expect(combobox).toHaveAttribute("aria-activedescendant", await last.getAttribute("id"))
})

test("Enter selects the active option and Escape restores selector focus", async ({ page }) => {
  await load(page, "shared--model-selector-accessible")

  await page.getByRole("button", { name: "Review model: Alpha" }).click()
  const combobox = page.getByRole("combobox", { name: "Review model: Alpha. Search models" })
  await combobox.press("ArrowDown")
  await combobox.press("Enter")

  const trigger = page.getByRole("button", { name: "Review model: Bravo" })
  await expect(page.getByTestId("model-selector-value")).toHaveText("bravo")
  await expect(trigger).toBeFocused()

  await trigger.click()
  const reopened = page.getByRole("combobox", { name: "Review model: Bravo. Search models" })
  await reopened.press("ArrowDown")
  await reopened.press("Escape")

  await expect(page.getByTestId("model-selector-value")).toHaveText("bravo")
  await expect(trigger).toBeFocused()
})

test("no-match search announces the empty result and can choose the default option", async ({ page }) => {
  await load(page, "shared--model-selector-accessible")

  await page.getByRole("button", { name: "Review model: Alpha" }).click()
  const combobox = page.getByRole("combobox", { name: "Review model: Alpha. Search models" })
  await combobox.fill("no matching model")

  await expect(page.locator(".model-selector-empty")).toHaveText("No model results")
  const clear = page.getByRole("treeitem", { name: "Use default model" })
  await expect(combobox).toHaveAttribute("aria-activedescendant", await clear.getAttribute("id"))
  await combobox.press("Enter")

  await expect(page.getByTestId("model-selector-value")).toHaveText("default")
  await expect(page.getByRole("button", { name: "Review model: Use default model" })).toBeFocused()
})

test("settings and mode editing expose distinct model field purposes", async ({ page }) => {
  await load(page, "settings--models-accessible-labels")

  await expect(page.getByRole("button", { name: "Default Model: Not set" })).toHaveAccessibleDescription(
    "Primary model for conversations",
  )
  await expect(page.getByRole("button", { name: "Small Model: Not set" })).toHaveAccessibleDescription(
    /Lightweight model/,
  )
  await expect(page.getByRole("button", { name: "Subagent Model: Not set" })).toHaveAccessibleDescription(
    /Default model and reasoning effort/,
  )
  await expect(page.getByRole("button", { name: "Autocomplete model: Not set" })).toHaveAccessibleDescription(
    "Select the model used for inline code completions",
  )
  await expect(page.getByRole("button", { name: "Model per Mode: code: Not set" })).toHaveAccessibleDescription(
    /Override the default model for specific modes/,
  )

  await load(page, "settings--models-speech-to-text")
  const speech = page.getByRole("button", { name: "Speech to Text Model: Chirp 3" })
  await expect(speech).toBeEnabled()
  await speech.click()
  await page.getByRole("option", { name: "Parakeet TDT 0.6B v3 (NVIDIA)" }).click()
  await expect(page.getByRole("button", { name: "Speech to Text Model: Parakeet TDT 0.6B v3" })).toBeVisible()

  await load(page, "settings--mode-edit-export")
  await expect(page.getByRole("button", { name: /Model Override:/ })).toHaveAccessibleDescription(
    "Override the default model for this agent",
  )
})

test("mode picker focuses the selected mode as it opens", async ({ page }) => {
  await load(page, "prompt-input--default-420")

  await page.getByRole("button", { name: "Code", exact: true }).click()
  await expect(page.locator(".mode-switcher-item.selected")).toBeFocused()
})

test("Ultra selection is blocked by a non-dismissible confirmation until accepted", async ({ page }) => {
  await load(page, "prompt-input--default-420")

  const trigger = page.locator(".prompt-selector-trigger--mode")
  const count = page.locator('[data-ui="qa-agent-select-count"]')
  const prompt = page.locator("textarea.prompt-input")
  await trigger.click()
  await page.locator('.mode-switcher-item[data-agent="ultra"]').click()

  const dialog = page.getByRole("alertdialog", { name: "Enter Ultra mode" })
  const confirm = page.getByRole("button", { name: "Confirm and enter Ultra" })
  await expect(dialog).toBeVisible()
  await expect(trigger).toHaveAttribute("data-agent", "code")
  await expect(count).toHaveText("0")
  await expect(confirm).toBeFocused()

  await page.keyboard.press("Escape")
  await expect(dialog).toBeVisible()
  await page.locator(".ultra-mode-dialog-overlay").click({ position: { x: 2, y: 2 }, force: true })
  await expect(dialog).toBeVisible()
  await page.keyboard.press("Tab")
  await expect(confirm).toBeFocused()
  await page.keyboard.press("Shift+Tab")
  await expect(confirm).toBeFocused()

  await confirm.click()
  await expect(dialog).toBeHidden()
  await expect(trigger).toHaveAttribute("data-agent", "ultra")
  await expect(count).toHaveText("1")
  await expect(prompt).toBeFocused()

  await trigger.click()
  await page.locator('.mode-switcher-item[data-agent="ultra"]').click()
  await expect(dialog).toBeHidden()
  await expect(count).toHaveText("2")

  await trigger.click()
  await page.locator('.mode-switcher-item[data-agent="code"]').click()
  await expect(dialog).toBeHidden()
  await expect(trigger).toHaveAttribute("data-agent", "code")
  await expect(count).toHaveText("3")

  await trigger.click()
  await page.locator('.mode-switcher-item[data-agent="ultra"]').click()
  await expect(dialog).toBeVisible()
  await expect(count).toHaveText("3")
  await confirm.click()
  await expect(trigger).toHaveAttribute("data-agent", "ultra")
  await expect(count).toHaveText("4")
})

test("Ultra confirmation covers keyboard, slash, native identity, session changes, and narrow layouts", async ({
  page,
}) => {
  await load(page, "prompt-input--default-420")
  const trigger = page.locator(".prompt-selector-trigger--mode")
  await trigger.click()
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Enter")
  await expect(page.getByRole("alertdialog", { name: "Enter Ultra mode" })).toBeVisible()
  await page.getByRole("button", { name: "Confirm and enter Ultra" }).click()

  await trigger.click()
  await page.locator('.mode-switcher-item[data-agent="code"]').click()
  const prompt = page.locator("textarea.prompt-input")
  await prompt.evaluate((el) => el.setAttribute("aria-disabled", "false"))
  await prompt.fill("/agents")
  await prompt.press("Enter")
  await page.locator('.mode-switcher-item[data-agent="ultra"]').click()
  await expect(page.getByRole("alertdialog", { name: "Enter Ultra mode" })).toBeVisible()
  await page.getByRole("button", { name: "Confirm and enter Ultra" }).click()

  await load(page, "prompt-input--custom-ultra-420")
  await page.locator(".prompt-selector-trigger--mode").click()
  await page.locator('.mode-switcher-item[data-agent="ultra"]').click()
  await expect(page.getByRole("alertdialog")).toHaveCount(0)
  await expect(page.locator(".prompt-selector-trigger--mode")).toHaveAttribute("data-agent", "ultra")

  await load(page, "prompt-input--ultra-session-switch-420")
  await page.locator(".prompt-selector-trigger--mode").click()
  await page.locator('.mode-switcher-item[data-agent="ultra"]').click()
  await expect(page.getByRole("alertdialog", { name: "Enter Ultra mode" })).toBeVisible()
  await page.locator('[data-ui="qa-switch-session"]').evaluate((element: HTMLButtonElement) => element.click())
  await expect(page.getByRole("alertdialog")).toHaveCount(0)
  await expect(page.locator('[data-ui="qa-agent-select-count"]')).toHaveText("0")

  await page.setViewportSize({ width: 200, height: 720 })
  await load(page, "prompt-input--ultra-confirmation-200")
  const dialog = page.getByRole("alertdialog", { name: "进入 Ultra 模式" })
  const flow = page.getByRole("img", {
    name: /Code 生成并冻结完整答案.*三个互相隔离的 Explore 会话并行验证.*独立 Ask 会话/,
  })
  await expect(flow).toBeVisible()
  await expect(flow).toContainText("用户问题")
  await expect(flow).toContainText("冻结 Code 答案")
  await expect(flow.locator('[data-node="explore"]')).toHaveCount(3)
  await expect(flow.locator('[data-stage="verification"] [data-node="explore"]')).toHaveCount(3)
  await expect(flow).toContainText("独立验证")
  await expect(flow).toContainText("独立 Ask 综合会话")
  await expect(flow).toContainText("综合三份独立验证")
  await expect(flow).not.toContainText("调用链验证")
  await expect(flow).not.toContainText("对抗式验证")
  await expect(flow).not.toContainText("源码与覆盖验证")
  await expect(page.getByRole("button", { name: "确认并进入 Ultra" })).toBeVisible()
  const box = await dialog.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(200)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(720)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(200)
})

test("Document selection explains the default boundary before entering the native mode", async ({ page }) => {
  await load(page, "prompt-input--document-selection-420")

  const trigger = page.locator(".prompt-selector-trigger--mode")
  const count = page.locator('[data-ui="qa-agent-select-count"]')
  const prompt = page.locator("textarea.prompt-input")
  await trigger.click()
  await page.locator('.mode-switcher-item[data-agent="document"]').click()

  const dialog = page.getByRole("alertdialog", { name: "Enter Document mode" })
  const confirm = page.getByRole("button", { name: "Confirm and enter Document" })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText("Document RAG")
  await expect(dialog).toContainText("Documents only")
  await expect(dialog).toContainText("Documents + code")
  await expect(dialog).toContainText("explicit request")
  await expect(trigger).toHaveAttribute("data-agent", "code")
  await expect(count).toHaveText("0")
  await expect(confirm).toBeFocused()

  await page.keyboard.press("Escape")
  await expect(dialog).toBeVisible()
  await confirm.click()

  await expect(dialog).toBeHidden()
  await expect(trigger).toHaveAttribute("data-agent", "document")
  await expect(count).toHaveText("1")
  await expect(page.locator('.document-agent-scope-button[data-scope="documents"]')).toContainText("Documents only")
  await expect(prompt).toBeFocused()
})

test("Document confirmation keeps both scope states readable in a 200px sidebar", async ({ page }) => {
  await page.setViewportSize({ width: 200, height: 720 })
  await load(page, "prompt-input--document-confirmation-200")

  const dialog = page.getByRole("alertdialog", { name: "进入 Document 模式" })
  const flow = page.getByRole("img", {
    name: /默认仅文档.*明确要求查询代码后.*文档加代码.*只读代码探索/,
  })
  await expect(flow).toBeVisible()
  await expect(flow.locator('[data-state="documents"]')).toContainText("仅文档")
  await expect(flow.locator('[data-state="documents_and_code"]')).toContainText("文档 + 代码")
  await expect(dialog).toContainText("未收到明确要求，不会搜索代码库。")
  await expect(page.getByRole("button", { name: "确认并进入 Document" })).toBeVisible()

  const box = await dialog.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(200)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(720)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(200)
})

test("ChipMate DeepSeek Harness selection explains the native boundary before starting DSH", async ({ page }) => {
  await load(page, "prompt-input--deep-seek-harness-selection-420")

  const trigger = page.locator(".prompt-selector-trigger--mode")
  const activations = page.locator('[data-ui="qa-dsh-activation-count"]')
  await trigger.click()
  await page.locator('.mode-switcher-item[data-agent="deepseek-harness"]').click()

  const dialog = page.getByRole("alertdialog", { name: "Start ChipMate DeepSeek Harness" })
  const confirm = page.getByRole("button", { name: "Confirm and start ChipMate DeepSeek Harness" })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText("QA is only the interface")
  await expect(dialog).toContainText("Official DSH 0.1.0-rc.6")
  await expect(dialog).toContainText("Neither uses ChipMate prompts")
  await expect(dialog).toContainText("private persistent DSH_HOME")
  await expect(trigger).toHaveAttribute("data-agent", "code")
  await expect(activations).toHaveText("0")
  await expect(confirm).toBeFocused()

  await page.keyboard.press("Escape")
  await expect(dialog).toBeVisible()
  await confirm.click()
  await expect(dialog).toBeHidden()
  await expect(trigger).toHaveAttribute("data-agent", "deepseek-harness")
  await expect(activations).toHaveText("1")

  await trigger.click()
  await page.locator('.mode-switcher-item[data-agent="deepseek-harness"]').click()
  await expect(page.getByRole("alertdialog")).toHaveCount(0)
  await expect(activations).toHaveText("1")

  await trigger.click()
  await page.locator('.mode-switcher-item[data-agent="code"]').click()
  await expect(trigger).toHaveAttribute("data-agent", "code")
  await trigger.click()
  await page.locator('.mode-switcher-item[data-agent="deepseek-harness"]').click()
  await expect(dialog).toBeVisible()
  await expect(activations).toHaveText("1")
})

test("ChipMate DeepSeek Harness guarded selection covers cycle requests and session changes", async ({ page }) => {
  await load(page, "prompt-input--deep-seek-harness-session-switch-420")
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("chipmate:request-agent-selection", { detail: { name: "deepseek-harness" } })),
  )
  await expect(page.getByRole("alertdialog", { name: "Start ChipMate DeepSeek Harness" })).toBeVisible()
  await expect(page.locator('[data-ui="qa-dsh-activation-count"]')).toHaveText("0")

  await page.locator('[data-ui="qa-switch-session"]').evaluate((element: HTMLButtonElement) => element.click())
  await expect(page.getByRole("alertdialog")).toHaveCount(0)
  await expect(page.locator('[data-ui="qa-dsh-activation-count"]')).toHaveText("0")
})

test("ChipMate DeepSeek Harness confirmation survives pending QA session materialization", async ({ page }) => {
  await load(page, "prompt-input--deep-seek-harness-pending-session-420")
  const trigger = page.locator(".prompt-selector-trigger--mode")
  const activations = page.locator('[data-ui="qa-dsh-activation-count"]')

  await trigger.click()
  await page.locator('.mode-switcher-item[data-agent="deepseek-harness"]').click()
  await expect(page.getByRole("alertdialog", { name: "Start ChipMate DeepSeek Harness" })).toBeVisible()
  await page.locator('[data-ui="qa-materialize-session"]').evaluate((element: HTMLButtonElement) => element.click())
  await page.getByRole("button", { name: "Confirm and start ChipMate DeepSeek Harness" }).click()

  await expect(page.getByRole("alertdialog")).toHaveCount(0)
  await expect(trigger).toHaveAttribute("data-agent", "deepseek-harness")
  await expect(activations).toHaveText("1")
})

test("ChipMate DeepSeek Harness architecture remains readable in a 200px sidebar", async ({ page }) => {
  await page.setViewportSize({ width: 200, height: 720 })
  await load(page, "prompt-input--deep-seek-harness-confirmation-200")

  const dialog = page.getByRole("alertdialog", { name: "启动 ChipMate DeepSeek Harness" })
  const flow = page.getByRole("img", { name: /QA 输入与展示.*官方协议转发.*官方 DSH.*会话、工具、审批和子 Agent/ })
  await expect(flow).toBeVisible()
  await expect(flow).toContainText("QA 输入与展示")
  await expect(flow).toContainText("官方协议转发")
  await expect(flow).toContainText("官方 DSH 0.1.0-rc.6")
  await expect(flow).toContainText("会话 · 工具 · 审批 · 子 Agent")
  await expect(dialog).toContainText("不进入 ChipMate 的 Prompt")
  await expect(dialog).toContainText("确认后才启动")
  await expect(page.getByRole("button", { name: "确认并启动 ChipMate DeepSeek Harness" })).toBeVisible()

  const box = await dialog.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(200)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(720)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(200)
})

test("Document code scope stays explicit without truncating its boundary", async ({ page }) => {
  await load(page, "prompt-input--document-code-scope-zh")

  const scope = page.getByRole("button", { name: "文档 + 代码", exact: true })
  await expect(scope).toBeVisible()
  await expect(scope).toHaveAttribute("aria-pressed", "true")
  await expect(scope.locator("span").last()).toHaveText("文档 + 代码")
  await expect
    .poll(() =>
      scope
        .locator("span")
        .last()
        .evaluate((label) => label.scrollWidth <= label.clientWidth),
    )
    .toBe(true)
})

test("Ultra uses its sparkle icon and theme-aware semantic color without affecting other modes", async ({ page }) => {
  const select = async () => {
    await page.locator(".prompt-selector-trigger--mode").click()
    const row = page.locator('.mode-switcher-item[data-agent="ultra"]')
    await expect(row).toHaveAttribute("aria-selected", "false")
    await row.click()
    await expect(page.getByRole("alertdialog", { name: "Enter Ultra mode" })).toBeVisible()
    await page.getByRole("button", { name: "Confirm and enter Ultra" }).click()
    return page.locator('.prompt-selector-trigger--mode[data-agent="ultra"]')
  }

  const verify = async (theme: string, color: string) => {
    await load(page, "prompt-input--default-420", theme)
    const trigger = await select()
    const icon = trigger.locator(".prompt-selector-icon")
    const label = trigger.locator(".mode-switcher-trigger-label")

    await expect(trigger.locator(".codicon-sparkle")).toBeVisible()
    await expect(trigger.locator(".codicon-comment-discussion")).toHaveCount(0)
    await expect(icon).toHaveCSS("color", color)
    await expect(label).toHaveCSS("color", color)
    await expect(trigger.locator(".prompt-selector-chevron")).not.toHaveCSS("color", color)

    await trigger.click()
    const ultra = page.locator('.mode-switcher-item[data-agent="ultra"]')
    await expect(ultra).toHaveAttribute("aria-selected", "true")
    await expect(ultra.locator(".mode-switcher-item-name")).toHaveCSS("color", color)
    await expect(page.locator('.mode-switcher-item[data-agent="code"] .mode-switcher-item-name')).not.toHaveCSS(
      "color",
      color,
    )
    await expect(page.locator('.mode-switcher-item[data-agent="ask"] .mode-switcher-item-name')).not.toHaveCSS(
      "color",
      color,
    )
    await expect(ultra.locator(".mode-switcher-item-desc")).not.toHaveCSS("color", color)
  }

  await verify("dark-modern", "rgb(167, 139, 250)")
  await verify("light-modern", "rgb(109, 40, 217)")

  for (const theme of ["hc-black", "hc-light"]) {
    await load(page, "prompt-input--default-420", theme)
    const trigger = await select()
    const label = trigger.locator(".mode-switcher-trigger-label")
    const foreground = await page.locator("body").evaluate((el) => getComputedStyle(el).color)
    await expect(label).toHaveCSS("color", foreground)
    await expect(label).not.toHaveCSS("color", "rgb(167, 139, 250)")
    await expect(label).not.toHaveCSS("color", "rgb(109, 40, 217)")
  }

  await load(page, "prompt-input--default-420")
  await page.locator(".prompt-selector-trigger--mode").click()
  await expect(page.locator('.mode-switcher-item[data-agent="code"]')).toBeFocused()
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("ArrowDown")
  await expect(page.locator('.mode-switcher-item[data-agent="ultra"]')).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("alertdialog", { name: "Enter Ultra mode" })).toBeVisible()
  await page.getByRole("button", { name: "Confirm and enter Ultra" }).click()
  await expect(page.locator('.prompt-selector-trigger--mode[data-agent="ultra"]')).toBeVisible()

  const prompt = page.locator("textarea.prompt-input")
  await prompt.evaluate((el) => el.setAttribute("aria-disabled", "false"))
  await prompt.fill("/agents")
  await prompt.press("Enter")
  const selected = page.locator('.mode-switcher-item[data-agent="ultra"]')
  await expect(selected).toBeFocused()
  await selected.press("Escape")
  await expect(prompt).toBeFocused()

  await page.setViewportSize({ width: 200, height: 720 })
  await load(page, "prompt-input--default-200")
  const trigger = await select()
  await expect(trigger.locator(".codicon-sparkle")).toBeHidden()
  await expect(trigger.locator(".mode-switcher-trigger-label")).toBeVisible()
  await expect(trigger.locator(".prompt-selector-chevron")).toBeHidden()
  const box = await trigger.boundingBox()
  const label = await trigger.locator(".mode-switcher-trigger-label").boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(200)
  expect(label!.x).toBeGreaterThanOrEqual(box!.x)
  expect(label!.x + label!.width).toBeLessThanOrEqual(box!.x + box!.width)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(200)
})

test("variant picker focuses the selected effort as it opens", async ({ page }) => {
  await load(page, "prompt-input--with-thinking-420")

  await page.getByRole("button", { name: "Reasoning effort: Medium" }).click()
  await expect(page.locator(".thinking-selector-item.selected")).toBeFocused()
})

test("Qwen3.8 thinking selector defaults to XHigh and keeps the disabled choice per session", async ({ page }) => {
  await page.setViewportSize({ width: 200, height: 600 })
  await load(page, "prompt-input--qwen-38-thinking-zh")

  const xhigh = page.getByRole("button", { name: "推理强度：XHigh" })
  await expect(xhigh).toBeVisible()
  await xhigh.click()

  const list = page.getByRole("listbox")
  await expect(page.getByRole("option")).toHaveText(["XHigh", "Medium", "Low", "关闭"])
  const box = await list.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(200)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(200)

  await page.keyboard.press("End")
  await expect(page.getByRole("option", { name: "关闭" })).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(page.getByRole("button", { name: "推理强度：关闭" })).toBeVisible()

  await page.locator('[data-ui="qa-switch-session"]').evaluate((button: HTMLButtonElement) => button.click())
  await expect(page.getByRole("button", { name: "推理强度：XHigh" })).toBeVisible()
  await page.locator('[data-ui="qa-switch-session"]').evaluate((button: HTMLButtonElement) => button.click())
  await expect(page.getByRole("button", { name: "推理强度：关闭" })).toBeVisible()

  await load(page, "prompt-input--qwen-38-thinking-zh", "light-modern")
  await page.getByRole("button", { name: "推理强度：XHigh" }).click()
  await expect(page.getByRole("option", { name: "XHigh" })).toBeFocused()
})

test("slash mode picker Escape returns focus to the prompt", async ({ page }) => {
  await load(page, "prompt-input--default-420")

  const prompt = page.locator("textarea.prompt-input")
  await prompt.evaluate((el) => el.setAttribute("aria-disabled", "false"))
  await prompt.fill("/agents")
  await prompt.press("Enter")

  const selected = page.locator(".mode-switcher-item.selected")
  await expect(selected).toBeFocused()
  await selected.press("Escape")

  await expect(prompt).toBeFocused()
})

test("chat picker Escape returns focus to the prompt", async ({ page }) => {
  await load(page, "prompt-input--default-420")

  await page.getByRole("button", { name: /^Select model:/ }).click()
  const combobox = page.getByRole("combobox", { name: /^Select model:.*Search models$/ })
  await expect(combobox).toBeFocused()
  await combobox.press("Escape")

  await expect(page.locator("textarea.prompt-input")).toBeFocused()
})

test("thinking selector uses a checked Titanium selection without the native focus rectangle", async ({ page }) => {
  await load(page, "prompt-input--qa-thinking-open")

  const list = page.getByRole("listbox")
  const low = page.getByRole("option", { name: "Low" })
  const medium = page.getByRole("option", { name: "Medium" })
  await expect(list).toBeVisible()
  await expect(low).toHaveAttribute("aria-selected", "true")
  await expect(low.locator(".codicon-check")).toBeVisible()
  await expect(low).toBeFocused()

  const selected = await low.evaluate((item) => {
    const style = getComputedStyle(item)
    return {
      border: style.borderTopWidth,
      outline: style.outlineWidth,
      background: style.backgroundColor,
    }
  })
  expect(selected.border).toBe("0px")
  expect(selected.outline).toBe("0px")
  expect(selected.background).not.toBe("rgba(0, 0, 0, 0)")

  await page.keyboard.press("ArrowDown")
  await expect(medium).toBeFocused()
  await expect.poll(() => medium.evaluate((item) => getComputedStyle(item).boxShadow)).not.toBe("none")
  await page.keyboard.press("Enter")
  await expect(list).toBeHidden()
  await expect(page.getByRole("button", { name: "Reasoning effort: Medium" })).toBeVisible()
  await expect(page.locator("textarea.prompt-input")).toBeFocused()

  await page.getByRole("button", { name: "Reasoning effort: Medium" }).click()
  await expect(page.getByRole("listbox")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("listbox")).toBeHidden()
  await expect(page.locator("textarea.prompt-input")).toBeFocused()

  await load(page, "prompt-input--qa-thinking-open", "hc-black")
  const contrast = page.getByRole("option", { name: "Low" })
  await expect(contrast).toBeFocused()
  await expect.poll(() => contrast.evaluate((item) => getComputedStyle(item).outlineWidth)).toBe("2px")
})
