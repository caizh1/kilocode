import type * as Tool from "@/tool/tool"
import * as WorkflowGuard from "@/chipmate/skill/workflow-guard"

const ID = "source_backed_design_job"
const CONTROLLER_OWNED = new Set([
  "declare_artifact",
  "validate_mermaid_diagram",
  "render_mermaid_diagram",
  "save_mermaid_artifact",
  "insert_mermaid_into_word",
  "create_word_document",
  "inspect_word_document",
  "validate_word_document",
  "apply_word_document_edits",
  "apply_word_template_styles",
  "materialize_word_fields",
  "merge_word_documents",
  "diff_word_documents",
  "normalize_word_table_spec",
  "render_word_document",
])
const WORKER_OWNED = new Set([
  "apply_patch",
  "bash",
  "codebase_analysis",
  "document_search",
  "edit",
  "glob",
  "grep",
  "read",
  "semantic_search",
  "write",
])

export function filter(input: { tools: Tool.Def[]; sessionID: string; messages: WorkflowGuard.Message[] }) {
  if (WorkflowGuard.sourceBacked(input.sessionID, input.messages)) {
    if (!WorkflowGuard.job(input.sessionID, input.messages)) return input.tools
    return input.tools.filter((tool) => !CONTROLLER_OWNED.has(tool.id) && !WORKER_OWNED.has(tool.id))
  }
  return input.tools.filter((tool) => tool.id !== ID)
}
