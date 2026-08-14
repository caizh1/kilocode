import { describe, expect, it } from "bun:test"
import { formatDocumentDiagnosticReport } from "../../src/chipmate-provider/document-diagnostics"

describe("Document RAG 完整诊断", () => {
  it("导出分类汇总和全部文件错误", () => {
    const text = formatDocumentDiagnosticReport({
      runId: "run-1",
      startedAt: "2026-08-12T00:00:00.000Z",
      completedAt: "2026-08-12T00:01:00.000Z",
      issueSummary: [
        {
          category: "office-corrupt",
          count: 2,
          samples: [{ file: "one.docx", message: "Corrupted zip" }],
        },
      ],
      diagnostics: [
        {
          time: "2026-08-12T00:00:10.000Z",
          source: "documents",
          location: "documents:extract",
          category: "office-corrupt",
          file: "one.docx",
          message: "Corrupted zip",
        },
        {
          time: "2026-08-12T00:00:11.000Z",
          source: "documents",
          location: "documents:extract",
          category: "office-corrupt",
          file: "two.docx",
          message: "End of data reached",
        },
      ],
    })

    expect(text).toContain("Office 文件损坏 (office-corrupt): 2")
    expect(text).toContain("文件=one.docx")
    expect(text).toContain("文件=two.docx")
    expect(text.match(/documents:extract/g)).toHaveLength(2)
  })
})
