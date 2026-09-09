import assert from "node:assert/strict"
import { spawn, type ChildProcess } from "node:child_process"
import { createHash } from "node:crypto"
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import JSZip from "jszip"

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "../../..")
const repo = resolve(root, "../..")
const skill = resolve(repo, "docs/chipmate-skill-market-alignment-evidence/g0/source-backed-detail-design.tar.gz")
const docx = resolve(repo, "ufs-task-module-interface.docx")

interface Running {
  child: ChildProcess
  origin: string
}

interface Fixture {
  dir: string
  packages: string
  path: string
  master: string
  breakGlass: string
}

async function port() {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("failed to allocate test port")
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  return address.port
}

async function fixture(seed = true): Promise<Fixture> {
  const dir = await mkdtemp(join(tmpdir(), "chipmate-market-g2-"))
  const packages = join(dir, "packages")
  const market = join(packages, "skill-market")
  const skills = join(market, "skills")
  const bin = join(dir, "bin")
  await mkdir(bin, { recursive: true })
  if (seed) {
    await mkdir(skills, { recursive: true })
    const zip = new JSZip()
    zip.file(
      "extension/package.json",
      JSON.stringify({
        publisher: "chipmate",
        name: "chipmate",
        version: "0.0.1",
        chipmatePackageTarget: "linux-x64-baseline",
      }),
    )
    const bytes = await zip.generateAsync({ type: "nodebuffer" })
    await Promise.all([
      copyFile(skill, join(skills, "source-backed-detail-design.tar.gz")),
      writeFile(join(packages, "chipmate-vscode-linux-x64-baseline.vsix"), bytes),
    ])
    await writeFile(
      join(market, "skills.json"),
      `${JSON.stringify(
        {
          items: [
            {
              id: "source-backed-detail-design",
              name: "Source-backed Detail Design",
              description: "Generate source-backed module detail designs.",
              category: "documents",
              content: "skills/source-backed-detail-design.tar.gz",
            },
          ],
        },
        null,
        2,
      )}\n`,
    )
  }
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  const wrapper = join(bin, "chromium")
  await writeFile(wrapper, `#!/bin/sh\nexec ${JSON.stringify(chrome)} "$@"\n`)
  await chmod(wrapper, 0o755)
  const master = join(dir, "master.key")
  const breakGlass = join(dir, "break-glass.key")
  await writeFile(master, "ChipMate-Legacy-Compatibility-Master-Key-0001\n")
  await writeFile(breakGlass, "ChipMate-Legacy-Compatibility-Break-Glass\n")
  return { dir, packages, path: `${bin}:${process.env.PATH ?? ""}`, master, breakGlass }
}

async function start(args: string[], value: Fixture): Promise<Running> {
  const selected = await port()
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: {
      ...process.env,
      PACKAGE_ROOT: value.packages,
      PATH: value.path,
      PORT: String(selected),
      SKILL_MARKET_ROOT: join(value.packages, "skill-market"),
      UPDATE_EXTENSION_ID: "chipmate.chipmate",
      CHIPMATE_AUTH_MASTER_KEY_FILE: value.master,
      CHIPMATE_AUTH_BREAK_GLASS_KEY_FILE: value.breakGlass,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  const output = { text: "" }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server start timed out: ${output.text}`)), 15_000)
    const read = (chunk: Buffer) => {
      output.text += chunk.toString()
      if (!output.text.includes("listening on 0.0.0.0")) return
      clearTimeout(timer)
      resolve()
    }
    child.stdout?.on("data", read)
    child.stderr?.on("data", read)
    child.once("exit", (code) => {
      clearTimeout(timer)
      reject(new Error(`server exited before ready with ${code}: ${output.text}`))
    })
  })
  return { child, origin: `http://127.0.0.1:${selected}` }
}

async function stop(value: Running) {
  if (value.child.exitCode !== null) return
  value.child.kill("SIGTERM")
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      value.child.kill("SIGKILL")
      resolve()
    }, 3_000)
    value.child.once("exit", () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

async function request(origin: string, path: string, init?: RequestInit) {
  const res = await fetch(`${origin}${path}`, init)
  const bytes = Buffer.from(await res.arrayBuffer())
  return {
    status: res.status,
    type: res.headers.get("content-type") ?? "",
    bytes,
    text: bytes.toString("utf8"),
  }
}

async function digest(origin: string, path: string) {
  const res = await fetch(`${origin}${path}`)
  if (!res.body) throw new Error(`response body is missing for ${path}`)
  const hash = createHash("sha256")
  const size = { value: 0 }
  const reader = res.body.getReader()
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    hash.update(chunk.value)
    size.value += chunk.value.byteLength
  }
  return {
    status: res.status,
    type: res.headers.get("content-type") ?? "",
    sha256: hash.digest("hex"),
    size: size.value,
  }
}

function normalized(text: string, origins: string[]) {
  const replaced = origins.reduce((value, origin) => value.replaceAll(origin, "<origin>"), text)
  const value = JSON.parse(replaced) as unknown
  return JSON.stringify(stable(value))
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "elapsedMs" && key !== "generatedAt")
      .map(([key, item]) => [key, stable(item)]),
  )
}

function json(value: Awaited<ReturnType<typeof request>>) {
  return JSON.parse(value.text) as Record<string, unknown>
}

