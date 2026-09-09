#!/usr/bin/env node
/* global console, process */
import { createHash, randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import { copyFile, mkdir, readFile, rename, stat } from "node:fs/promises"
import { dirname, join, resolve, sep } from "node:path"

const source = resolve(process.argv[2] || "/seed")
const destination = resolve(process.argv[3] || "/packages/runtimes")
const manifestSource = join(source, "deepseek-harness", "manifest.json")
const catalog = JSON.parse(await readFile(manifestSource, "utf8"))
if (catalog.schemaVersion !== 1 || catalog.runtime !== "deepseek-harness" || !catalog.artifacts)
  throw new Error("DeepSeek Harness 运行时清单无效")

for (const artifact of Object.values(catalog.artifacts)) {
  if (!artifact || typeof artifact !== "object") throw new Error("DeepSeek Harness 运行时制品描述无效")
  const relative = String(artifact.url || "").replace(/^\/packages\/runtimes\//u, "")
  const from = safe(source, relative)
  const to = safe(destination, relative)
  const info = await stat(from)
  if (info.size !== artifact.sizeBytes || (await sha256(from)) !== artifact.sha256)
    throw new Error(`DeepSeek Harness 运行时校验失败：${relative}`)
  await mkdir(dirname(to), { recursive: true })
  const temporary = `${to}.${process.pid}.${randomUUID()}.part`
  await copyFile(from, temporary)
  await rename(temporary, to)
  console.log(`已部署 DeepSeek Harness 运行时：${relative}`)
}

const manifestDestination = join(destination, "deepseek-harness", "manifest.json")
await mkdir(dirname(manifestDestination), { recursive: true })
const temporaryManifest = `${manifestDestination}.${process.pid}.${randomUUID()}.part`
await copyFile(manifestSource, temporaryManifest)
await rename(temporaryManifest, manifestDestination)

function safe(root, relative) {
  if (!relative || relative.includes("\\") || relative.split("/").some((item) => !item || item === "." || item === ".."))
    throw new Error("DeepSeek Harness 运行时路径无效")
  const path = resolve(root, relative)
  if (!path.startsWith(`${resolve(root)}${sep}`)) throw new Error("DeepSeek Harness 运行时路径越界")
  return path
}

async function sha256(path) {
  const hash = createHash("sha256")
  await new Promise((resolvePromise, reject) => {
    const input = createReadStream(path)
    input.on("data", (chunk) => hash.update(chunk))
    input.on("error", reject)
    input.on("end", resolvePromise)
  })
  return hash.digest("hex")
}
