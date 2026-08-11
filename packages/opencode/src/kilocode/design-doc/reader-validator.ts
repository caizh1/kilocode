import type { ValidationIssue } from "./domain"

const readerKeys = new Set([
  "title",
  "summary",
  "label",
  "text",
  "description",
  "businessMeaning",
  "trigger",
  "guard",
  "action",
  "condition",
  "reason",
])

const internal =
  /\b(?:Evidence Pack|WorkItem|DesignUnit)\b|topic-evidence-[a-z-]+|\bMOD-[a-f0-9]{20}\b|\bflow-(?:node|edge)\b|证据包|工作项|设计单元|内部流水线|代表性采样|已采样|采样证据/iu

export function validateReaderContent(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const [jsonPath, text] of readerTexts(value)) {
    if (text.includes("…")) {
      issues.push(issue("TRUNCATED_READER_TEXT", `面向读者的内容不得包含人为省略号：${jsonPath}`, jsonPath))
    }
    const match = text.match(internal)
    if (!match) continue
    issues.push(
      issue(
        "INTERNAL_PIPELINE_TERM",
        `面向读者的内容不得包含内部流水线术语“${match[0]}”：${jsonPath}`,
        jsonPath,
      ),
    )
  }
  return issues
}

function readerTexts(value: unknown) {
  const output: Array<readonly [jsonPath: string, text: string]> = []
  const visit = (current: unknown, jsonPath: string, key?: string) => {
    if (typeof current === "string") {
      if (key && readerKeys.has(key)) output.push([jsonPath, current])
      return
    }
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${jsonPath}[${index}]`, key))
      return
    }
    if (!current || typeof current !== "object") return
    for (const [childKey, child] of Object.entries(current)) {
      visit(child, `${jsonPath}.${childKey}`, childKey)
    }
  }
  visit(value, "$")
  return output
}

function issue(code: string, message: string, jsonPath: string): ValidationIssue {
  return {
    severity: "error",
    code,
    message,
    jsonPath,
    evidenceIDs: [],
    sourcePaths: [],
    retryable: true,
  }
}
