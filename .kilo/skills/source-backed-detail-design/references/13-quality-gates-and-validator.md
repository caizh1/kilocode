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

- 源码范围是否清楚：用户原始名称、context parent、target module、target-owned confirmed submodules、peer/dependency、核心实现、边界和不负责内容是否分开写清，并有层级证据。
- 非 contract 能力是否保留：范围定位、源码/控制流证据、业务抽象、正文、图形、Word、旧文档差异和长任务续作是否按实际交付范围覆盖。
- 证据是否足够：关键结论是否引用源码、控制流、状态、结构体、宏、寄存器、文档或 owner-review 说明。
- 章节顺序是否正确：阅读路径、术语范围、父系统与目标角色、业务能力、详细主业务流程和内部架构分解是否先于代码流和状态机细节。
- 发现信号与候选是否双重闭环：业务能力、接口、构建/注册、调用链、状态/事件、资源所有权和错误恢复信号是否先独立编号，再映射到候选或证据化 non-submodule；是否满足 `discoverySignalCount = mappedToCandidateSignalCount + evidencedNonSubmoduleSignalCount`、`unmappedDiscoverySignalCount = 0`、`candidateCount = confirmedCount + excludedCount`、`unmappedCandidateCount = 0`，并验证候选与信号 ID 双向严格相等。强信号候选若排除，是否给出逐项反证而非仅写 helper/adapter 标签。
- 目标解析是否正确：用户明确主体是否优先；多个名称构成源码确认的祖先—后代链时，是否选择最深模块作为 target、把祖先保留为 context parent；同级或层级未知时是否先澄清而非任意选主体。
- 设计单元是否完整：是否恰有一个 root target DesignUnit，每个 target-owned confirmed submodule 是否分别拥有简介、边界、输入输出、架构、业务、对象生命周期、函数/代码、状态、接口、异常、策略性能、构建集成、可观测性和证据缺口；context parent 是否被排除在 DesignUnit 外。
- 正文是否为解释而非清单：函数、对象、接口、状态转换、流程、策略和证据是否说明了语义、关系、副作用、异常和生命周期，而不是只列名称。
- 横向章节是否越权：全局对象、接口、状态、代码流或性能索引是否只总结跨模块关系，没有替代已确认子模块本地内容。
- 业务流程是否有解释：如果生成了业务图，图前简介、图后解读、关键步骤和异常路径是否可读。
- 代码流程是否有依据：如果生成了代码图，关键边是否能追溯到函数、分支、状态读写或调用关系。
- 状态机是否合适：目标和子模块是否都只在存在持久控制状态的 `current state -> event/trigger -> guard/action -> next state` 关系时生成状态机图；普通 opcode/command/type 分派、handler table、switch selector、结果/status 字段或数据/资源生命周期不能单独证明存在状态机。
- 构建与集成是否覆盖：构建目标、注册、初始化/清理顺序、feature flag、条件编译和平台差异是否在适用设计单元中说明。
- 范围变体是否守界：单章节、单子模块、状态机专项、差异报告或快速更新是否只生成请求范围，并披露跳过内容。
- 更新与差异是否可信：旧文档是否只作为线索，旧符号是否完成演进映射，Both/CodeOnly/DocOnly 是否有当前源码证据。
- 长任务是否可续：仅在长任务或用户要求时记录 `resume-state.md`、`continue-prompt.md` 和 `review-notes.md`，并从第一个未完成项继续。
- Word 输出是否符合用户请求：如果用户要求完整 `.docx`，是否使用“轻量骨架 `create_word_document` → 串行 `apply_word_document_edits` → 字段物化 → inspection → render QA”，每个成功渲染的 PNG 是否已进入骨架中的目标章节，并报告最终串行链返回的主文件路径。
- Word 前置结构是否完整：是否存在唯一且文本正确的 `Title` 样式标题；独立 `{{TOC}}` 是否位于摘要之后、第一个 Heading 1“阅读路径”之前；字段物化后是否为 Word 原生 TOC 而不是 Normal 段落假目录；“阅读路径”是否仍为第一个 outline 项，且后续“术语、范围与证据基线”未被删除。
- Word 冻结目录是否完整：轻量骨架是否预先包含目标模块、全部确认子模块及其最终 H3 的有序标题和唯一内容锚点；后续填充是否只消费这些锚点，没有把迟到章节 append 到文末或移动到横向收束章节之后。
- Word 文件名是否稳定：创建、章节编辑、补图、样式和字段物化是否始终显式传递同一个 `taskSlug` 和 `outputFile`，最终文件名是否避免连续 `-edited` 后缀。
- 大文档是否有界：首次创建是否排除了长正文、大表格、长列表和代码正文；后续是否按一个主章节或已确认子模块的上限分批，并只对每个唯一标题锚点插入一次；路径型图片骨架仍失败时，是否保留全部覆盖槽位并串行补插，而不是删图。
- 原生工具失败是否收敛：巨型调用是否缩减为轻量骨架，失败章节是否继续按唯一子标题拆分；最小语义单元仍失败时是否保留最后成功的 DOCX 并披露缺口，而不是创建第二条文档分支。
- 图形覆盖是否完整：覆盖账本是否只包含 target module 和每个 target-owned confirmed submodule 的 `5D` 基础槽位，context parents 是否未进入分母或冒充 base slot，状态机 `N/A` 是否有证据，重要性是否未排除子模块。
- 语义拆图是否完整：每个真实入口/流程族、异步链、异常恢复链、FSM、生命周期族和平台/初始化变体是否分别拥有唯一 Signal ID、证据、所需图类型和 diagram ID；多个实例共图时是否有可审计合并理由，且 `requiredFigureCount = 5D - stateMachineNaCount + focusedFigureCount`。
- 图片关系是否解释：是否记录 baseline、skeleton、late inserted、replaced、actually removed 和 final relationship-ID set，并通过集合差异核对；是否避免把结构段落删除误当作关系删除，或把 replace 误当作新增；`inspect_word_document.imageCount` 是否只作为粗关系数使用。
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

