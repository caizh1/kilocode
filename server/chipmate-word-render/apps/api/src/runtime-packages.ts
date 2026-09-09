import { createReadStream } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import { resolve, sep } from "node:path"
import type { FastifyInstance, FastifyReply } from "fastify"

const MANIFEST = "/packages/runtimes/deepseek-harness/manifest.json"
const PREFIX = "/packages/runtimes/deepseek-harness/"

type Artifact = { url: string; sha256: string; sizeBytes: number }
type Catalog = { schemaVersion: number; runtime: string; artifacts: Record<string, Artifact> }

export function registerRuntimePackages(app: FastifyInstance, root: string) {
  app.get(MANIFEST, async (_req, reply) => {
    const catalog = await readCatalog(root).catch(() => undefined)
    if (!catalog) return missing(reply)
    return reply.header("cache-control", "no-store").send(catalog)
  })

  app.get("/packages/runtimes/deepseek-harness/:version/:target/:artifact.zip", async (req, reply) => {
    const params = req.params as { version: string; target: string; artifact: string }
    if (!/^[a-f0-9]{64}$/u.test(params.artifact)) return missing(reply)
    const requested = `${PREFIX}${params.version}/${params.target}/${params.artifact}.zip`
    const catalog = await readCatalog(root).catch(() => undefined)
    const artifact = catalog?.artifacts[params.target]
    if (!artifact || artifact.url !== requested || artifact.sha256 !== params.artifact) return missing(reply)
    const path = packagePath(root, requested)
    const info = await stat(path).catch(() => undefined)
    if (!info?.isFile() || info.size !== artifact.sizeBytes) return missing(reply)
    const range = parseRange(req.headers.range, info.size)
    if (range === false)
      return reply
        .header("accept-ranges", "bytes")
        .header("content-range", `bytes */${info.size}`)
        .code(416)
        .send()
    const common = reply
      .header("content-type", "application/zip")
      .header("cache-control", "public, max-age=31536000, immutable")
      .header("accept-ranges", "bytes")
      .header("etag", `"${artifact.sha256}"`)
      .header("x-content-sha256", artifact.sha256)
    if (!range) return common.header("content-length", info.size).send(createReadStream(path))
    return common
      .header("content-length", range.end - range.start + 1)
      .header("content-range", `bytes ${range.start}-${range.end}/${info.size}`)
      .code(206)
      .send(createReadStream(path, range))
  })
}

async function readCatalog(root: string): Promise<Catalog> {
  const path = packagePath(root, MANIFEST)
  const value = JSON.parse(await readFile(path, "utf8")) as Catalog
  if (value.schemaVersion !== 1 || value.runtime !== "deepseek-harness" || !value.artifacts)
    throw new Error("DeepSeek Harness 运行时清单无效")
  for (const [target, artifact] of Object.entries(value.artifacts)) {
    if (
      !target ||
      !artifact.url.startsWith(PREFIX) ||
      !/^[a-f0-9]{64}$/u.test(artifact.sha256) ||
      !Number.isSafeInteger(artifact.sizeBytes) ||
      artifact.sizeBytes <= 0
    )
      throw new Error("DeepSeek Harness 运行时制品描述无效")
  }
  return value
}

function packagePath(root: string, url: string): string {
  const base = resolve(root)
  const relative = decodeURIComponent(url.slice("/packages/".length))
  const path = resolve(base, relative)
  if (!path.startsWith(`${base}${sep}`)) throw new Error("运行时制品路径越界")
  return path
}

function parseRange(value: string | undefined, size: number): { start: number; end: number } | false | undefined {
  if (!value) return undefined
  const match = value.match(/^bytes=(\d*)-(\d*)$/u)
  if (!match || (!match[1] && !match[2])) return false
  let start: number
  let end: number
  if (!match[1]) {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : size - 1
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size)
    return false
  return { start, end: Math.min(end, size - 1) }
}

function missing(reply: FastifyReply) {
  return reply.code(404).send({
    ok: false,
    issues: [{ severity: "error", code: "runtime-not-found", message: "DeepSeek Harness 运行时不存在。" }],
  })
}
