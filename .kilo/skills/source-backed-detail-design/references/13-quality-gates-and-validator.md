# 13 Review Checklist

For `SBDD_RULESET_REVISION=2026-07-source-semantic-v117`, only source-backed PNGs whose render result reports `wordFitStatus=readable` and `documentReady=true` pass figure review or image insertion. `split-required` remains evidence-only; readable replacement claims must follow `pendingSplitDetails.suggestedChildren`, keep the returned IDs and `splitFromDiagramId`, and close the returned node/edge union before another view. A split-required intermediate probe is evidence-only and does not become another required parent. The tool's calibrated minimum scale is `0.65`, matching the checks below.

本文件只提供源码驱动详细设计的人工 review 建议。它不是 ChipMate 文档合同，不是自动修复流水线，不是缺失图表渲染计划，也不是 Kilo QA 的触发条件。

不要迁移或调用旧的 artifact validator helper。Kilo 中的详细设计 skill 应依靠模型、Kilo 原生证据工具、通用 Word/Mermaid/artifact tools，以及人工可读的 review notes。

## 内容完整性优先

先审核正文，再审核图形数量和 Word 结构。确认子模块数量必须等于完整本地详细设计章节数量；目标模块和每个确认子模块的本地章节都必须覆盖十四项设计主题。以下任一情况都将对应设计单元记为 `PARTIAL` 或 `MISSING`，即使 DOCX、目录、图片数量和页面 PNG 均正常：

- 子模块分解已确认该单元，但没有连续的本地详细设计章节；
- 章节只有简介、函数名、状态名、结构体、字段、宏或阈值清单；
- 函数缺少职责、参数/返回、前后置条件、调用关系、副作用、错误/清理和证据；
- 对象缺少创建者、所有者、读写者、更新点、失效/释放和并发风险；
- 接口缺少调用双方、时机、同步性、前后置条件、状态/数据影响和失败行为；
- 算法或策略缺少目标、输入、规则、边界、失败路径、性能/资源影响和调优参数；
- 状态机缺少 `current state -> event/trigger -> guard -> action -> next state` 及其副作用；
- 业务流程缺少分支、等待/重试、失败恢复、终态、状态/数据变化和证据；
- 图形缺少图前问题、图后解读或源码证据；
- 文档承认上述缺口，却仍把完整交付声明为完成。
- 将多个 topic 写成 `6-14`、`6/7/8`、“其余主题”或一个 catch-all 小节，却将未独立出现的 topic 标记为 `PASS`。
- 批量写完多个 unit 后只凭模型自述、checkbox 或手写 review 表宣称正文通过，没有逐文件完成“单独 read 工具回读 → 独立 grep 标题和 status 行 → 必要时修复并重验 → 写 review-notes audit → 一次性更新 canonical resume checkpoint”；或把未审计草稿计入完成。
- status 行位于标题之前、与标题不相邻或 ID 不匹配；正文写明状态机为 `N/A`/不适用却计入 PASS；确认编译单元把 topic 01–07 或 09–14 标为 N/A；或没有实际调用独立 `read` 工具却手写 `read+grep verified`。
- 把有独立 build unit、配对接口/头文件和 callable symbols 的候选，仅因 stateless、utility/storage/adapter、shared、single caller 或“由另一单元管理”而排除；依赖关系不能冒充 alias/duplicate 证据。

每个确认候选必须与唯一 DesignUnit ID 和唯一连续章节对应。全局对象表、接口表、状态索引、函数索引、图片总数或跨模块汇总都不能替代该设计单元的本地正文。

## 建议检查项