Target module 和每个 target-owned confirmed submodule 必须分别记录五类槽位状态。Context parent 不记录强制槽位；其可选定位图不能为任何 DesignUnit 计数。全局汇总章节存在、图片总数正确或对象名称已列出，都不能单独使某个设计单元 `PASS`。一张图不能跨设计单元或视图重复计数。窄范围任务只评估声明范围内的单元，并把未请求内容标记为未纳入范围，而不是 `MISSING`。

完整交付只有在目标模块与全部确认子模块的十四项本地正文均为 `PASS`、发现信号和候选全集均零未映射、全部 `5D` 槽位都为 `PASS` 或证据化状态机 `N/A`、每个复杂度实例都映射到至少一个聚焦图 Diagram ID（合并时仍须共享同一实际 Diagram ID、MergeGroupId 并逐实例证明覆盖）、全部必需 PNG 已插入、冻结目录与最终 outline 一致、关系集合一致且逐图逐页检查完成时，`acceptanceStatus` 才能为 `PASS`。原生工具仍可用且有界尝试尚未失败时，必须继续第一个未完成正文主题、图形槽位或 Word 检查，不能主动以 `PARTIAL` 提前结束。只有出现明确披露的证据阻塞、渲染不可用/失败、最小 Word mutation 失败、用户中断或执行边界耗尽时，才保留最后成功状态、记录续作点并声明 `PARTIAL`；正文尚未完成时不得生成或宣称完整 Word，已有可用 DOCX 的 `artifactStatus` 仍可记录为 `generated`。这些只是 skill 内人工可读状态，不是普通 QA 错误。

## 明确禁止

- 不要因为图没有 PNG 就在普通 QA 或全局运行时自动启动补图流程；显式 Word 工作流中的关系数不一致必须先定位到具体缺失或多余插入，只有确认缺失时才复用对应已有 PNG 做局部修复。
- 不要因为 `.docx` 未生成就插入旧合同规划提示。
- 不要把 Word/Mermaid 参数写入临时 JSON 后用 shell 绕过原生工具，也不要安装或调用 `python-docx`、自建 Python/Node DOCX 生成器、Pandoc 或 shell LibreOffice/soffice 作为替代 authoring 路径。
- 不要在 `apply_word_document_edits` 中添加 image block；初始图片属于轻量骨架，迟到图片只能通过 `insert_mermaid_into_word` 定点插入。即使已有 `pngPath`，也必须传入工具要求的原始 `source`、当前 `wordPath`、唯一 heading、稳定 taskSlug/outputFile 和唯一可见 caption。
- 不要把 Mermaid 源码、ASCII 图、文本框或纯文字伪图当成缺失 PNG 的替代品。
- 不要在 skill disabled、skill permission denied、或普通代码 QA 场景中触发本 skill 的 review 文案。
- 不要把 Markdown 草稿、Mermaid 源码、Word 输出、render QA 绑定成不可拆分的合同。
- 不要把 review checklist 的 `MISSING` 当成 runtime error。
- 不要用 review checklist、章节缺失或旧新差异结果触发 classifier、skill loader、普通 QA 或全局工具循环变化。
