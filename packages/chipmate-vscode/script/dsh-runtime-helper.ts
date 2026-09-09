import { createHash } from "node:crypto"
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { basename, join } from "node:path"
import { exec } from "../src/util/process"

export const dshVersion = "0.1.0-rc.6"
export const dshIntegrity =
  "sha512-brpZfED7ieRa2PQ5tUxMhHrM1pb2CmKFVM/f6yMULBDMicahk+Z2OsHgTwTDnoiZm23Ftu9rQz0NN4pflaoJcg=="
export const nodeVersion = "24.19.0"

export const linuxBuilderRootfs = {
  url: "https://github.com/AlmaLinux/wsl-images/releases/download/v8.10.20260311.0/AlmaLinux-8.10_x64_20260311.0.wsl",
  filename: "AlmaLinux-8.10_x64_20260311.0.wsl",
  sha256: "77a662e2947a1482087e3edf22595d62121ad8011385152f9209734adac87941",
  architecture: "linux/amd64",
  glibc: "2.28",
} as const

const linuxBuilderBase = `chipmate-dsh-linux-builder-base:${linuxBuilderRootfs.sha256.slice(0, 16)}`
const linuxBuilderRevision = "python39-tencent-direct-v1"
const linuxBuilder = `chipmate-dsh-linux-builder:${linuxBuilderRootfs.sha256.slice(0, 16)}-${linuxBuilderRevision}`
const linuxBuilderLabel = "com.chipmate.deepseek-harness.builder-rootfs-sha256"
const linuxNpmCacheVolume = `chipmate-dsh-npm-${dshVersion.replaceAll(/[^a-z0-9]/giu, "-")}-${nodeVersion.replaceAll(".", "-")}`

const distributions: Record<string, { archive: string; sha256: string; os: string; cpu: string }> = {
  "darwin-arm64": {
    archive: `node-v${nodeVersion}-darwin-arm64.tar.gz`,
    sha256: "8294b7aa9b03997481c06babf1e8b270c859358f27da57a11509afe537ac381d",
    os: "darwin",
    cpu: "arm64",
  },
  "darwin-x64": {
    archive: `node-v${nodeVersion}-darwin-x64.tar.gz`,
    sha256: "d1b5e999db158c62fe8f7267a4476b035d8bd93b1a605bac24a3f0dd166e3316",
    os: "darwin",
    cpu: "x64",
  },
  "linux-x64": {
    archive: `node-v${nodeVersion}-linux-x64.tar.gz`,
    sha256: "f625d97cd707df4ff96254916fbc5ff014f09c09effe5a1e0ca8f6d41a8789d4",
    os: "linux",
    cpu: "x64",
  },
  "linux-arm64": {
    archive: `node-v${nodeVersion}-linux-arm64.tar.gz`,
    sha256: "d28c8a5bf0a808f0ed434a1dce8c54ae98f0371c0bd86ac58abc613f73e6643f",
    os: "linux",
    cpu: "arm64",
  },
  "linux-x64-baseline": {
    archive: `node-v${nodeVersion}-linux-x64.tar.gz`,
    sha256: "f625d97cd707df4ff96254916fbc5ff014f09c09effe5a1e0ca8f6d41a8789d4",
    os: "linux",
    cpu: "x64",
  },
  "win32-x64": {
    archive: `node-v${nodeVersion}-win-x64.zip`,
    sha256: "57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73",
    os: "win32",
    cpu: "x64",
  },
  "win32-x64-baseline": {
    archive: `node-v${nodeVersion}-win-x64.zip`,
    sha256: "57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73",
    os: "win32",
    cpu: "x64",
  },
}

export function supportsDeepSeekHarnessTarget(target: string): boolean {
  return target in distributions
}

