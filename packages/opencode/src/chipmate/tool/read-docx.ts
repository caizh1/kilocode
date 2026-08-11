import mammoth from "mammoth"
import * as path from "path"
import { Readable } from "stream"
import { extractDocxPlantUml } from "@chipmate/chipmate-indexing/engine"

export function accepts(filepath: string) {
  return path.extname(filepath).toLowerCase() === ".docx"
}

export async function open(filepath: string, bytes: Buffer) {
  const result = await mammoth.extractRawText({ buffer: bytes }).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Failed to extract text from DOCX file: ${filepath}\n${message}`, { cause: err })
  })
  const warnings = result.messages.filter((item) => item.type === "warning").map((item) => item.message)
  const diagrams = await extractDocxPlantUml(bytes).catch((err: unknown) => {
    warnings.push(`PlantUML image extraction failed: ${err instanceof Error ? err.message : String(err)}`)
    return undefined
  })
  if (diagrams) {
    warnings.push(...diagrams.warnings)
    if (diagrams.truncated) warnings.push("Embedded PlantUML extraction was truncated by safety limits.")
  }
  const note = warnings.length > 0 ? `\n\n(DOCX extraction warnings: ${warnings.join("; ")})` : ""
  const sources =
    diagrams?.diagrams
      .map((diagram) => `\n\n[Embedded PlantUML diagram: ${diagram.mediaPath}]\n${diagram.source}`)
      .join("") ?? ""
  return Readable.from([result.value + sources + note])
}
