#!/usr/bin/env node
/* global process */
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import { join, resolve, sep } from "node:path"

const root = resolve(process.argv[2] || "/app/packages/runtimes")
const manifest = join(root, "deepseek-harness", "manifest.json")
const catalog = JSON.parse(await readFile(manifest, "utf8"))
if (catalog.schemaVersion !== 1 || catalog.runtime !== "deepseek-harness" || !catalog.artifacts) {
  throw new Error("DeepSeek Harness 运行时清单无效")
}

for (const [target, artifact] of Object.entries(catalog.artifacts)) {
  if (!artifact || typeof artifact !== "object" || artifact.target !== target) {
    throw new Error(`DeepSeek Harness 运行时目标无效：${target}`)
  }
  const relative = String(artifact.url || "").replace(/^\/packages\/runtimes\//u, "")
  const path = safe(root, relative)
  const info = await stat(path)
  if (!info.isFile() || info.size !== artifact.sizeBytes || (await sha256(path)) !== artifact.sha256) {
    throw new Error(`DeepSeek Harness 运行时校验失败：${relative}`)
  }
}

function safe(base, relative) {
  if (!relative || relative.includes("\\") || relative.split("/").some((item) => !item || item === "." || item === "..")) {
    throw new Error("DeepSeek Harness 运行时路径无效")
  }
  const path = resolve(base, relative)
  if (!path.startsWith(`${resolve(base)}${sep}`)) throw new Error("DeepSeek Harness 运行时路径越界")
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