export async function prepareDeepSeekHarnessRuntime(target: string, binDir: string): Promise<void> {
  const distribution = distributions[target]
  if (!distribution) throw new Error(`DeepSeek Harness 尚未锁定 ${target} 的官方 Node 24 运行时`)
  const source = join(import.meta.dir, "..", "dsh-runtime")
  const lock = join(source, "package-lock.json")
  verifyLock(lock)

  const work = join(binDir, ".dsh-runtime-build")
  mkdirSync(work, { recursive: true })
  const temporary = mkdtempSync(join(work, "prepare-"))
  try {
    const archive = join(temporary, distribution.archive)
    const cache = process.env.CHIPMATE_DSH_NODE_ARCHIVE_DIR?.trim()
    const cachedArchive = cache ? join(cache, distribution.archive) : undefined
    if (cachedArchive && existsSync(cachedArchive)) cpSync(cachedArchive, archive)
    else {
      await Bun.write(
        archive,
        await downloadWithRetry(`https://nodejs.org/dist/v${nodeVersion}/${distribution.archive}`, 4),
      )
    }
    const actual = createHash("sha256").update(readFileSync(archive)).digest("hex")
    if (actual !== distribution.sha256) throw new Error(`官方 Node ${nodeVersion} SHA-256 不匹配`)

    const install = join(temporary, "install")
    mkdirSync(install, { recursive: true })
    cpSync(join(source, "package.json"), join(install, "package.json"))
    cpSync(lock, join(install, "package-lock.json"))
    const builder =
      distribution.os === "linux"
        ? await installLinuxDependencies(temporary, install, archive)
        : await installCrossPlatformDependencies(install, distribution.os, distribution.cpu)
    await verifyOfficialDshPackage(install, temporary)

    const destination = join(binDir, "dsh-runtime")
    rmSync(destination, { recursive: true, force: true })
    mkdirSync(destination, { recursive: true })
    const nodeRoot = join(temporary, basename(distribution.archive).replace(/\.(tar\.gz|zip)$/u, ""))
    if (distribution.archive.endsWith(".zip")) await exec("unzip", ["-q", archive, "-d", temporary])
    else await exec("tar", ["-xzf", archive, "-C", temporary])
    const nodeBinary = join(nodeRoot, distribution.os === "win32" ? "node.exe" : "bin/node")
    cpSync(nodeBinary, join(destination, distribution.os === "win32" ? "node.exe" : "node"))
    cpSync(join(install, "node_modules"), join(destination, "node_modules"), { recursive: true, dereference: true })
    pruneNativeArtifacts(destination, distribution.os, distribution.cpu)
    pruneSourceMaps(destination)
    writeFileSync(
      join(destination, "runtime-manifest.json"),
      `${JSON.stringify(
        {
          dshVersion,
          dshIntegrity,
          nodeVersion,
          nodeArchive: distribution.archive,
          nodeSha256: distribution.sha256,
          target,
          ...(builder ? { builder } : {}),
          launch: {
            command: "dsh web",
            arguments: ["web", "--host", "127.0.0.1", "--port", "0"],
            injectedEnvironment: ["DSH_HOME", "DEEPSEEK_BASE_URL", "DEEPSEEK_API_KEY"],
          },
        },
        null,
        2,
      )}\n`,
    )
    verifyRuntime(destination, distribution.os, distribution.cpu)
    if (distribution.os === "linux") await smokeLinuxRuntime(destination, builder!.image)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  }
}

async function installCrossPlatformDependencies(install: string, os: string, cpu: string): Promise<undefined> {
  await exec(npmCommand(), ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: install,
    env: { ...process.env, npm_config_os: os, npm_config_cpu: cpu },
    maxBuffer: 32 * 1024 * 1024,
  })
  return undefined
}

