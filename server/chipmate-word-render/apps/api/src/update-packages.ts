import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import type { MarketDb } from "@chipmate/market-db"
import type { FastifyInstance, FastifyReply } from "fastify"
import type { ExtensionRuntime } from "./extensions.ts"

const ID = "chipmate.chipmate"
const require = createRequire(import.meta.url)
const legacy = require(resolve(dirname(fileURLToPath(import.meta.url)), "../../../server.js")) as {
  compareExtensionVersions(left: string, right: string): number
  generatePackageManifest(root: string, id: string): Promise<Manifest>
}

interface Entry {
  extensionId: string
  publisher: string
  name: string
  version: string
  target: string
  filename: string
  url: string
  sha256: string
  sizeBytes: number
  mtimeMs: number
}

interface Manifest {
  packages: Entry[]
}

export function registerUpdatePackages(app: FastifyInstance, db: MarketDb, runtime: ExtensionRuntime, root: string) {
  app.get("/packages/manifest.json", async (_req, reply) => {
    await runtime.syncLegacy()
    const old = await legacy.generatePackageManifest(root, ID)
    const artifacts = await db.extensionUpdateArtifacts(ID)
    const notes = new Map<string, string>()
    for (const item of artifacts) {
      const value = item.manifest.releaseNotes?.trim()
      if (value && !notes.has(item.version)) notes.set(item.version, value)
    }
    const web = artifacts
      .filter((item) => item.source === "web" && item.manifest.updateTarget)
      .map((item): Entry => ({
        extensionId: item.extensionId,
        publisher: item.manifest.publisher,
        name: item.manifest.name,
        version: item.version,
        target: item.manifest.updateTarget!,
        filename: item.filename,
        url: `/packages/artifacts/${encodeURIComponent(item.id)}.vsix`,
        sha256: item.sha256,
        sizeBytes: item.size,
        mtimeMs: Date.parse(item.publishedAt),
      }))
    const seen = new Set<string>()
    const packages = [...old.packages, ...web]
      .filter((item) => !seen.has(item.sha256) && seen.add(item.sha256))
      .sort((left, right) => {
        const version = legacy.compareExtensionVersions(right.version, left.version)
        return version || right.mtimeMs - left.mtimeMs
      })
    const latestByTarget: Record<string, Entry & { releaseNotes?: string; publishedAt?: string }> = {}
    for (const item of packages) {
      if (latestByTarget[item.target]) continue
      const releaseNotes = notes.get(item.version)
      latestByTarget[item.target] = {
        ...item,
        ...(releaseNotes ? { releaseNotes } : {}),
        ...(Number.isFinite(item.mtimeMs) ? { publishedAt: new Date(item.mtimeMs).toISOString() } : {}),
      }
    }
    return reply.header("cache-control", "no-store").send({
      ok: true,
      schemaVersion: 2,
      service: "chipmate-word-render",
      generatedAt: new Date().toISOString(),
      latest: packages[0] ?? null,
      latestByTarget,
      packages,
    })
  })

  app.get("/packages/artifacts/:artifact.vsix", async (req, reply) => {
    if (req.headers.range) return reply.header("accept-ranges", "none").code(416).send()
    const id = (req.params as { artifact: string }).artifact
    const item = (await db.extensionUpdateArtifacts(ID)).find((candidate) => candidate.id === id && candidate.source === "web")
    if (!item) return missing(reply)
    return reply
      .header("content-type", "application/vnd.microsoft.vscode.vsix")
      .header("content-length", item.size)
      .header("cache-control", "no-store")
      .header("accept-ranges", "none")
      .header("x-content-sha256", item.sha256)
      .send(createReadStream(item.path))
  })

  app.get("/packages/*", async (req, reply) => {
    const relative = decodeURIComponent((req.params as { "*": string })["*"] ?? "")
    const base = resolve(root)
    const path = resolve(base, relative)
    if (path !== base && !path.startsWith(`${base}${sep}`)) return reply.code(403).send({ ok: false })
    const info = await stat(path).catch(() => undefined)
    if (!info?.isFile()) return missing(reply)
    return reply
      .header("content-type", path.toLocaleLowerCase().endsWith(".vsix") ? "application/vnd.microsoft.vscode.vsix" : "application/octet-stream")
      .header("content-length", info.size)
      .header("cache-control", "no-store")
      .send(createReadStream(path))
  })
}

function missing(reply: FastifyReply) {
  return reply.code(404).send({
    ok: false,
    issues: [{ severity: "error", code: "package-not-found", message: "Package file not found." }],
  })
}
