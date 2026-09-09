import { defineConfig } from "@vscode/test-cli"

export default defineConfig({
  files: "out/test/session-surface.integration.test.js",
  launchArgs: [
    "/Users/archer/Work/kilocode",
    "--user-data-dir=/private/tmp/chipmate-session-surface-profile-20260903-2400",
    "--extensions-dir=/private/tmp/chipmate-session-surface-extensions-20260903-2400",
  ],
})