async function installLinuxDependencies(
  temporary: string,
  install: string,
  nodeArchive: string,
): Promise<{ image: string; rootfsSha256: string; glibc: string }> {
  const image = await ensureLinuxBuilder(temporary)
  const container = `chipmate-dsh-install-${process.pid}-${Date.now()}`
  const command = [
    "set -euo pipefail",
    `test \"$(uname -m)\" = x86_64`,
    `test \"$(getconf GNU_LIBC_VERSION)\" = \"glibc ${linuxBuilderRootfs.glibc}\"`,
    "mkdir -p /build/node",
    `tar --no-same-owner -xzf /build/${basename(nodeArchive)} -C /build/node --strip-components=1`,
    "export PATH=/build/node/bin:$PATH",
    "cd /build/install",
    "CXX=/usr/local/bin/chipmate-dsh-g++ PYTHON=/usr/bin/python3.9 npm_config_python=/usr/bin/python3.9 npm_config_nodedir=/build/node npm_config_maxsockets=1 npm_config_fetch_retries=20 npm_config_fetch_retry_mintimeout=1000 npm_config_fetch_retry_maxtimeout=10000 npm_config_fetch_timeout=600000 /build/node/bin/npm ci --omit=dev --include=optional --no-audit --no-fund --foreground-scripts",
    "/build/node/bin/node -e \"Promise.all([import('sharp'), import('node-pty'), import('koffi')]).then(() => console.log('Linux 原生依赖加载通过'))\"",
  ].join("\n")
  await runDockerContainer(
    container,
    [
      "--platform",
      linuxBuilderRootfs.architecture,
      "--mount",
      `type=bind,source=${temporary},target=/build`,
      "--mount",
      `type=volume,source=${linuxNpmCacheVolume},target=/root/.npm`,
      ...dockerProxyArguments(temporary),
      image,
      "/bin/bash",
      "-lc",
      command,
    ],
    20 * 60_000,
  )
  return { image, rootfsSha256: linuxBuilderRootfs.sha256, glibc: linuxBuilderRootfs.glibc }
}

async function ensureLinuxBuilder(temporary: string): Promise<string> {
  const compilerWrapper = join(temporary, "dsh-gxx-wrapper.sh")
  writeFileSync(
    compilerWrapper,
    `#!/bin/bash
set -euo pipefail
arguments=()
for argument in "$@"; do
  if [[ "$argument" == "-std=gnu++20" ]]; then argument="-std=gnu++2a"; fi
  arguments+=("$argument")
done
exec /usr/bin/g++ "\${arguments[@]}"
`,
    { mode: 0o700 },
  )
  const resumable = await imageMatches(linuxBuilder)
  if (resumable && (await builderReady(linuxBuilder))) return linuxBuilder
  if (!(await imageMatches(linuxBuilderBase))) {
    const configured = process.env.CHIPMATE_DSH_LINUX_BUILDER_ROOTFS?.trim()
    const rootfs = configured || join(temporary, linuxBuilderRootfs.filename)
    if (!configured) await Bun.write(rootfs, await downloadWithRetry(linuxBuilderRootfs.url, 5))
    if (!existsSync(rootfs) || fileSha256(rootfs) !== linuxBuilderRootfs.sha256)
      throw new Error("Linux DSH 构建根文件系统 SHA-256 不匹配")
    await exec(
      "docker",
      [
        "import",
        "--platform",
        linuxBuilderRootfs.architecture,
        "--change",
        `LABEL ${linuxBuilderLabel}=${linuxBuilderRootfs.sha256}`,
        rootfs,
        linuxBuilderBase,
      ],
      { timeout: 5 * 60_000, maxBuffer: 8 * 1024 * 1024 },
    )
  }
  const container = `chipmate-dsh-builder-${process.pid}-${Date.now()}`
  try {
    await exec(
      "docker",
      [
        "run",
        "--name",
        container,
        "--platform",
        linuxBuilderRootfs.architecture,
        "--mount",
        `type=bind,source=${temporary},target=/chipmate-build,readonly`,
        resumable ? linuxBuilder : linuxBuilderBase,
        "/bin/bash",
        "-lc",
        [
          "set -euo pipefail",
          `test \"$(getconf GNU_LIBC_VERSION)\" = \"glibc ${linuxBuilderRootfs.glibc}\"`,
          "install -m 0755 /chipmate-build/dsh-gxx-wrapper.sh /usr/local/bin/chipmate-dsh-g++",
          "sed -ri 's|^mirrorlist=|# mirrorlist=|; s|^# baseurl=https://repo.almalinux.org/almalinux|baseurl=https://mirrors.cloud.tencent.com/almalinux|' /etc/yum.repos.d/almalinux.repo",
          "if ! command -v g++ >/dev/null || ! command -v python3.9 >/dev/null || ! command -v readelf >/dev/null; then dnf --setopt=max_parallel_downloads=1 --setopt=timeout=300 --setopt=minrate=1 --setopt=retries=20 install -y gcc-c++ make python39 binutils findutils tar gzip ca-certificates; fi",
          "dnf clean all",
        ].join("\n"),
      ],
      { timeout: 60 * 60_000, maxBuffer: 32 * 1024 * 1024 },
    )
    await exec(
      "docker",
      ["commit", "--change", `LABEL ${linuxBuilderLabel}=${linuxBuilderRootfs.sha256}`, container, linuxBuilder],
      { timeout: 5 * 60_000, maxBuffer: 8 * 1024 * 1024 },
    )
  } finally {
    await exec("docker", ["container", "rm", "-f", container], { timeout: 30_000 }).catch(() => undefined)
  }
  if (!(await builderReady(linuxBuilder))) throw new Error("Linux DSH builder 工具链校验失败")
  return linuxBuilder
}

