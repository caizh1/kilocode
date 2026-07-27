import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

import {
  canUseGatewayUi,
  canUseSidebarSessionActions,
  gatewayTarget,
} from "../../webview-ui/src/utils/internal-offline-ui"
import { internalOfflineProviderDefaults, shouldUseQuickProviderMode } from "../../src/shared/internal-offline"
import { QWEN_FIM_MODEL_ID } from "../../src/shared/qwen-autocomplete"

const ROOT = path.resolve(import.meta.dir, "../..")

describe("internal offline webview gateway UI", () => {
  it("enables key-only provider setup only for complete internal defaults", () => {
    expect(internalOfflineProviderDefaults(false, "https://example.com/v1", "vendor/deepseek")).toBeUndefined()
    expect(internalOfflineProviderDefaults(true, "", "vendor/deepseek")).toBeUndefined()
    const defaults = internalOfflineProviderDefaults(true, " https://example.com/v1 ", " vendor/deepseek ")
    expect(defaults).toMatchObject({
      providerID: "chipmate",
      npm: "@ai-sdk/openai-compatible",
      baseURL: "https://example.com/v1",
      modelID: "vendor/deepseek",
      autocompleteModelID: QWEN_FIM_MODEL_ID,
      variant: "low",
    })
    expect(shouldUseQuickProviderMode(defaults)).toBe(true)
    expect(shouldUseQuickProviderMode(defaults, "chipmate")).toBe(true)
    expect(shouldUseQuickProviderMode(defaults, "another-provider")).toBe(false)
  })
  it("keeps Gateway UI available in public builds", () => {
    expect(canUseGatewayUi(false)).toBe(true)
    expect(gatewayTarget(false)).toEqual({ view: "profile" })
  })

  it("redirects Gateway login entry points to Providers in internal offline builds", () => {
    expect(canUseGatewayUi(true)).toBe(false)
    expect(gatewayTarget(true)).toEqual({ view: "settings", tab: "providers" })
  })

  it("hides sidebar session actions only in internal offline builds", () => {
    expect(canUseSidebarSessionActions(false)).toBe(true)
    expect(canUseSidebarSessionActions(true)).toBe(false)
  })

  it("hides KiloClaw and Profile entry points from internal builds", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"))
    const title = pkg.contributes.menus["view/title"] as Array<{ command: string; when?: string }>
    const editor = pkg.contributes.menus["editor/title"] as Array<{ command: string; when?: string }>
    const palette = pkg.contributes.menus.commandPalette as Array<{ command: string; when?: string }>

    for (const command of ["chipmate.v2.sidebarTitle.kiloClawOpen", "chipmate.v2.sidebarTitle.profileButtonClicked"]) {
      expect(title.find((item) => item.command === command)?.when).toContain("!chipmate.v2.internalOffline")
    }
    expect(editor.find((item) => item.command === "chipmate.v2.profileButtonClicked")?.when).toContain(
      "!chipmate.v2.internalOffline",
    )
    for (const command of ["chipmate.v2.kiloClawOpen", "chipmate.v2.profileButtonClicked"]) {
      expect(palette.find((item) => item.command === command)?.when).toBe("!chipmate.v2.internalOffline")
    }

    const host = fs.readFileSync(path.join(ROOT, "src/extension.ts"), "utf8")
    const prompt = fs.readFileSync(path.join(ROOT, "webview-ui/src/components/chat/PromptInput.tsx"), "utf8")
    expect(host).toContain('executeCommand("setContext", INTERNAL_OFFLINE_CONTEXT, internal)')
    expect(host).toContain('if (internal && suffix === "profilePanel")')
    expect(prompt).toContain('if (isInternalOfflineBuild()) hidden.add("kiloclaw")')
  })
})
