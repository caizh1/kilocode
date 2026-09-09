import assert from "node:assert/strict"
import { spawn, type ChildProcess } from "node:child_process"
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "../../..")
const repo = resolve(root, "../..")
const archive = resolve(repo, "docs/chipmate-skill-market-alignment-evidence/g0/source-backed-detail-design.tar.gz")

interface InstallerModule {
  MarketplaceInstaller: new (paths: unknown) => {
    installSkill(
      item: {
        type: "skill"
        id: string
        name: string
        displayName: string
        description: string
        category: string
        displayCategory: string
        content: string
      },
      scope: "project",
      workspace: string,
    ): Promise<{ success: boolean; error?: string }>
  }
}

interface PathsModule {
  MarketplacePaths: new () => unknown
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

async function start(packages: string, source: string, market: string, store: string) {
  const selected = await port()
  const secretDir = join(packages, ".auth-test")
  const master = join(secretDir, "master.key")
  const breakGlass = join(secretDir, "break-glass.key")
  await mkdir(secretDir, { recursive: true })
  await Promise.all([writeFile(master, "m".repeat(48)), writeFile(breakGlass, "break-glass-test-key\n")])
  const child = spawn(process.execPath, ["--import", "tsx", "apps/api/src/start.ts"], {
    cwd: root,
    env: {
      ...process.env,
      MARKET_DB_ROOT: store,
      MARKET_IMPORT_ROOT: source,
      MARKET_LEGACY_ROOT: market,
      PACKAGE_ROOT: packages,
      PORT: String(selected),
      SKILL_MARKET_ROOT: market,
      CHIPMATE_AUTH_MASTER_KEY_FILE: master,
      CHIPMATE_AUTH_BREAK_GLASS_KEY_FILE: breakGlass,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  const output = { text: "" }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Fastify start timed out: ${output.text}`)), 15_000)
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
      reject(new Error(`Fastify exited before ready with ${code}: ${output.text}`))
    })
  })
  return { child, origin: `http://127.0.0.1:${selected}` }
}

async function stop(child: ChildProcess) {
  if (child.exitCode !== null) return
  child.kill("SIGTERM")
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      resolve()
    }, 3_000)
    child.once("exit", () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

test("ChipMate installs the Worker-generated archive from the legacy catalog", { timeout: 60_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "chipmate-g3-legacy-"))
  const source = join(dir, "source")
  const skills = join(source, "skills")
  const packages = join(dir, "packages")
  const market = join(packages, "skill-market")
  const store = join(dir, "store")
  const workspace = join(dir, "workspace")
  await Promise.all([
    mkdir(skills, { recursive: true }),
    mkdir(packages, { recursive: true }),
    mkdir(workspace, { recursive: true }),
  ])
  await copyFile(archive, join(skills, "source-backed-detail-design.tar.gz"))
  await writeFile(
    join(source, "skills.json"),
    `${JSON.stringify({
      items: [
        {
          id: "source-backed-detail-design",
          name: "Source-backed Detail Design",
          description: "Generate source-backed module detail designs.",
          category: "documents",
          author: "ChipMate",
          content: "skills/source-backed-detail-design.tar.gz",
        },
      ],
    })}\n`,
  )

  const server = { child: undefined as ChildProcess | undefined, origin: "" }
  try {
    const running = await start(packages, source, market, store)
    server.child = running.child
    server.origin = running.origin

    const catalogResponse = await fetch(`${server.origin}/marketplace/skills`)
    const catalog = (await catalogResponse.json()) as { items: Array<{ id: string; content: string }> }
    assert.equal(catalogResponse.status, 200)
    assert.equal(catalog.items[0]?.id, "source-backed-detail-design")

    const filesResponse = await fetch(`${server.origin}/marketplace/skills/source-backed-detail-design/files`)
    const files = (await filesResponse.json()) as { ok: boolean; code: string }
    assert.equal(filesResponse.status, 404)
    assert.equal(files.code, "skill-files-not-found")

    const item = catalog.items[0]
    if (!item) throw new Error("generated legacy catalog is empty")
    const installerModule = (await import(
      pathToFileURL(resolve(repo, "packages/chipmate-vscode/src/services/marketplace/installer.ts")).href
    )) as InstallerModule
    const pathsModule = (await import(
      pathToFileURL(resolve(repo, "packages/chipmate-vscode/src/services/marketplace/paths.ts")).href
    )) as PathsModule
    const installer = new installerModule.MarketplaceInstaller(new pathsModule.MarketplacePaths())
    const installed = await installer.installSkill(
      {
        type: "skill",
        id: item.id,
        name: "Source-backed Detail Design",
        displayName: "Source-backed Detail Design",
        description: "Generate source-backed module detail designs.",
        category: "documents",
        displayCategory: "Documents",
        content: item.content,
      },
      "project",
      workspace,
    )
    assert.equal(installed.success, true, installed.error ?? "actual ChipMate installer failed")
    assert.match(await readFile(join(workspace, ".chipmate-v2", "skills", item.id, "SKILL.md"), "utf8"), /source-backed/i)
  } finally {
    if (server.child) await stop(server.child)
    await rm(dir, { recursive: true, force: true })
  }
})

test("a market database startup failure does not block health and render routes", { timeout: 30_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "chipmate-g3-degraded-"))
  const packages = join(dir, "packages")
  const source = join(dir, "source")
  const market = join(dir, "legacy-latest")
  const invalid = join(dir, "market-db-is-a-file")
  await mkdir(packages, { recursive: true })
  await writeFile(invalid, "not a directory\n")
  const running = await start(packages, source, market, invalid)
  try {
    const response = await fetch(`${running.origin}/health`)
    const health = (await response.json()) as { ok: boolean; endpoints: string[] }
    assert.equal(response.status, 200)
    assert.equal(health.ok, true)
    assert.ok(health.endpoints.includes("/render/word"))
    assert.ok(health.endpoints.includes("/render/mermaid"))
  } finally {
    await stop(running.child)
    await rm(dir, { recursive: true, force: true })
  }
})