async function builderReady(image: string): Promise<boolean> {
  try {
    await exec(
      "docker",
      [
        "run",
        "--rm",
        "--platform",
        linuxBuilderRootfs.architecture,
        image,
        "/bin/bash",
        "-lc",
        `test \"$(uname -m)\" = x86_64 && test \"$(getconf GNU_LIBC_VERSION)\" = \"glibc ${linuxBuilderRootfs.glibc}\" && command -v g++ >/dev/null && command -v chipmate-dsh-g++ >/dev/null && command -v python3.9 >/dev/null && command -v readelf >/dev/null`,
      ],
      { timeout: 60_000 },
    )
    return true
  } catch {
    return false
  }
}

async function imageMatches(image: string): Promise<boolean> {
  try {
    const result = await exec(
      "docker",
      [
        "image",
        "inspect",
        image,
        "--format",
        `{{index .Config.Labels \"${linuxBuilderLabel}\"}} {{.Os}}/{{.Architecture}}`,
      ],
      { timeout: 30_000 },
    )
    return result.stdout.trim() === `${linuxBuilderRootfs.sha256} ${linuxBuilderRootfs.architecture}`
  } catch {
    return false
  }
}

function dockerProxyArguments(temporary: string): string[] {
  const entries = ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY"].flatMap((name) => {
    const raw = process.env[name]?.trim()
    if (!raw) return []
    if (/\r|\n/u.test(raw)) throw new Error(`Docker 代理变量 ${name} 含非法换行`)
    if (name === "NO_PROXY") return [`${name}=${raw}`]
    const proxy = new URL(raw)
    if (proxy.hostname === "127.0.0.1" || proxy.hostname === "localhost") proxy.hostname = "host.docker.internal"
    return [`${name}=${proxy.toString()}`]
  })
  if (entries.length === 0) return []
  const file = join(temporary, ".docker-proxy.env")
  writeFileSync(file, `${entries.join("\n")}\n`, { mode: 0o600 })
  return ["--add-host", "host.docker.internal:host-gateway", "--env-file", file]
}

export async function smokeLinuxRuntime(root: string, image: string): Promise<void> {
  const smoke = join(import.meta.dir, "dsh-runtime-smoke.mjs")
  if (!existsSync(smoke)) throw new Error("缺少 Linux DSH 运行时启动冒烟脚本")
  const native = nativeLinuxFiles(root)
  const files = [join(root, "node"), native.sharp, native.libvips, native.pty, native.koffi]
  const quoted = files.map((path) => `/runtime/${path.slice(root.length + 1).replaceAll("\\", "/")}`)
  const versionAudit = quoted
    .map((path) => `readelf --version-info '${path}' 2>/dev/null | grep -Eo 'GLIBC(X{2})?_[0-9]+(\\.[0-9]+)*' || true`)
    .join("\n")
  const command = ["set -euo pipefail", versionAudit, "/runtime/node /smoke.mjs /runtime"].join("\n")
  const container = `chipmate-dsh-smoke-${process.pid}-${Date.now()}`
  const output = await runDockerContainer(
    container,
    [
      "--platform",
      linuxBuilderRootfs.architecture,
      "--mount",
      `type=bind,source=${smoke},target=/smoke.mjs,readonly`,
      image,
      "/bin/bash",
      "-lc",
      command,
    ],
    300_000,
    [{ source: `${root}/.`, destination: "/runtime" }],
  )
  verifyGlibcVersions(output)
}

