export const SKILL_ID_LIMIT = 64
export const SKILL_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function normalizeSkillId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, SKILL_ID_LIMIT)
    .replace(/-+$/g, "")
}

export function isSkillId(value: string): boolean {
  return value.length <= SKILL_ID_LIMIT && SKILL_ID_PATTERN.test(value)
}

export type SkillIdentity =
  | { valid: true; id: string }
  | {
      valid: false
      code: "invalid-name" | "directory-mismatch" | "metadata-mismatch"
      message: string
    }

export function validateSkillIdentity(input: { name: string; directory: string; metadataId?: string }): SkillIdentity {
  if (!isSkillId(input.name)) {
    return {
      valid: false,
      code: "invalid-name",
      message: `Skill name must be a lowercase hyphenated id with at most ${SKILL_ID_LIMIT} characters`,
    }
  }
  if (input.directory !== input.name) {
    return {
      valid: false,
      code: "directory-mismatch",
      message: `Skill directory "${input.directory}" must match name "${input.name}"`,
    }
  }
  if (input.metadataId !== undefined && input.metadataId !== input.name) {
    return {
      valid: false,
      code: "metadata-mismatch",
      message: `skill.json id "${input.metadataId}" must match name "${input.name}"`,
    }
  }
  return { valid: true, id: input.name }
}
