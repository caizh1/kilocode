import { $ } from "bun"
import {
  closeSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { ensureLinuxPoppler } from "./poppler-linux-helper"

const version = "26.02.0-0"
const file = `Release-${version}.zip`
const url = `https://github.com/oschwartz10612/poppler-windows/releases/download/v${version}/${file}`
const preflightMarker = "CHIPMATE_PDF_PREFLIGHT_OK"
const runtimeFiles = ["msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll"] as const

export type PopplerRunResult = { exitCode: number; signal?: string; stdout: string; stderr: string }
export type PopplerRunner = (exe: string, pdf: string) => Promise<PopplerRunResult>

export function popplerDir(bin: string): string {
  return join(bin, "poppler")
}

export function popplerBinary(bin: string): string {
  return join(popplerDir(bin), "pdftotext.exe")
}

export async function ensurePopplerForTarget(target: string, bin: string): Promise<void> {
  if (target === "linux-x64") return ensureLinuxPoppler(bin)
  if (target !== "win32-x64") return
  const dir = popplerDir(bin)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })

  const src = process.env.POPPLER_WINDOWS_DIR?.trim()
  if (src) {
    copy(realpathSync(src), dir)
    copyRuntime(dir)
    await verifyPopplerForTarget(bin)
    return
  }

  const preseededArchive = process.env.POPPLER_WINDOWS_ARCHIVE?.trim()
  const cacheDir = process.env.CHIPMATE_POPPLER_CACHE_DIR?.trim() || join(homedir(), ".cache", "chipmate", "poppler")
  mkdirSync(cacheDir, { recursive: true })
  const cachedArchive = join(cacheDir, file)

  const tmp = join(bin, ".poppler-tmp")
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })

  try {
    const archive = preseededArchive || (existsSync(cachedArchive) ? cachedArchive : join(tmp, file))
    if (!preseededArchive && !existsSync(cachedArchive)) {
      const res = await fetchWithRetry(url, 4)
      await Bun.write(archive, await res.arrayBuffer())
      copyFileSync(archive, cachedArchive)
    }
    await extract(archive, tmp)
    copy(tmp, dir)
    copyRuntime(dir)
    await verifyPopplerForTarget(bin)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

function copyRuntime(dest: string): void {
  const configured = process.env.CHIPMATE_INTERNAL_VC_RUNTIME_WIN32_X64_DIR?.trim()
  if (!configured) {
    throw new Error(
      "Windows x64 Poppler packaging requires CHIPMATE_INTERNAL_VC_RUNTIME_WIN32_X64_DIR with audited app-local VC++ Runtime DLLs.",
    )
  }
  const src = realpathSync(configured)
  for (const item of runtimeFiles) {
    const file = join(src, item)
    if (!existsSync(file) || !statSync(file).isFile()) {
      throw new Error(`Windows x64 VC++ Runtime missing required file: ${file}`)
    }
    verifyPeX64(file)
    copyFileSync(file, join(dest, item))
  }
}

async function fetchWithRetry(url: string, attempts: number): Promise<Response> {
  let last: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120_000)
    try {
      const res = await fetch(url, { signal: controller.signal })
      if (res.ok) return res
      last = new Error(`HTTP ${res.status}`)
    } catch (err) {
      last = err
    } finally {
      clearTimeout(timeout)
    }
    await Bun.sleep(750 * attempt)
  }
  const msg = last instanceof Error ? last.message : String(last)
  throw new Error(
    `Failed to download Poppler from ${url}. For offline Windows builds, preseed POPPLER_WINDOWS_DIR, POPPLER_WINDOWS_ARCHIVE, or CHIPMATE_POPPLER_CACHE_DIR: ${msg}`,
    { cause: last },
  )
}

function copy(root: string, dest: string): void {
  const bin = find(root, "pdftotext.exe")
  if (!bin) throw new Error(`Poppler source does not contain pdftotext.exe: ${root}`)
  const dir = dirname(bin)
  for (const item of readdirSync(dir)) {
    const src = join(dir, item)
    const stat = statSync(src)
    if (stat.isDirectory()) continue
    if (item === "pdftotext.exe" || item.toLowerCase().endsWith(".dll")) cpSync(src, join(dest, item))
  }

  const data = share(dir)
  if (data) cpSync(data, join(dest, "share", "poppler"), { recursive: true, dereference: true })
}

function find(root: string, name: string): string | undefined {
  for (const item of readdirSync(root)) {
    const file = join(root, item)
    const stat = statSync(file)
    if (stat.isFile() && item.toLowerCase() === name) return file
    if (!stat.isDirectory()) continue
    const hit = find(file, name)
    if (hit) return hit
  }
  return undefined
}