async function runDockerContainer(
  name: string,
  arguments_: string[],
  timeout: number,
  copies: Array<{ source: string; destination: string }> = [],
): Promise<string> {
  await exec("docker", ["container", "rm", "-f", name], { timeout: 30_000 }).catch(() => undefined)
  await exec("docker", ["create", "--name", name, ...arguments_], {
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
  })
  try {
    for (const copy of copies)
      await exec("docker", ["cp", copy.source, `${name}:${copy.destination}`], {
        timeout: 20 * 60_000,
        maxBuffer: 8 * 1024 * 1024,
      })
    await exec("docker", ["start", name], { timeout: 60_000 })
    const deadline = performance.now() + timeout
    while (performance.now() < deadline) {
      const state = await exec(
        "docker",
        ["container", "inspect", name, "--format", "{{.State.Running}} {{.State.ExitCode}}"],
        { timeout: 30_000 },
      )
      const [running, code] = state.stdout.trim().split(/\s+/u)
      if (running === "false") {
        const logs = await exec("docker", ["logs", name], {
          timeout: 60_000,
          maxBuffer: 32 * 1024 * 1024,
        })
        const output = `${logs.stdout}\n${logs.stderr}`
        if (code !== "0") throw new Error(`Docker 构建阶段失败（退出码 ${code}）：\n${output.slice(-16_000)}`)
        return output
      }
      await Bun.sleep(1_000)
    }
    throw new Error(`Docker 构建阶段超过 ${Math.ceil(timeout / 1_000)} 秒`)
  } finally {
    await exec("docker", ["container", "rm", "-f", name], { timeout: 30_000 }).catch(() => undefined)
  }
}

export function verifyGlibcVersions(output: string): void {
  const versions = [...output.matchAll(/\b(GLIBC|GLIBCXX)_(\d+)\.(\d+)(?:\.(\d+))?/gu)]
  for (const match of versions) {
    const major = Number(match[2])
    const minor = Number(match[3])
    const patch = Number(match[4] ?? 0)
    if (match[1] === "GLIBC" && (major > 2 || (major === 2 && minor > 28)))
      throw new Error(`Linux DSH 运行时要求超出 glibc 2.28：${match[0]}`)
    if (match[1] === "GLIBCXX" && (major > 3 || (major === 3 && (minor > 4 || (minor === 4 && patch > 25)))))
      throw new Error(`Linux DSH 运行时要求超出 RHEL 8 GLIBCXX_3.4.25：${match[0]}`)
  }
}

function verifyLock(path: string): void {
  if (!existsSync(path)) throw new Error("缺少 dsh-runtime/package-lock.json")
  const lock = JSON.parse(readFileSync(path, "utf8")) as {
    packages?: Record<string, { version?: string; integrity?: string }>
  }
  const root = lock.packages?.["node_modules/@deepseek-ai/dsh"]
  if (root?.version !== dshVersion || root.integrity !== dshIntegrity) throw new Error("官方 DSH npm 锁定值不匹配")
}

