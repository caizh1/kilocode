# 13 Review Checklist

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

每个确认候选必须与唯一 DesignUnit ID 和唯一连续章节对应。全局对象表、接口表、状态索引、函数索引、图片总数或跨模块汇总都不能替代该设计单元的本地正文。

## 建议检查项

- 源码范围是否清楚：用户原始名称、所属上级模块、目标模块、目标内部已确认子模块、同级/依赖、核心实现、边界和不负责内容是否分开写清，并有层级证据；内部范围字段是否没有泄漏到用户可见内容。
- 关系维度是否独立取证：系统架构位置、源码归属、所属上级模块、调用方/被调用方、数据/状态/控制权 handoff、依赖、协作、管理和资源所有权是否分别给出证据，没有从一种关系推导另一种关系。
- 关系描述是否自洽：目标所属的系统层是否没有同时被写成目标下游；所属上级模块是否没有被无证据写成业务上游或调用入口；调用关系是否没有冒充所有权；“管理”或“位于……之间”是否有直接证据，证据不足时是否标记“待确认”。
- 全文是否一致：术语表、范围映射、系统定位、模块分解、正文、接口表、架构图、流程图、图注、review notes 和结论中的角色名称与关系是否一致，且用户可见内容统一使用“所属上级模块”。
- 非 contract 能力是否保留：范围定位、源码/控制流证据、业务抽象、正文、图形、Word、旧文档差异和长任务续作是否按实际交付范围覆盖。
- 证据是否足够：关键结论是否引用源码位置、控制流、状态/数据读写、结构字段、配置路径、外部资源访问、现有文档或 owner-review 说明。
- 章节顺序是否正确：阅读路径、术语范围、系统架构定位与模块归属、目标角色、业务能力、详细主业务流程和内部架构分解是否先于代码流和状态机细节。
- 发现信号与候选是否双重闭环：业务能力、接口、构建/注册、调用链、状态/事件、资源所有权和错误恢复信号是否先独立编号，再映射到候选或证据化 non-submodule；是否满足 `discoverySignalCount = mappedToCandidateSignalCount + evidencedNonSubmoduleSignalCount`、`unmappedDiscoverySignalCount = 0`、`candidateCount = confirmedCount + excludedCount`、`unmappedCandidateCount = 0`，并验证候选与信号 ID 双向严格相等。强信号候选若排除，是否给出逐项反证而非仅写 helper/adapter 标签。
- 目标解析是否正确：用户明确主体是否优先；多个名称构成源码确认的祖先—后代链时，是否选择最深模块作为 target、把有证据的祖先保留为所属上级模块；同级或层级未知时是否先澄清而非任意选主体。
- 集合是否真正一致：架构分解名称、confirmed census、DesignUnit 文件、详细章节和五视图账本是否完全同集；是否拒绝“数量不变但用目标外部单元替换 target-owned 子模块”的伪闭环。
- 正文 readiness 是否可核查：完整 Word 是否存在 `module-scope.md`、每个 DesignUnit 的独立 unit 文件、`resume-state.md` 和 `review-notes.md`；unit 数量是否与冻结 census 相等；十四项是否全部为解释性 `PASS` 或有证据的 `N/A`；任一缺失时是否保持 Word `not_started`。
- 设计单元是否完整：是否恰有一个 root target DesignUnit，每个 target-owned confirmed submodule 是否分别拥有简介、边界、输入输出、架构、业务、对象生命周期、函数/代码、状态、接口、异常、策略性能、构建集成、可观测性和证据缺口；所属上级模块是否被排除在 DesignUnit 外。
- 正文是否为解释而非清单：函数、对象、接口、状态转换、流程、策略和证据是否说明了语义、关系、副作用、异常和生命周期，而不是只列名称。
- 横向章节是否越权：全局对象、接口、状态、代码流或性能索引是否只总结跨模块关系，没有替代已确认子模块本地内容。
- 业务流程是否有解释：如果生成了业务图，图前简介、图后解读、关键步骤和异常路径是否可读。
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
- 双重就绪是否成立：是否计算 `expectedBaseSlots = 5D - evidencedStateMachineNaCount`，且 `missingSlotCount = 0`、`duplicateDiagramIdCount = 0`；任一非零时 Word 是否保持 `not_started`。
- 语义拆图是否完整：每个真实入口/流程族、异步链、异常恢复链、FSM、生命周期族和平台/初始化变体是否分别拥有唯一 Signal ID、证据、所需图类型和 diagram ID；多个实例共图时是否有可审计合并理由，且 `requiredFigureCount = 5D - stateMachineNaCount + focusedFigureCount`。
- 图片关系是否解释：新建纯文字 skeleton 的关系基线是否为空，是否记录 late inserted、replaced、actually removed 和 final relationship-ID set，并通过集合差异核对；是否避免把结构段落删除误当作关系删除，或把 replace 误当作新增；`inspect_word_document.imageCount` 是否只作为粗关系数使用。
- Word 写入是否串行：同一 DOCX 的每次编辑、插图、样式和字段操作是否都使用上一次成功返回的路径，是否避免从同一 sourcePath 并行产生会丢失内容的 sibling forks。
- 修复后结构是否仍完整：最终 outline、章节顺序、目标/子模块设计单元、横向收束章节、caption-only figure ID 和图片关系是否仍与计划一致；第 6 章目标业务主图是否只插入和计数一次；不得用 imageCount 掩盖丢章节、错图、孤立关系或重复图。
- 图形身份是否一致：每个 diagram ID 是否只在 caption 中使用一次可见的 `[DU-<designUnitId>/<viewType>/<diagramId>]` 标识，title 是否为普通中文图题，alt text 是否为完整说明；是否按每个实际 drawing occurrence 的 headingPath、caption、visible ID、alt text、relationship、media path 和 hash 与图账本逐项对账。
- 长文档 inspection 是否完整：是否使用 `maxParagraphs: 1000` 和 `maxTables: 200`，并分别确认 `paragraphsTruncated: false`、`tablesTruncated: false`；若任一仍截断，是否通过全部页面核对受影响的可见 figure ID 或表格；结构与页面证据都不完整时是否保持 `acceptanceStatus: PARTIAL`。
- 图片视觉 QA 是否完成：每张 PNG 是否已按 100% 查看整体，并按 200% 检查文字、边标签、箭头、裁剪、重叠、空白和比例。
- Word 逐页 QA 是否完成：完整 Word 交付是否调用 `render_word_document`，并实际打开、逐页检查所有页面；复杂图、表格和代码页是否额外按 200% 检查；发现问题后是否修复并整份重渲染。自动 ink ratio、edge check 或“无法查看图片”不能作为人工视觉通过。
- 状态是否分离：是否分别报告 `artifactStatus: generated | failed`、`pageEvidenceStatus: completed | incomplete | unavailable`、skill 自己的 `pageReviewStatus: pending | passed | skipped` 和 `acceptanceStatus: PASS | PARTIAL`；`visualQaStatus` 是否只作为兼容页证据状态而没有冒充人工逐页 review。远端和本地渲染都不可用时，已生成 DOCX 保持 generated，但整体 acceptance 为 PARTIAL。
- 字段刷新是否闭环：目录物化后是否要求 render 明确返回 `fieldRefreshStatus: completed`、有效 `refreshedDocxPath`，且 TOC heading/entry/page-number 数量相等；是否只把这个刷新文件作为权威 DOCX 并重新检查标题、outline、TOC、drawing、关系和截断状态；普通格式转换或没有显式成功状态时是否保持 `PARTIAL`。
- Artifact 是否清晰：生成的 `.docx`、`.mmd`、`.png`、`.pdf`、诊断 JSON 等是否有路径、摘要和 warnings。