- 源码范围是否清楚：用户原始名称、所属上级模块、目标模块、目标内部已确认子模块、同级/依赖、核心实现、边界和不负责内容是否分开写清，并有层级证据；内部范围字段是否没有泄漏到用户可见内容。
- 关系维度是否独立取证：系统架构位置、源码归属、所属上级模块、调用方/被调用方、数据/状态/控制权 handoff、依赖、协作、管理和资源所有权是否分别给出证据，没有从一种关系推导另一种关系。
- 关系描述是否自洽：目标所属的系统层是否没有同时被写成目标下游；所属上级模块是否没有被无证据写成业务上游或调用入口；调用关系是否没有冒充所有权；“管理”或“位于……之间”是否有直接证据，证据不足时是否标记“待确认”。
- 全文是否一致：术语表、范围映射、系统定位、模块分解、正文、接口表、架构图、流程图、图注、review notes 和结论中的角色名称与关系是否一致，且用户可见内容统一使用“所属上级模块”。
- 非 contract 能力是否保留：范围定位、源码/控制流证据、业务抽象、正文、图形、Word、旧文档差异和长任务续作是否按实际交付范围覆盖。
- 证据是否足够：关键结论是否引用源码位置、控制流、状态/数据读写、结构字段、配置路径、外部资源访问、现有文档或 owner-review 说明。
- 章节顺序是否正确：阅读路径、术语范围、系统架构定位与模块归属、目标角色、业务能力、详细主业务流程和内部架构分解是否先于代码流和状态机细节。
- 编译单元、发现信号与候选是否三重闭环：每个 target-owned 编译单元是否映射到 target orchestration、唯一候选、证据化 alias/duplicate owner 或严格限定的 generated/test/inactive non-submodule，并满足 `unmappedTargetCompilationUnitCount = 0`；C/C++ 的 `design-unit-census.json` 是否包含精确 `targetSourceRoot` 和实际实现路径全集，语义校验是否确认每个 `.c/.cc/.cpp/.cxx` 恰好映射一次，合法排除是否使用固定 reason、行级证据和必要 owner，而不是只自报计数；业务能力、接口、构建/注册、调用链、状态/事件、转换、资源所有权和错误恢复信号是否映射到候选或证据化 non-submodule；是否满足 `discoverySignalCount = mappedToCandidateSignalCount + evidencedNonSubmoduleSignalCount`、`unmappedDiscoverySignalCount = 0` 和 candidate 等式，并验证 ID 双向严格相等。独立实现/头文件、导出 API、专属转换或所有权等强信号候选若排除，是否逐项反证，而不是只写 helper/utility/storage/adapter、简单、无状态或 FSM-free 标签。
- 目标解析是否正确：用户明确主体是否优先；多个名称构成源码确认的祖先—后代链时，是否选择最深模块作为 target、把有证据的祖先保留为所属上级模块；同级或层级未知时是否先澄清而非任意选主体。
- 集合是否真正一致：架构分解名称、confirmed census、DesignUnit 文件、详细章节和五视图账本是否完全同集；是否拒绝“数量不变但用目标外部单元替换 target-owned 子模块”的伪闭环。
- 正文 readiness 是否可核查：完整 Word 是否先读取 reference `10`；每个冻结 unit 是否都有独立 `read`、后续独立 `grep`、必要的 repair/re-read/re-grep 和逐单元 review audit，之后才一次性更新 canonical resume checkpoint；resume 是否没有重复章节、陈旧 current/in-progress 或 completed/next 矛盾；是否记录 `separateReadToolCallCompleted: true`；是否恰有 ID `01`–`14` 的 14 个独立标题、紧随各标题的 14 条 `SBDD-TOPIC-STATUS` 和 14 个派生审核行；`verifiedHeadingIds` 与 `verifiedStatusMarkerIds` 是否均为 `01..14`；topic 01–07/09–14 是否全部为解释性 PASS、只有 topic 08 可证据化 N/A；是否满足 `topicPassCount + evidencedTopicNaCount = 14`、`missingTopicCount = 0`；任一缺失或手写验证声明是否保持 Word `not_started`。
- 设计单元是否完整：是否恰有一个 root target DesignUnit，每个 target-owned confirmed submodule 是否分别拥有简介、边界、输入输出、架构、业务、对象生命周期、函数/代码、状态、接口、异常、策略性能、构建集成、可观测性和证据缺口；所属上级模块是否被排除在 DesignUnit 外。
- 正文是否为解释而非清单：函数、对象、接口、状态转换、流程、策略和证据是否说明了语义、关系、副作用、异常和生命周期，而不是只列名称。
- 横向章节是否越权：全局对象、接口、状态、代码流或性能索引是否只总结跨模块关系，没有替代已确认子模块本地内容。
- 业务流程是否有解释：如果生成了业务图，图前简介、图后解读、关键步骤和异常路径是否可读。
- 业务流程族是否闭环：是否先建立 `14-business-flow-family-census.csv`，并满足 `unmappedFlowFamilyCount = 0`、`missingBusinessEdgeCount = 0`、`missingAsyncHandoffCount = 0`、`missingBusinessTerminalCount = 0`；target 主图是否覆盖或导航到全部流程族，而不是只画一个代表性子流程、组件拓扑或状态机。
- 主流程是否足够详细：影响业务结果的决策、跨单元/异步 handoff、等待/重试/超时/取消、失败/恢复/清理和全部终态是否都映射到可见 Diagram ID；总图不可读时是否拆出聚焦图而非删减分支。
- 代码流程是否有依据：如果生成了代码图，关键边是否能追溯到函数、分支、状态读写或调用关系。
- 状态机是否合适：目标和子模块是否都只在存在持久控制状态的 `current state -> event/trigger -> guard/action -> next state` 关系时生成状态机图；普通 opcode/command/type 分派、handler table、switch selector、结果/status 字段或数据/资源生命周期不能单独证明存在状态机。
- 构建与集成是否覆盖：构建目标、注册、初始化/清理顺序、feature flag、条件编译和平台差异是否在适用设计单元中说明。
- 范围变体是否守界：单章节、单子模块、状态机专项、差异报告或快速更新是否只生成请求范围，并披露跳过内容。
- 更新与差异是否可信：旧文档是否只作为线索，旧符号是否完成演进映射，Both/CodeOnly/DocOnly 是否有当前源码证据。
- 长任务是否可续：完整多子模块 Word 是否始终记录 `resume-state.md`、`continue-prompt.md` 和 `review-notes.md`，并从第一个未完成项继续；普通 QA 和窄范围短任务是否仍不被强制创建这些文件。
- Word 输出是否符合用户请求：如果用户要求完整 `.docx`，是否使用“正文 readiness → 纯文字 working skeleton → 精确锚点串行填充 → heading-body audit → 串行插图 → 字段物化 → inspection → render QA → `validate_word_document`”，并且只报告最终串行链返回且状态为 `valid` 或 `repaired` 的权威文件路径；`invalid` 不得交付。
- Word 封面是否有效：是否存在唯一且文本正确的 `Title`；Subtitle 是否根据本次范围与证据动态生成、非空、不等于“详细设计”、不重复标题且不是占位文字；默认作者是否为 `ChipMate source-backed-detail-design`，用户明确指定作者时是否正确覆盖；是否不存在模型自行生成的 Kilo/Kilo Code 作者变体；目录前是否存在简洁且有证据的范围、源码基线和证据状态说明，未知事实是否被省略或标记“待确认”。
- Word 前置结构是否完整：独立 `{{TOC}}` 是否是封面 summary 的最后一项并位于第一个 Heading 1“阅读路径”之前；字段物化后是否为第二页开始的 Word 原生 TOC 而不是 Normal 段落假目录；“阅读路径”是否仍为第一个 outline 项，且后续“术语、范围与证据基线”未被删除。
- TOC 顺序是否用索引验证：物化前是否满足 `placeholderParagraphIndex < firstHeading1ParagraphIndex`；物化后是否满足 `Title index < TOCHeading index < first Heading 1 index`，而不是只检查 TOC 文本存在。
- Word 冻结目录是否完整：纯文字 working skeleton 是否预先包含目标模块、全部确认子模块、最终 H3 和唯一 `[[SBDD-CONTENT:<designUnitId>:<topicId>]]` 普通段落；后续是否只用 `replace_paragraph_with_blocks` 精确消费这些锚点，没有使用 heading 插入或文末 append 绕过缺失项。
- Word 正文是否实际存在：插图前是否已确认剩余锚点、空标题和 bodyless heading range 均为零；图片、图题、图注、目录、列表、表格、清单或一句名称是否没有被计作解释性正文。
- Word 文件名是否稳定：创建、章节编辑和正文 audit 阶段是否使用明确的 `*-working.docx`；完成插图、样式和字段物化后是否才采用最终文件名，并避免连续 `-edited` 后缀或把 working 路径报告给用户。
- 大文档是否有界：首次创建是否排除了图片、长正文、大表格、长列表和代码正文；后续是否按一个主章节或已确认子模块的上限分批，且多图共用一个标题时是否按最终顺序逆序串行插入。
- 原生工具失败是否收敛：巨型调用是否缩减为纯文字骨架，失败章节是否继续按唯一 topic anchor 拆分；最小语义单元仍失败时是否保留 Markdown unit 和续作点且不交付 working DOCX，而不是创建第二条文档分支。
- 图形覆盖是否完整：覆盖账本是否只包含 target module 和每个 target-owned confirmed submodule 的 `5D` 基础槽位，所属上级模块是否未进入分母或冒充 base slot，状态机 `N/A` 是否有证据，重要性是否未排除子模块。
- 渲染事务是否完整：是否在渲染前满足 overview semantic-set 双向闭环；完整任务是否每个冻结批次只有一个回读过的 v1 batch manifest 和一次 source-backed batch render，result 的 item ID 集合是否与批次 required ID 集合相等；是否读取完整 `batchResultPath` 后才更新账本；每个 Diagram ID 是否 `renderAttemptCount <= 4` 且没有通过删语义追尺寸；是否满足成功 Diagram ID、terminal artifact path、PNG path、PNG SHA-256 四个唯一计数均等于 requiredFigureCount，`duplicateTerminalPngHashCount = renderOutputPathCollisionCount = 0`，并在单元结束后重新 hash 防止后写覆盖；是否拒绝代表性子模块或重复 PNG 冒充完整矩阵。
- 双重就绪是否成立：是否计算 `expectedBaseSlots = 5D - evidencedStateMachineNaCount`，记录 `completedFigureUnitIds/currentFigureUnitId/remainingFigureUnitIds`，且 `unassignedSlotIdCount = pendingRenderSlotCount = missingRenderedPngCount = remainingRequiredFigureCount = duplicateDiagramIdCount = 0`，流程族、业务边、handoff 和终态也零缺失；任一非零时 Word 是否保持 `not_started`。
- 语义拆图是否完整：base overview 是否是语义地图而非目录图；架构图是否逐名包含 confirmed submodule、边界、职责和依赖，业务/代码图是否保留全部 flow family、dispatch branch、async/wait、error/recovery 和 terminal 导航，生命周期图是否包含主要对象、所有权、读写、传递、失效和释放；focused 图是否没有被用来替代空壳 overview。每个复杂实例是否有唯一 Signal ID、证据和 diagram ID，且 `requiredFigureCount = 5D - stateMachineNaCount + focusedFigureCount`。
- 五类基础图是否各自足够详细：是否直接展示该视图所有适用的源码语义，而不是几个方框、单一 happy path、名称清单或目录链接；架构图的 `designUnitCensusPath` 是否指向冻结且回读过的 census，当前 DesignUnit 的每个直属确认子模块是否恰好映射到一个可见 node claim；是否满足 `missingBaseSemanticItemCount = genericPlaceholderNodeCount = singleHappyPathOnlyCount = focusedOnlySemanticCount = 0`；focused 图是否只增加局部细节，没有成为关键职责、分支、异常恢复、异步、状态转换或数据生命周期的唯一载体。
- Mermaid 布局预演是否完成：是否从首个 reference 起每消息只有一个 tool call，且按独立消息完成 `03 → 07 → 08 → mkdir → ledger write → source #1`，没有 `01`/其他 reference；`extraReferenceReadCount = multiToolMessageViolationCount = 0`，ledger 含九列表头和唯一 `<!-- SBDD-APPEND-SOURCE-ROW -->`；是否严格按 source call 1 精确目标目录、call 2 target symbol grep 取证；call #1 的 Observed Anchor IDs 是否字面为 `NONE`，没有 `@dir_listing`、`@file_exists` 或无 `:line` 伪锚点，`directoryPseudoAnchorCount = 0`；#2 是否就是第一次 target grep，结果后是否立即用 `oldString=sentinel` 落账，而未发出替代/更宽/header grep，`targetSymbolGrepCallCount = 1`、`replacementTargetGrepCount = 0`；每个源码调用（含零匹配/错误/定位/分页）的下一条 tool call 是否仅为独立 ledger edit，且 EMPTY/ERROR 独占 ordinal；每行是否当场冻结该结果实际显示的节点/接口与 `source -> relationship -> target` anchors，Anchor ID 是否永久不可变，后续是否仅使用裸 ID；目录列表和 grep miss 是否未被外推成关系；是否始终只 edit 唯一哨兵、`ledgerSentinelCount = 1`、`ledgerEditFailureCount = ledgerReadFallbackCount = shellLedgerMutationCount = 0`；是否满足 `unledgeredSourceCallCount = offSequenceSourceCallCount = unobservedLedgerAnchorCount = directoryPseudoAnchorCount = replacementTargetGrepCount = 0`、固定 slot 顺序成立、`sourceEvidenceCallCount = sourceCallLedgerRowCount = finalSourceCallOrdinal <= 8`、`sourceCallOrderViolationCount = 0`、`fullImplementationReadCount <= 2`、`publicHeaderReadCount <= 1`、`focusedSubmoduleHeaderReadCount <= 1`、`supportDefinitionPlatformHeaderReadCount = parentDirectoryReadCount = parentGlobCount = 0`、`parentScopedGrepCount >= 1 && parentScopedGrepCount <= 2`；目标 orchestration、header-only 文件和旧 artifact 是否未成为子模块/证据；#6 最大缺口实现与 #7 build-manifest grep 是否完成；`anchorRedefinitionCount = edgeLedgerMutationAfterReadCount = 0`；confirmed 与 support-object 集合是否闭合；layout plan 是否使用最多三个紧凑节点/rank 和两到三条 lane 首次预演 Word-fit，且 7–12 节点时严格为 3–5 ranks、未删 evidence-backed 语义。
- 首次成图约束是否成立：必需基础图是否白底且无 init/theme/style token；`visible-edge-evidence.md` 是否在 MMD 前真实写入并独立回读，每行是否具有 source、target、direction、kind、displayed label 和直接 `path:line`；初始及修正 MMD 是否各自独立回读并满足 `visibleEdgeTripleSet = ledgerEdgeTripleSet`、实际 rank 等于 layout plan、多终点存在结尾为具名 egress 的 literal `~~~` chain；入口、dispatcher、全部确认子模块、support objects 和 egress 是否都在唯一 outer target 内；最终 `end` 后是否无节点/边；每次 render 后是否在 copy/hash/declaration 前明写 CSS `624/width`、`720/height` 和三项 min，低于 `0.65` 时是否未声明完成；该阈值是否同样约束 no-Word/image-only/narrow/calibration；第四次失败后是否没有复制 terminal PNG、声明 artifact、完成建议或交付。
- 窄范围架构自检是否来自文件而非自述：原子 todo 是否分别包含且按顺序完成 `READ source ledger → WRITE/READ edge ledger → WRITE/READ MMD → preflight → validate → render`，没有合并 author/render；TOTAL seriality 是否满足且 `multiReadBatchViolationCount = diagramChronologyViolationCount = 0`；工具顺序是否满足 `sourceLedgerReadIndex < semanticLedgerReadIndex < firstMmdWriteIndex < firstMmdReadIndex`；每个节点/边是否引用 source-call ledger 中真实存在的 Observed Anchor ID，路径、行号和关系语义是否逐字闭合，`unreadEvidencePathCount = unobservedAnchorReferenceCount = anchorSemanticOverreachCount = 0`；是否达到 semantic-node/MMD exact set、每个 confirmed unit 可见证据边、edge triple/count 与 rank exact match、零反转；7–12 个节点是否只有 3–5 ranks；`~~~` 是否只连已声明节点且最右端为 `EGRESS`。任何迟到回读、未读路径、语义外推、六个稀疏 ranks、泛化节点、invisible-only 单元、批量读取、账本漏项或 exact-set 冲突必须在 validate/render 前失败，最终自报不能覆盖文件与工具历史。
- 根会话边界是否成立：普通 QA、窄图和完整 Word 是否都未调用 `task`/`agent_manager`；完整 `D > 1` Word 是否只处理冻结范围和当前 1–3-unit 批次、逐文件独立 read/grep、逐图串行 source-backed validate/render。任何委派、切换模型、固定根目录复用、并发图片写入或跨批次抢跑都使本轮在最终合并前失败。
- fragment 合并是否成立：target base 是否是唯一含 Title/Subtitle/author/`{{TOC}}` 的 fragment；每个 child/closing fragment 是否删除自身 cover且首块为冻结 Heading 1；是否只插入对应 `figure-result.json` 记录的 exact PNG；merge sources 是否严格为 base → frozen children → closing、`separatorHeading: false`；合并后 Title/TOC 是否各恰好一个且 source/DesignUnit/image counts 与结果 manifests 一致。
- 图片关系是否解释：新建纯文字 skeleton 的关系基线是否为空，是否记录 late inserted、replaced、actually removed 和 final relationship-ID set，并通过集合差异核对；是否避免把结构段落删除误当作关系删除，或把 replace 误当作新增；`inspect_word_document.imageCount` 是否只作为粗关系数使用。
- Word 写入是否串行：同一 DOCX 的每次编辑、插图、样式和字段操作是否都使用上一次成功返回的路径，是否避免从同一 sourcePath 并行产生会丢失内容的 sibling forks。
- 修复后结构是否仍完整：最终 outline、章节顺序、目标/子模块设计单元、横向收束章节、caption-only figure ID 和图片关系是否仍与计划一致；第 6 章目标业务主图是否只插入和计数一次；不得用 imageCount 掩盖丢章节、错图、孤立关系或重复图。
- 图形身份是否一致：每个 diagram ID 是否只在 caption 中使用一次可见的 `[DU-<designUnitId>/<viewType>/<diagramId>]` 标识，title 是否为普通中文图题，alt text 是否为完整说明；是否按每个实际 drawing occurrence 的 headingPath、caption、visible ID、alt text、relationship、media path 和 hash 与图账本逐项对账。
- 长文档 inspection 是否完整：是否使用 `maxParagraphs: 1000` 和 `maxTables: 200`，并分别确认 generic `truncated: false`、`paragraphsTruncated: false`、`tablesTruncated: false`；任一仍截断都不能证明结构或正文完整，必须提高范围重新检查或停止，不得用页面抽查替代结构证据。
- 源码图语义校验是否闭环：每个 terminal Diagram ID 是否有唯一 claim 文件、相同 MMD SHA-256、工作区内有效行证据和一一映射的 node/edge；validate/render 是否都显式使用 `semanticMode: "source-backed"` 与同一 `semanticEvidencePath`；是否不存在 `invalid`、未声明节点/边、反向调用、错误所有权、虚构符号或隐藏未知关系；普通 Mermaid 是否未启用该模式。
- Mermaid 基础 QA 是否完成：渲染前是否把 emoji、勾叉/状态图标、象形/装饰字符和无解释单字母标签改成明确的 font-safe 文字；是否仅从当前终态 `render_mermaid_diagram` 语义结果建立 `serviceBasicQaDiagramIdSet`，并与 `terminalDiagramIdSet` 严格相等，满足 `serviceBasicQaDiagramCount = terminalDiagramIdSet.size`、`missingServiceBasicQaCount = 0`。每行是否记录绝对 PNG 路径、render call ID、`rendered`、diagnostics/issues、CSS/pixel 尺寸、scale、content/crop bounds、padding、`contentCropRatio`、像素密度和 Word-fit；任一 error、缺元数据、比例低于 0.2、Word-fit 低于 0.65 或语义覆盖缺口是否在最多三次定点修正内解决，第四次仍失败时是否硬停止而未继续写图或渲染。模型是否能看图不属于内网阻塞条件。
- Mermaid 路径与依赖是否可信：是否只报告当前 render call 原样返回的 artifact/PNG 路径，未虚构时间戳、task slug、逻辑副本或猜测绝对路径；是否从返回的 CSS 尺寸立即计算 `wordFitScale`，低于 `0.65` 时没有宣称完成；工具失败后是否未通过 `bash`、`npx`、`npm`、`bunx`、`pip`、下载浏览器或临时脚本安装/创建替代 renderer。
- Word Render Service QA 是否完成：完整 Word 交付是否调用 `render_word_document`，并满足 `visualQaStatus: completed`、`pageEvidenceStatus: completed`、exact page count、`pagePngPaths` 完整且唯一、通过的 `textQa`、完成的 field refresh、有效 refreshed DOCX、TOC 计数一致，且不存在 blank/near-blank/page-summary/image-loss/invalid/duplicate/sequence/text-loss 等诊断。基础自动检查只能写成 `qaLevel: render-service-basic`；没有图像模型时 `pixelReviewStatus: unavailable`，不阻塞交付，也不得伪装成人工视觉 PASS。
- 状态是否分离：是否分别记录 `serviceBasicPageQaStatus`、可选 `pixelReviewStatus` 和 `acceptanceStatus`；是否逐项检查语义返回值而不是工具调用状态。`rendered: false`、`visualQaStatus: skipped`、text QA 失败、缺页或刷新失败都不能写成基础 QA 通过；仅缺视觉 provider 时允许在明确披露 QA 层级后交付。
- 字段刷新是否闭环：目录物化后是否要求 render 明确返回 `fieldRefreshStatus: completed`、有效 `refreshedDocxPath`，且 TOC heading/entry/page-number 数量相等；是否只把这个刷新文件作为权威 DOCX并重新检查标题、outline、TOC、drawing、关系和截断状态；`fieldRefreshStatus: failed`、普通格式转换或没有显式成功状态时，完整 Word 不得交付。
- Artifact 是否清晰：生成的 `.docx`、`.mmd`、`.png`、`.pdf`、诊断 JSON 等是否有路径、摘要和 warnings。