function share(dir: string): string | undefined {
  const candidates = [
    join(dir, "share", "poppler"),
    join(dirname(dir), "share", "poppler"),
    join(dirname(dirname(dir)), "share", "poppler"),
    join(dir, "..", "share", "poppler"),
  ]
  return candidates.find((item) => existsSync(item) && statSync(item).isDirectory())
}

async function extract(archive: string, dest: string): Promise<void> {
  const unzip = Bun.which("unzip")
  if (unzip) {
    await $`${unzip} -q -o ${archive} -d ${dest}`.quiet()
    return
  }

  const powershell = Bun.which("powershell.exe") ?? Bun.which("pwsh.exe")
  if (powershell) {
    await $`${powershell} -NoProfile -NonInteractive -Command ${`$global:ProgressPreference = 'SilentlyContinue'; Expand-Archive -LiteralPath '${archive.replaceAll("'", "''")}' -DestinationPath '${dest.replaceAll("'", "''")}' -Force`}`.quiet()
    return
  }

  throw new Error("Extracting bundled Poppler requires unzip or PowerShell.")
}

export async function verifyPopplerForTarget(
  bin: string,
  platform: NodeJS.Platform = process.platform,
  run: PopplerRunner = runPoppler,
): Promise<void> {
  const exe = popplerBinary(bin)
  if (!existsSync(exe)) throw new Error(`Bundled Poppler missing required file: ${exe}`)
  const files = readdirSync(popplerDir(bin))
  const binaries = files.filter((item) => item === "pdftotext.exe" || item.toLowerCase().endsWith(".dll"))
  if (!binaries.some((item) => item.toLowerCase().endsWith(".dll"))) {
    throw new Error(`Bundled Poppler missing required DLL dependencies: ${popplerDir(bin)}`)
  }
  for (const item of binaries) verifyPeX64(join(popplerDir(bin), item))
  for (const item of runtimeFiles) {
    if (!files.some((file) => file.toLowerCase() === item)) {
      throw new Error(`Bundled Poppler missing app-local VC++ Runtime: ${join(popplerDir(bin), item)}`)
    }
  }
  const data = join(popplerDir(bin), "share", "poppler")
  if (!existsSync(data)) throw new Error(`Bundled Poppler missing poppler data: ${data}`)
  if (platform !== "win32") return

  const dir = mkdtempSync(join(bin, "Poppler 预检 中文 路径 "))
  const pdf = join(dir, "最小 PDF 夹具.pdf")
  try {
    writeFileSync(pdf, pdfFixture(preflightMarker))
    const result = await run(exe, pdf)
    if (result.exitCode === 0 && result.stdout.includes(preflightMarker)) return
    throw new Error(
      `Bundled Poppler runtime preflight failed: executable=${exe}; exitCode=${result.exitCode}; signal=${result.signal ?? "none"}; stderr=${sanitize(result.stderr) || "(empty)"}`,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function verifyPeX64(file: string): void {
  const handle = openSync(file, "r")
  try {
    const dos = Buffer.alloc(64)
    if (readSync(handle, dos, 0, dos.length, 0) !== dos.length || dos.subarray(0, 2).toString("ascii") !== "MZ") {
      throw new Error(`Bundled Poppler file is not a Windows PE binary: ${file}`)
    }
    const offset = dos.readUInt32LE(0x3c)
    const pe = Buffer.alloc(6)
    if (readSync(handle, pe, 0, pe.length, offset) !== pe.length || pe.subarray(0, 4).toString("binary") !== "PE\0\0") {
      throw new Error(`Bundled Poppler file has an invalid PE header: ${file}`)
    }
    if (pe.readUInt16LE(4) !== 0x8664) throw new Error(`Bundled Poppler file is not x64: ${file}`)
  } finally {
    closeSync(handle)
  }
}

async function runPoppler(exe: string, pdf: string): Promise<PopplerRunResult> {
  const child = Bun.spawn([exe, "-layout", pdf, "-"], {
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { exitCode, stdout, stderr }
}

function sanitize(value: string): string {
  return value
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\b(authorization|api[-_ ]?key|token|password)\s*[:=]\s*\S+/gi, "$1=[已隐藏凭据]")
    .replace(/([?&](?:api[-_]?key|access[-_]?token|token|password)=)[^&#\s]+/gi, "$1[已隐藏凭据]")
    .replace(/:\/\/([^\s/@:]+):([^\s/@]+)@/g, "://$1:[已隐藏凭据]@")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8 * 1024)
}

function pdfFixture(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET\n`
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}endstream`,
  ]
  let value = "%PDF-1.4\n"
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(value, "ascii"))
    value += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(value, "ascii")
  value += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  value += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")
  value += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(value, "ascii")
}