## Review 状态写法

需要记录状态时，用人工可读的 `PASS / PARTIAL / MISSING / N/A` 即可。`MISSING` 只表示该交付范围内缺少某项证据或产物，不应触发自动补图、自动合同规划或普通 QA 改道。

Target module 和每个 target-owned confirmed submodule 必须分别记录五类槽位状态。所属上级模块不记录强制槽位；其可选定位图不能为任何 DesignUnit 计数。全局汇总章节存在、图片总数正确或对象名称已列出，都不能单独使某个设计单元 `PASS`。一张图不能跨设计单元或视图重复计数。窄范围任务只评估声明范围内的单元，并把未请求内容标记为未纳入范围，而不是 `MISSING`。

完整交付只有在目标模块与全部确认子模块的十四项本地正文均为 `PASS` 或有证据的 `N/A`、unit 数量与 census 相等、剩余正文锚点和 bodyless heading range 均为零、发现信号和候选全集均零未映射、全部 `5D` 槽位都为 `PASS` 或证据化状态机 `N/A`、每个复杂度实例都映射到至少一个聚焦图 Diagram ID、全部必需 PNG 已插入、冻结目录与最终 outline 一致、关系集合一致且逐图逐页检查完成时，`acceptanceStatus` 才能为 `PASS`。原生工具仍可用且有界尝试尚未失败时，必须继续第一个未完成项。正文 readiness 未通过时不创建或交付最终 DOCX；若 Word 工具已自动产生 working artifact manifest，只把它作为续作证据，不报告其路径，也不把用户侧 `artifactStatus` 升级为 `generated`。正文完成后的真实图片/渲染阻塞可使文本完整的 DOCX 为 `generated + PARTIAL`。这些只是 skill 内人工可读状态，不是普通 QA 错误。

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
