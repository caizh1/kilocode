import { $ } from "bun"
import { createHash, randomUUID } from "node:crypto"
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"
import { linuxPdfChinese, linuxPdfFixture, linuxPdfMarker } from "./poppler-linux-fixture"

const recipe = join(import.meta.dir, "poppler-linux")
const base = "alpine:3.21@sha256:48b0309ca019d89d40f670aa1bc06e426dc0931948452e8491e3d65087abc07d"
const manifest = "manifest.json"
const required = [
  "pdftotext",
  "pdftotext.bin",
  "lib/ld-musl-x86_64.so.1",
  "share/poppler/cMap/Adobe-GB1/UniGB-UCS2-H",
  "share/poppler/cidToUnicode/Adobe-GB1",
  "licenses/Poppler-COPYING",
  "licenses/poppler-26.02.0.tar.xz",
  "licenses/poppler-data-0.4.12.tar.gz",
]

type Result = { exitCode: number; stdout: string; stderr: string }
export type LinuxPopplerRunner = (root: string, args: string[]) => Promise<Result>

function hash(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex")
}

function recipeHash(): string {
  return hash(
    ["Dockerfile", "build.sh", "pdftotext"].map((file) => readFileSync(join(recipe, file), "utf8")).join("\n"),
  )
}

function files(root: string, prefix = ""): string[] {
  return readdirSync(join(root, prefix), { withFileTypes: true })
    .flatMap((entry) => {
      const file = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) return files(root, file)
      if (!entry.isFile()) throw new Error(`Linux Poppler 不允许符号链接或特殊文件：${file}`)
      return [file]
    })
    .sort()
}

export function writeLinuxPopplerManifest(root: string): void {
  const entries = Object.fromEntries(
    files(root)
      .filter((file) => file !== manifest)
      .map((file) => {
        const bytes = readFileSync(join(root, file))
        return [file, { 大小: bytes.length, SHA256: hash(bytes) }]
      }),
  )
  writeFileSync(
    join(root, manifest),
    `${JSON.stringify({ 版本: 1, 目标: "linux-x64", 构建配方: recipeHash(), 文件: entries }, null, 2)}\n`,
  )
}

export function auditLinuxPoppler(root: string): void {
  const entries = files(root)
  for (const file of [...required, manifest]) {
    if (!entries.includes(file)) throw new Error(`Linux Poppler 缺少必需文件：${file}`)
  }
  const record = JSON.parse(readFileSync(join(root, manifest), "utf8"))
  if (record.版本 !== 1 || record.目标 !== "linux-x64" || record.构建配方 !== recipeHash()) {
    throw new Error("Linux Poppler 清单目标或构建配方不匹配，必须重新构建")
  }
  if (!record.文件 || typeof record.文件 !== "object" || Array.isArray(record.文件))
    throw new Error("Linux Poppler 文件清单无效")
  const actual = entries.filter((file) => file !== manifest)
  if (JSON.stringify(actual) !== JSON.stringify(Object.keys(record.文件).sort()))
    throw new Error("Linux Poppler 文件集合与清单不一致")
  for (const file of actual) {
    const bytes = readFileSync(join(root, file))
    const expected = record.文件[file]
    if (expected?.大小 !== bytes.length || expected?.SHA256 !== hash(bytes))
      throw new Error(`Linux Poppler 文件校验失败：${file}`)
    if (file === "pdftotext.bin" || file.startsWith("lib/")) verifyElf(bytes, file)
  }
  if (readFileSync(join(root, "pdftotext"), "utf8") !== readFileSync(join(recipe, "pdftotext"), "utf8")) {
    throw new Error("Linux Poppler 启动器不符合当前打包契约")
  }
  for (const file of ["pdftotext", "pdftotext.bin", "lib/ld-musl-x86_64.so.1"]) {
    if (!(statSync(join(root, file)).mode & 0o111)) throw new Error(`Linux Poppler 文件没有执行权限：${file}`)
  }
}

function verifyElf(bytes: Buffer, file: string): void {
  if (
    bytes.length < 64 ||
    bytes.subarray(0, 4).toString("binary") !== "\x7fELF" ||
    bytes[4] !== 2 ||
    bytes[5] !== 1 ||
    bytes.readUInt16LE(18) !== 62
  ) {
    throw new Error(`Linux Poppler 文件不是 x64 ELF：${file}`)
  }
}

