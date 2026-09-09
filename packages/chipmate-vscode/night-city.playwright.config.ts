import { defineConfig } from "@playwright/test"

// 仅连接显式提供的隔离开发宿主，不启动 Storybook 或安装插件。
export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results/night-city-runtime",
  testMatch: ["night-city-runtime.spec.ts", "night-city-input-runtime.spec.ts"],
  workers: 1,
  timeout: 120_000,
  reporter: "list",
})
