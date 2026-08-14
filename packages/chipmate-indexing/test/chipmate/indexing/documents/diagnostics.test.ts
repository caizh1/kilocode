import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import {
  classifyDocumentIssue,
  DocumentDiagnosticLedger,
  sanitizeDocumentDiagnostic,
} from "../../../../src/indexing/documents/diagnostics"

describe("Document RAG diagnostics", () => {
  test("classifies only explicit PDF password reports as password failures", () => {
    expect(classifyDocumentIssue(new Error("Command Line Error: Incorrect password"))).toBe("pdf-password")
    expect(classifyDocumentIssue(new Error("pdftotext failed with code 53"))).toBe("extraction-unknown")
    expect(classifyDocumentIssue(new Error("Invalid PDF: damaged xref table"))).toBe("pdf-invalid")
    expect(classifyDocumentIssue(new Error("Syntax Error: Couldn't find trailer dictionary"))).toBe("pdf-invalid")
  })

  test("classifies corrupt Office archives and unavailable files", () => {
    expect(classifyDocumentIssue(new Error("Corrupted zip: end of data reached"))).toBe("office-corrupt")
    expect(classifyDocumentIssue(Object.assign(new Error("missing"), { code: "ENOENT" }))).toBe("file-unavailable")
    expect(classifyDocumentIssue(new Error("archive extraction safety limit exceeded"))).toBe(
      "extraction-safety-limit",
    )
  })

  test("sanitizes credentials, ANSI and control characters within the 8 KiB bound", () => {
    const text = sanitizeDocumentDiagnostic(
      `\u001b[31mboom\u001b[0m token=secret-value https://user:pass@example.test/file?api_key=query-secret\u0000 ${"x".repeat(9000)}`,
    )
    expect(text).not.toContain("secret-value")
    expect(text).not.toContain("query-secret")
    expect(text).not.toContain(":pass@")
    expect(text).not.toContain("\u001b")
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(8 * 1024)
  })

  test("atomically persists every diagnostic while limiting only summary samples", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "chipmate-document-ledger-"))
    try {
      const ledger = new DocumentDiagnosticLedger(root, "/workspace")
      ledger.start("run-1")
      for (let index = 0; index < 7; index += 1) {
        ledger.add({
          location: "documents:extract",
          category: "office-corrupt",
          file: `/workspace/broken-${index}.docx`,
          message: "Corrupted zip",
        })
      }
      const report = await ledger.complete()
      const loaded = await ledger.read("run-1")

      expect(report?.diagnostics).toHaveLength(7)
      expect(report?.issueSummary).toEqual([
        expect.objectContaining({ category: "office-corrupt", count: 7, samples: expect.any(Array) }),
      ])
      expect(report?.issueSummary[0]?.samples).toHaveLength(3)
      expect(loaded).toEqual(report)
      expect(await ledger.read()).toEqual(report)
      expect(await ledger.read("../latest")).toBeUndefined()

      ledger.start("run-2")
      await ledger.complete()
      expect(await ledger.read("run-1")).toBeUndefined()
      expect((await ledger.read())?.runId).toBe("run-2")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
