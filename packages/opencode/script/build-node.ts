#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

const generated = await import("./generate.ts")

await Bun.build({
  target: "node",
  // chipmate_change start
  entrypoints: [
    "./src/node.ts",
    "../chipmate-sandbox/src/chipmate-sandbox-mutation-worker.ts",
    "../chipmate-sandbox/src/chipmate-sandbox-network-relay.ts",
  ],
  // chipmate_change end
  outdir: "./dist/node",
  format: "esm",
  sourcemap: "linked",
  external: ["jsonc-parser", "@lydell/node-pty"],
  define: {
    CHIPMATE_MODELS_DEV: generated.modelsData,
    CHIPMATE_SANDBOX_MUTATION_WORKER_PATH: `'./chipmate-sandbox-mutation-worker.js'`, // chipmate_change
    CHIPMATE_SANDBOX_NETWORK_RELAY_PATH: `'./chipmate-sandbox-network-relay.js'`, // chipmate_change
    CHIPMATE_SANDBOX_SECCOMP_PATH: "undefined", // chipmate_change
    CHIPMATE_CHANNEL: `'${Script.channel}'`,
  },
  files: {
    "opencode-web-ui.gen.ts": "",
  },
})

console.log("Build complete")
