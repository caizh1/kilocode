import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"
import { createHash } from "node:crypto"
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
    latestByTarget: Record<string, { filename: string; version: string; releaseNotes?: string; publishedAt?: string }>
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
    }, "# ChipMate 0.0.10\n\n- 展示直接投放包的更新说明")
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
    assert.equal(
      manifest.latestByTarget["win32-x64-baseline"]?.releaseNotes,
      "# ChipMate 0.0.10\n\n- 展示直接投放包的更新说明",
    )
    assert.match(manifest.latestByTarget["win32-x64-baseline"]?.publishedAt ?? "", /^20\d\d-/)
    const wire = JSON.parse(JSON.stringify(manifest)) as {
      packages: Array<{ releaseNotes?: string }>
    }
    assert.equal(wire.packages[1]?.releaseNotes, undefined)
    assert.match(manifest.packages[0]?.sha256 ?? "", /^[a-f0-9]{64}$/)
    const linux = await readFile(join(root, "chipmate-0.0.11-linux-x64-baseline.vsix"))
    assert.equal(manifest.packages[0]?.sha256, createHash("sha256").update(linux).digest("hex"))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("package manifest coalesces cold scans and reuses the fingerprint cache", async () => {
  const root = await mkdtemp(join(tmpdir(), "chipmate-packages-cache-"))
  try {
    await vsix(root, "chipmate-0.0.20-win32-x64-baseline.vsix", {
      version: "0.0.20",
      chipmatePackageTarget: "win32-x64-baseline",
    })

    const [first, second, third] = await Promise.all([
      generatePackageManifest(root, "chipmate.chipmate"),
      generatePackageManifest(root, "chipmate.chipmate"),
      generatePackageManifest(root, "chipmate.chipmate"),
    ])
    const cached = await generatePackageManifest(root, "chipmate.chipmate")

    assert.strictEqual(first, second)
    assert.strictEqual(second, third)
    assert.strictEqual(third, cached)
    assert.equal(first.latestByTarget["win32-x64-baseline"]?.version, "0.0.20")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("package manifest invalidates cached entries when a VSIX fingerprint changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "chipmate-packages-invalidate-"))
  const file = "chipmate-current-win32-x64-baseline.vsix"
  try {
    await vsix(root, file, { version: "0.0.21", chipmatePackageTarget: "win32-x64-baseline" })
    const first = await generatePackageManifest(root, "chipmate.chipmate")

    await vsix(root, file, { version: "0.0.222", chipmatePackageTarget: "win32-x64-baseline" })
    const second = await generatePackageManifest(root, "chipmate.chipmate")

    assert.notStrictEqual(first, second)
    assert.equal(second.latestByTarget["win32-x64-baseline"]?.version, "0.0.222")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("package manifest logs an invalid unchanged VSIX only once", async () => {
  const root = await mkdtemp(join(tmpdir(), "chipmate-packages-negative-"))
  const original = console.warn
  const warnings: string[] = []
  console.warn = (...parts: unknown[]) => warnings.push(parts.join(" "))
  try {
    await writeFile(join(root, "broken.vsix"), "not a VSIX")

    await generatePackageManifest(root, "chipmate.chipmate")
    await generatePackageManifest(root, "chipmate.chipmate")

    assert.equal(warnings.length, 1)
    assert.match(warnings[0] ?? "", /skipped broken\.vsix/)
  } finally {
    console.warn = original
    await rm(root, { recursive: true, force: true })
  }
})

async function vsix(root: string, name: string, input: Record<string, string>, releaseNotes?: string) {
  const zip = new JSZip()
  zip.file(
    "extension/package.json",
    JSON.stringify({ publisher: "chipmate", name: "chipmate", version: "0.0.1", ...input }),
  )
  if (releaseNotes) zip.file("extension/RELEASE_NOTES.md", releaseNotes)
  await writeFile(join(root, name), await zip.generateAsync({ type: "nodebuffer" }))
}