export async function runLinuxPoppler(root: string, args: string[]): Promise<Result> {
  const native = process.platform === "linux" && process.arch === "x64"
  const mapped = "/离线 PDF 预检/组件"
  const container = `chipmate-poppler-check-${randomUUID()}`
  const command = native
    ? args.map((arg) => arg.replaceAll("$ROOT", root))
    : [
        "docker",
        "run",
        "--rm",
        "--name",
        container,
        "--platform",
        "linux/amd64",
        "--network=none",
        "--read-only",
        "--volume",
        `${root}:${mapped}:ro`,
        base,
        ...args.map((arg) => arg.replaceAll("$ROOT", mapped)),
      ]
  const child = Bun.spawn(command, {
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
    env: { ...process.env, LD_LIBRARY_PATH: "", LD_PRELOAD: "" },
  })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill("SIGKILL")
  }, 60_000)
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    return { exitCode, stdout, stderr }
  } finally {
    clearTimeout(timer)
    if (timedOut && !native) {
      const cleanup = await $`docker rm -f ${container}`.quiet().nothrow()
      if (cleanup.exitCode !== 0)
        console.warn(`Linux PDF 预检容器清理失败：${cleanup.stderr.toString().slice(0, 2000)}`)
    }
  }
}

export async function verifyLinuxPoppler(root: string, run: LinuxPopplerRunner = runLinuxPoppler): Promise<void> {
  auditLinuxPoppler(root)
  // 每个动态库必须来自包内；不能让构建容器的系统库掩盖依赖遗漏。
  const dependencies = await run(root, [
    "$ROOT/lib/ld-musl-x86_64.so.1",
    "--library-path",
    "$ROOT/lib",
    "--list",
    "$ROOT/pdftotext.bin",
  ])
  // musl 把已显式启动的包内加载器显示成 ELF 的 PT_INTERP 名称，并不重新加载系统 libc。
  const paths = [...dependencies.stdout.matchAll(/^\s*(\S+) =>\s+(.+?)\s+\(0x[\da-f]+\)/gim)]
    .filter((match) => !(match[1] === "libc.musl-x86_64.so.1" && match[2] === "/lib/ld-musl-x86_64.so.1"))
    .map((match) => match[2])
  const roots = [root, "/离线 PDF 预检/组件"]
  if (
    dependencies.exitCode !== 0 ||
    paths.length === 0 ||
    paths.some((file) => !roots.some((prefix) => file.startsWith(`${prefix}/lib/`)))
  ) {
    throw new Error(`Linux Poppler 包内依赖不完整：${dependencies.stderr.slice(0, 2000)}`)
  }
  const directory = mkdtempSync(join(root, "中文 空格预检 "))
  const pdf = join(directory, "两页中文.pdf")
  try {
    writeFileSync(pdf, linuxPdfFixture())
    const result = await run(root, ["$ROOT/pdftotext", "-layout", "-enc", "UTF-8", pdf.replace(root, "$ROOT"), "-"])
    const pages = result.stdout.split("\f")
    if (result.exitCode !== 0 || !pages[0]?.includes(linuxPdfMarker) || !pages[1]?.includes(linuxPdfChinese)) {
      throw new Error(
        `Linux Poppler 中英文分页提取预检失败：退出码=${result.exitCode}；${result.stderr.slice(0, 2000)}`,
      )
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

export async function ensureLinuxPoppler(bin: string): Promise<void> {
  mkdirSync(bin, { recursive: true })
  const staging = mkdtempSync(join(resolve(bin), ".poppler-linux-"))
  const root = join(staging, "poppler")
  try {
    const source = process.env.POPPLER_LINUX_X64_DIR?.trim()
    if (source) {
      // 不补写清单：离线输入也必须携带原始构建校验记录。
      cpSync(resolve(source), root, { recursive: true })
    } else {
      if (!Bun.which("docker"))
        throw new Error("构建 Linux Poppler 需要 Docker，或使用 POPPLER_LINUX_X64_DIR 提供已验证的离线组件")
      const image = `chipmate-poppler-linux-x64:${recipeHash().slice(0, 16)}`
      await $`docker build --platform linux/amd64 -t ${image} ${recipe}`
      const container = (await $`docker create --platform linux/amd64 ${image} /poppler/pdftotext`.quiet())
        .text()
        .trim()
      try {
        mkdirSync(root)
        await $`docker cp ${`${container}:/poppler/.`} ${root}`.quiet()
      } finally {
        await $`docker rm ${container}`.quiet()
      }
      writeLinuxPopplerManifest(root)
    }
    await verifyLinuxPoppler(root)
    const destination = join(resolve(bin), "poppler")
    rmSync(destination, { recursive: true, force: true })
    renameSync(root, destination)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

export async function verifyLinuxPopplerVsix(vsix: string): Promise<void> {
  const archive = resolve(vsix)
  const listed = (await $`unzip -Z1 ${archive}`.quiet()).text().split(/\r?\n/)
  const prefix = "extension/bin/poppler/"
  const members = listed.filter((file) => file.startsWith(prefix))
  if (!members.length || members.some((file) => file.includes("..") || file.includes("\\")))
    throw new Error("VSIX 的 Linux Poppler 内容缺失或路径无效")
  const staging = mkdtempSync(join(dirname(archive), ".poppler-vsix-"))
  try {
    await $`unzip -q ${archive} ${`${prefix}*`} -d ${staging}`.quiet()
    await verifyLinuxPoppler(join(staging, "extension", "bin", "poppler"))
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}
