import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import { existsSync, readFileSync } from "node:fs"
import path from "path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const skillRoot = path.join(repoRoot, ".kilo/skills/source-backed-detail-design")
const documentRoot = path.join(
  repoRoot,
  "packages/opencode/test/kilocode/fixtures/source-backed-neutral-module",
)
const sourceFiles = [...new Bun.Glob("*.ts").scanSync({ cwd: documentRoot })].sort()
const documentFiles = new Set(sourceFiles.filter((file) => file !== "target.ts"))
const sources = new Map(sourceFiles.map((file) => [file, readFileSync(path.join(documentRoot, file), "utf8")]))
const oracle = deriveSourceOracle(sources)
const fsmDenominator = oracle.fsm
const complexityDenominator = oracle.complexity

describe("source-backed detail design skill migration boundary", () => {
  test("uses Kilo-native tools and keeps ChipMate runtime out of the migrated skill", async () => {
    const skill = await fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8")
    const allowedTools = frontmatterList(skill, "allowed-tools")

    expect(frontmatterValue(skill, "name")).toBe("source-backed-detail-design")
    expect(frontmatterValue(skill, "description")).toBe(
      "Generate or update source-backed detailed design documents with Kilo native code/document evidence tools, Mermaid PNG artifacts, Word docx output, and render diagnostics.",
    )
    expect(allowedTools).toEqual([
      "codebase_analysis",
      "semantic_search",
      "document_search",
      "read",
      "grep",
      "glob",
      "declare_artifact",
      "list_artifacts",
      "open_artifact",
      "export_artifact_diagnostics",
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
    expect(skill).toContain("codebase_analysis")
    expect(skill).toContain("semantic_search")
    expect(skill).toContain("document_search")
    expect(skill).toContain("render_mermaid_diagram")
    expect(skill).toContain("create_word_document")
    expect(skill).toContain("inspect_word_document")
    expect(skill).toContain("validate_word_document")
    expect(skill).toContain("render_word_document")
    expect(skill).toContain("Ordinary QA stays artifact-free")
    expect(allowedTools.some((tool) => tool.startsWith("chipmate_"))).toBe(false)
    expect(allowedTools).not.toContain("DesignDocAgentFlow")
  })

  test("ships the required source-backed reference set", async () => {
    const references = [
      "01-core-principles.md",
      "02-input-and-module-scope-rules.md",
      "03-source-exploration-rules.md",
      "04-control-flow-evidence-schema.md",
      "05-submodule-business-flow-rules.md",
      "06-state-machine-extraction-rules.md",
      "07-diagram-planning-and-splitting-rules.md",
      "08-mermaid-png-rendering-rules.md",
      "09-parent-module-assembly-rules.md",
      "10-detail-design-output-templates.md",
      "11-feature-diff-completeness-rules.md",
      "12-word-export-rules.md",
      "13-quality-gates-and-validator.md",
      "14-continuation-checkpoint-protocol.md",
      "15-business-flow-abstraction-rules.md",
    ]

    for (const reference of references) {
      const text = await fs.readFile(path.join(skillRoot, "references", reference), "utf8")
      expect(text.length).toBeGreaterThan(0)
      expect(text).not.toContain("chipmate_")
    }
  })

  test("keeps full-Word invariants visible after tool-output compaction", async () => {
    const skill = await fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8")
    const scope = await fs.readFile(path.join(skillRoot, "references", "02-input-and-module-scope-rules.md"), "utf8")
    const mermaid = await fs.readFile(path.join(skillRoot, "references", "08-mermaid-png-rendering-rules.md"), "utf8")
    const review = await fs.readFile(path.join(skillRoot, "references", "13-quality-gates-and-validator.md"), "utf8")
    const revision = (
      await Promise.all(
        ["07-diagram-planning-and-splitting-rules.md", "14-continuation-checkpoint-protocol.md"].map((file) =>
          fs.readFile(path.join(skillRoot, "references", file), "utf8"),
        ),
      )
    ).join("\n")
    const loaded = [
      '<skill_content name="source-backed-detail-design">',
      "# Skill: source-backed-detail-design",
      "",
      skill.trim(),
      "",
      `Base directory for this skill: ${skillRoot}`,
      "</skill_content>",
    ].join("\n")
    const compacted = loaded.slice(0, 2_000)

    expect(Buffer.byteLength(skill)).toBeLessThanOrEqual(36_000)
    expect(Buffer.byteLength(loaded)).toBeLessThan(50 * 1024)
    for (const marker of [
      "SBDD_RULESET_REVISION=2026-07-source-semantic-v122",
      "root only",
      "task/agent_manager STOP",
      "target=deepest evidenced",
      "orchestrator!=child",
      "DesignUnits only actual implementations under target source root",
      "outside units=dependencies unless user expands scope",
      "map every target-dir implementation",
      "stateless/utility remains child",
      "zero unmapped",
      "Before units:scope+census",
      "D exact impl reads+D file greps",
      "EACH unit has 14 separate numbered headings+14 adjacent markers",
      "range/catch-all heading invalid",
      "No 07/08/MMD/figures",
      "14-business-flow-family-census.csv",
      "flowCensusStatus: PASS",
      "rows>=D",
      "every unit owns>=1 real family",
      "never request “继续”",
      "RESUME",
      "reload Skill+07+08",
      "read resume+review+batch units before ANY `04-diagrams` write",
      "freeze full `5D` rows",
      "source+edge ledgers→all batch MMD/claims write+read",
      "one v1 batch manifest",
      "one source-backed batch render",
      'semanticMode:"source-backed"',
      "`semanticEvidencePath`",
      "ordinary fallback invalid",
      "FIGURES",
      "documentReady=true",
      "FULL WORD",
      "3–5 turns",
      "only “继续”",
      "five views/unit",
    ]) {
      expect(compacted).toContain(marker)
    }
    expect(skill).toContain("grep symbols→targeted read")
    expect(skill).toContain("final DOCX")
    expect(skill).toContain("exactly one standalone `{{TOC}}`")
    expect(skill).toContain("Exact `A→B` proof")
    expect(skill).toContain("MMD→`sourceHash`→claim")
    expect(skill).toContain("split-required→overview+focus before next")
    expect(skill).toContain("no call quota/anchor ledger")
    expect(skill).toContain("tool-enforced 10 source-backed validations/4 renders")
    expect(skill).toContain("Data needs one-object producer+consumer evidence")
    expect(skill).toContain('semanticMode:"source-backed"')
    expect(skill).toContain("semanticEvidencePath")
    expect(skill).toContain("definition/include/order is not proof")
    expect(skill).toContain("minor whitespace/layout/wording is nonblocking")
    expect(skill).toContain("source discovery excludes them")
    expect(skill).toContain("ignore these paths even when the target-directory listing exposes them")
    expect(skill).toContain("No `...`/wildcards")
    expect(skill).toContain("At Word width reject overlap, crossings")
    expect(skill).toContain("ordinary Mermaid omits both fields")
    expect(skill).toContain("Architecture maps every child/shared object/input/output/egress")
    expect(skill).toContain("Chinese relation labels")
    expect(skill).toContain("Omission/deletion/overwrite STOP")
    expect(skill).toContain("An invalid/split batch is not a turn boundary")
    expect(skill).toContain("pendingSplitDetails.suggestedChildren")
    expect(skill).toContain("same suggested ID, parent, nodes and edges")
    expect(skill).toContain("`scopePath`=target source root, never one file in a full task")
    expect(skill).toContain("architecture `designUnitCensusPath`=canonical census")
    expect(skill).toContain("A `split-required` render is evidence-only")
    expect([skill, mermaid, review, revision].join("\n")).not.toContain(
      "SBDD_RULESET_REVISION=2026-07-source-semantic-v116",
    )
    expect(revision).toContain("SBDD_RULESET_REVISION=2026-07-source-semantic-v122")
    expect(mermaid).toContain("validated node and edge coverage is monotonic")
    expect(skill).toContain("Keep the full multi-unit workflow in the root session")
    expect(skill).toContain("do not use `task`, `agent_manager`")
    expect(skill).toContain("calls `declare_artifact` once")
    expect(skill).toContain("never invent a fixed reusable root")
    expect(skill).toContain(
      "`D` distinct exact implementation-file native `read` calls and `D` distinct file-targeted native `grep` calls",
    )
    expect(skill).toContain("figureBatchCount = min(3, max(1, ceil(D / 3)))")
    expect(skill).toContain("expectedTurnCount = 2 + figureBatchCount")
    expect(skill).toContain("It must never ask the user how to proceed")
    expect(skill).toContain("The root writes all frozen fourteen-topic unit files")
    expect(skill).toContain("shell `cat`/`grep`, bash")
    expect(skill).toContain("A narrow source-backed figure reads only `08`")
    expect(skill).toContain(
      "read `references/07-diagram-planning-and-splitting-rules.md` and then `references/08-mermaid-png-rendering-rules.md` before the first figure write",
    )
    expect(scope).toContain("design-unit-census.json")
    expect(mermaid).toContain("designUnitCensusPath")
    expect(mermaid).toContain("designUnitId")
    expect(mermaid).toContain('"targetDesignUnitId": "DU-TARGET"')
    expect(mermaid).toContain('"kind": "confirmed-submodule"')
    expect(review).toContain("恰好映射到一个可见 node claim")
    expect(skill).not.toContain("Narrow transaction: ONE TOOL CALL TOTAL/message")
    expect(skill).not.toContain("#2 FIRST target-symbol grep/no replacement")
  })

  test("requires Render Service QA, Word-fit splitting, and contradiction-free figure checkpoints", async () => {
    const skill = await fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8")
    const diagrams = await fs.readFile(
      path.join(skillRoot, "references/07-diagram-planning-and-splitting-rules.md"),
      "utf8",
    )
    const mermaid = await fs.readFile(
      path.join(skillRoot, "references/08-mermaid-png-rendering-rules.md"),
      "utf8",
    )
    const continuation = await fs.readFile(
      path.join(skillRoot, "references/14-continuation-checkpoint-protocol.md"),
      "utf8",
    )

    for (const text of [skill, diagrams, mermaid]) {
      expect(text).toContain("wordFitStatus")
      expect(text).toContain("documentReady")
      expect(text).toContain("split-required")
    }
    expect(skill).toContain("The root processes only the current frozen batch")
    expect(diagrams).toContain("单个 DesignUnit 完成不是用户响应边界")
    expect(mermaid).toContain("serviceBasicQaDiagramIdSet")
    expect(mermaid).toContain("serviceBasicQaDiagramCount = terminalDiagramIdSet.size")
    expect(mermaid).toContain("missingServiceBasicQaCount = 0")
    expect(mermaid).toContain("contentCropRatio >= 0.2")
    expect(mermaid).toContain("font-safe words instead of emoji")
    expect(mermaid).toContain("unexplained one-letter node or edge labels")
    expect(mermaid).toContain("pixelReviewStatus: unavailable")
    expect(mermaid).toContain("qaLevel: render-service-basic")
    expect(mermaid).toContain("Probe renders, rejected layouts, old paths")
    expect(mermaid).toContain("Never render batch items in parallel or use batch mode for ordinary Mermaid")
    expect(mermaid).toContain("uniqueTerminalPngSha256Count")
    expect(mermaid).toContain("duplicateTerminalPngHashCount = renderOutputPathCollisionCount = 0")
    expect(diagrams).toContain("architectureBaseConfirmedNameSet = frozenConfirmedSubmoduleNameSet")
    expect(diagrams).toContain("missingOverviewSemanticItemCount = foreignOverviewSubstitutionCount = 0")
    expect(diagrams).toContain("renderAttemptCount <= 4")
    expect(diagrams).toContain("unmappedBaseSupportObjectCount = 0")
    expect(mermaid).toContain("a container ID used as an arrow endpoint")
    expect(mermaid).toContain("reject an empty or whitespace-only `subgraph` title")
    expect(mermaid).toContain("any outer-target cross-boundary edge")
    expect(mermaid).toContain("one single-line titled outer target container (`baseTargetContainerCount = 1`)")
    expect(mermaid).toContain(
      "target-owned entry, dispatcher/handoff, every confirmed submodule, every frozen evidenced support object, and one named egress",
    )
    expect(mermaid).toContain("External contract names stay in the egress")
    expect(mermaid).toContain("a focused external-interaction figure has no container")
    expect(mermaid).toContain("Never shorten, translate, normalize, or invent a source identifier or alias")
    expect(mermaid).toContain("Generic English role words")
    expect(mermaid).toContain("any internal subgraph in the base architecture overview")
    expect(mermaid).toContain("Each base node has exactly two visual lines")
    expect(mermaid).toContain("do not repeat transitive/secondary dependencies as dispatcher-to-all fanout")
    expect(mermaid).toContain("Minimal `~~~` invisible links may constrain layout only")
    expect(mermaid).toContain("never share one source as invisible fanout")
    expect(mermaid).toContain("perform a separate native `read` and audit that exact text")
    expect(mermaid).toContain("widthFit = 624 / width")
    expect(mermaid).toContain("heightFit = 720 / height")
    expect(mermaid).toContain("no arithmetic means failure")
    expect(mermaid).toContain("wordFitStatus=split-required")
    expect(mermaid).toContain("cannot count as a terminal base/focused figure or enter Word")
    expect(continuation).toContain("不得再次全库探索")
    expect(continuation).toContain("总数与完成状态只从 canonical ledgers/checkpoint 取得")
    expect(mermaid).toContain("Render Service parser success is authoritative")
    expect(diagrams).toContain("renderAttemptCount=4` 必须 `STOP_NOW`")
    expect(mermaid).toContain("at most four render attempts per claim path")
    expect(mermaid).toContain("On the fourth failed attempt, checkpoint and stop")
    expect(diagrams).toContain("Overview 不是目录图")
    expect(diagrams).toContain("五张基础图本身必须分别成为该 DesignUnit 的详细语义地图")
    expect(diagrams).toContain("拆图只能增加细节")
    expect(mermaid).toContain("missingBaseSemanticItemCount")
    expect(mermaid).toContain("removedRequiredSemanticItemCount = missingRequiredSemanticItemCount = 0")
    expect(mermaid).toContain("genericPlaceholderNodeCount")
    expect(mermaid).toContain("singleHappyPathOnlyCount")
    expect(mermaid).toContain("focusedOnlySemanticCount")
    expect(skill).toContain(
      "read `references/07-diagram-planning-and-splitting-rules.md` and then `references/08-mermaid-png-rendering-rules.md` before the first figure write",
    )
    expect(diagrams).toContain("flowchart TB")
    expect(mermaid).toContain("baseInternalSubgraphCount = baseNodeThirdLineCount = baseNodeCapacityOrParameterCount = directFanoutDuplicateEdgeCount")
    expect(mermaid).toContain("must not contain init/theme directives")
    expect(diagrams).toContain("远端语法失败也消耗一次")
    for (const field of [
      "postTargetEndNodeOrEdgeCount",
      "orphanConfirmedUnitCount",
      "duplicateConfirmedUnitPlacementCount",
      "baseInternalSubgraphCount",
      "baseNodeThirdLineCount",
      "directFanoutDuplicateEdgeCount",
      "targetOrchestratorMisclassifiedCount",
      "headerOnlySupportMisclassifiedCount",
      "layoutOnlyInvisibleFanoutCount",
    ]) {
      expect(diagrams).toContain(field)
    }
    expect(diagrams).toContain("sourceEvidenceCallCount = sourceCallLedgerRowCount = finalSourceCallOrdinal <= 8")
    expect(diagrams).toContain("02-source-evidence/source-call-ledger.md")
    expect(diagrams).toContain("Observed Anchor IDs")
    expect(diagrams).toContain("S<ordinal>A<n>=path:start[-end]@symbol-or-relation")
    expect(diagrams).toContain("directoryPseudoAnchorCount > 0")
    expect(diagrams).toContain(
      "unobservedLedgerAnchorCount = directoryPseudoAnchorCount = replacementTargetGrepCount = 0",
    )
    expect(diagrams).toContain("targetSymbolGrepCallCount = 1")
    expect(diagrams).toContain("replacementTargetGrepCount = 0")
    expect(diagrams).toContain("`oldString` 必须只等于唯一 sentinel")
    expect(diagrams).toContain("每个 assistant message 只能有一个 tool call")
    expect(diagrams).toContain("multiToolMessageViolationCount > 0")
    expect(diagrams).toContain("仅按 `03 → 07 → 08` 加载 reference")
    expect(diagrams).toContain("extraReferenceReadCount > 0")
    expect(diagrams).toContain("创建目录、写九列 ledger 表头+唯一 sentinel、执行 source call 1")
    expect(diagrams).toContain("multiReadBatchViolationCount = diagramChronologyViolationCount = 0")
    expect(diagrams).toContain("整批作废")
    expect(diagrams).toContain("call 1 是精确目标目录 read")
    expect(diagrams).toContain("call 2 是第一次出现的 target-scoped symbol grep 调用")
    expect(diagrams).toContain("sourceCallOrderViolationCount = 0")
    expect(diagrams).toContain("ledger 初始必须含唯一 `<!-- SBDD-APPEND-SOURCE-ROW -->`")
    expect(diagrams).toContain("下一条 tool call 只能独立 edit 该哨兵")
    expect(diagrams).toContain("空/失败以 `EMPTY`/`ERROR` 独占 slot")
    expect(diagrams).toContain("unledgeredSourceCallCount > 0")
    expect(diagrams).toContain("offSequenceSourceCallCount > 0")
    expect(diagrams).toContain("support/definition/platform header、parent read/glob 均禁止")
    expect(diagrams).toContain("#3 public header → #4 main impl → #5 one confirmed-submodule header")
    expect(diagrams).toContain("fullImplementationReadCount <= 2")
    expect(diagrams).toContain("reportedConfirmedSubmoduleNameSet = frozenConfirmedSubmoduleNameSet")
    expect(diagrams).toContain("maxBaseNodesPerVisualRank <= 3")
    expect(diagrams).toContain("actualVisualRankPlan = plannedVisualRankPlan")
    expect(diagrams).toContain("3 <= actualVisualRankCount <= 5")
    expect(diagrams).toContain("plannedVisualRankCount > 5")
    expect(diagrams).toContain("sourceLedgerReadIndex < semanticLedgerReadIndex < firstMmdWriteIndex < firstMmdReadIndex")
    expect(diagrams).toContain("mmdDeclaredNodeIdSet = semanticNodeIdSet")
    expect(diagrams).toContain("incidentVisibleEdgeCount >= 1")
    expect(diagrams).toContain('禁止 `A ~~~ NEW["..."]`')
    expect(diagrams).toContain("`EGRESS ~~~ OTHER` 明确失败")
    expect(diagrams).toContain("estimatedCssWidth <= 960")
    expect(diagrams).toContain("estimatedCssHeight <= 1107")
    expect(diagrams).toContain("publicHeaderReadCount <= 1")
    expect(diagrams).toContain("focusedSubmoduleHeaderReadCount <= 1")
    expect(diagrams).toContain("supportDefinitionPlatformHeaderReadCount = parentDirectoryReadCount = parentGlobCount = 0")
    expect(diagrams).toContain("parentScopedGrepCount >= 1 && parentScopedGrepCount <= 2")
    expect(diagrams).toContain("Anchor ID 映射随后永久不可变")
    expect(diagrams).toContain("edgeLedgerMutationAfterReadCount > 0")
    expect(diagrams).toContain("Observed Anchor ID(s) 单元格只能含裸 ID")
    expect(diagrams).toContain("diagramChronologyViolationCount")
    expect(diagrams).toContain("`READ source-call-ledger`")
    expect(diagrams).toContain("04-diagrams/visible-edge-evidence.md")
    expect(diagrams).toContain(
      "unreadEvidencePathCount = unobservedAnchorReferenceCount = anchorSemanticOverreachCount = endpointOnlyEdgeAnchorCount = 0",
    )
    expect(diagrams).toContain("边 anchor 的已记录含义必须明确包含 `source -> relationship -> target`")
    expect(diagrams).toContain("不能登记未成图的 support object")
    expect(diagrams).toContain("edgeEvidenceLedgerWritten = edgeEvidenceLedgerRead = true")
    expect(diagrams).toContain("visibleEdgeTripleSet = ledgerEdgeTripleSet")
    expect(diagrams).toContain("architectureBaseSupportObjectNameSet = evidencedSupportObjectNameSet")
    expect(diagrams).toContain("unmappedBaseSupportObjectCount = 0")
    expect(diagrams).toContain("不得通过删除 evidence-backed node/edge")
    expect(mermaid).toContain("File-name-only, symbol-only, or final-response counts are invalid")
    expect(mermaid).toContain("must not delete an evidence-backed node/edge")
    expect(diagrams).toContain("targetTitlePathCount = 0")
    expect(diagrams).toContain("layoutOnlyVisibleEdgeCount")
    expect(diagrams).toContain("inventedVisibleEdgeCount")
    expect(diagrams).toContain("visibleEdgeLineCount = visibleEdgeEvidenceRowCount")
    expect(diagrams).toContain("reversedVisibleEdgeForLayoutCount")
    expect(diagrams).toContain("layoutOnlyInvisibleLinkCount = layoutOnlyInvisibleLinkIds.size")
    expect(diagrams).toContain("每一条可见箭头行都必须写成带简洁语义标签的 `-->|<evidenced relation>|`")
    expect(diagrams).toContain("实际 MMD 必须出现一条从最后内部 terminal 到具名 egress 的 `LAST ~~~ EGRESS`")
    expect(diagrams).toContain("不能先渲染再靠第二次修正补 hard gate")
    expect(diagrams).toContain("三个或更多真实可见目标")
    expect(diagrams).toContain("egressTerminalVisualRank = true")
    expect(diagrams).toContain("unresolvedWideFanoutSourceCount = wastefulBaseLabelWhitespaceCount = 0")
    expect(mermaid).toContain("Plan at most three compact nodes in one rank")
    expect(diagrams).toContain("现有 `.mmd`、PNG、DOCX")
    expect(mermaid).toContain("Attempt two sets `firstPass: false` and then `STOP_NOW`")
    expect(skill).toContain("second failed render=`attempted_failed/STOP_NOW`")
    expect(mermaid).toContain("every visible arrow line must carry an evidenced relationship label")
    expect(mermaid).toContain("actual final layout-only chain whose last token is the named egress")
    expect(mermaid).toContain("correction repeats write→independent read→all hard gates→validate→render")
    expect(mermaid).toContain("The gate applies to Word, no-Word, image-only, narrow and calibration delivery")
    expect(mermaid).toContain("do not copy to a terminal PNG, declare an artifact, suggest completion, deliver a file")
    expect(mermaid).toContain("A narrow architecture task reads this reference only")
    expect(mermaid).toContain("one authoritative `.mmd`")
    expect(mermaid).toContain("claimEdgeCount = visibleMmdArrowLineCount")
    expect(mermaid).toContain("one arrow carrying several API names still has one edge claim")
    expect(mermaid).toContain("default module/resource/interface edges to `dependency`")
    expect(mermaid).toContain("An aggregated label naming several functions remains one evidenced `dependency` claim")
    expect(mermaid).toContain("requiredArchitectureNodeSet = target + confirmed children + evidenced shared objects")
    expect(mermaid).toContain("a bare API/function list is not a sufficient relationship label")
    expect(mermaid).toContain("reportedRequiredArchitectureOmissionCount > 0")
    expect(mermaid).toContain("claimSchemaErrorCount = missingClaimEvidenceCount")
    expect(mermaid).toContain("at most ten source-backed semantic validations")
    expect(mermaid).toContain("splitFromDiagramId")
    expect(skill).toContain("node/edge-ID union")
    expect(mermaid).toContain("never guess a range from a truncated full-file read")
    expect(mermaid).toContain("egressInsideTarget")
    expect(skill).toContain("raw inventories, and giant canvases are not detail")
    expect(skill).toContain("Only `documentReady=true` counts")
    expect(mermaid).toContain("Never use `bash`, a package manager, `npx`, `npm`, `bunx`, `pip`")
    expect(mermaid).toContain("Never report a requested task slug, fabricated timestamp directory")
    expect(skill).toContain("batchManifestPath")
    expect(skill).toContain("1–20 unique items")
    expect(skill).toContain("exactly once for that frozen batch")
    expect(skill).toContain("do not also pass `source` or `semanticEvidencePath`")
    expect(mermaid).toContain("repair-only batch")
    expect(mermaid).toContain("batchResultPath")
    expect(mermaid).toContain("Never render batch items in parallel or use batch mode for ordinary Mermaid")
    expect(continuation).toContain("五张基础图 semantic-set audit")
    expect(continuation).toContain("canonicalPhaseStatusMatchCount=1")
    expect(continuation).toContain("stalePhaseStatusCount=0")
    expect(continuation).toContain("staleRemainingCount=0")
    expect(continuation).toContain("没有平行的 Phase Progress 摘要")
  })

  test("requires fail-closed batch-audited prose before diagrams or Word", async () => {
    const skill = await fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8")
    const template = await fs.readFile(
      path.join(skillRoot, "references", "10-detail-design-output-templates.md"),
      "utf8",
    )
    const review = await fs.readFile(
      path.join(skillRoot, "references", "13-quality-gates-and-validator.md"),
      "utf8",
    )

    for (const marker of [
      "reference10Loaded: true",
      "The root writes all frozen fourteen-topic unit files",
      "make one native `read` tool call targeted at each saved file",
      "use one `grep` targeted at that same file",
      "a directory or recursive grep is invalid",
      "after every edit, separately re-read and re-grep that exact file",
      "after all frozen unit drafts exist",
      "only after every unit passes",
      "verifiedFile",
      "verifiedHeadingIds",
      "combinedHeadingMatchCount",
      "verifiedStatusMarkerIds",
      "separateReadToolCallCompleted",
    ]) {
      expect(skill).toContain(marker)
    }
    for (const file of [
      "references/07-diagram-planning-and-splitting-rules.md",
      "references/08-mermaid-png-rendering-rules.md",
      "references/09-parent-module-assembly-rules.md",
    ]) {
      expect(skill).toContain(file)
    }
    expect(skill).toContain("never guess filenames")
    expect(template).toContain("根会话可按冻结顺序先写完多个 unit 草稿")
    expect(template).toContain("shell `cat`/`grep`、write 返回和模型记忆均不能代替该审计")
    expect(template).toContain("write frozen unit drafts → for each unit: read → grep")
    expect(template).toContain("任何未独立 read+grep 的草稿仍为 `MISSING`")
    expect(template).toContain("不得仅凭头文件、目录列表、另一单元源码、模型记忆或常见实现模式起草")
    expect(template).toContain("preWriteImplementationReadCount")
    expect(template).toContain("unreadImplementationPathCount = 0")
    expect(template).toContain("一个宽泛证据 ID 不得自动支持十四个主题")
    expect(template).toContain("update one canonical resume checkpoint")
    expect(template).toContain("只有 topic `08`")
    for (const id of Array.from({ length: 14 }, (_, index) => String(index + 1).padStart(2, "0"))) {
      const topic = String(Number(id))
      expect(template).toMatch(new RegExp(`#### ${topic}\\. [^\\n]+\\nSBDD-TOPIC-STATUS: ${id} \\|`))
    }
    expect(review).toContain("单独 read 工具回读 → 独立 grep 标题和 status 行")
    expect(review).toContain("批量写完多个 unit 后")
    expect(review).toContain("模型自述、checkbox 或手写 review 表")
    expect(review).toContain("却计入 PASS")
    expect(review).toContain("topic 01–07/09–14 是否全部为解释性 PASS")
  })

  test("blocks the long-task false-pass regression and accepts a complete neutral case", async () => {
    const fixture = JSON.parse(
      await fs.readFile(
        path.join(
          repoRoot,
          "packages/opencode/test/kilocode/fixtures/source-backed-detail-design-long-task-regression.json",
        ),
        "utf8",
      ),
    ) as LongTaskRegressionFixture

    for (const item of [fixture.invalid, fixture.valid]) {
      expect(evaluateLongTask(item, fixture.requiredTopics)).toEqual(item.expected)
    }

    const scope = await fs.readFile(
      path.join(skillRoot, "references/02-input-and-module-scope-rules.md"),
      "utf8",
    )
    const diagrams = await fs.readFile(
      path.join(skillRoot, "references/07-diagram-planning-and-splitting-rules.md"),
      "utf8",
    )
    const word = await fs.readFile(path.join(skillRoot, "references/12-word-export-rules.md"), "utf8")
    const continuation = await fs.readFile(
      path.join(skillRoot, "references/14-continuation-checkpoint-protocol.md"),
      "utf8",
    )
    const combined = [scope, diagrams, word, continuation].join("\n")
    expect(combined).toContain("architecture decomposition names = confirmed census")
    expect(combined).toContain("expectedBaseSlots = 5D - evidencedStateMachineNaCount")
    expect(combined).toContain("duplicateDiagramIdCount = 0")
    expect(combined).toContain("placeholderParagraphIndex < firstHeading1ParagraphIndex")
    expect(combined).toContain("Title index < TOCHeading index < first Heading 1 index")
    expect(combined).toContain("重新加载 `source-backed-detail-design`")
  })

  test("rejects a shallow representative flow and requires flow-family edge and terminal closure", async () => {
    const fixture = JSON.parse(
      await fs.readFile(
        path.join(
          repoRoot,
          "packages/opencode/test/kilocode/fixtures/source-backed-detail-design-flow-family-regression.json",
        ),
        "utf8",
      ),
    ) as FlowFamilyRegressionFixture

    for (const item of fixture.cases) expect(evaluateFlowFamilies(item)).toEqual(item.expected)

    const skill = await fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8")
    const diagrams = await fs.readFile(
      path.join(skillRoot, "references/07-diagram-planning-and-splitting-rules.md"),
      "utf8",
    )
    const flows = await fs.readFile(
      path.join(skillRoot, "references/15-business-flow-abstraction-rules.md"),
      "utf8",
    )
    const word = await fs.readFile(path.join(skillRoot, "references/12-word-export-rules.md"), "utf8")
    const combined = [skill, diagrams, flows, word].join("\n")

    expect(combined).toContain("14-business-flow-family-census.csv")
    expect(combined).toContain("unmappedFlowFamilyCount = 0")
    expect(combined).toContain("missingBusinessEdgeCount = 0")
    expect(combined).toContain("missingAsyncHandoffCount = 0")
    expect(combined).toContain("missingBusinessTerminalCount = 0")
    expect(combined).toContain("flowCensusParseStatus=failed")
    expect(combined).toContain("Flow family IDs")
    expect(combined).toContain("Async handoff IDs")
    expect(combined).toContain("Terminal step IDs")
    expect(combined).toContain("代表性流程")
    expect(combined).toContain("not_started")
  })

  test("keeps a policy fixture boundary for embedded C detail-design delivery", async () => {
    const skill = await fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8")
    const discovery = await fs.readFile(path.join(skillRoot, "references/03-source-exploration-rules.md"), "utf8")
    const diagrams = await fs.readFile(
      path.join(skillRoot, "references/07-diagram-planning-and-splitting-rules.md"),
      "utf8",
    )
    const fixture = JSON.parse(
      await fs.readFile(
        path.join(repoRoot, "packages/opencode/test/kilocode/fixtures/source-backed-detail-design-policy.json"),
        "utf8",
      ),
    ) as {
      expectedNativeEvidenceTools: string[]
      expectedArtifactTools: string[]
      expectedOutputs: string[]
      expectedCapabilityGroups: string[]
      expectedOutline: string[]
      expectedUnitTopics: string[]
      diagramCoverageFixture: {
        targetUnits: number
        confirmedSubmodules: number
        stateMachineNa: number
        focusedFigures: number
        expectedBaseSlots: number
        expectedRequiredPngs: number
        designUnits: Array<{
          id: string
          kind: "target" | "confirmed_submodule"
          stateNaEvidenceIds?: string[]
          views: Record<"architecture" | "business" | "code" | "state" | "data", string>
        }>
      }
      discoverySignalFixture: {
        signals: Array<{
          id: string
          kind: string
          candidateId?: string
          disposition?: "evidenced_non_submodule"
          evidenceIds: string[]
        }>
        expectedSignalCount: number
        expectedMappedCount: number
        expectedNonSubmoduleCount: number
        expectedUnmappedCount: number
      }
      submoduleCandidateFixture: {
        candidates: Array<{
          id: string
          decision: "confirmed_submodule" | "excluded_non_submodule"
          signals: string[]
          decisionEvidenceIds?: string[]
          exclusionCounterEvidenceIds?: string[]
          designUnitId?: string
          exclusionReason?: string
          strongSignal?: boolean
        }>
        expectedCandidateCount: number
        expectedConfirmedCount: number
        expectedExcludedCount: number
        expectedUnmappedCount: number
      }
      complexitySignalFixture: {
        instances: Array<{
          id: string
          designUnitId: string
          kind: string
          evidenceIds: string[]
          requiredFigureKind: string
          diagramIds: string[]
          mergeReason?: string
        }>
        expectedMappedSignals: number
      }
      chapterPlacementFixture: {
        targetUnitChapters: number[]
        architectureChapter: number
        businessPrimaryChapter: number
        decompositionChapter: number
        implementationChapter: number
        submoduleChapter: number
        targetBusinessPrimaryInsertions: number
      }
      wordAcceptanceFixture: {
        baselineRelationshipIds: string[]
        skeletonRelationshipIds: string[]
        lateInsertedRelationshipIds: string[]
        replacedRelationshipIds: string[]
        removedRelationshipIds: string[]
        finalRelationshipIds: string[]
        maxParagraphs: number
        paragraphsTruncated: boolean
        tablesTruncated: boolean
        artifactStatus: "generated" | "failed"
        repairLoops: number
      }
      forbiddenRuntimeMarkers: string[]
      forbiddenContractMarkers: string[]
      forbiddenSampleMarkers: string[]
    }

    for (const tool of [...fixture.expectedNativeEvidenceTools, ...fixture.expectedArtifactTools]) {
      expect(skill).toContain(tool)
    }
    for (const output of fixture.expectedOutputs) {
      expect(output.length).toBeGreaterThan(0)
    }
    for (const group of fixture.expectedCapabilityGroups) {
      expect(skill).toContain(group)
    }
    ordered(skill, fixture.expectedOutline)
    ordered(skill, fixture.expectedUnitTopics)

    const units = fixture.diagramCoverageFixture.targetUnits + fixture.diagramCoverageFixture.confirmedSubmodules
    expect(units * 5).toBe(fixture.diagramCoverageFixture.expectedBaseSlots)
    expect(
      units * 5 - fixture.diagramCoverageFixture.stateMachineNa + fixture.diagramCoverageFixture.focusedFigures,
    ).toBe(fixture.diagramCoverageFixture.expectedRequiredPngs)
    expect(fixture.diagramCoverageFixture.designUnits).toHaveLength(units)
    expect(new Set(fixture.diagramCoverageFixture.designUnits.map((unit) => unit.id)).size).toBe(units)
    for (const unit of fixture.diagramCoverageFixture.designUnits) {
      expect(Object.keys(unit.views).sort()).toEqual(["architecture", "business", "code", "data", "state"])
      expect(unit.views.architecture.startsWith("DG-")).toBe(true)
      expect(unit.views.business.startsWith("DG-")).toBe(true)
      expect(unit.views.code.startsWith("DG-")).toBe(true)
      expect(unit.views.data.startsWith("DG-")).toBe(true)
      expect(unit.views.state === "N/A" || unit.views.state.startsWith("DG-")).toBe(true)
    }
    expect(
      fixture.diagramCoverageFixture.designUnits.flatMap((unit) => Object.values(unit.views)).filter((view) => view === "N/A"),
    ).toHaveLength(fixture.diagramCoverageFixture.stateMachineNa)
    expect(
      fixture.diagramCoverageFixture.designUnits
        .filter((unit) => unit.views.state === "N/A")
        .every((unit) => unit.stateNaEvidenceIds && unit.stateNaEvidenceIds.length > 0),
    ).toBe(true)
    const base = fixture.diagramCoverageFixture.designUnits
      .flatMap((unit) => Object.values(unit.views))
      .filter((view) => view !== "N/A")
    expect(new Set(base).size).toBe(base.length)
    expect(diagrams).toContain("`5D` 个基础槽位")
    expect(diagrams).toContain(
      "`requiredFigureCount = 5D - stateMachineNaCount + focusedFigureCount`",
    )

    const signals = fixture.discoverySignalFixture.signals
    const mapped = signals.filter((signal) => signal.candidateId)
    const closed = signals.filter((signal) => signal.disposition === "evidenced_non_submodule")
    const open = signals.filter((signal) => !signal.candidateId && signal.disposition !== "evidenced_non_submodule")
    expect(signals).toHaveLength(fixture.discoverySignalFixture.expectedSignalCount)
    expect(new Set(signals.map((signal) => signal.id)).size).toBe(signals.length)
    expect(mapped).toHaveLength(fixture.discoverySignalFixture.expectedMappedCount)
    expect(closed).toHaveLength(fixture.discoverySignalFixture.expectedNonSubmoduleCount)
    expect(open).toHaveLength(fixture.discoverySignalFixture.expectedUnmappedCount)
    expect(signals.every((signal) => signal.evidenceIds.length > 0)).toBe(true)
    expect(discovery).toContain("discoverySignalCount = mappedToCandidateSignalCount + evidencedNonSubmoduleSignalCount")
    expect(discovery).toContain("unmappedDiscoverySignalCount = 0")

    const policy = fixture as unknown as PolicyFixture
    expect(policy.discoverySurfaceFixture.surfaces).toHaveLength(
      policy.discoverySurfaceFixture.scopeRegions.length * policy.discoverySurfaceFixture.classes.length,
    )
    expect(new Set(policy.discoverySurfaceFixture.surfaces.map((surface) => surface.id)).size).toBe(
      policy.discoverySurfaceFixture.surfaces.length,
    )
    for (const region of policy.discoverySurfaceFixture.scopeRegions) {
      for (const kind of policy.discoverySurfaceFixture.classes) {
        expect(
          policy.discoverySurfaceFixture.surfaces.filter(
            (surface) => surface.scopeRegionId === region.id && surface.class === kind,
          ),
        ).toHaveLength(1)
      }
    }

    const candidates = fixture.submoduleCandidateFixture.candidates
    const confirmed = candidates.filter((candidate) => candidate.decision === "confirmed_submodule")
    const excluded = candidates.filter((candidate) => candidate.decision === "excluded_non_submodule")
    const unmapped = candidates.filter(
      (candidate) => candidate.decision !== "confirmed_submodule" && candidate.decision !== "excluded_non_submodule",
    )
    expect(candidates).toHaveLength(fixture.submoduleCandidateFixture.expectedCandidateCount)
    expect(new Set(candidates.map((candidate) => candidate.id)).size).toBe(candidates.length)
    expect(mapped.every((signal) => candidates.some((candidate) => candidate.id === signal.candidateId))).toBe(true)
    expect(candidates.every((candidate) => mapped.some((signal) => signal.candidateId === candidate.id))).toBe(true)
    expect(confirmed).toHaveLength(fixture.submoduleCandidateFixture.expectedConfirmedCount)
    expect(excluded).toHaveLength(fixture.submoduleCandidateFixture.expectedExcludedCount)
    expect(unmapped).toHaveLength(fixture.submoduleCandidateFixture.expectedUnmappedCount)
    expect(candidates.every((candidate) => candidate.id.length > 0 && candidate.signals.length > 0)).toBe(true)
    expect(
      candidates.every((candidate) =>
        candidate.signals.every((id) => mapped.some((signal) => signal.id === id && signal.candidateId === candidate.id)),
      ),
    ).toBe(true)
    expect(
      mapped.every((signal) => candidates.some((candidate) => candidate.id === signal.candidateId && candidate.signals.includes(signal.id))),
    ).toBe(true)
    expect(confirmed.every((candidate) => candidate.decisionEvidenceIds?.length && candidate.designUnitId)).toBe(true)
    expect(excluded.every((candidate) => candidate.exclusionReason?.length)).toBe(true)
    expect(excluded.every((candidate) => candidate.exclusionCounterEvidenceIds?.length)).toBe(true)
    expect(candidates.filter((candidate) => candidate.strongSignal).every((candidate) => candidate.decision === "confirmed_submodule")).toBe(true)
    expect(discovery).toContain("candidateCount = confirmedCount + excludedCount")
    expect(discovery).toContain("unmappedCandidateCount = 0")
    expect(skill).toContain("`confirmed_submodule` or evidenced `excluded_non_submodule`")
    expect(new Set(confirmed.map((candidate) => candidate.designUnitId)).size).toBe(confirmed.length)
    expect(new Set(confirmed.map((candidate) => candidate.designUnitId))).toEqual(
      new Set(fixture.diagramCoverageFixture.designUnits.filter((unit) => unit.kind === "confirmed_submodule").map((unit) => unit.id)),
    )

    const instances = fixture.complexitySignalFixture.instances
    expect(instances).toHaveLength(
      fixture.complexitySignalFixture.expectedMappedSignals,
    )
    expect(new Set(instances.map((instance) => instance.id)).size).toBe(instances.length)
    expect(instances.some((instance) => instance.kind === "full Word authoring chain")).toBe(true)
    expect(instances.some((instance) => instance.kind === "remote and mmdc fallback")).toBe(true)
    expect(instances.every((instance) => instance.evidenceIds.length > 0)).toBe(true)
    expect(instances.every((instance) => instance.diagramIds.length > 0)).toBe(true)
    const focused = instances.flatMap((instance) => instance.diagramIds)
    expect(new Set(focused).size).toBe(fixture.diagramCoverageFixture.focusedFigures)
    expect(new Set([...base, ...focused]).size).toBe(fixture.diagramCoverageFixture.expectedRequiredPngs)
    const primary = fixture.diagramCoverageFixture.designUnits.flatMap((unit) =>
      Object.entries(unit.views)
        .filter(([, diagram]) => diagram !== "N/A")
        .map(([view, diagram]) => ({
          diagram,
          png: `04-diagrams/png/${diagram}.png`,
          visible: `[${unit.id}/${view}/${diagram}]`,
        })),
    )
    const detail = [...new Map(
      instances.flatMap((instance) =>
        instance.diagramIds.map((diagram) => [diagram, {
          diagram,
          png: `04-diagrams/png/${diagram}.png`,
          visible: `[${instance.designUnitId}/${instance.requiredFigureKind}/${diagram}]`,
        }] as const),
      ),
    ).values()]
    const figures = [...primary, ...detail]
    expect(new Set(figures.map((figure) => figure.diagram)).size).toBe(figures.length)
    expect(new Set(figures.map((figure) => figure.png)).size).toBe(figures.length)
    expect(new Set(figures.map((figure) => figure.visible)).size).toBe(figures.length)
    expect(fixture.chapterPlacementFixture.targetUnitChapters).toEqual([4, 5, 6, 7, 8])
    expect(fixture.chapterPlacementFixture.architectureChapter).toBe(4)
    expect(fixture.chapterPlacementFixture.businessPrimaryChapter).toBe(6)
    expect(fixture.chapterPlacementFixture.decompositionChapter).toBe(7)
    expect(fixture.chapterPlacementFixture.implementationChapter).toBe(8)
    expect(fixture.chapterPlacementFixture.submoduleChapter).toBe(9)
    expect(fixture.chapterPlacementFixture.targetBusinessPrimaryInsertions).toBe(1)

    const word = fixture.wordAcceptanceFixture
    const expected = new Set([...word.baselineRelationshipIds, ...word.skeletonRelationshipIds, ...word.lateInsertedRelationshipIds])
    for (const id of word.removedRelationshipIds) expected.delete(id)
    expect(word.replacedRelationshipIds.every((id) => expected.has(id))).toBe(true)
    expect(new Set(word.finalRelationshipIds)).toEqual(expected)
    expect(word.finalRelationshipIds).toHaveLength(fixture.diagramCoverageFixture.expectedRequiredPngs)
    expect(word.maxParagraphs).toBe(1000)
    expect(word.paragraphsTruncated).toBe(false)
    expect(word.tablesTruncated).toBe(false)
    expect(word.artifactStatus).toBe("generated")
    expect(word.repairLoops).toBeGreaterThanOrEqual(1)
    expect(evaluatePolicy(policy)).toEqual({ status: "PASS", errors: [] })

    const files = await collectFiles(skillRoot)
    const combined = (await Promise.all(files.map((file) => fs.readFile(file, "utf8")))).join("\n")
    const allowedTools = frontmatterList(skill, "allowed-tools")
    for (const marker of fixture.forbiddenRuntimeMarkers) {
      expect(allowedTools).not.toContain(marker)
    }
    for (const marker of [
      ...fixture.forbiddenContractMarkers,
      ...fixture.forbiddenSampleMarkers.filter((item) => item !== "MP CP"),
    ]) {
      expect(combined).not.toContain(marker)
    }
  })

  test("derives acceptance from ledgers and rejects coverage mutations", async () => {
    const load = async () => JSON.parse(
      await fs.readFile(
        path.join(repoRoot, "packages/opencode/test/kilocode/fixtures/source-backed-detail-design-policy.json"),
        "utf8",
      ),
    ) as PolicyFixture
    const reject = async (code: string, mutate: (fixture: PolicyFixture) => void) => {
      const fixture = await load()
      mutate(fixture)
      const result = evaluatePolicy(fixture)
      expect(result.status).toBe("PARTIAL")
      expect(result.errors).toContain(code)
    }

    await reject("non-state-na", (fixture) => {
      fixture.diagramCoverageFixture.designUnits[0]!.views.architecture = "N/A"
    })
    await reject("fsm-audit-incomplete", (fixture) => {
      fixture.diagramCoverageFixture.designUnits.at(-1)!.fsmAudit.dimensions.stateReads = []
    })
    await reject("fsm-source-denominator-mismatch", (fixture) => {
      fixture.diagramCoverageFixture.designUnits[0]!.fsmAudit.decision = "PRESENT"
      fixture.diagramCoverageFixture.designUnits[0]!.views.state = "DG-TARGET-STATE"
    })
    await reject("discovery-surface-matrix", (fixture) => {
      fixture.discoverySurfaceFixture.surfaces.pop()
    })
    await reject("discovery-surface-open", (fixture) => {
      fixture.discoverySurfaceFixture.surfaces[0]!.truncated = true
      fixture.discoverySurfaceFixture.surfaces[0]!.continuationComplete = false
    })
    await reject("candidate-design-unit-bijection", (fixture) => {
      fixture.submoduleCandidateFixture.candidates[1]!.designUnitId = "DU-WORD"
    })
    await reject("source-denominator-mismatch", (fixture) => {
      fixture.submoduleCandidateFixture.candidates[0]!.sourceFile = undefined
    })
    await reject("complexity-diagram-missing", (fixture) => {
      fixture.complexitySignalFixture.instances[0]!.diagramIds = []
      fixture.complexitySignalFixture.instances[0]!.mergeReason = "Merged elsewhere"
    })
    await reject("complexity-source-denominator-mismatch", (fixture) => {
      fixture.complexitySignalFixture.instances.pop()
    })
    await reject("complexity-merge-invalid", (fixture) => {
      fixture.complexitySignalFixture.instances.at(-1)!.designUnitId = "DU-WORD"
    })
    await reject("acceptance-word-incomplete", (fixture) => {
      fixture.wordAcceptanceFixture.paragraphsTruncated = true
    })
    await reject("diagram-requirement-bijection", (fixture) => {
      fixture.diagramRequirementFixture.requirements.pop()
    })
    await reject("diagram-requirement-invalid", (fixture) => {
      fixture.diagramRequirementFixture.requirements[0]!.sourceEvidence = []
    })
    await reject("diagram-requirement-nonterminal", (fixture) => {
      fixture.diagramRequirementFixture.requirements[0]!.syntaxValidation = "failed"
    })
    await reject("diagram-requirement-nonterminal", (fixture) => {
      fixture.diagramRequirementFixture.requirements[0]!.renderDisposition = "attempted_failed"
    })
    await reject("diagram-requirement-nonterminal", (fixture) => {
      fixture.diagramRequirementFixture.requirements[0]!.visualQaStatus = "unreviewed"
    })
    await reject("diagram-requirement-nonterminal", (fixture) => {
      fixture.diagramRequirementFixture.requirements[0]!.wordInsertionStatus = "missing"
    })
    await reject("diagram-requirement-invalid", (fixture) => {
      fixture.diagramRequirementFixture.requirements[0]!.targetSection = "wrong-section"
    })
    await reject("diagram-requirement-duplicate", (fixture) => {
      fixture.diagramRequirementFixture.requirements[1]!.pngHash =
        fixture.diagramRequirementFixture.requirements[0]!.pngHash
    })
    await reject("diagram-requirement-invalid", (fixture) => {
      fixture.diagramRequirementFixture.requirements[0]!.mmdPath = "04-diagrams/placeholder.mmd"
    })
  })

  test("derives the FSM and complexity denominator from an independent neutral source fixture", () => {
    expect(oracle.fsm.size).toBe(4)
    expect(oracle.complexity).toHaveLength(11)
    const changed = new Map(sources)
    changed.set(
      "word.ts",
      `${changed.get("word.ts")}\n// @complexity SIG-012 | DU-WORD | code | cancellation-detail | cancelPendingEdit\nexport function cancelPendingEdit() { return "cancelled" }\n`,
    )
    const derived = deriveSourceOracle(changed)
    expect(derived.complexity).toHaveLength(12)
    expect(derived.complexity.at(-1)?.[0]).toBe("SIG-012")

    const persistent = readFileSync(path.join(documentRoot, "persistent-fsm.fixture.txt"), "utf8")
    const stateful = deriveSourceOracle(new Map([["persistent-fsm.ts", persistent]]))
    expect(stateful.fsm.get("DU-FSM")).toEqual({
      decision: "PRESENT",
      evidence: "SRC-ACTUAL-PERSISTENT-FSM",
    })
    expect(stateful.complexity).toEqual([
      ["SIG-FSM-001", "DU-FSM", "state", "transition-detail", "persistent-fsm.ts", "advance"],
    ])
  })

  test("covers full document, state-machine-only, update, and evidence coverage guidance", async () => {
    const skill = await fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8")
    const stateMachineRules = await fs.readFile(
      path.join(skillRoot, "references", "06-state-machine-extraction-rules.md"),
      "utf8",
    )
    const outputTemplate = await fs.readFile(
      path.join(skillRoot, "references", "10-detail-design-output-templates.md"),
      "utf8",
    )
    const diffRules = await fs.readFile(
      path.join(skillRoot, "references", "11-feature-diff-completeness-rules.md"),
      "utf8",
    )
    const qualityRules = await fs.readFile(
      path.join(skillRoot, "references", "13-quality-gates-and-validator.md"),
      "utf8",
    )
    const businessCoverageRules = await fs.readFile(
      path.join(skillRoot, "references", "15-business-flow-abstraction-rules.md"),
      "utf8",
    )

    expect(skill).toContain("Generate or update source-backed detailed design documents")
    expect(skill).toContain("enhanced-detail-design")
    expect(skill).toContain("Word docx")
    expect(skill).toContain("Use for explicit deliverables")
    expect(skill).toContain("apply_word_document_edits")
    expect(skill).toContain("diff_word_documents")
    expect(skill).toContain("not a ChipMate runtime pipeline")
    expect(skill).toContain("Ordinary QA stays artifact-free")
    expect(skill).toContain("Required Reference Loading")
    expect(skill).toContain("Content-first Work Package Order")
    expect(skill).toContain("Review Checklist")

    expect(stateMachineRules).toContain("dispatch")
    expect(stateMachineRules).toContain("state-overview")
    expect(stateMachineRules).toContain("transition-conditions")
    expect(outputTemplate).toContain("状态机章节必须引用")

    expect(diffRules).toContain("旧")
    expect(diffRules).toContain("差异")
    expect(qualityRules).toContain("Review Checklist")
    expect(qualityRules).toContain("不是 ChipMate 文档合同")
    expect(qualityRules).toContain("不要因为图没有 PNG")
    expect(businessCoverageRules).toContain("12-business-flow-edge-coverage.csv")
    expect(businessCoverageRules).toContain("13-business-text-coverage.csv")
    expect(businessCoverageRules).toContain("unverified")
  })

  test("keeps content depth in the main skill and phases required references for full Word delivery", async () => {
    const skill = await fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8")

    for (const heading of [
      "## Required Content",
      "## Prose Readiness Rule",
      "## Key Design Objects Rule",
      "## Interfaces and Collaboration Rule",
      "## Algorithms, Strategy, and Performance Rule",
      "## Evidence-backed State Machine Rule",
      "## New Maintainer Reading Rule",
      "## Design Unit Template",
    ]) {
      expect(skill).toContain(heading)
    }
    for (const reference of [
      "references/02-input-and-module-scope-rules.md",
      "references/03-source-exploration-rules.md",
      "references/10-detail-design-output-templates.md",
      "references/12-word-export-rules.md",
      "references/13-quality-gates-and-validator.md",
      "references/15-business-flow-abstraction-rules.md",
    ]) {
      expect(skill).toContain(reference)
    }
    ordered(skill, [
      "ordered DesignUnits",
      "The root writes all frozen fourteen-topic unit files",
      "figureBatchCount = min(3, max(1, ceil(D / 3)))",
      "Process only the next batch",
      "create bounded text-complete Word fragments",
      "materialize the sole TOC",
    ])
    expect(skill).toContain("A heading, one-line overview, function list, state list")
    expect(skill).toContain("distinctTopicHeadingCount = 14")
    expect(skill).toContain("headings such as `6-14`, `6/7/8`, `remaining topics`")
    expect(skill).toContain("current state, event or trigger, guard, transition action, next state")
    expect(skill).toContain("A one-line function table is incomplete")
  })

  test("separates context parents from the deepest source-confirmed target module", async () => {
    const fixture = JSON.parse(
      await fs.readFile(
        path.join(
          repoRoot,
          "packages/opencode/test/kilocode/fixtures/source-backed-detail-design-target-resolution.json",
        ),
        "utf8",
      ),
    ) as TargetResolutionFixture
    for (const item of fixture.cases) expect(resolveTarget(item)).toEqual(item.expected)

    const skill = await fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8")
    const scope = await fs.readFile(
      path.join(skillRoot, "references/02-input-and-module-scope-rules.md"),
      "utf8",
    )
    const diagrams = await fs.readFile(
      path.join(skillRoot, "references/07-diagram-planning-and-splitting-rules.md"),
      "utf8",
    )
    const word = await fs.readFile(path.join(skillRoot, "references/12-word-export-rules.md"), "utf8")
    const continuation = await fs.readFile(
      path.join(skillRoot, "references/14-continuation-checkpoint-protocol.md"),
      "utf8",
    )
    const combined = [skill, scope, diagrams, word, continuation].join("\n")

    expect(skill).toContain("## Target Resolution Rule")
    expect(skill).toContain("an evidenced ancestor/descendant chain")
    expect(skill).toContain("deepest, most specific member")
    expect(scope).toContain("deepest confirmed descendant")
    expect(scope).toContain("所属上级模块")
    expect(scope).toContain("唯一目标模块")
    expect(scope).toContain("目标内部确认子模块")
    expect(diagrams).toContain("`D = 1 + confirmedSubmoduleCount`")
    expect(diagrams).toContain("所属上级模块定位图不计入 `D`、`5D` 或 requiredFigureCount")
    expect(word).toContain("opening positioning section separates system architecture")
    expect(continuation).toContain("所属上级模块不进入 DesignUnit census")
    expect(continuation).toContain("目标仍需澄清时不得开始正文或 Word")
    expect(combined).not.toContain("the requested target module is the parent design unit")
    expect(combined).not.toContain("请求的目标模块就是承载这些内部子模块的父设计单元")
  })

  test("classifies partial chapters, list-only content, and missing views as incomplete", async () => {
    const fixture = JSON.parse(
      await fs.readFile(
        path.join(
          repoRoot,
          "packages/opencode/test/kilocode/fixtures/source-backed-detail-design-content-regression.json",
        ),
        "utf8",
      ),
    ) as ContentRegressionFixture
    const findings = evaluateContentRegression(fixture)

    expect(fixture.expectedStatus).toBe("PARTIAL")
    expect(findings).toEqual(fixture.expectedFindings)

    const review = await fs.readFile(
      path.join(skillRoot, "references/13-quality-gates-and-validator.md"),
      "utf8",
    )
    expect(review).toContain("确认子模块数量必须等于完整本地详细设计章节数量")
    expect(review).toContain("只有简介、函数名、状态名、结构体、字段、宏或阈值清单")
    expect(review).toContain("topic 01–07/09–14 为 `PASS`")
  })

  test("rejects unconsumed anchors and heading ranges without explanatory prose", async () => {
    const fixture = JSON.parse(
      await fs.readFile(
        path.join(
          repoRoot,
          "packages/opencode/test/kilocode/fixtures/source-backed-detail-design-word-body-regression.json",
        ),
        "utf8",
      ),
    ) as WordBodyRegressionFixture

    for (const item of fixture.cases) {
      const findings = evaluateWordBody(item, fixture.requiredTopics)
      expect(findings).toEqual(item.expectedFindings)
      expect(findings.length === 0 ? "PASS" : "MISSING").toBe(item.expectedStatus)
    }

    const skill = await fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8")
    const word = await fs.readFile(path.join(skillRoot, "references/12-word-export-rules.md"), "utf8")
    const review = await fs.readFile(
      path.join(skillRoot, "references/13-quality-gates-and-validator.md"),
      "utf8",
    )
    const combined = [skill, word, review].join("\n")
    expect(combined).toContain("[[SBDD-CONTENT:<designUnitId>:<topicId>]]")
    expect(combined).toContain("replace_paragraph_with_blocks")
    expect(skill).toContain("Word starts only after every prose and figure manifest passes")
    expect(combined).toContain("bodyless heading range")
    expect(combined).toContain("working DOCX")
    expect(combined).toContain("no DOCX path")
    expect(skill).toContain("Without a safe writing tool")
  })

  test("does not migrate ChipMate document-contract repair helpers", async () => {
    const files = await collectFiles(skillRoot)
    const relativeFiles = files.map((file) => path.relative(skillRoot, file).replaceAll(path.sep, "/"))

    expect(relativeFiles).not.toContain("scripts/validate_artifacts.mjs")
    expect(relativeFiles).not.toContain("scripts/manifest.json")

    const combined = (await Promise.all(files.map((file) => fs.readFile(file, "utf8")))).join("\n")
    for (const forbidden of [
      "nextToolContract",
      "missingDeliverable",
      "missing-required-artifact",
      "missing-mermaid-pngs",
      "validate_artifacts",
      "缺失文档合同规划",
      "先渲染缺失图表",
    ]) {
      expect(combined).not.toContain(forbidden)
    }
  })

  test("uses text-first Word assembly and existing Mermaid insertion tools without stale document APIs", async () => {
    const files = await collectFiles(skillRoot)
    const combined = (await Promise.all(files.map((file) => fs.readFile(file, "utf8")))).join("\n")

    expect(combined).toContain("CoverageSlot")
    expect(combined).toContain("DiagramRequirement")
    expect(combined).toContain("renderDisposition -> visualQaStatus -> wordInsertionStatus")
    expect(combined).toContain("[[SBDD-CONTENT:<designUnitId>:<topicId>]]")
    expect(combined).toContain("replace_paragraph_with_blocks")
    expect(combined).toContain('"wordPath": "<latest working DOCX path>"')
    expect(combined).toContain('"pngPath": "<pngPath returned by render_mermaid_diagram>"')
    expect(combined).toContain("only after all render transactions and prose readiness pass")
    expect(combined).toContain("reverse intended display order")
    expect(combined).toContain("inspect_word_document.imageCount")
    expect(combined).toContain("lateInsertedRelationshipIds")
    expect(combined).toContain("removedRelationshipIds")
    expect(combined).toContain("Pass the exact persisted PNG path")
    expect(combined).toContain("recovers the authoritative Mermaid source")
    expect(combined).toContain("[DU-<designUnitId>/<viewType>/<diagramId>]")

    for (const forbidden of [
      "start_word_document_draft",
      "append_word_document_sections",
      "finalize_word_document_draft",
      "WordDocSpec",
      "FigureSpec",
      "artifactPath",
      "sections[].figures[]",
    ]) {
      expect(combined).not.toContain(forbidden)
    }
  })

  test("requires five source-backed diagram views and explicit image/page visual review", async () => {
    const files = await collectFiles(skillRoot)
    const combined = (await Promise.all(files.map((file) => fs.readFile(file, "utf8")))).join("\n")
    const word = await fs.readFile(path.join(skillRoot, "references/12-word-export-rules.md"), "utf8")

    expect(combined).toContain(
      "| Target | Required | Required | Required | Required or evidenced `N/A` | Required |",
    )
    expect(combined).toContain(
      "| Every confirmed submodule | Required | Required | Required | Required or evidenced `N/A` | Required |",
    )
    expect(combined).not.toContain(
      "| Every important submodule | Required | Required | Required | Required or evidenced `N/A` | Required |",
    )
    expect(combined).not.toContain("每个重要子模块")
    expect(combined).toContain("不能因为它被归为非核心、辅助、平台相关、初始化相关或实现简单而省略")
    expect(combined).toContain("每个 confirmed candidate 与 target-owned DesignUnit 双射")
    expect(combined).toContain("candidateCount = confirmedCount + excludedCount")
    expect(combined).toContain("unmappedCandidateCount = 0")
    expect(combined).toContain("Caption-only entries, Mermaid source, ASCII, placeholders, repeated visuals")
    expect(combined).toContain("04-diagrams/coverage-slots.md")
    expect(combined).toContain("04-diagrams/diagram-requirements.md")
    expect(combined).toContain("rendered: false")
    expect(combined).toContain("uniqueSuccessfulDiagramIdCount = requiredFigureCount")
    expect(combined).toContain("uniqueSuccessfulDiagramIdCount = successfulRenderedItemCount = requiredFigureCount")
    expect(combined).toContain("Batch-call count is orchestration evidence only")
    expect(combined).toContain("remainingRequiredFigureCount")
    expect(combined).toContain("pendingRenderSlotCount")
    expect(combined).toContain("missingRenderedPngCount")
    expect(combined).toContain("completedFigureUnitIds")
    expect(combined).toContain("PASS（N/A）")
    expect(combined).toContain("`save_mermaid_artifact` success proves source persistence only")
    expect(combined).toContain("including a working skeleton")
    expect(combined).toContain("architecture: boundary")
    expect(combined).toContain("business flow: trigger")
    expect(combined).toContain("code flow: entry functions")
    expect(combined).toContain("state machine: states")
    expect(combined).toContain("data/lifecycle: create/init")
    expect(combined).toContain("Codex `standard_business_brief`")
    expect(combined).toContain("Render Service basic-QA transaction")
    expect(combined).toContain("optional `pixelReviewStatus`")
    expect(combined).toContain("no final artifact declaration")
    expect(combined).toContain("不使用节点数、边数或 subgraph 数量作为机械质量指标")
    expect(combined).toContain("complexity-sources.md")
    expect(combined).toContain("complexity-census.md")
    expect(combined).toContain("多入口（multi-entry）或多个独立业务流程族：每个入口/流程族各有实例")
    expect(combined).toContain("多个独立 FSM 域：每个域生成 state overview 和 transition detail")
    expect(combined).toContain("All mutations of one DOCX must be serialized")
    expect(word).toContain("every mutation uses the immediately returned path")
    expect(combined).toContain("`fieldRefreshStatus: completed`")
    expect(combined).toContain("diagramId -> baseOrFocused -> owningSlot -> complexityInstanceIds -> sourceEvidence")
    expect(combined).toContain("`imageCount` is only a coarse relationship count")
    expect(combined).toContain("Reconcile each actual drawing occurrence")
    expect(combined).toContain("headingPath")
    expect(combined).toContain("tocPageNumberCount")
    expect(combined).not.toContain("imageCount` to equal the ledger's total required rendered PNG count")
    expect(combined).toContain("qaLevel: render-service-basic")
    expect(combined).toContain("not human/model pixel review")
    expect(combined).toContain('tocMode: "materialize"')
    expect(combined).toContain("exactly one standalone `{{TOC}}` before Heading 1 `阅读路径`")
    expect(combined).toContain("no handwritten directory")
    expect(combined).toContain("exactly one Title-style paragraph")
    expect(combined).toContain("`阅读路径` as the first outline item")
    expect(combined).toContain("pass the path returned by each successful")
    expect(combined).toContain("`PARTIAL` is the unfinished task status")
    expect(combined).toContain("no Heading 1 named `目录`/`TOC`/`Contents`")
    expect(combined).toContain("evidenced FSM `N/A` must have no Diagram ID")
    expect(combined).toContain("generic `truncated: true` is also failure")
    expect(combined).toContain("`visualQaStatus: skipped`")
    expect(combined).toContain("`fieldRefreshStatus: failed`")
    expect(combined).toContain("`business-target-module-master-flow` 是 target DesignUnit")
    expect(combined).toContain("05-enhanced-detail-design/08-confirmed-submodules.md")
    expect(combined).not.toContain("05-enhanced-detail-design/08-submodule-business-flows.md")
    expect(combined).not.toContain("a concrete image/render blocker may leave a text-complete generated DOCX")
    expect(combined).not.toContain("generated + PARTIAL")
  })

  test("closes discovery, complexity, FSM, chapter, figure identity, and Word acceptance gaps", async () => {
    const skill = await fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8")
    const discovery = await fs.readFile(path.join(skillRoot, "references/03-source-exploration-rules.md"), "utf8")
    const fsm = await fs.readFile(path.join(skillRoot, "references/06-state-machine-extraction-rules.md"), "utf8")
    const diagrams = await fs.readFile(
      path.join(skillRoot, "references/07-diagram-planning-and-splitting-rules.md"),
      "utf8",
    )
    const mermaid = await fs.readFile(path.join(skillRoot, "references/08-mermaid-png-rendering-rules.md"), "utf8")
    const parent = await fs.readFile(path.join(skillRoot, "references/09-parent-module-assembly-rules.md"), "utf8")
    const template = await fs.readFile(path.join(skillRoot, "references/10-detail-design-output-templates.md"), "utf8")
    const word = await fs.readFile(path.join(skillRoot, "references/12-word-export-rules.md"), "utf8")
    const review = await fs.readFile(path.join(skillRoot, "references/13-quality-gates-and-validator.md"), "utf8")

    for (const text of [discovery, diagrams, review]) {
      expect(text).toContain("discoverySignalCount = mappedToCandidateSignalCount + evidencedNonSubmoduleSignalCount")
      expect(text).toContain("unmappedDiscoverySignalCount = 0")
    }
    expect(skill).not.toContain("discoverySignalCount = mappedToCandidateSignalCount + evidencedNonSubmoduleSignalCount")
    expect(discovery).toContain("DiscoverySignalId")
    expect(discovery).toContain("unmappedTargetCompilationUnitCount = 0")
    expect(discovery).toContain("callable/cross-file symbols")
    expect(discovery).toContain("“只被另一单元使用”只是依赖边")
    expect(discovery).toContain("exact alias/duplicate")
    expect(skill).toContain("unmappedTargetCompilationUnitCount = 0")
    expect(review).toContain("编译单元、发现信号与候选是否三重闭环")

    const schema =
      "diagramId -> baseOrFocused -> owningSlot -> complexityInstanceIds -> sourceEvidence -> mmdPath -> sourceStatus -> syntaxValidation -> semanticCoverage -> pngPath -> visibleFigureId -> targetSection -> renderDisposition -> visualQaStatus -> wordInsertionStatus"
    for (const text of [mermaid, word]) expect(text).toContain(schema)
    expect(skill).not.toContain(schema)
    expect(diagrams).toContain("Complexity instance IDs")
    expect(diagrams).toContain("Signal ID、DesignUnit ID、Kind、ComplexitySourceIds、Evidence IDs、Required view/figure kind、Diagram IDs、MergeGroupId、Merge reason、edge/transition/owner/variant coverage、Status")
    expect(diagrams).toContain("requiredFigureCount = 5D - stateMachineNaCount + focusedFigureCount")
    for (const text of [skill, diagrams]) expect(text).toContain("multi-entry")

    for (const text of [skill, fsm, review]) {
      expect(text).toContain("current state -> event/trigger -> guard/action -> next state")
      expect(text).toContain("opcode")
    }
    expect(fsm).toContain("Target module 和已确认子模块使用相同三态判定")

    expect(skill).toContain("Chapters 4 through 8 jointly form the target's continuous DesignUnit")
    expect(skill).toContain("Chapter 9 contains one continuous DesignUnit per confirmed submodule")
    for (const text of [parent, template]) expect(text).toContain("第 4 至第 8")
    expect(word).toContain("chapters 4 through 8 together form the target module DesignUnit")
    expect(parent).toContain("任一 source 或 PNG 失败立即保存续作点")
    expect(parent).toContain("停止后续 target/child 图与全部 Word 工作")
    expect(word).toContain("Any missing or duplicate unit")

    for (const text of [mermaid, word]) {
      expect(text).toContain('"figureTitle": "中文图题"')
      expect(text).toContain('"caption": "[DU-<designUnitId>/<viewType>/<diagramId>] 中文图注"')
      expect(text).not.toContain('"title": "[DU-')
      expect(text).not.toContain('"altText": "[DU-')
    }
    expect(skill).toContain("unique-ID captions, independent alt text, cropped dimensions")

    expect(skill).toContain("text-complete Word fragments")
    expect(word).toContain("text-only")
    expect(word).toContain("replacedRelationshipIds")
    expect(word).toContain("removedRelationshipIds")
    for (const text of [mermaid, word, review]) expect(text).toContain("maxParagraphs: 1000")
    for (const text of [word, review]) {
      expect(text).toContain("maxTables: 200")
      expect(text).toContain("paragraphsTruncated: false")
      expect(text).toContain("tablesTruncated: false")
      expect(text).toContain("serviceBasicPageQaStatus")
      expect(text).toContain("pixelReviewStatus")
      expect(text).toContain("pagePngPaths")
    }
    expect(skill).toContain("`PARTIAL` describes the unfinished task")
    expect(word).toContain("`PARTIAL` is the unfinished task status")
    expect(mermaid).toContain("acceptance remains `PARTIAL`")
    expect(review).toContain("acceptanceStatus` 才能为 `PASS`")
    expect(word).not.toContain("baselineImageCount + successfulNewImageInsertions - intentionallyRemovedBaselineImages")
    expect(word).toContain("no final artifact declaration")
  })

  test("preserves all non-contract capability families after chapter restructuring", async () => {
    const files = await collectFiles(skillRoot)
    const combined = (await Promise.all(files.map((file) => fs.readFile(file, "utf8")))).join("\n")

    for (const marker of [
      "候选源码范围评分",
      "SRC-0001",
      "08-diagram-edge-coverage.csv",
      "business-flow-steps",
      "Canonical Full-Document Outline",
      "Both、CodeOnly、DocOnly",
      "resume-state.md",
      "00-input/",
      "08-word-export/",
      "Build targets, module registration, initialization order",
    ]) {
      expect(combined).toContain(marker)
    }
  })

  test("keeps full and narrow deliverables on the same skill without broadening QA", async () => {
    const skill = await fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8")

    expect(skill).toContain("A full Word delivery")
    expect(skill).toContain("A single-chapter or single-submodule delivery")
    expect(skill).toContain("A state-machine-only delivery")
    expect(skill).toContain("An existing-document update")
    expect(skill).toContain("A source-versus-document difference report")
    expect(skill).toContain("A quick update")
    expect(skill).toContain("Do not expand a narrow request into a full Word deliverable")
    expect(skill).toContain("Ordinary QA stays artifact-free")
  })
})

type View = "architecture" | "business" | "code" | "state" | "data"
type ContentRegressionFixture = {
  confirmedDesignUnits: string[]
  requiredTopics: string[]
  chapters: Array<{
    designUnitId: string
    topics: string[]
    explanations: string[]
  }>
  views: Record<string, View[]>
  expectedStatus: "PARTIAL"
  expectedFindings: string[]
}
type WordBodyRegressionCase = {
  name: string
  designUnits: string[]
  completedUnits: string[]
  remainingAnchors: string[]
  topics?: Record<string, string[]>
  sections: Array<{
    heading: string
    unitId: string
    bodyKinds: Array<"explanatory-paragraph" | "code-explanation" | "list" | "table" | "image" | "caption">
  }>
  expectedStatus: "PASS" | "MISSING"
  expectedFindings: string[]
}
type WordBodyRegressionFixture = { requiredTopics: string[]; cases: WordBodyRegressionCase[] }
type FlowFamilyRegressionCase = {
  name: string
  flowFamilies: string[]
  businessEdges: string[]
  asyncHandoffs: string[]
  terminalSteps: string[]
  diagrams: Array<{
    id: string
    kind: "base" | "focused"
    png: string
    flowFamilies: string[]
    businessEdges: string[]
    asyncHandoffs: string[]
    terminalSteps: string[]
    navigatesTo: string[]
  }>
  claimedAcceptanceStatus: "PASS" | "PARTIAL"
  expected: {
    wordAllowed: boolean
    acceptanceStatus: "PASS" | "PARTIAL"
    findings: string[]
  }
}
type FlowFamilyRegressionFixture = { cases: FlowFamilyRegressionCase[] }
type LongTaskRegressionCase = {
  name: string
  expectedTarget: string
  actualTarget: string
  expectedContextParents: string[]
  actualContextParents: string[]
  confirmedUnits: string[]
  architectureUnits: string[]
  unitFiles: string[]
  detailedChapterUnits: string[]
  diagramLedgerUnits: string[]
  topics: Record<string, string[]>
  stateMachineNaCount: number
  diagrams: Array<{ id: string; unit: string; view: View; png: string }>
  toc: {
    titleIndex: number
    placeholderParagraphIndex: number
    tocHeadingIndex: number
    firstHeading1ParagraphIndex: number
  }
  claimedAcceptanceStatus: "PASS" | "PARTIAL"
  expected: {
    wordAllowed: boolean
    acceptanceStatus: "PASS" | "PARTIAL"
    findings: string[]
  }
}
type LongTaskRegressionFixture = {
  rulesetRevision: string
  requiredTopics: string[]
  invalid: LongTaskRegressionCase
  valid: LongTaskRegressionCase
}
type TargetResolutionResult = {
  status: "resolved" | "clarification_required"
  contextParents: string[]
  target: string | null
  reason:
    | "explicit-subject"
    | "single-named-module"
    | "deepest-confirmed-descendant"
    | "multiple-deepest-candidates"
    | "multiple-explicit-subjects-require-delivery-split"
}
type TargetResolutionCase = {
  name: string
  prompt: string
  explicitSubjects: string[]
  namedModules: string[]
  relations: Array<{ ancestor: string; descendant: string; evidenceIds: string[] }>
  expected: TargetResolutionResult
}
type TargetResolutionFixture = { cases: TargetResolutionCase[] }
type DesignUnitId = (typeof fsmDenominator extends Map<infer Key, unknown> ? Key : never)
type AuditDimension =
  | "stateStorageEnums"
  | "stateReads"
  | "stateWrites"
  | "eventsTriggers"
  | "dispatchHandlers"
  | "initialization"
  | "terminalErrorRecovery"

type PolicyFixture = {
  diagramCoverageFixture: {
    targetUnits: number
    confirmedSubmodules: number
    stateMachineNa: number
    focusedFigures: number
    expectedBaseSlots: number
    expectedRequiredPngs: number
    designUnits: Array<{
      id: DesignUnitId
      kind: "target" | "confirmed_submodule"
      views: Record<View, string>
      fsmAudit: {
        decision: "PRESENT" | "N/A" | "MISSING"
        dimensions: Record<AuditDimension, string[]>
        unresolvedStateCandidateIds: string[]
      }
      stateNaEvidenceIds?: string[]
    }>
  }
  discoverySurfaceFixture: {
    classes: string[]
    scopeRegions: Array<{ id: string; path: string }>
    surfaces: Array<{
      id: string
      scopeRegionId: string
      class: string
      queryScope: string
      queryExpression: string
      tool: string
      searchEvidenceIds: string[]
      hitIds: string[]
      zeroResultEvidenceIds: string[]
      truncated: boolean
      continuationComplete: boolean
      terminalStatus: "completed" | "missing"
    }>
  }
  discoverySignalFixture: {
    signals: Array<{
      id: string
      candidateId?: string
      disposition?: "evidenced_non_submodule"
      evidenceIds: string[]
    }>
  }
  submoduleCandidateFixture: {
    candidates: Array<{
      id: string
      decision: "confirmed_submodule" | "excluded_non_submodule"
      signals: string[]
      decisionEvidenceIds?: string[]
      exclusionCounterEvidenceIds?: string[]
      designUnitId?: string
      sourceFile?: string
    }>
  }
  complexitySignalFixture: {
    instances: Array<{
      id: string
      designUnitId: DesignUnitId
      evidenceIds: string[]
      requiredView: View
      requiredFigureKind: string
      diagramIds: string[]
      mergeGroupId?: string
      mergeReason?: string
      semanticCoverage: string[]
    }>
  }
  diagramRequirementFixture: {
    requirements: Array<{
      diagramId: string
      baseOrFocused: "base" | "focused"
      owningSlot: string
      complexityInstanceIds: string[]
      sourceEvidence: string[]
      mmdPath: string
      sourceHash: string
      sourceStatus: "semantic_validated" | "MISSING"
      syntaxValidation: "passed" | "failed"
      semanticCoverage: string[]
      pngPath: string
      pngHash: string
      visibleFigureId: string
      targetSection: string
      renderDisposition: "attempted_success" | "attempted_failed" | "not_attemptable"
      visualQaStatus: "passed" | "failed" | "unreviewed"
      wordInsertionStatus: "inserted" | "missing"
    }>
  }
  wordAcceptanceFixture: {
    baselineRelationshipIds: string[]
    skeletonRelationshipIds: string[]
    lateInsertedRelationshipIds: string[]
    replacedRelationshipIds: string[]
    removedRelationshipIds: string[]
    finalRelationshipIds: string[]
    maxParagraphs: number
    paragraphsTruncated: boolean
    tablesTruncated: boolean
    artifactStatus: "generated" | "failed"
  }
}

function evaluatePolicy(fixture: PolicyFixture) {
  const errors = new Set<string>()
  const diagram = fixture.diagramCoverageFixture
  const units = diagram.designUnits
  const unitIds = new Set(units.map((unit) => unit.id))
  const subunits = units.filter((unit) => unit.kind === "confirmed_submodule")
  const dimensions: AuditDimension[] = [
    "stateStorageEnums",
    "stateReads",
    "stateWrites",
    "eventsTriggers",
    "dispatchHandlers",
    "initialization",
    "terminalErrorRecovery",
  ]

  if (units.filter((unit) => unit.kind === "target").length !== 1 || unitIds.size !== units.length) {
    errors.add("design-unit-census")
  }
  if (units.length * 5 !== diagram.expectedBaseSlots) errors.add("base-slot-count")
  for (const unit of units) {
    const expected = fsmDenominator.get(unit.id)
    if (!expected || unit.fsmAudit.decision !== expected.decision || !unit.stateNaEvidenceIds?.includes(expected.evidence)) {
      errors.add("fsm-source-denominator-mismatch")
    }
    for (const view of ["architecture", "business", "code", "data"] as const) {
      if (!unit.views[view].startsWith("DG-")) errors.add("non-state-na")
    }
    if (dimensions.some((dimension) => unit.fsmAudit.dimensions[dimension].length === 0)) {
      errors.add("fsm-audit-incomplete")
    }
    if (unit.fsmAudit.unresolvedStateCandidateIds.length > 0 || unit.fsmAudit.decision === "MISSING") {
      errors.add("fsm-audit-incomplete")
    }
    if (unit.views.state === "N/A" && unit.fsmAudit.decision !== "N/A") errors.add("fsm-decision-mismatch")
    if (unit.views.state !== "N/A" && (!unit.views.state.startsWith("DG-") || unit.fsmAudit.decision !== "PRESENT")) {
      errors.add("fsm-decision-mismatch")
    }
  }
  const stateNa = units.filter((unit) => unit.views.state === "N/A").length
  if (stateNa !== diagram.stateMachineNa) errors.add("fsm-na-count")

  const discovery = fixture.discoverySurfaceFixture
  const surfaces = discovery.surfaces
  const surfaceIds = new Set(surfaces.map((surface) => surface.id))
  if (surfaceIds.size !== surfaces.length || surfaces.length !== discovery.scopeRegions.length * discovery.classes.length) {
    errors.add("discovery-surface-matrix")
  }
  for (const region of discovery.scopeRegions) {
    if (!existsSync(path.join(repoRoot, region.path))) errors.add("discovery-scope-missing")
    for (const kind of discovery.classes) {
      if (surfaces.filter((surface) => surface.scopeRegionId === region.id && surface.class === kind).length !== 1) {
        errors.add("discovery-surface-matrix")
      }
    }
  }
  for (const surface of surfaces) {
    const empty = surface.hitIds.length === 0 && surface.zeroResultEvidenceIds.length === 0
    if (
      surface.terminalStatus !== "completed" ||
      surface.searchEvidenceIds.length === 0 ||
      !surface.queryScope ||
      !surface.queryExpression ||
      !surface.tool ||
      empty ||
      (surface.truncated && !surface.continuationComplete)
    ) {
      errors.add("discovery-surface-open")
    }
  }

  const signals = fixture.discoverySignalFixture.signals
  const signalIds = new Set(signals.map((signal) => signal.id))
  const hitIds = surfaces.flatMap((surface) => surface.hitIds)
  if (signalIds.size !== signals.length || new Set(hitIds).size !== hitIds.length || !sameSet(signalIds, new Set(hitIds))) {
    errors.add("discovery-signal-closure")
  }
  if (signals.some((signal) => signal.evidenceIds.length === 0 || (!signal.candidateId && signal.disposition !== "evidenced_non_submodule"))) {
    errors.add("discovery-signal-closure")
  }

  const candidates = fixture.submoduleCandidateFixture.candidates
  const candidateIds = new Set(candidates.map((candidate) => candidate.id))
  if (candidateIds.size !== candidates.length) errors.add("candidate-census")
  for (const candidate of candidates) {
    const mapped = signals.filter((signal) => signal.candidateId === candidate.id).map((signal) => signal.id)
    if (!sameSet(new Set(mapped), new Set(candidate.signals))) errors.add("candidate-signal-bijection")
    if (candidate.decision === "confirmed_submodule" && (!candidate.designUnitId || !candidate.decisionEvidenceIds?.length)) {
      errors.add("candidate-design-unit-bijection")
    }
    if (candidate.decision === "excluded_non_submodule" && !candidate.exclusionCounterEvidenceIds?.length) {
      errors.add("candidate-exclusion-evidence")
    }
  }
  if (signals.some((signal) => signal.candidateId && !candidateIds.has(signal.candidateId))) {
    errors.add("candidate-signal-bijection")
  }
  const confirmed = candidates.filter((candidate) => candidate.decision === "confirmed_submodule")
  const files = new Set(confirmed.flatMap((candidate) => candidate.sourceFile ? [candidate.sourceFile] : []))
  if (!sameSet(files, documentFiles)) errors.add("source-denominator-mismatch")
  const mappedUnits = confirmed.flatMap((candidate) => candidate.designUnitId ? [candidate.designUnitId] : [])
  if (new Set(mappedUnits).size !== mappedUnits.length || !sameSet(new Set(mappedUnits), new Set(subunits.map((unit) => unit.id)))) {
    errors.add("candidate-design-unit-bijection")
  }

  const base = units.flatMap((unit) => Object.values(unit.views).filter((id) => id !== "N/A"))
  if (new Set(base).size !== base.length) errors.add("base-diagram-unique")
  const instances = fixture.complexitySignalFixture.instances
  const expectedComplexityIds = new Set(complexityDenominator.map((item) => item[0]))
  if (!sameSet(new Set(instances.map((instance) => instance.id)), expectedComplexityIds)) {
    errors.add("complexity-source-denominator-mismatch")
  }
  for (const [id, unit, view, kind, file, token] of complexityDenominator) {
    const instance = instances.find((item) => item.id === id)
    if (
      !instance ||
      instance.designUnitId !== unit ||
      instance.requiredView !== view ||
      instance.requiredFigureKind !== kind ||
      !sources.get(file)?.includes(token)
    ) {
      errors.add("complexity-source-denominator-mismatch")
    }
  }
  if (new Set(instances.map((instance) => instance.id)).size !== instances.length) errors.add("complexity-instance-census")
  for (const instance of instances) {
    if (!unitIds.has(instance.designUnitId) || instance.evidenceIds.length === 0 || instance.semanticCoverage.length === 0) {
      errors.add("complexity-instance-census")
    }
    if (instance.diagramIds.length === 0) errors.add("complexity-diagram-missing")
  }
  const focused = new Set(instances.flatMap((instance) => instance.diagramIds))
  if (focused.size !== diagram.focusedFigures || [...focused].some((id) => base.includes(id))) {
    errors.add("focused-diagram-census")
  }
  for (const id of focused) {
    const owners = instances.filter((instance) => instance.diagramIds.includes(id))
    if (owners.length < 2) continue
    const first = owners[0]!
    const valid = owners.every(
      (instance) =>
        instance.designUnitId === first.designUnitId &&
        instance.requiredView === first.requiredView &&
        instance.requiredFigureKind === first.requiredFigureKind &&
        instance.mergeGroupId &&
        instance.mergeGroupId === first.mergeGroupId &&
        instance.mergeReason &&
        instance.semanticCoverage.length > 0,
    )
    if (!valid) errors.add("complexity-merge-invalid")
  }
  if (base.length + focused.size !== diagram.expectedRequiredPngs) errors.add("required-figure-count")

  const required = fixture.diagramRequirementFixture.requirements
  const expectedDiagrams = new Set([...base, ...focused])
  const requirementIds = new Set(required.map((item) => item.diagramId))
  if (requirementIds.size !== required.length || !sameSet(requirementIds, expectedDiagrams)) {
    errors.add("diagram-requirement-bijection")
  }
  const paths = new Set<string>()
  const hashes = new Set<string>()
  for (const item of required) {
    const owner = item.owningSlot.split(":")
    const unit = owner[0] as DesignUnitId | undefined
    const view = owner[1] as View | undefined
    const baseOwner = units.find((candidate) => candidate.id === unit && candidate.views[view!] === item.diagramId)
    const focusOwners = instances.filter((candidate) => candidate.diagramIds.includes(item.diagramId))
    const expectedSection = unit === "DU-TARGET" ? `target:${view}` : `submodule:${unit}`
    if (
      !unitIds.has(unit!) ||
      !view ||
      item.targetSection !== expectedSection ||
      item.visibleFigureId !== item.diagramId ||
      item.sourceEvidence.length === 0 ||
      item.semanticCoverage.length === 0 ||
      !item.mmdPath.endsWith(`${item.diagramId}.mmd`) ||
      !item.pngPath.endsWith(`${item.diagramId}.png`) ||
      !/^[a-f0-9]{64}$/.test(item.sourceHash) ||
      !/^[a-f0-9]{64}$/.test(item.pngHash) ||
      /^0{64}$/.test(item.sourceHash) ||
      /^0{64}$/.test(item.pngHash) ||
      /placeholder/i.test(`${item.mmdPath} ${item.pngPath}`)
    ) {
      errors.add("diagram-requirement-invalid")
    }
    if (paths.has(item.mmdPath) || paths.has(item.pngPath) || hashes.has(item.sourceHash) || hashes.has(item.pngHash)) {
      errors.add("diagram-requirement-duplicate")
    }
    paths.add(item.mmdPath)
    paths.add(item.pngPath)
    hashes.add(item.sourceHash)
    hashes.add(item.pngHash)
    if (
      item.sourceStatus !== "semantic_validated" ||
      item.syntaxValidation !== "passed" ||
      item.renderDisposition !== "attempted_success" ||
      item.visualQaStatus !== "passed" ||
      item.wordInsertionStatus !== "inserted"
    ) {
      errors.add("diagram-requirement-nonterminal")
    }
    if (item.baseOrFocused === "base" && (!baseOwner || item.complexityInstanceIds.length !== 0)) {
      errors.add("diagram-requirement-owner")
    }
    if (
      item.baseOrFocused === "focused" &&
      (focusOwners.length === 0 ||
        !focusOwners.every((candidate) => candidate.designUnitId === unit && candidate.requiredView === view) ||
        !sameSet(new Set(item.complexityInstanceIds), new Set(focusOwners.map((candidate) => candidate.id))))
    ) {
      errors.add("diagram-requirement-owner")
    }
  }

  const word = fixture.wordAcceptanceFixture
  const expected = new Set([...word.baselineRelationshipIds, ...word.skeletonRelationshipIds, ...word.lateInsertedRelationshipIds])
  for (const id of word.removedRelationshipIds) expected.delete(id)
  if (
    word.artifactStatus !== "generated" ||
    word.maxParagraphs !== 1000 ||
    word.paragraphsTruncated ||
    word.tablesTruncated ||
    !sameSet(expected, new Set(word.finalRelationshipIds)) ||
    word.finalRelationshipIds.length !== diagram.expectedRequiredPngs ||
    word.replacedRelationshipIds.some((id) => !expected.has(id))
  ) {
    errors.add("acceptance-word-incomplete")
  }

  return { status: errors.size === 0 ? "PASS" : "PARTIAL", errors: [...errors].sort() }
}

function evaluateContentRegression(fixture: ContentRegressionFixture) {
  const findings: string[] = []
  const chapters = new Map(fixture.chapters.map((chapter) => [chapter.designUnitId, chapter]))
  const topics = new Set(fixture.requiredTopics)
  const explanations = new Set([
    "functions",
    "objects",
    "interfaces",
    "lifecycle",
    "recovery",
    "transitions",
    "line-evidence",
  ])

  for (const unit of fixture.confirmedDesignUnits) {
    if (!chapters.has(unit)) findings.push(`missing-design-unit-chapter:${unit}`)
  }
  for (const unit of fixture.confirmedDesignUnits) {
    const chapter = chapters.get(unit)
    if (!chapter) continue
    if (!sameSet(new Set(chapter.topics), topics)) findings.push(`incomplete-content-topics:${unit}`)
    if (!sameSet(new Set(chapter.explanations), explanations)) findings.push(`list-only-content:${unit}`)
  }
  for (const unit of fixture.confirmedDesignUnits) {
    if (!sameSet(new Set(fixture.views[unit] ?? []), new Set<View>(["architecture", "business", "code", "state", "data"]))) {
      findings.push(`missing-five-view-coverage:${unit}`)
    }
  }
  return findings
}

function evaluateFlowFamilies(item: FlowFamilyRegressionCase) {
  const findings = new Set<string>()
  const ids = new Set(item.diagrams.map((diagram) => diagram.id))
  const pngs = new Set(item.diagrams.map((diagram) => diagram.png))
  const families = new Set(item.diagrams.flatMap((diagram) => diagram.flowFamilies))
  const edges = new Set(item.diagrams.flatMap((diagram) => diagram.businessEdges))
  const handoffs = new Set(item.diagrams.flatMap((diagram) => diagram.asyncHandoffs))
  const terminals = new Set(item.diagrams.flatMap((diagram) => diagram.terminalSteps))
  const base = item.diagrams.find((diagram) => diagram.kind === "base")

  if (!sameSet(families, new Set(item.flowFamilies))) findings.add("unmapped-flow-family")
  if (!sameSet(edges, new Set(item.businessEdges))) findings.add("missing-business-edge")
  if (!sameSet(handoffs, new Set(item.asyncHandoffs))) findings.add("missing-async-handoff")
  if (!sameSet(terminals, new Set(item.terminalSteps))) findings.add("missing-business-terminal")
  if (ids.size !== item.diagrams.length || pngs.size !== item.diagrams.length) findings.add("duplicate-business-diagram")

  const reachable = new Set(base?.flowFamilies ?? [])
  for (const id of base?.navigatesTo ?? []) {
    const target = item.diagrams.find((diagram) => diagram.id === id)
    if (!target) continue
    for (const family of target.flowFamilies) reachable.add(family)
  }
  if (!base || !sameSet(reachable, new Set(item.flowFamilies))) findings.add("master-flow-not-navigable")

  const list = [...findings]
  return {
    wordAllowed: list.length === 0,
    acceptanceStatus: list.length === 0 ? "PASS" as const : "PARTIAL" as const,
    findings: list,
  }
}

function evaluateLongTask(item: LongTaskRegressionCase, topics: string[]) {
  const findings: string[] = []
  const expected = new Set(item.confirmedUnits)
  const sets = [
    item.architectureUnits,
    item.unitFiles,
    item.detailedChapterUnits,
    item.diagramLedgerUnits,
  ]
  if (
    item.actualTarget !== item.expectedTarget ||
    !sameSet(new Set(item.actualContextParents), new Set(item.expectedContextParents))
  ) {
    findings.push("context-target-mismatch")
  }
  if (sets.some((units) => !sameSet(new Set(units), expected))) findings.push("design-unit-set-mismatch")
  if (!sameSet(new Set(item.unitFiles), expected)) findings.push("incomplete-unit-census")
  for (const unit of item.unitFiles) {
    if (sameSet(new Set(item.topics[unit] ?? []), new Set(topics))) continue
    findings.push(`incomplete-unit-topics:${unit}`)
  }

  const ids = item.diagrams.map((diagram) => diagram.id)
  const slots = new Set(item.diagrams.map((diagram) => `${diagram.unit}:${diagram.view}`))
  const expectedBaseSlots = item.confirmedUnits.length * 5 - item.stateMachineNaCount
  if (slots.size !== expectedBaseSlots) findings.push("missing-diagram-slots")
  if (new Set(ids).size !== ids.length) findings.push("duplicate-diagram-id")
  if (item.toc.placeholderParagraphIndex >= item.toc.firstHeading1ParagraphIndex) {
    findings.push("toc-placeholder-after-first-heading")
  }
  if (
    item.toc.titleIndex >= item.toc.tocHeadingIndex ||
    item.toc.tocHeadingIndex >= item.toc.firstHeading1ParagraphIndex
  ) {
    findings.push("toc-heading-after-first-heading")
  }
  if (findings.length > 0 && item.claimedAcceptanceStatus === "PASS") findings.push("false-pass-claim")

  return {
    wordAllowed: findings.length === 0,
    acceptanceStatus: findings.length === 0 ? "PASS" : "PARTIAL",
    findings,
  }
}

function evaluateWordBody(item: WordBodyRegressionCase, topics: string[]) {
  const findings: string[] = []
  if (!sameSet(new Set(item.designUnits), new Set(item.completedUnits))) findings.push("incomplete-unit-census")
  if (item.remainingAnchors.length > 0) findings.push("unconsumed-content-anchor")
  if (item.topics) {
    for (const unit of item.designUnits) {
      if (sameSet(new Set(item.topics[unit] ?? []), new Set(topics))) continue
      findings.push(`incomplete-unit-topics:${unit}`)
    }
  }
  for (const section of item.sections) {
    if (section.bodyKinds.some((kind) => kind === "explanatory-paragraph" || kind === "code-explanation")) continue
    findings.push(`bodyless-heading:${section.heading}`)
  }
  return findings
}

function resolveTarget(item: TargetResolutionCase): TargetResolutionResult {
  if (item.explicitSubjects.length > 1) {
    return {
      status: "clarification_required",
      contextParents: [],
      target: null,
      reason: "multiple-explicit-subjects-require-delivery-split",
    }
  }
  if (item.explicitSubjects.length === 1) {
    return {
      status: "resolved",
      contextParents: ancestors(item.explicitSubjects[0]!, item.namedModules, item.relations),
      target: item.explicitSubjects[0]!,
      reason: "explicit-subject",
    }
  }
  if (item.namedModules.length === 1) {
    return {
      status: "resolved",
      contextParents: [],
      target: item.namedModules[0]!,
      reason: "single-named-module",
    }
  }

  const roots = item.namedModules.filter(
    (name) => !item.relations.some((relation) => relation.ancestor === name && item.namedModules.includes(relation.descendant)),
  )
  if (roots.length !== 1) {
    return {
      status: "clarification_required",
      contextParents: [],
      target: null,
      reason: "multiple-deepest-candidates",
    }
  }
  return {
    status: "resolved",
    contextParents: ancestors(roots[0]!, item.namedModules, item.relations),
    target: roots[0]!,
    reason: "deepest-confirmed-descendant",
  }
}

function ancestors(
  target: string,
  names: string[],
  relations: Array<{ ancestor: string; descendant: string; evidenceIds: string[] }>,
) {
  const result = new Set<string>()
  const queue = [target]
  for (const child of queue) {
    for (const relation of relations) {
      if (relation.descendant !== child || !names.includes(relation.ancestor) || result.has(relation.ancestor)) continue
      result.add(relation.ancestor)
      queue.push(relation.ancestor)
    }
  }
  return names.filter((name) => result.has(name))
}

function sameSet(left: Set<string>, right: Set<string>) {
  return left.size === right.size && [...left].every((value) => right.has(value))
}

function deriveSourceOracle(files: Map<string, string>) {
  const fsm = new Map<string, { decision: "PRESENT" | "N/A"; evidence: string }>()
  const complexity: Array<[string, string, View, string, string, string]> = []
  for (const [file, source] of files) {
    for (const match of source.matchAll(/@unit\s+([^|]+)\|\s*(PRESENT|N\/A)\s*\|\s*([^\r\n]+)/g)) {
      fsm.set(match[1]!.trim(), {
        decision: match[2]!.trim() as "PRESENT" | "N/A",
        evidence: match[3]!.trim(),
      })
    }
    for (const match of source.matchAll(
      /@complexity\s+([^|]+)\|\s*([^|]+)\|\s*(architecture|business|code|state|data)\s*\|\s*([^|]+)\|\s*([^\r\n]+)/g,
    )) {
      complexity.push([
        match[1]!.trim(),
        match[2]!.trim(),
        match[3]!.trim() as View,
        match[4]!.trim(),
        file,
        match[5]!.trim(),
      ])
    }
  }
  return { fsm, complexity }
}

function frontmatterList(text: string, key: string): string[] {
  const lines = text.split(/\r?\n/)
  const inline = lines.find((line) => line.startsWith(`${key}: [`))
  if (inline) {
    return inline
      .slice(inline.indexOf("[") + 1, inline.lastIndexOf("]"))
      .split(",")
      .map((item) => item.trim())
  }
  const start = lines.findIndex((line) => line.trim() === `${key}:`)
  if (start === -1) return []
  const items: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("  - ")) break
    items.push(line.slice(4).trim())
  }
  return items
}

function frontmatterValue(text: string, key: string): string | undefined {
  const match = text.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))
  return match?.[1]?.trim()
}

function ordered(text: string, items: string[]) {
  items.reduce((last, item) => {
    const next = text.indexOf(item, last + 1)
    expect(next).toBeGreaterThan(last)
    return next
  }, -1)
}

async function collectFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true })
  const result: string[] = []
  for (const entry of entries) {
    const file = path.join(root, entry.name)
    if (entry.isDirectory()) result.push(...(await collectFiles(file)))
    else if (entry.isFile()) result.push(file)
  }
  return result
}