test("Fastify and the frozen Node server return equivalent legacy contracts", { timeout: 60_000 }, async () => {
  const value = await fixture()
  const legacy = await start(["server.js"], value)
  const fastify = await start(["--import", "tsx", "apps/api/src/start.ts"], value)
  const origins = [legacy.origin, fastify.origin]
  try {
    const cases: Array<[string, RequestInit | undefined]> = [
      ["/health", undefined],
      ["/packages/manifest.json", undefined],
      ["/marketplace/skills", undefined],
      ["/marketplace/manifest.json", undefined],
      ["/marketplace/skills/source-backed-detail-design/files", undefined],
      ["/marketplace/skills/missing.tar.gz", undefined],
      ["/missing", undefined],
      [
        "/render/word",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ filename: "bad.txt", docxBase64: "AA==" }),
        },
      ],
      [
        "/render/mermaid",
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: "" }) },
      ],
      [
        "/render/plantuml",
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: "" }) },
      ],
      [
        "/auth/new-api/resolve-user",
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey: "" }) },
      ],
      [
        "/marketplace/skills",
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) },
      ],
      [
        "/marketplace/skills/source-backed-detail-design/stars",
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) },
      ],
    ]
    for (const [path, init] of cases) {
      const before = await request(legacy.origin, path, init)
      const after = await request(fastify.origin, path, init)
      assert.equal(after.status, before.status, path)
      assert.equal(after.type, before.type, path)
      assert.equal(normalized(after.text, origins), normalized(before.text, origins), path)
    }

    const manifest = json(await request(fastify.origin, "/packages/manifest.json"))
    assert.equal((manifest.packages as unknown[]).length, 1)
    const catalog = json(await request(fastify.origin, "/marketplace/skills"))
    assert.equal((catalog.items as unknown[]).length, 1)

    const before = await request(legacy.origin, "/marketplace/skills/source-backed-detail-design.tar.gz")
    const after = await request(fastify.origin, "/marketplace/skills/source-backed-detail-design.tar.gz")
    assert.equal(after.status, before.status)
    assert.equal(
      createHash("sha256").update(after.bytes).digest("hex"),
      createHash("sha256").update(before.bytes).digest("hex"),
    )

    const beforePackage = await digest(legacy.origin, "/packages/chipmate-vscode-linux-x64-baseline.vsix")
    const afterPackage = await digest(fastify.origin, "/packages/chipmate-vscode-linux-x64-baseline.vsix")
    assert.deepEqual(afterPackage, beforePackage)
    const bytes = await readFile(join(value.packages, "chipmate-vscode-linux-x64-baseline.vsix"))
    assert.equal(afterPackage.sha256, createHash("sha256").update(bytes).digest("hex"))
  } finally {
    await Promise.all([stop(legacy), stop(fastify), rm(value.dir, { recursive: true, force: true })])
  }
})

test("Fastify starts with market storage unavailable and reports degradation", { timeout: 30_000 }, async () => {
  const value = await fixture(false)
  const fastify = await start(["--import", "tsx", "apps/api/src/start.ts"], value)
  try {
    const response = await request(fastify.origin, "/health")
    const health = json(response)
    const capabilities = health.capabilities as Record<string, Record<string, unknown>>
    const market = capabilities.skillMarket
    if (!market) throw new Error("health response is missing skillMarket capability")
    assert.equal(response.status, 200)
    assert.equal(health.ok, true)
    assert.equal(market.catalogExists, false)
    assert.ok((health.endpoints as string[]).includes("/render/word"))
    assert.ok((health.endpoints as string[]).includes("/render/mermaid"))
    assert.ok((health.endpoints as string[]).includes("/render/plantuml"))
  } finally {
    await Promise.all([stop(fastify), rm(value.dir, { recursive: true, force: true })])
  }
})

test(
  "Fastify executes real Mermaid and DOCX rendering through the compatibility core",
  { timeout: 120_000 },
  async () => {
    const value = await fixture()
    const fastify = await start(["--import", "tsx", "apps/api/src/start.ts"], value)
    try {
      const mermaid = await request(fastify.origin, "/render/mermaid", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: "g2-smoke",
          scale: 2,
          source: "flowchart TD\nA[开始] --> B{校验}\nB -->|通过| C[发布]\nB -->|失败| D[修复]",
        }),
      })
      const diagram = json(mermaid)
      assert.equal(mermaid.status, 200)
      assert.equal(diagram.ok, true, JSON.stringify(diagram))
      assert.equal((diagram.png as Record<string, unknown>).contentType, "image/png")
      assert.ok(Number(diagram.pixelWidth) > 0)
      assert.ok(Number(diagram.pixelHeight) > 0)
      assert.ok(
        Buffer.from(String((diagram.png as Record<string, unknown>).base64), "base64")
          .subarray(0, 8)
          .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
      )

      const bytes = await readFile(docx)
      const word = await request(fastify.origin, "/render/word", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: "ufs-task-module-interface.docx", docxBase64: bytes.toString("base64") }),
      })
      const document = json(word)
      assert.equal(word.status, 200)
      assert.equal(document.ok, true)
      assert.ok(Number(document.pageCount) > 0)
      assert.equal((document.pdf as Record<string, unknown>).contentType, "application/pdf")
      assert.ok(Array.isArray(document.pages))
      assert.ok((document.pages as Array<Record<string, unknown>>).every((page) => page.contentType === "image/png"))
    } finally {
      await Promise.all([stop(fastify), rm(value.dir, { recursive: true, force: true })])
    }
  },
)
