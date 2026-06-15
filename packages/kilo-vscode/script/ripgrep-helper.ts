import { $ } from "bun"
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"

const version = "15.1.0"

const targets: Record<string, { platform: string; exe: string }> = {
  "win32-x64": { platform: "x86_64-pc-windows-msvc", exe: "rg.exe" },
  "win32-arm64": { platform: "aarch64-pc-windows-msvc", exe: "rg.exe" },
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
    const file = `ripgrep-${version}-${cfg.platform}.zip`
    const archive = join(tmp, file)
    const member = `ripgrep-${version}-${cfg.platform}/${cfg.exe}`
    const url = `https://github.com/BurntSushi/ripgrep/releases/download/${version}/${file}`

    const res = await fetch(url)
    if (!res.ok) throw new Error(`Failed to download ripgrep from ${url}: HTTP ${res.status}`)

    await Bun.write(archive, await res.arrayBuffer())
    await extract(archive, member, tmp, dest)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

async function extract(archive: string, member: string, tmp: string, dest: string): Promise<void> {
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
