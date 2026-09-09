import { describe, expect, it } from "bun:test"
import { unlinkSync } from "node:fs"
import path from "node:path"
import { build } from "esbuild"
import { solidPlugin } from "esbuild-plugin-solid"

const ROOT = path.resolve(import.meta.dir, "../..")
const WEBVIEW = path.join(ROOT, "webview-ui")
const FIXTURE = path.join(ROOT, "tests/fixtures/session-surface-initial-binding.tsx")

describe("SessionSurface 初始绑定", () => {
  it("覆盖空白侧栏、恢复会话、时序交换与主编辑区 pinnedKey", async () => {
    const solid = path.dirname(Bun.resolveSync("solid-js/package.json", WEBVIEW))
    const aliases: Record<string, string> = {
      "solid-js": path.join(solid, "dist/solid.js"),
      "solid-js/web": path.join(solid, "web/dist/web.js"),
      "solid-js/store": path.join(solid, "store/dist/store.js"),
    }
    const dedupe = {
      name: "solid-dedupe",
      setup(ctx: Parameters<NonNullable<Parameters<typeof build>[0]["plugins"]>[number]["setup"]>[0]) {
        ctx.onResolve({ filter: /^solid-js(\/web|\/store)?$/ }, (args) => ({ path: aliases[args.path] }))
      },
    }
    const result = await build({
      entryPoints: [FIXTURE],
      bundle: true,
      conditions: ["browser"],
      external: ["happy-dom"],
      format: "esm",
      logLevel: "silent",
      platform: "node",
      plugins: [dedupe, solidPlugin()],
      target: "es2022",
      write: false,
    })
    const file = path.join(ROOT, `.session-surface-initial-binding-${crypto.randomUUID()}.mjs`)
    await Bun.write(file, result.outputFiles[0]!.contents)

    try {
      for (const scenario of [
        "bootstrap-first",
        "ready-first",
        "restored",
        "sidebar-stale-pinned",
        "main-session",
        "main-draft",
        "sidebar-explicit-draft",
        "commit-ack",
        "commit-rejected",
        "old-key-rejection",
        "draft-switch-ack",
        "draft-switch-rejected",
        "draft-switch-timeout",
        "draft-switch-late-ack",
        "draft-switch-late-rejection",
        "rapid-switch-200",
      ]) {
        const child = Bun.spawnSync(["bun", file, scenario], { cwd: WEBVIEW, stdout: "pipe", stderr: "pipe" })
        const output = child.stdout.toString() + child.stderr.toString()
        expect(child.exitCode, `${scenario}: ${output}`).toBe(0)
      }
    } finally {
      unlinkSync(file)
    }
  })
})
