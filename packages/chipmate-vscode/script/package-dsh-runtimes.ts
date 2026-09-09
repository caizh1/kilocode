#!/usr/bin/env bun
import { createHash } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join, relative, sep } from "node:path"
import * as yazl from "yazl"
import {
  DEEPSEEK_HARNESS_RUNTIME_SCHEMA,
  type DeepSeekHarnessRuntimeArtifact,
  type DeepSeekHarnessRuntimeCatalog,
  type DeepSeekHarnessRuntimeTarget,
} from "../src/shared/deepseek-harness-runtime"
import { dshVersion, nodeVersion, prepareDeepSeekHarnessRuntime } from "./dsh-runtime-helper"

const targets = argument("targets", "win32-x64-baseline,linux-x64-baseline")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean) as DeepSeekHarnessRuntimeTarget[]
const output = argument("out", join(import.meta.dir, "..", "out", "dsh-runtimes"))
const catalogPath = argument("catalog", join(output, "manifest.json"))
const artifacts: DeepSeekHarnessRuntimeCatalog["artifacts"] = {}

await mkdir(output, { recursive: true })
for (const target of targets) {
  if (target !== "win32-x64-baseline" && target !== "linux-x64-baseline")
    throw new Error(`不支持的 DeepSeek Harness 运行时目标：${target}`)
  for (const name of await readdir(output)) {
    if (name.startsWith(`deepseek-harness-runtime-${dshVersion}-node-${nodeVersion}-${target}-`))
      await rm(join(output, name), { force: true })
  }
  const temporaryRoot = join(output, ".build")
  await mkdir(temporaryRoot, { recursive: true })
  const temporary = await mkdtemp(join(temporaryRoot, `chipmate-dsh-${target}-`))
  try {
    await prepareDeepSeekHarnessRuntime(target, temporary)
    const root = join(temporary, "dsh-runtime")
    await rm(join(root, "file-manifest.json"), { force: true })
    const files = await inventory(root)
    const fileManifest = Buffer.from(`${JSON.stringify({ schemaVersion: 1, files }, null, 2)}\n`)
    const fileManifestSha256 = digest(fileManifest)
    await writeFile(join(root, "file-manifest.json"), fileManifest, { mode: 0o600 })
    const pending = join(output, `.deepseek-harness-runtime-${target}-${process.pid}.zip`)
    await zip(root, pending)
    const sha256 = await fileDigest(pending)
    const filename = `deepseek-harness-runtime-${dshVersion}-node-${nodeVersion}-${target}-${sha256}.zip`
    const destination = join(output, filename)
    await rm(destination, { force: true })
    await rename(pending, destination)
    const archive = await stat(destination)
    const expandedSizeBytes = files.reduce((total, file) => total + file.size, fileManifest.length)
    const artifact: DeepSeekHarnessRuntimeArtifact = {
      target,
      dshVersion,
      nodeVersion,
      url: `/packages/runtimes/deepseek-harness/${dshVersion}/${target}/${sha256}.zip`,
      sha256,
      sizeBytes: archive.size,
      expandedSizeBytes,
      fileCount: files.length + 1,
      fileManifestSha256,
    }
    artifacts[target] = artifact
    await writeFile(`${destination}.sha256`, `${sha256}  ${filename}\n`)
    console.log(`已生成 ${target} 运行时：${destination}`)
  } finally {
    if (process.env.CHIPMATE_DSH_KEEP_FAILED_BUILD === "1")
      console.warn(`保留 DeepSeek Harness 构建目录用于失败诊断：${temporary}`)
    else await rm(temporary, { recursive: true, force: true })
  }
}

const catalog: DeepSeekHarnessRuntimeCatalog = {
  schemaVersion: DEEPSEEK_HARNESS_RUNTIME_SCHEMA,
  runtime: "deepseek-harness",
  dshVersion,
  nodeVersion,
  artifacts,
}
await mkdir(dirname(catalogPath), { recursive: true })
await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`)
console.log(`已生成 DeepSeek Harness 运行时清单：${catalogPath}`)

async function inventory(root: string) {
  const result: Array<{ path: string; size: number; sha256: string; mode: number }> = []
  for (const path of await files(root)) {
    const info = await stat(path)
    result.push({
      path: relative(root, path).split(sep).join("/"),
      size: info.size,
      sha256: await fileDigest(path),
      mode: info.mode & 0o777,
    })
  }
  return result.sort((left, right) => left.path.localeCompare(right.path))
}

async function files(root: string, directory = root): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...(await files(root, path)))
    else if (entry.isFile()) result.push(path)
    else throw new Error(`DSH 运行时包含不支持的文件类型：${relative(root, path)}`)
  }
  return result
}

async function zip(root: string, destination: string): Promise<void> {
  const archive = new yazl.ZipFile()
  const fixed = new Date("2020-01-01T00:00:00.000Z")
  for (const path of await files(root)) {
    const info = await stat(path)
    archive.addFile(path, `dsh-runtime/${relative(root, path).split(sep).join("/")}`, {
      mtime: fixed,
      mode: info.mode & 0o777,
      compress: true,
    })
  }
  archive.end()
  await new Promise<void>((resolvePromise, reject) => {
    const output = createWriteStream(destination, { flags: "wx", mode: 0o600 })
    archive.outputStream.on("error", reject)
    output.on("error", reject)
    output.on("finish", resolvePromise)
    archive.outputStream.pipe(output)
  })
}

async function fileDigest(path: string): Promise<string> {
  const hash = createHash("sha256")
  await new Promise<void>((resolvePromise, reject) => {
    const input = createReadStream(path)
    input.on("data", (chunk) => hash.update(chunk))
    input.on("error", reject)
    input.on("end", resolvePromise)
  })
  return hash.digest("hex")
}

function digest(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}

function argument(name: string, fallback: string): string {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback
}
