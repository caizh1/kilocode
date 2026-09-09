import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"

export type PackagedCliTarget = {
  target: string
  cliDir: string
  binary: string
}

export type ReleaseCliPackage = {
  name: string
  binary: string
}

const Artifact = z.object({
  package: z.string().min(1),
  binary: z.string().min(1),
  binaryBytes: z.number().int().positive(),
  binarySha256: z.string().regex(/^[a-f0-9]{64}$/u),
  indexer: z.string().min(1),
  indexerBytes: z.number().int().positive(),
  indexerSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  modelsSha256: z.string().regex(/^[a-f0-9]{64}$/u),
})

const Receipt = z.object({
  schema: z.literal(1),
  description: z.literal("ChipMate 交付包全新 release CLI 构建凭证"),
  version: z.string().min(1),
  release: z.literal(true),
  bunVersion: z.string().min(1),
  createdAt: z.string().datetime(),
  artifacts: z.array(Artifact).min(1),
})

export type ReleaseCliReceipt = z.infer<typeof Receipt>

export const RELEASE_CLI_RECEIPT = ".chipmate-release-cli-build.json"

export function releaseCliPackages(targets: readonly PackagedCliTarget[], windowsX64Only: boolean) {
  const packages = targets.map((item) => ({ name: item.cliDir, binary: item.binary }))
  if (targets.some((item) => item.target === "win32-x64-baseline") && !windowsX64Only) {
    packages.push({ name: "@chipmate/cli-windows-arm64", binary: "chipmate.exe" })
  }
  return [...new Map(packages.map((item) => [item.name, item])).values()]
}

export function releaseCliArguments(packages: readonly ReleaseCliPackage[]) {
  return [
    "script/build.ts",
    `--targets=${packages.map((item) => item.name).join(",")}`,
    "--skip-install",
    "--skip-release-upload",
  ]
}

export function releaseCliEnvironment(version: string, prerelease: boolean, current = process.env) {
  const env = {
    ...current,
    CHIPMATE_VERSION: version,
    CHIPMATE_RELEASE: "1",
    CHIPMATE_CHANNEL: prerelease ? "rc" : "latest",
  }
  delete env.CHIPMATE_BUMP
  return env
}

export async function buildFreshReleaseCli(input: {
  opencodeDir: string
  distDir: string
  version: string
  prerelease: boolean
  targets: readonly PackagedCliTarget[]
  windowsX64Only: boolean
}) {
  const expected = path.join(input.opencodeDir, "dist")
  if (path.resolve(input.distDir) !== path.resolve(expected)) {
    throw new Error("交付打包禁止通过 CLI_DIST_DIR 复用外部 CLI；必须使用本仓库全新 release 构建。")
  }

  const packages = releaseCliPackages(input.targets, input.windowsX64Only)
  const args = releaseCliArguments(packages)
  console.log(`\n🔒 全新构建 release CLI：${packages.map((item) => item.name).join(", ")}`)
  const child = Bun.spawn([process.execPath, ...args], {
    cwd: input.opencodeDir,
    env: releaseCliEnvironment(input.version, input.prerelease),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    windowsHide: true,
  })
  const code = await child.exited
  if (code !== 0) throw new Error(`全新 release CLI 构建失败，退出码 ${code}`)

  await writeReleaseCliReceipt({ distDir: input.distDir, version: input.version, packages })
  const receipt = await verifyReleaseCliReceipt({ distDir: input.distDir, version: input.version, packages })
  console.log(`  ✅ release CLI 构建凭证已校验：${path.join(input.distDir, RELEASE_CLI_RECEIPT)}`)
  return receipt
}

export async function writeReleaseCliReceipt(input: {
  distDir: string
  version: string
  packages: readonly ReleaseCliPackage[]
}) {
  const artifacts = await Promise.all(input.packages.map((item) => artifact(input.distDir, item)))
  const receipt = Receipt.parse({
    schema: 1,
    description: "ChipMate 交付包全新 release CLI 构建凭证",
    version: input.version,
    release: true,
    bunVersion: process.versions.bun,
    createdAt: new Date().toISOString(),
    artifacts,
  })
  await Bun.write(path.join(input.distDir, RELEASE_CLI_RECEIPT), `${JSON.stringify(receipt, null, 2)}\n`)
  return receipt
}

export async function verifyReleaseCliReceipt(input: {
  distDir: string
  version: string
  packages: readonly ReleaseCliPackage[]
}) {
  const file = path.join(input.distDir, RELEASE_CLI_RECEIPT)
  const receipt = Receipt.parse(JSON.parse(await Bun.file(file).text()))
  if (receipt.version !== input.version) {
    throw new Error(`release CLI 构建凭证版本不匹配：期望 ${input.version}，实际 ${receipt.version}`)
  }
  if (receipt.bunVersion !== process.versions.bun) {
    throw new Error(`release CLI 构建凭证 Bun 版本不匹配：期望 ${process.versions.bun}，实际 ${receipt.bunVersion}`)
  }

  const expected = [...input.packages].sort((a, b) => a.name.localeCompare(b.name))
  const actual = [...receipt.artifacts].sort((a, b) => a.package.localeCompare(b.package))
  if (actual.length !== expected.length || actual.some((item, index) => item.package !== expected[index]?.name)) {
    throw new Error("release CLI 构建凭证目标集合与本次 VSIX 打包目标不一致")
  }

  for (const item of expected) {
    const recorded = actual.find((entry) => entry.package === item.name)
    if (!recorded) throw new Error(`release CLI 构建凭证缺少目标 ${item.name}`)
    const current = await artifact(input.distDir, item)
    if (JSON.stringify(current) !== JSON.stringify(recorded)) {
      throw new Error(`release CLI 构建凭证与实际文件不一致：${item.name}`)
    }
  }
  return receipt
}

async function artifact(distDir: string, item: ReleaseCliPackage) {
  const bin = path.join(distDir, item.name, "bin")
  const indexer = item.binary.endsWith(".exe") ? "chipmate-indexer.exe" : "chipmate-indexer"
  const binary = path.join(bin, item.binary)
  const indexing = path.join(bin, indexer)
  const models = path.join(bin, "models-snapshot.json")
  const maps = []
  for await (const entry of new Bun.Glob("**/*.map").scan({ cwd: bin, onlyFiles: true })) maps.push(entry)
  if (maps.length) throw new Error(`release CLI 不得包含 source map：${item.name}`)
  const [binaryStat, indexerStat] = await Promise.all([stat(binary), stat(indexing)])
  return Artifact.parse({
    package: item.name,
    binary: item.binary,
    binaryBytes: binaryStat.size,
    binarySha256: await digest(binary),
    indexer,
    indexerBytes: indexerStat.size,
    indexerSha256: await digest(indexing),
    modelsSha256: await digest(models),
  })
}

async function digest(file: string) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest("hex")
}
