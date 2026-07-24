import { describe, expect, test } from "bun:test"
import {
  isSkillId,
  normalizeSkillId,
  validateSkillIdentity,
} from "../../src/kilocode/skill-identity"

describe("ChipMate Skill identity", () => {
  test("normalizes imported names into Agent Skills ids", () => {
    expect(normalizeSkillId("  PDF_Processing v2  ")).toBe("pdf-processing-v2")
    expect(normalizeSkillId("---PDF---Processing---")).toBe("pdf-processing")
  })

  test("accepts only canonical ids", () => {
    expect(isSkillId("pdf-processing")).toBe(true)
    expect(isSkillId("PDF Processing")).toBe(false)
    expect(isSkillId("pdf_processing")).toBe(false)
    expect(isSkillId("pdf.processing")).toBe(false)
  })

  test("requires the frontmatter, directory, and optional metadata ids to agree", () => {
    expect(validateSkillIdentity({ name: "pdf-processing", directory: "pdf-processing" })).toEqual({
      valid: true,
      id: "pdf-processing",
    })
    expect(validateSkillIdentity({ name: "pdf-processing", directory: "other" })).toMatchObject({
      valid: false,
      code: "directory-mismatch",
    })
    expect(
      validateSkillIdentity({ name: "pdf-processing", directory: "pdf-processing", metadataId: "other" }),
    ).toMatchObject({ valid: false, code: "metadata-mismatch" })
  })
})