## Review 状态写法

需要记录状态时，用人工可读的 `PASS / PARTIAL / MISSING / N/A` 即可。`MISSING` 只表示该交付范围内缺少某项证据或产物，不应触发自动补图、自动合同规划或普通 QA 改道。

Target module 和每个 target-owned confirmed submodule 必须分别记录五类槽位状态。所属上级模块不记录强制槽位；其可选定位图不能为任何 DesignUnit 计数。全局汇总章节存在、图片总数正确或对象名称已列出，都不能单独使某个设计单元 `PASS`。一张图不能跨设计单元或视图重复计数。窄范围任务只评估声明范围内的单元，并把未请求内容标记为未纳入范围，而不是 `MISSING`。

在正文和 PNG 双门禁通过前，不得调用任何 Word 工具或声明 Word artifact；`*-working.docx`、skeleton、preview 和 continuation 不是例外。不得在 `PARTIAL` 回答中输出 working DOCX 路径。

完整交付只有在目标模块与全部确认子模块的十四项本地正文均闭合（topic 01–07/09–14 为 `PASS`，topic 08 为 `PASS` 或有证据的 `N/A`）、unit 数量与 census 相等、剩余正文锚点和 bodyless heading range 均为零、发现信号和候选全集均零未映射、流程 CSV 结构有效且流程族/业务边/终态均零缺失、全部 `5D` 槽位都为 `PASS` 或证据化状态机 `N/A`、FSM denominator 闭合、每个复杂度实例都映射到聚焦图、全部必需 PNG 已渲染/检查/插入、冻结目录与最终 outline 一致、inspection 未截断、关系集合一致、字段刷新成功且逐图逐页检查完成时，`acceptanceStatus` 才能为 `PASS`。证据化状态机 `N/A` 不得生成 Mermaid 或占位图。原生工具仍可用且有界尝试尚未失败时，必须继续第一个未完成项。任一完整 Word 门禁失败时不创建、声明或交付最终 DOCX；若工具已自动产生 working artifact manifest，只把它作为续作证据，不报告其路径，也不把用户侧状态升级为可交付。`PARTIAL` 只描述未完成任务，不授权交付完整 Word。这些只是 skill 内人工可读状态，不是普通 QA 错误。

