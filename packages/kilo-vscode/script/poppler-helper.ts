import { $ } from "bun"
import { cpSync, existsSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs"
import { dirname, join } from "node:path"

const version = "26.02.0-0"
const file = `Release-${version}.zip`
const url = `https://github.com/oschwartz10612/poppler-windows/releases/download/v${version}/${file}`

export function popplerDir(bin: string): string {
  return join(bin, "poppler")
}

export function popplerBinary(bin: string): string {
  return join(popplerDir(bin), "pdftotext.exe")
}

export async function ensurePopplerForTarget(target: string, bin: string): Promise<void> {
  if (target !== "win32-x64") return
  const dir = popplerDir(bin)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })

  const src = process.env.POPPLER_WINDOWS_DIR?.trim()
  if (src) {
    copy(realpathSync(src), dir)
    verify(bin)
    return
  }

  const tmp = join(bin, ".poppler-tmp")
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })

  try {
    const archive = join(tmp, file)
    const res = await fetch(url).catch((cause: unknown) => {
      const msg = cause instanceof Error ? cause.message : String(cause)
      throw new Error(
        `Failed to download Poppler from ${url}. Set POPPLER_WINDOWS_DIR to a preseeded Poppler Windows directory for offline builds: ${msg}`,
        { cause },
      )
    })
    if (!res.ok) throw new Error(`Failed to download Poppler from ${url}: HTTP ${res.status}`)
    await Bun.write(archive, await res.arrayBuffer())
    await extract(archive, tmp)
    copy(tmp, dir)
    verify(bin)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
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

function verify(bin: string): void {
  const exe = popplerBinary(bin)
  if (!existsSync(exe)) throw new Error(`Bundled Poppler missing required file: ${exe}`)
  const files = readdirSync(popplerDir(bin))
  if (!files.some((item) => item.toLowerCase().endsWith(".dll"))) {
    throw new Error(`Bundled Poppler missing required DLL dependencies: ${popplerDir(bin)}`)
  }
  const data = join(popplerDir(bin), "share", "poppler")
  if (!existsSync(data)) throw new Error(`Bundled Poppler missing poppler data: ${data}`)
}