function pruneNativeArtifacts(root: string, os: string, cpu: string): void {
  const remove = (path: string) => rmSync(path, { recursive: true, force: true })
  walk(root, (path) => {
    const normalized = path.slice(root.length).replaceAll("\\", "/").toLowerCase()
    const platform = `${os}-${cpu}`
    const name = basename(path).toLowerCase()
    if (cpu === "x64" && (name.includes("arm64") || name.includes("aarch64"))) {
      remove(path)
      return
    }
    if (normalized.includes("/prebuilds/") && !normalized.includes(platform)) remove(path)
    if (os !== "win32" && normalized.includes("/node_modules/node-pty/third_party/conpty/")) remove(path)
    const imagePackage = normalized.match(/\/node_modules\/@img\/([^/]+)$/u)?.[1]
    const platformImagePackage = imagePackage?.startsWith("sharp-") && imagePackage !== "sharp-libvips-dev"
    if (platformImagePackage && !imagePackage.includes(platform) && statSync(path).isDirectory()) remove(path)
  })
}

function pruneSourceMaps(root: string): void {
  walk(root, (path) => {
    const normalized = path.replaceAll("\\", "/")
    if (path.endsWith(".map") && !normalized.includes("/node_modules/@deepseek-ai/dsh/")) rmSync(path, { force: true })
  })
}

async function verifyOfficialDshPackage(install: string, temporary: string): Promise<void> {
  const archive = join(temporary, `deepseek-ai-dsh-${dshVersion}.tgz`)
  const cache = process.env.CHIPMATE_DSH_NPM_TARBALL_DIR?.trim()
  const cachedArchive = cache ? join(cache, `deepseek-ai-dsh-${dshVersion}.tgz`) : undefined
  const bytes =
    cachedArchive && existsSync(cachedArchive)
      ? readFileSync(cachedArchive)
      : await downloadWithRetry(`https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-${dshVersion}.tgz`, 8)
  const sri = createHash("sha512").update(bytes).digest("base64")
  if (`sha512-${sri}` !== dshIntegrity) throw new Error("官方 DSH npm tarball integrity 不匹配")
  await Bun.write(archive, bytes)
  const source = join(temporary, "official-dsh")
  mkdirSync(source, { recursive: true })
  await exec("tar", ["-xzf", archive, "-C", source])
  const expected = tree(join(source, "package"))
  const actual = tree(join(install, "node_modules", "@deepseek-ai", "dsh"))
  if (JSON.stringify(expected) !== JSON.stringify(actual))
    throw new Error("安装后的 @deepseek-ai/dsh 文件与官方 npm tarball 不一致")
}