## 明确禁止

- 不要因为图没有 PNG 就在普通 QA 或全局运行时自动启动补图流程；显式 Word 工作流中的关系数不一致必须先定位到具体缺失或多余插入，只有确认缺失时才复用对应已有 PNG 做局部修复。
- 不要因为 `.docx` 未生成就插入旧合同规划提示。
- 不要把 Word/Mermaid 参数写入临时 JSON 后用 shell 绕过原生工具，也不要安装或调用 `python-docx`、自建 Python/Node DOCX 生成器、Pandoc 或 shell LibreOffice/soffice 作为替代 authoring 路径。
- 不要在 `apply_word_document_edits` 中添加 image block，也不要在初始 working skeleton 中添加图片；正文 body audit 通过后，图片只能通过 `insert_mermaid_into_word` 定点插入。即使已有 `pngPath`，也必须传入工具要求的原始 `source`、当前 `wordPath`、唯一 heading、稳定 taskSlug/outputFile 和唯一可见 caption。
- 不要把 Mermaid 源码、ASCII 图、文本框或纯文字伪图当成缺失 PNG 的替代品。
- 不要在 skill disabled、skill permission denied、或普通代码 QA 场景中触发本 skill 的 review 文案。
- 不要把 Markdown 草稿、Mermaid 源码、Word 输出、render QA 绑定成不可拆分的合同。
- 不要把 review checklist 的 `MISSING` 当成 runtime error。
- 不要用 review checklist、章节缺失或旧新差异结果触发 classifier、skill loader、普通 QA 或全局工具循环变化。
