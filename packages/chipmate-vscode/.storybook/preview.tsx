/** @jsxImportSource solid-js */
import type { Preview, SolidRenderer } from "storybook-solidjs-vite"
import type { DecoratorFunction } from "storybook/internal/types"
import { onMount, onCleanup } from "solid-js"
import { mountAppearance } from "../webview-ui/appearance"
// Reference chipmate-ui stories helpers directly — not exported via package.json
import { applyChipMateTheme, applyVscodeTheme, clearVscodeTheme } from "../../chipmate-ui/src/stories/theme-decorator"
import "../../chipmate-ui/.storybook/fonts.css"
import "@chipmate/chipmate-ui/styles"
import "@vscode/codicons/dist/codicon.css"
import "../webview-ui/src/styles/chat.css"

// Make the ChipMate logo available in Storybook (normally injected by the extension host)
;(window as { ICONS_BASE_URI?: string }).ICONS_BASE_URI = "/icons"

const themeDecorator: DecoratorFunction<SolidRenderer> = (Story, context) => {
  const themeId = (context.globals["theme"] as string) ?? "chipmate-vscode"
  const vscodeThemeId = (context.globals["vscodeTheme"] as string) ?? "dark-modern"

  const colorScheme = (() => {
    if (themeId === "chipmate-vscode") return applyVscodeTheme(vscodeThemeId)
    clearVscodeTheme()
    return (context.globals["colorScheme"] as "light" | "dark") ?? "dark"
  })()

  applyChipMateTheme(themeId, colorScheme)
  const skin = context.globals["skin"] === "night-city" ? "night-city" : "default"
  document.documentElement.dataset.chipmateSkin = skin
  document.documentElement.dataset.chipmateNativeNavigation = String(context.parameters.nativeNavigation === true)
  document.documentElement.dataset.chipmateMotion = "immersive"
  document.documentElement.style.setProperty("--night-city-frame", 'url("/appearance/future-page-frame.png")')
  for (const part of ["page", "composer", "tab"]) {
    document.documentElement.style.setProperty(`--future-${part}-frame`, `url("/appearance/future-${part}-frame.png")`)
  }
  document.documentElement.style.setProperty("--future-composer-slice", "245 90 250 90")
  document.documentElement.style.setProperty("--future-tab-slice", "280 70 290 70")
  if (skin === "night-city") document.documentElement.dataset.colorScheme = "dark"
  onMount(() => {
    // 固定夹具只用于视觉与性能，真实导航和保存另由开发宿主测试覆盖。
    const cleanup = mountAppearance({ postMessage: () => {}, getState: () => undefined, setState: () => {} })
    onCleanup(cleanup)
  })
  document.body.style.background = "var(--background-base)"
  document.body.style.color = "var(--text-base)"
  return Story()
}

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    layout: "fullscreen",
  },
  decorators: [themeDecorator],
  globalTypes: {
    skin: {
      description: "插件皮肤",
      toolbar: {
        title: "皮肤",
        items: [
          { value: "default", title: "原皮肤" },
          { value: "night-city", title: "未来风" },
        ],
      },
    },
    theme: {
      description: "Theme",
      toolbar: {
        title: "Theme",
        icon: "paintbrush",
        items: [
          { value: "chipmate-vscode", title: "ChipMate VSCode" },
          { value: "chipmate", title: "ChipMate" },
        ],
        dynamicTitle: true,
      },
    },
    colorScheme: {
      description: "Color Scheme",
      toolbar: {
        title: "Color Scheme",
        icon: "circlehollow",
        items: [
          { value: "dark", title: "Dark", icon: "moon" },
          { value: "light", title: "Light", icon: "sun" },
        ],
        dynamicTitle: true,
      },
    },
    vscodeTheme: {
      description: "VSCode Theme",
      toolbar: {
        title: "VSCode Theme",
        icon: "browser",
        items: [
          { value: "dark-modern", title: "Dark Modern (default)" },
          { value: "dark-plus", title: "Dark+" },
          { value: "light-modern", title: "Light Modern" },
          { value: "hc-black", title: "High Contrast Dark" },
          { value: "hc-light", title: "High Contrast Light" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: "chipmate-vscode",
    colorScheme: "dark",
    vscodeTheme: "dark-modern",
    a11y: { manual: true },
  },
}

export default preview
