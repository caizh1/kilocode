import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./apps/web/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  outputDir: ".runtime/e2e-results",
  use: {
    baseURL: "http://127.0.0.1:4174",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
    viewport: { width: 1440, height: 1024 },
  },
  projects: [
    { name: "chrome", use: { browserName: "chromium", channel: "chrome" } },
    { name: "edge", use: { browserName: "chromium", channel: "msedge" } },
  ],
  webServer: [
    {
      command:
        "npm run preview:seed && npm run preview:auth && CHIPMATE_AUTH_MASTER_KEY_FILE=.runtime/e2e-auth/master.key CHIPMATE_AUTH_BREAK_GLASS_KEY_FILE=.runtime/e2e-auth/break-glass.key MARKET_DB_ROOT=.runtime/e2e-db MARKET_IMPORT_ROOT=.runtime/source MARKET_LEGACY_ROOT=.runtime/e2e-legacy PACKAGE_ROOT=.runtime/e2e-packages SKILL_MARKET_ROOT=.runtime/e2e-legacy EXTENSION_MARKET_ENABLED=1 EXTENSION_MARKET_ROOT=.runtime/e2e-extensions EXTENSION_DROP_SCAN_MS=1000 PORT=6111 npm run dev",
      url: "http://127.0.0.1:6111/api/v1/status",
      timeout: 30_000,
      reuseExistingServer: false,
    },
    {
      command:
        "MARKET_API_ORIGIN=http://127.0.0.1:6111 npm exec vite --workspace @chipmate/market-web -- --host 127.0.0.1 --port 4174",
      url: "http://127.0.0.1:4174/",
      timeout: 30_000,
      reuseExistingServer: false,
    },
  ],
})
