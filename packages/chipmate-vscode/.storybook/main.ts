import type { StorybookConfig } from "storybook-solidjs-vite"
import { mergeConfig } from "vite"
import solidPlugin from "vite-plugin-solid"

const cordisBrowserNodeModulePlugin = {
  name: "cordis-browser-node-module",
  enforce: "pre" as const,
  resolveId: (id: string) => (id === "node:module" ? "\0cordis-browser-node-module" : undefined),
  load: (id: string) =>
    id === "\0cordis-browser-node-module"
      ? "export const createRequire = () => { throw new Error('Cordis Node fallback is unavailable in the ChipMate QA webview') }"
      : undefined,
}

const config: StorybookConfig = {
  framework: "storybook-solidjs-vite",
  stories: ["../webview-ui/src/stories/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y"],
  staticDirs: [{ from: "../assets/icons", to: "/icons" }, { from: "../assets/appearance", to: "/appearance" }],
  refs: {},
  viteFinal: async (config) => {
    return mergeConfig(config, {
      plugins: [cordisBrowserNodeModulePlugin, solidPlugin()],
      define: {
        "process.env.CORDIS_SHARED": "undefined",
        "process.execArgv": "[]",
        "process.versions.node": JSON.stringify("0"),
      },
      resolve: {
        conditions: ["browser", "solid", "module", "import"],
      },
      esbuild: {
        jsxImportSource: "solid-js",
        jsx: "automatic",
      },
      worker: {
        format: "es",
      },
    })
  },
}

export default config
