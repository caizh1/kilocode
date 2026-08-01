import { createHash } from "node:crypto"
import { createReadStream, existsSync } from "node:fs"
import { copyFile, mkdir, open, readFile, readdir, rename, writeFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { spawn } from "node:child_process"

const root = resolve(process.env.CHIPMATE_WORKTREE ?? process.cwd())
const outputValue = process.env.CHIPMATE_PUBLIC_PACKAGES
const targetValue = process.env.CHIPMATE_ARTIFACTS_JSON
const versionValue = process.env.CHIPMATE_VERSION
const extensionValue = process.env.CHIPMATE_EXTENSION_DIR

if (!outputValue || !targetValue || !versionValue || !extensionValue || !/^\d+\.\d+\.\d+$/.test(versionValue)) {
  console.error("缺少公共包目录、产物描述路径、扩展目录或有效版本")
  process.exit(2)
}
const output = outputValue
const target = targetValue
const version = versionValue
const extension = resolve(root, extensionValue)
if (extension !== root && !extension.startsWith(`${root}/`)) throw new Error("扩展目录必须位于工作区内")

async function run(args: string[], cwd: string) {
  if (!args[0]) throw new Error("构建命令为空")
  const child = spawn(args[0], args.slice(1), {
    cwd,
    env: process.env,
    stdio: "inherit",
  })
  const code = await new Promise<number>((done, reject) => {
    child.once("error", reject)
    child.once("close", (value) => done(value ?? 1))
  })
  if (code !== 0) throw new Error(`命令执行失败（退出码 ${code}）：${args.join(" ")}`)
}

function sha(path: string) {
  return new Promise<string>((done, reject) => {
    const hash = createHash("sha256")
    const stream = createReadStream(path)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.once("error", reject)
    stream.once("end", () => done(hash.digest("hex")))
  })
}

async function publish(source: string, name: string) {
  await mkdir(output, { recursive: true })
  const destination = join(output, name)
  const temporary = join(output, `.${name}.${process.pid}.part`)
  await copyFile(source, temporary)
  const handle = await open(temporary, "r")
  await handle.sync()
  await handle.close()
  await rename(temporary, destination)
  const digest = await sha(destination)
  const sidecar = `${destination}.sha256`
  const sidecarTemporary = `${sidecar}.${process.pid}.part`
  await writeFile(sidecarTemporary, `${digest}  ${name}\n`)
  await rename(sidecarTemporary, sidecar)
  return destination
}

const manifestPath = join(extension, "package.json")
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { version?: string }
if (manifest.version !== version) {
  throw new Error(`扩展版本 ${manifest.version ?? "缺失"} 与预留版本 ${version} 不一致`)
}

await run(
  [
    "bun",
    "script/build.ts",
    "--skip-install",
    "--targets=windows-x64-baseline,windows-arm64,linux-x64-baseline",
  ],
  join(root, "packages", "opencode"),
)
await run(
  [
    "bun",
    "script/build.ts",
    "--internal-offline",
    "--targets=win32-x64-baseline,linux-x64-baseline",
  ],
  extension,
)

const out = join(extension, "out")
const files = await readdir(out)
function source(platform: string) {
  const matches = files.filter((file) => file.endsWith(`-${platform}.vsix`))
  if (matches.length !== 1) throw new Error(`${platform} 构建产物数量不是 1`)
  return join(out, matches[0]!)
}

const built = [
  {
    source: source("win32-x64-baseline"),
    platform: "win32-x64-baseline",
    name: `chipmate-${version}-win32-x64-baseline.vsix`,
  },
  {
    source: source("linux-x64-baseline"),
    platform: "linux-x64-baseline",
    name: `chipmate-${version}-linux-x64-baseline.vsix`,
  },
]

for (const artifact of built) {
  if (!existsSync(artifact.source)) throw new Error(`构建产物不存在：${artifact.source}`)
}

const artifacts = []
for (const artifact of built) {
  const path = await publish(artifact.source, artifact.name)
  artifacts.push({ path, platform: artifact.platform })
}

await mkdir(dirname(target), { recursive: true })
await writeFile(target, `${JSON.stringify({ version, artifacts }, null, 2)}\n`)
console.log(`ChipMate ${version} 双平台产物已原子写入公共包目录。`)
console.log(artifacts.map((artifact) => basename(artifact.path)).join("\n"))