function tree(root: string): Array<{ path: string; sha256: string }> {
  const files: Array<{ path: string; sha256: string }> = []
  walk(root, (path) => {
    if (!existsSync(path) || !statSync(path).isFile()) return
    files.push({
      path: path.slice(root.length + 1).replaceAll("\\", "/"),
      sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
    })
  })
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

function walk(root: string, visit: (path: string) => void): void {
  for (const name of readdirSync(root)) {
    const path = join(root, name)
    visit(path)
    if (existsSync(path) && statSync(path).isDirectory()) walk(path, visit)
  }
}

export function verifyRuntime(root: string, os: string, cpu: string): void {
  const node = join(root, os === "win32" ? "node.exe" : "node")
  const entry = join(root, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js")
  if (!existsSync(node) || !existsSync(entry)) throw new Error("DeepSeek Harness 运行时缺少官方入口或 Node")
  if (os === "linux" && cpu === "x64") {
    const native = nativeLinuxFiles(root)
    for (const path of [node, native.sharp, native.libvips, native.pty, native.koffi]) verifyElfX64(path)
    walk(root, (path) => {
      if (!existsSync(path) || !statSync(path).isFile()) return
      const name = basename(path).toLowerCase()
      if (name.endsWith(".dll") || name.endsWith(".exe") || name.endsWith(".dylib"))
        throw new Error(`Linux DSH 运行时含非 Linux 原生文件：${path}`)
      if (name.endsWith(".node") || name.endsWith(".so") || /\.so\.\d/u.test(name)) verifyElfX64(path)
    })
  }
  if (os === "win32" && cpu === "x64") {
    const required = [
      node,
      findRequired(root, "node_modules/@img/sharp-win32-x64", (name) => name.endsWith(".node")),
      join(root, "node_modules", "node-pty", "prebuilds", "win32-x64", "pty.node"),
      join(root, "node_modules", "@koromix", "koffi-win32-x64", "win32_x64", "koffi.node"),
    ]
    for (const path of required) verifyPeX64(path)
  }
  if (cpu === "x64") {
    const forbidden: string[] = []
    walk(root, (path) => {
      const lower = path.slice(root.length).toLowerCase()
      if (lower.includes("arm64") || lower.includes("aarch64")) forbidden.push(path)
    })
    if (forbidden.length > 0) throw new Error(`${os} x64 DSH 运行时含 ARM 资源：${forbidden[0]}`)
  }
}

function nativeLinuxFiles(root: string): {
  sharp: string
  libvips: string
  pty: string
  koffi: string
} {
  return {
    sharp: findRequired(root, "node_modules/@img/sharp-linux-x64", (name) => name.endsWith(".node")),
    libvips: findRequired(root, "node_modules/@img/sharp-libvips-linux-x64", (name) => name.includes(".so")),
    pty: join(root, "node_modules", "node-pty", "build", "Release", "pty.node"),
    koffi: join(root, "node_modules", "@koromix", "koffi-linux-x64", "linux_x64", "koffi.node"),
  }
}

function findRequired(root: string, relative: string, accept: (name: string) => boolean): string {
  const directory = join(root, relative)
  if (!existsSync(directory)) throw new Error(`DeepSeek Harness 运行时缺少目标原生目录：${relative}`)
  let found: string | undefined
  walk(directory, (path) => {
    if (!found && existsSync(path) && statSync(path).isFile() && accept(basename(path))) found = path
  })
  if (!found) throw new Error(`DeepSeek Harness 运行时缺少目标原生文件：${relative}`)
  return found
}

function verifyElfX64(path: string): void {
  if (!existsSync(path)) throw new Error(`Linux DSH 运行时缺少原生文件：${path}`)
  const bytes = readFileSync(path)
  if (
    bytes.length < 20 ||
    bytes[0] !== 0x7f ||
    bytes[1] !== 0x45 ||
    bytes[2] !== 0x4c ||
    bytes[3] !== 0x46 ||
    bytes[4] !== 2 ||
    bytes[5] !== 1 ||
    bytes.readUInt16LE(18) !== 0x3e
  )
    throw new Error(`Linux DSH 原生文件不是 ELF x86-64：${path}`)
}

function verifyPeX64(path: string): void {
  if (!existsSync(path)) throw new Error(`Windows DSH 运行时缺少原生文件：${path}`)
  const bytes = readFileSync(path)
  const offset = bytes.length >= 0x40 ? bytes.readUInt32LE(0x3c) : 0
  if (
    bytes.length < offset + 6 ||
    bytes[0] !== 0x4d ||
    bytes[1] !== 0x5a ||
    bytes.toString("ascii", offset, offset + 4) !== "PE\0\0" ||
    bytes.readUInt16LE(offset + 4) !== 0x8664
  )
    throw new Error(`Windows DSH 原生文件不是 PE x64：${path}`)
}

function fileSha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm"
}

async function downloadWithRetry(url: string, attempts: number): Promise<Buffer> {
  let last: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120_000)
    try {
      const response = await fetch(url, { signal: controller.signal })
      if (response.ok) return Buffer.from(await response.arrayBuffer())
      last = new Error(`HTTP ${response.status}`)
    } catch (error) {
      last = error
    } finally {
      clearTimeout(timeout)
    }
    await Bun.sleep(750 * attempt)
  }
  const message = last instanceof Error ? last.message : String(last)
  throw new Error(`下载锁定制品失败：${message}`, { cause: last })
}

if (import.meta.main) {
  const target = process.argv[2] ?? `${process.platform}-${process.arch}`
  const binDir = process.argv[3] ?? join(import.meta.dir, "..", "bin")
  await prepareDeepSeekHarnessRuntime(target, binDir)
}
