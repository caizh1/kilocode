import { discoverSkillCandidates } from "@chipmate/skill-spec/node"
import { normalizeSkillId } from "@opencode-ai/core/chipmate/skill-identity"
import { parse as parseYaml } from "yaml"
import type { MarketplaceUploadPayload } from "./types"

const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_BYTES = 50 * 1024 * 1024

export interface MarketplaceBuiltinSkill {
  name: string
  description?: string
  content: string
}

export async function buildMarketplaceSkillUploadPayload(sourcePath: string): Promise<MarketplaceUploadPayload> {
  const candidates = await discoverSkillCandidates(sourcePath)
  const candidate = candidates.find((item) => item.key === "0:.") ?? candidates[0]
  if (!candidate) throw new Error("No publishable Skill was found")
  if (!candidate.snapshot.valid) throw new Error("Skill does not pass the shared publication specification")
  const files = candidate.files.map((file) => ({
    path: file.path,
    contentBase64: file.data.toString("base64"),
    sizeBytes: file.data.length,
  }))
  return {
    id: candidate.snapshot.spec.id,
    name: candidate.snapshot.spec.name,
    description: candidate.snapshot.spec.description,
    category: candidate.snapshot.spec.category,
    files,
  }
}

export function buildMarketplaceBuiltinSkillUploadPayload(skill: MarketplaceBuiltinSkill): MarketplaceUploadPayload {
  const content = skill.content
  if (!content.trim()) throw new Error("Built-in Skill content is empty")
  if (rendered(content)) {
    throw new Error("内置 Skill 内容已被渲染为 HTML，无法上传；请更新 ChipMate CLI 后重试。")
  }

  const bytes = Buffer.byteLength(content)
  if (bytes > MAX_FILE_BYTES || bytes > MAX_TOTAL_BYTES) throw new Error("Built-in Skill upload is too large")

  const frontmatter = readFrontmatter(content)
  const name = skill.name.trim()
  if (!name) throw new Error("Built-in Skill name is empty")
  const description = skill.description?.trim() || firstMeaningfulLine(content) || `${name} skill`
  const category = stringValue(frontmatter.category) || "general"

  return {
    id: sanitizeId(name),
    name,
    description,
    category,
    files: [{ path: "SKILL.md", contentBase64: Buffer.from(content).toString("base64"), sizeBytes: bytes }],
  }
}

function rendered(content: string): boolean {
  const value = content.trimStart()
  return /^<(?:hr\b|h[1-6]\b|p\b|ul\b|ol\b)/i.test(value) && /<\/(?:h[1-6]|p|ul|ol|li)>/i.test(value)
}

function readFrontmatter(markdown: string): Record<string, unknown> {
  if (!markdown.startsWith("---")) return {}
  const end = markdown.indexOf("\n---", 3)
  if (end < 0) return {}
  const parsed = parseYaml(markdown.slice(3, end))
  return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {}
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function firstMeaningfulLine(markdown: string): string | undefined {
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.replace(/^#+\s*/, "").trim()
    if (trimmed && trimmed !== "---" && !trimmed.includes(":")) return trimmed
  }
  return undefined
}

function sanitizeId(value: string): string {
  const id = normalizeSkillId(value)
  if (!id) throw new Error("Skill id is empty")
  return id
}
