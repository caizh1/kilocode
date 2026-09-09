#!/usr/bin/env node
/* global console, process */
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { copyFile, mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises"
import { basename, dirname, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const script = dirname(fileURLToPath(import.meta.url))
const server = resolve(script, "..")
const sourceManifest = resolve(process.env.CHIPMATE_DSH_RUNTIME_CATALOG || process.argv[2] || "")
if (!process.env.CHIPMATE_DSH_RUNTIME_CATALOG && !process.argv[2]) {
  throw new Error("必须通过 CHIPMATE_DSH_RUNTIME_CATALOG 或第一个参数提供运行时清单")
}
const source = dirname(sourceManifest)
const destination = join(server, ".runtime-seed", "deepseek-harness")
const catalog = JSON.parse(await readFile(sourceManifest, "utf8"))
if (catalog.schemaVersion !== 1 || catalog.runtime !== "deepseek-harness" || !catalog.artifacts) {
  throw new Error("DeepSeek Harness 运行时清单无效")
}

const temporary = `${destination}.preparing-${process.pid}`
await rm(temporary, { recursive: true, force: true })
await mkdir(temporary, { recursive: true })
for (const artifact of Object.values(catalog.artifacts)) {
  const files = (await readdir(source)).filter((name) => name.endsWith(".zip") && name.includes(artifact.sha256))
  if (files.length !== 1) throw new Error(`未找到唯一的 DeepSeek Harness 运行时归档：${artifact.sha256}`)
  const from = safe(source, files[0])
  const info = await stat(from)
  if (!info.isFile() || info.size !== artifact.sizeBytes || (await sha256(from)) !== artifact.sha256) {
    throw new Error(`DeepSeek Harness 运行时校验失败：${basename(from)}`)
  }
  const relative = String(artifact.url || "").replace(/^\/packages\/runtimes\/deepseek-harness\//u, "")
  const to = safe(temporary, relative)
  await mkdir(dirname(to), { recursive: true })
  await copyFile(from, to)
}
await copyFile(sourceManifest, join(temporary, "manifest.json"))
await rm(destination, { recursive: true, force: true })
await mkdir(dirname(destination), { recursive: true })
await rename(temporary, destination)
console.log(`已准备镜像内置运行时：${destination}`)

function safe(root, relative) {
  if (!relative || relative.includes("\\") || relative.split("/").some((item) => !item || item === "." || item === "..")) {
    throw new Error("DeepSeek Harness 运行时路径无效")
  }
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
