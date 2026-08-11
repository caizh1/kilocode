import { createCanonicalArchive } from "@chipmate/skill-spec"
import type { MarketplaceUploadFile } from "./types"

export function createSkillArchive(id: string, files: MarketplaceUploadFile[]) {
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(id)) throw new Error("Invalid Skill id")
  return createCanonicalArchive(
    id,
    files.map((file) => ({
      path: file.path,
      data: Buffer.from(file.contentBase64, "base64"),
      mode: file.path.startsWith("scripts/") ? 0o755 : 0o644,
    })),
  )
}
