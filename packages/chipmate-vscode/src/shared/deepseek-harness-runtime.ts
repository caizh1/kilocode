import {
  DEEPSEEK_HARNESS_NODE_VERSION,
  DEEPSEEK_HARNESS_VERSION,
  type DeepSeekHarnessAgentPreset,
} from "./deepseek-harness"

export const DEEPSEEK_HARNESS_RUNTIME_SCHEMA = 1
export const DEEPSEEK_HARNESS_RUNTIME_TARGETS = ["win32-x64-baseline", "linux-x64-baseline"] as const

export type DeepSeekHarnessRuntimeTarget = (typeof DEEPSEEK_HARNESS_RUNTIME_TARGETS)[number]

export interface DeepSeekHarnessRuntimeArtifact {
  target: DeepSeekHarnessRuntimeTarget
  dshVersion: string
  nodeVersion: string
  url: string
  sha256: string
  sizeBytes: number
  expandedSizeBytes: number
  fileCount: number
  fileManifestSha256: string
}

export interface DeepSeekHarnessRuntimeCatalog {
  schemaVersion: number
  runtime: "deepseek-harness"
  dshVersion: string
  nodeVersion: string
  artifacts: Partial<Record<DeepSeekHarnessRuntimeTarget, DeepSeekHarnessRuntimeArtifact>>
}

export function deepSeekHarnessHostTarget(
  platform = process.platform,
  architecture = process.arch,
): DeepSeekHarnessRuntimeTarget | undefined {
  if (platform === "win32" && architecture === "x64") return "win32-x64-baseline"
  if (platform === "linux" && architecture === "x64") return "linux-x64-baseline"
  return undefined
}

export function deepSeekHarnessPresetForTarget(
  target: DeepSeekHarnessRuntimeTarget,
): DeepSeekHarnessAgentPreset {
  if (target === "win32-x64-baseline") return "standard"
  return "minimal"
}

export function parseDeepSeekHarnessRuntimeCatalog(value: unknown): DeepSeekHarnessRuntimeCatalog {
  if (!record(value)) throw new Error("DeepSeek Harness 运行时清单必须是对象")
  if (value.schemaVersion !== DEEPSEEK_HARNESS_RUNTIME_SCHEMA || value.runtime !== "deepseek-harness")
    throw new Error("DeepSeek Harness 运行时清单身份或版本无效")
  if (value.dshVersion !== DEEPSEEK_HARNESS_VERSION || value.nodeVersion !== DEEPSEEK_HARNESS_NODE_VERSION)
    throw new Error("DeepSeek Harness 运行时清单版本与扩展固定版本不一致")
  if (!record(value.artifacts)) throw new Error("DeepSeek Harness 运行时清单缺少平台制品")
  const artifacts: DeepSeekHarnessRuntimeCatalog["artifacts"] = {}
  for (const target of DEEPSEEK_HARNESS_RUNTIME_TARGETS) {
    const raw = value.artifacts[target]
    if (raw === undefined) continue
    artifacts[target] = parseArtifact(raw, target)
  }
  return {
    schemaVersion: DEEPSEEK_HARNESS_RUNTIME_SCHEMA,
    runtime: "deepseek-harness",
    dshVersion: DEEPSEEK_HARNESS_VERSION,
    nodeVersion: DEEPSEEK_HARNESS_NODE_VERSION,
    artifacts,
  }
}

export function sameDeepSeekHarnessRuntimeArtifact(
  left: DeepSeekHarnessRuntimeArtifact,
  right: DeepSeekHarnessRuntimeArtifact,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function isAllowedDeepSeekHarnessRuntimeBase(url: URL): boolean {
  if (url.protocol === "https:") return true
  if (url.protocol !== "http:") return false
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]") return true
  const octets = url.hostname.split(".").map(Number)
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false
  if (octets[0] === 10) return true
  if (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) return true
  return octets[0] === 192 && octets[1] === 168
}

function parseArtifact(value: unknown, target: DeepSeekHarnessRuntimeTarget): DeepSeekHarnessRuntimeArtifact {
  if (!record(value)) throw new Error(`DeepSeek Harness ${target} 制品描述必须是对象`)
  const artifact: DeepSeekHarnessRuntimeArtifact = {
    target,
    dshVersion: string(value.dshVersion),
    nodeVersion: string(value.nodeVersion),
    url: string(value.url),
    sha256: string(value.sha256).toLowerCase(),
    sizeBytes: integer(value.sizeBytes),
    expandedSizeBytes: integer(value.expandedSizeBytes),
    fileCount: integer(value.fileCount),
    fileManifestSha256: string(value.fileManifestSha256).toLowerCase(),
  }
  if (artifact.dshVersion !== DEEPSEEK_HARNESS_VERSION || artifact.nodeVersion !== DEEPSEEK_HARNESS_NODE_VERSION)
    throw new Error(`DeepSeek Harness ${target} 制品版本不匹配`)
  if (!artifact.url.startsWith("/packages/runtimes/deepseek-harness/") || artifact.url.includes("?"))
    throw new Error(`DeepSeek Harness ${target} 制品 URL 不在固定路径中`)
  if (!sha(artifact.sha256) || !sha(artifact.fileManifestSha256))
    throw new Error(`DeepSeek Harness ${target} 制品哈希无效`)
  if (artifact.sizeBytes <= 0 || artifact.expandedSizeBytes <= 0 || artifact.fileCount <= 0)
    throw new Error(`DeepSeek Harness ${target} 制品大小或文件数无效`)
  return artifact
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function string(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("DeepSeek Harness 运行时清单字段必须是非空字符串")
  return value
}

function integer(value: unknown): number {
  if (!Number.isSafeInteger(value)) throw new Error("DeepSeek Harness 运行时清单数字字段无效")
  return value as number
}

const sha = (value: string) => /^[a-f0-9]{64}$/u.test(value)
