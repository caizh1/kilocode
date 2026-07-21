import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"

const repoRoot = path.resolve(import.meta.dir, "../..")

async function readSource(relativePath: string): Promise<string> {
  return fs.readFile(path.join(repoRoot, relativePath), "utf8")
}

describe("document tool routing boundary", () => {
  test("keeps generated document artifacts out of ordinary QA routing", async () => {
    const artifacts = await readSource("src/kilocode/tool/document-artifacts.ts")
    const word = await readSource("src/kilocode/tool/word-documents.ts")
    const mermaid = await readSource("src/kilocode/tool/mermaid-documents.ts")

    expect(artifacts).toContain("do not use for ordinary QA")
    expect(word).toContain("Use only when the user explicitly asks to generate a Word/docx deliverable")
    expect(word).toContain("not for general document QA; use document_search for indexed document questions")
    expect(word).toContain("Use only in explicit Word/document workflows; do not use for ordinary QA")
    expect(word).toContain("Delete operations should be dry-run first")
    expect(mermaid).toContain("does not decide business flow")
    expect(mermaid).toContain("not a code or document QA tool")
    expect(mermaid).toContain("does not replace Word or document_search QA")
  })

  test("keeps sidecar document tool failures as bounded tool results", async () => {
    const artifacts = await readSource("src/kilocode/tool/document-artifacts.ts")
    const word = await readSource("src/kilocode/tool/word-documents.ts")
    const mermaid = await readSource("src/kilocode/tool/mermaid-documents.ts")

    expect(artifacts).toContain("function artifactFailure")
    expect(artifacts).toContain("This generated-artifact sidecar operation failed")
    expect(artifacts).toContain("Kilo native QA, code understanding, and document_search are not replaced")

    expect(word).toContain("function wordFailure")
    expect(word).toContain("This Word sidecar operation failed")
    expect(word).toContain("Kilo native QA, code understanding, and document_search are not replaced")

    expect(mermaid).toContain("function mermaidFailure")
    expect(mermaid).toContain("This Mermaid sidecar operation failed")
    expect(mermaid).toContain("Kilo native QA, code understanding, and document_search are not replaced")
  })
})
