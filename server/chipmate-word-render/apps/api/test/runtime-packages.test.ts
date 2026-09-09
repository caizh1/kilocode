import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import Fastify from "fastify"
import { registerRuntimePackages } from "../src/runtime-packages.ts"

test("DeepSeek Harness 运行时接口独立提供清单、完整下载和 Range", async () => {
  const root = await mkdtemp(join(tmpdir(), "chipmate-runtime-api-"))
  const sha = "a".repeat(64)
  const relative = `runtimes/deepseek-harness/0.1.0-rc.6/win32-x64-baseline/${sha}.zip`
  const path = join(root, relative)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, "runtime-bytes")
  await mkdir(join(root, "runtimes", "deepseek-harness"), { recursive: true })
  await writeFile(
    join(root, "runtimes", "deepseek-harness", "manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      runtime: "deepseek-harness",
      artifacts: {
        "win32-x64-baseline": {
          target: "win32-x64-baseline",
          url: `/packages/${relative}`,
          sha256: sha,
          sizeBytes: 13,
        },
      },
    }),
  )
  const app = Fastify()
  registerRuntimePackages(app, root)
  try {
    const manifest = await app.inject({ method: "GET", url: "/packages/runtimes/deepseek-harness/manifest.json" })
    assert.equal(manifest.statusCode, 200)
    assert.equal(manifest.headers["cache-control"], "no-store")
    const full = await app.inject({ method: "GET", url: `/packages/${relative}` })
    assert.equal(full.statusCode, 200)
    assert.equal(full.body, "runtime-bytes")
    assert.equal(full.headers["x-content-sha256"], sha)
    assert.match(full.headers["cache-control"] ?? "", /immutable/u)
    const range = await app.inject({ method: "GET", url: `/packages/${relative}`, headers: { range: "bytes=0-0" } })
    assert.equal(range.statusCode, 206)
    assert.equal(range.body, "r")
    assert.equal(range.headers["content-range"], "bytes 0-0/13")
    const missing = await app.inject({
      method: "GET",
      url: `/packages/runtimes/deepseek-harness/0.1.0-rc.6/linux-x64-baseline/${sha}.zip`,
    })
    assert.equal(missing.statusCode, 404)
  } finally {
    await app.close()
    await rm(root, { recursive: true, force: true })
  }
})

test("运行时路由读取持久化 package root 中的原子部署结果", async () => {
  const packageRoot = await mkdtemp(join(tmpdir(), "chipmate-package-root-"))
  const sha = "b".repeat(64)
  const relative = `runtimes/deepseek-harness/0.1.0-rc.6/linux-x64-baseline/${sha}.zip`
  const path = join(packageRoot, relative)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, "persistent-runtime")
  await mkdir(join(packageRoot, "runtimes", "deepseek-harness"), { recursive: true })
  await writeFile(
    join(packageRoot, "runtimes", "deepseek-harness", "manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      runtime: "deepseek-harness",
      artifacts: {
        "linux-x64-baseline": {
          target: "linux-x64-baseline",
          url: `/packages/${relative}`,
          sha256: sha,
          sizeBytes: 18,
        },
      },
    }),
  )
  const { build } = await import("../src/index.ts")
  const app = build(undefined, { packageRoot })
  try {
    const response = await app.inject({ method: "GET", url: `/packages/${relative}` })
    assert.equal(response.statusCode, 200)
    assert.equal(response.body, "persistent-runtime")
  } finally {
    await app.close()
    await rm(packageRoot, { recursive: true, force: true })
  }
})
