import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"
import test from "node:test"
import JSZip from "jszip"

const require = createRequire(import.meta.url)
const { generatePackageManifest } = require("../../../server.js") as {
  generatePackageManifest: (
    root: string,
    extensionId: string,
  ) => Promise<{
    schemaVersion: number
    packages: Array<{ filename: string; target: string; version: string; sha256: string }>
    latestByTarget: Record<string, { filename: string; version: string }>
  }>
}

test("package manifest exposes only validated internal targets and selects the latest per target", async () => {
  const root = await mkdtemp(join(tmpdir(), "chipmate-packages-"))
  try {
    await vsix(root, "chipmate-0.0.9-win32-x64-baseline.vsix", {
      version: "0.0.9",
      chipmatePackageTarget: "win32-x64-baseline",
    })
    await vsix(root, "chipmate-0.0.10-win32-x64-baseline.vsix", {
      version: "0.0.10",
      chipmatePackageTarget: "win32-x64-baseline",
    })
    await vsix(root, "chipmate-0.0.11-linux-x64-baseline.vsix", {
      version: "0.0.11",
      chipmatePackageTarget: "linux-x64-baseline",
    })
    await vsix(root, "chipmate-0.0.12-win32-x64.vsix", {
      version: "0.0.12",
      chipmatePackageTarget: "win32-x64",
    })
    await vsix(root, "chipmate-invalid-version.vsix", {
      version: "version-next",
      chipmatePackageTarget: "win32-x64-baseline",
    })
    await vsix(root, "other-1.0.0.vsix", {
      publisher: "other",
      version: "1.0.0",
      chipmatePackageTarget: "win32-x64-baseline",
    })
    await writeFile(join(root, "broken.vsix"), "not a VSIX")

    const manifest = await generatePackageManifest(root, "chipmate.chipmate")

    assert.equal(manifest.schemaVersion, 2)
    assert.deepEqual(
      manifest.packages.map((item) => [item.target, item.version]),
      [
        ["linux-x64-baseline", "0.0.11"],
        ["win32-x64-baseline", "0.0.10"],
        ["win32-x64-baseline", "0.0.9"],
      ],
    )
    assert.equal(manifest.latestByTarget["win32-x64-baseline"]?.version, "0.0.10")
    assert.equal(manifest.latestByTarget["linux-x64-baseline"]?.version, "0.0.11")
    assert.match(manifest.latestByTarget["win32-x64-baseline"]?.filename ?? "", /0\.0\.10/)
    assert.match(manifest.packages[0]?.sha256 ?? "", /^[a-f0-9]{64}$/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

async function vsix(root: string, name: string, input: Record<string, string>) {
  const zip = new JSZip()
  zip.file(
    "extension/package.json",
    JSON.stringify({ publisher: "chipmate", name: "chipmate", version: "0.0.1", ...input }),
  )
  await writeFile(join(root, name), await zip.generateAsync({ type: "nodebuffer" }))
}
