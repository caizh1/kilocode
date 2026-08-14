import type { DocumentDiagnosticReport, DocumentIssueSummary } from "@chipmate/sdk/v2/client"

type DocumentIssueCategory = DocumentIssueSummary["category"]

const categories: Record<DocumentIssueCategory, string> = {
  "extractor-runtime": "提取器运行时故障",
  "pdf-password": "PDF 密码保护",
  "pdf-invalid": "PDF 损坏或格式无效",
  "office-corrupt": "Office 文件损坏",
  "file-unavailable": "文件不可用",
  "extraction-safety-limit": "触发抽取安全限制",
  "extraction-unknown": "未分类抽取错误",
}

export function formatDocumentDiagnosticReport(report: DocumentDiagnosticReport): string {
  const lines = [
    "Document RAG 完整诊断",
    `运行 ID: ${report.runId}`,
    `开始时间: ${report.startedAt}`,
    `完成时间: ${report.completedAt ?? "尚未完成"}`,
    `错误总数: ${report.diagnostics.length}`,
    "",
    "分类汇总:",
  ]
  for (const summary of report.issueSummary) {
    lines.push(`- ${categories[summary.category]} (${summary.category}): ${summary.count}`)
  }
  lines.push("", "完整错误:")
  for (const item of report.diagnostics) {
    const file = item.file ? ` 文件=${item.file}` : ""
    const category = item.category ? `${categories[item.category]} (${item.category})` : "未分类"
    lines.push(`- ${item.time} ${category} ${item.location}${file} - ${item.message}`)
  }
  return lines.join("\n")
}
