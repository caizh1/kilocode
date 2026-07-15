import { $ } from "bun"
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

const version = "15.1.0"

type Target = { platform: string; exe: string; archive: "zip" | "tar.gz"; envPrefix: string }

const targets: Record<string, Target> = {
  "linux-x64": { platform: "x86_64-unknown-linux-musl", exe: "rg", archive: "tar.gz", envPrefix: "LINUX" },
  "win32-x64": { platform: "x86_64-pc-windows-msvc", exe: "rg.exe", archive: "zip", envPrefix: "WINDOWS" },
  "win32-arm64": { platform: "aarch64-pc-windows-msvc", exe: "rg.exe", archive: "zip", envPrefix: "WINDOWS" },
}

export async function ensureRipgrepForTarget(target: string, bin: string): Promise<void> {
  const cfg = targets[target]
  if (!cfg) return

  const dest = join(bin, cfg.exe)
  if (existsSync(dest)) return

  const tmp = join(bin, ".ripgrep-tmp")
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })

  try {
    const file = `ripgrep-${version}-${cfg.platform}.${cfg.archive ?? "zip"}`
    const archive = await resolveArchiveOrExecutable(file, cfg.exe, tmp, dest, cfg.envPrefix ?? "WINDOWS")
    if (archive === "copied") return
    const member = `ripgrep-${version}-${cfg.platform}/${cfg.exe}`
    await extract(archive, member, tmp, dest, cfg.archive ?? "zip")
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

async function resolveArchiveOrExecutable(
  file: string,
  exe: string,
  tmp: string,
  dest: string,
  envPrefix: string,
): Promise<string | "copied"> {
  const preseededExe = process.env[`RIPGREP_${envPrefix}_EXE`]?.trim()
  if (preseededExe) {
    copyFileSync(preseededExe, dest)
    return "copied"
  }

  const preseededDir = process.env[`RIPGREP_${envPrefix}_DIR`]?.trim()
  if (preseededDir) {
    const candidate = join(preseededDir, exe)
    if (!existsSync(candidate)) throw new Error(`RIPGREP_${envPrefix}_DIR does not contain ${exe}: ${preseededDir}`)
    copyFileSync(candidate, dest)
    return "copied"
  }

  const preseededArchive = process.env[`RIPGREP_${envPrefix}_ARCHIVE`]?.trim()
  if (preseededArchive) return preseededArchive

  const cacheDir = process.env.KILO_RIPGREP_CACHE_DIR?.trim() || join(homedir(), ".cache", "kilocode", "ripgrep")
  mkdirSync(cacheDir, { recursive: true })
  const cached = join(cacheDir, file)
  if (existsSync(cached)) return cached

  const archive = join(tmp, file)
  const url = `https://github.com/BurntSushi/ripgrep/releases/download/${version}/${file}`
  const res = await fetchWithRetry(url, 3)
  await Bun.write(archive, await res.arrayBuffer())
  copyFileSync(archive, cached)
  return archive
}

async function fetchWithRetry(url: string, attempts: number): Promise<Response> {
  let last: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(url)
      if (res.ok) return res
      last = new Error(`HTTP ${res.status}`)
    } catch (err) {
      last = err
    }
    await Bun.sleep(500 * attempt)
  }
  const msg = last instanceof Error ? last.message : String(last)
  throw new Error(
    `Failed to download ripgrep from ${url}. For offline builds, preseed RIPGREP_${envPrefix}_EXE, RIPGREP_${envPrefix}_DIR, RIPGREP_${envPrefix}_ARCHIVE, or KILO_RIPGREP_CACHE_DIR: ${msg}`,
    { cause: last },
  )
}

async function extract(
  archive: string,
  member: string,
  tmp: string,
  dest: string,
  kind: "zip" | "tar.gz",
): Promise<void> {
  if (kind === "tar.gz") {
    const tar = Bun.which("tar")
    if (!tar) throw new Error("Extracting bundled Linux ripgrep requires tar.")
    await $`${tar} -xzf ${archive} -C ${tmp} ${member}`.quiet()
    copyFileSync(join(tmp, member), dest)
    return
  }

  const unzip = Bun.which("unzip")
  if (unzip) {
    await $`${unzip} -j -o ${archive} ${member} -d ${tmp}`.quiet()
    copyFileSync(join(tmp, "rg.exe"), dest)
    return
  }

  const powershell = Bun.which("powershell.exe") ?? Bun.which("pwsh.exe")
  if (powershell) {
    await $`${powershell} -NoProfile -NonInteractive -Command ${`$global:ProgressPreference = 'SilentlyContinue'; Expand-Archive -LiteralPath '${archive.replaceAll("'", "''")}' -DestinationPath '${tmp.replaceAll("'", "''")}' -Force`}`.quiet()
    copyFileSync(join(tmp, member), dest)
    return
  }

  throw new Error("Extracting bundled ripgrep requires unzip or PowerShell.")
}
