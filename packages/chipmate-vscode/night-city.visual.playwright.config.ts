import { defineConfig } from "@playwright/test"

// 复用已构建的本地夹具；真实扩展宿主另由 runtime 测试覆盖。
export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results/night-city-visual",
  testMatch: ["night-city-visual.spec.ts", "night-city-references.spec.ts", "dynamic-spinner-motion.spec.ts"],
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: process.env.CHIPMATE_APPEARANCE_BASE_URL ?? "http://127.0.0.1:6018",
    viewport: { width: 1488, height: 1056 },
    screenshot: "only-on-failure",
  },
  reporter: "list",
})
