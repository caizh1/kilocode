// kilocode_change - new file
// Built-in skills that ship inside the CLI binary.
// Content is inlined at compile time via Bun's static import of .md files.
// Registered before all discovery phases so user skills with the same name override.

import KILO_CONFIG from "./kilo-config.md" with { type: "text" }
import CHIPMATE_CONFIG from "./chipmate-config.md" with { type: "text" }
import { ProductProfile } from "../product-profile"
import DOCUMENTS from "../../../../../.kilo/skills/documents/SKILL.md" with { type: "text" }
import SOURCE_BACKED_DETAIL_DESIGN from "../../../../../.kilo/skills/source-backed-detail-design/SKILL.md" with { type: "text" }
import SOURCE_BACKED_DETAIL_DESIGN_REF_01 from "../../../../../.kilo/skills/source-backed-detail-design/references/01-core-principles.md" with { type: "text" }
import SOURCE_BACKED_DETAIL_DESIGN_REF_02 from "../../../../../.kilo/skills/source-backed-detail-design/references/02-input-and-module-scope-rules.md" with { type: "text" }
import SOURCE_BACKED_DETAIL_DESIGN_REF_03 from "../../../../../.kilo/skills/source-backed-detail-design/references/03-source-exploration-rules.md" with { type: "text" }
import SOURCE_BACKED_DETAIL_DESIGN_REF_04 from "../../../../../.kilo/skills/source-backed-detail-design/references/04-control-flow-evidence-schema.md" with { type: "text" }
import SOURCE_BACKED_DETAIL_DESIGN_REF_05 from "../../../../../.kilo/skills/source-backed-detail-design/references/05-submodule-business-flow-rules.md" with { type: "text" }
import SOURCE_BACKED_DETAIL_DESIGN_REF_06 from "../../../../../.kilo/skills/source-backed-detail-design/references/06-state-machine-extraction-rules.md" with { type: "text" }
import SOURCE_BACKED_DETAIL_DESIGN_REF_07 from "../../../../../.kilo/skills/source-backed-detail-design/references/07-diagram-planning-and-splitting-rules.md" with { type: "text" }
import SOURCE_BACKED_DETAIL_DESIGN_REF_08 from "../../../../../.kilo/skills/source-backed-detail-design/references/08-mermaid-png-rendering-rules.md" with { type: "text" }
import SOURCE_BACKED_DETAIL_DESIGN_REF_09 from "../../../../../.kilo/skills/source-backed-detail-design/references/09-parent-module-assembly-rules.md" with { type: "text" }
import SOURCE_BACKED_DETAIL_DESIGN_REF_10 from "../../../../../.kilo/skills/source-backed-detail-design/references/10-detail-design-output-templates.md" with { type: "text" }
import SOURCE_BACKED_DETAIL_DESIGN_REF_11 from "../../../../../.kilo/skills/source-backed-detail-design/references/11-feature-diff-completeness-rules.md" with { type: "text" }
import SOURCE_BACKED_DETAIL_DESIGN_REF_12 from "../../../../../.kilo/skills/source-backed-detail-design/references/12-word-export-rules.md" with { type: "text" }
import SOURCE_BACKED_DETAIL_DESIGN_REF_13 from "../../../../../.kilo/skills/source-backed-detail-design/references/13-quality-gates-and-validator.md" with { type: "text" }
import SOURCE_BACKED_DETAIL_DESIGN_REF_14 from "../../../../../.kilo/skills/source-backed-detail-design/references/14-continuation-checkpoint-protocol.md" with { type: "text" }
import SOURCE_BACKED_DETAIL_DESIGN_REF_15 from "../../../../../.kilo/skills/source-backed-detail-design/references/15-business-flow-abstraction-rules.md" with { type: "text" }

export interface BuiltinSkill {
  name: string
  description: string
  content: string
  files?: Record<string, string>
}

export const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    name: "documents",
    description:
      "Create, inspect, edit, render, merge, diff, and manage Word .docx document artifacts with Kilo native tools, Mermaid PNG figures, and external render diagnostics. Use only when the user explicitly asks for document deliverables, not for ordinary code QA.",
    content: DOCUMENTS,
  },
  {
    name: "kilo-config",
    description: ProductProfile.chipmate
      ? "Safety guide for isolated ChipMate v2 configuration, storage, agents, skills, permissions, MCPs, and artifacts."
      : "Guide for Kilo configuration: config paths, kilo.json fields, commands, agents, skills, permissions, MCPs, providers, TUI settings, plus Agent Manager worktree setup/run scripts, workflows, and state. Use for Kilo config questions, locating loaded config, changing settings, or Agent Manager questions about run/setup scripts, worktree setup/workflows, apply/merge/PR/conflicts, missing sessions/worktrees, and agent-manager.json recovery.",
    content: ProductProfile.chipmate ? CHIPMATE_CONFIG : KILO_CONFIG,
  },
  {
    name: "source-backed-detail-design",
    description:
      "Generate or update source-backed detailed design documents with Kilo native code/document evidence tools, Mermaid PNG artifacts, generic Word docx output, and optional render diagnostics. Use only for explicit source-backed design deliverables, not ordinary QA.",
    content: SOURCE_BACKED_DETAIL_DESIGN,
    files: {
      "references/01-core-principles.md": SOURCE_BACKED_DETAIL_DESIGN_REF_01,
      "references/02-input-and-module-scope-rules.md": SOURCE_BACKED_DETAIL_DESIGN_REF_02,
      "references/03-source-exploration-rules.md": SOURCE_BACKED_DETAIL_DESIGN_REF_03,
      "references/04-control-flow-evidence-schema.md": SOURCE_BACKED_DETAIL_DESIGN_REF_04,
      "references/05-submodule-business-flow-rules.md": SOURCE_BACKED_DETAIL_DESIGN_REF_05,
      "references/06-state-machine-extraction-rules.md": SOURCE_BACKED_DETAIL_DESIGN_REF_06,
      "references/07-diagram-planning-and-splitting-rules.md": SOURCE_BACKED_DETAIL_DESIGN_REF_07,
      "references/08-mermaid-png-rendering-rules.md": SOURCE_BACKED_DETAIL_DESIGN_REF_08,
      "references/09-parent-module-assembly-rules.md": SOURCE_BACKED_DETAIL_DESIGN_REF_09,
      "references/10-detail-design-output-templates.md": SOURCE_BACKED_DETAIL_DESIGN_REF_10,
      "references/11-feature-diff-completeness-rules.md": SOURCE_BACKED_DETAIL_DESIGN_REF_11,
      "references/12-word-export-rules.md": SOURCE_BACKED_DETAIL_DESIGN_REF_12,
      "references/13-quality-gates-and-validator.md": SOURCE_BACKED_DETAIL_DESIGN_REF_13,
      "references/14-continuation-checkpoint-protocol.md": SOURCE_BACKED_DETAIL_DESIGN_REF_14,
      "references/15-business-flow-abstraction-rules.md": SOURCE_BACKED_DETAIL_DESIGN_REF_15,
    },
  },
]
