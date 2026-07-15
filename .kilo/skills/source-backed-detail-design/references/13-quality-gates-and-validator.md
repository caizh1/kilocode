# 13 Review Checklist

本文件只提供源码驱动详细设计的人工 review 建议。它不是 ChipMate 文档合同，不是自动修复流水线，不是缺失图表渲染计划，也不是 Kilo QA 的触发条件。

不要迁移或调用旧的 artifact validator helper。Kilo 中的详细设计 skill 应依靠模型、Kilo 原生证据工具、通用 Word/Mermaid/artifact tools，以及人工可读的 review notes。

## 建议检查项

- 源码范围是否清楚：目标模块、父模块、核心实现、边界和不负责内容是否写清。
- 非 contract 能力是否保留：范围定位、源码/控制流证据、业务抽象、正文、图形、Word、旧文档差异和长任务续作是否按实际交付范围覆盖。
- 证据是否足够：关键结论是否引用源码、控制流、状态、结构体、宏、寄存器、文档或 owner-review 说明。
- 章节顺序是否正确：阅读路径、术语范围、父系统与目标角色、业务能力、详细主业务流程和内部架构分解是否先于代码流和状态机细节。
- 设计单元是否内聚：目标模块和每个重要子模块是否分别拥有简介、边界、输入输出、架构、业务、对象生命周期、函数/代码、状态、接口、异常、策略性能、构建集成、可观测性和证据缺口。
- 横向章节是否越权：全局对象、接口、状态、代码流或性能索引是否只总结跨模块关系，没有替代重要子模块本地内容。
- 业务流程是否有解释：如果生成了业务图，图前简介、图后解读、关键步骤和异常路径是否可读。
- 代码流程是否有依据：如果生成了代码图，关键边是否能追溯到函数、分支、状态读写或调用关系。
- 状态机是否合适：只有在源码存在状态、事件、phase、dispatch、handler 等证据时才生成状态机图。
- 构建与集成是否覆盖：构建目标、注册、初始化/清理顺序、feature flag、条件编译和平台差异是否在适用设计单元中说明。
- 范围变体是否守界：单章节、单子模块、状态机专项、差异报告或快速更新是否只生成请求范围，并披露跳过内容。
- 更新与差异是否可信：旧文档是否只作为线索，旧符号是否完成演进映射，Both/CodeOnly/DocOnly 是否有当前源码证据。
- 长任务是否可续：仅在长任务或用户要求时记录 `resume-state.md`、`continue-prompt.md` 和 `review-notes.md`，并从第一个未完成项继续。
- Word 输出是否符合用户请求：如果用户要求完整 `.docx`，是否使用“轻量骨架 `create_word_document` → 串行 `apply_word_document_edits` → 字段物化 → inspection → render QA”，每个成功渲染的 PNG 是否已进入骨架中的目标章节，并报告最终串行链返回的主文件路径。
- 大文档是否有界：首次创建是否排除了长正文、大表格、长列表和代码正文；后续是否按一个主章节或重要子模块的上限分批，并只对每个唯一标题锚点插入一次。
- 原生工具失败是否收敛：巨型调用是否缩减为轻量骨架，失败章节是否继续按唯一子标题拆分；最小语义单元仍失败时是否保留最后成功的 DOCX 并披露缺口，而不是创建第二条文档分支。
- 图片数量是否一致：`inspect_word_document.imageCount` 是否等于成功渲染并计划插入的图片数；若不一致，是否只复用已有 PNG 做局部修复并再次检查。
- Word 写入是否串行：同一 DOCX 的每次编辑、插图、样式和字段操作是否都使用上一次成功返回的路径，是否避免从同一 sourcePath 并行产生会丢失内容的 sibling forks。
- 修复后结构是否仍完整：最终 outline、章节顺序、目标/子模块设计单元、横向收束章节、图题和图片关系是否仍与计划一致；不得用 imageCount 掩盖丢章节、错图或多个 drawing 共用同一关系。
- 图形身份是否一致：每个 diagram ID 的 view type、可见标题、节点语义、源码证据、PNG 路径和目标章节是否一致；不同图不得误用同一泛化图或占位图。
- 图片视觉 QA 是否完成：每张 PNG 是否已按 100% 查看整体，并按 200% 检查文字、边标签、箭头、裁剪、重叠、空白和比例。
- Word 逐页 QA 是否完成：完整 Word 交付是否调用 `render_word_document`，并实际打开、逐页检查所有页面；复杂图、表格和代码页是否额外按 200% 检查；发现问题后是否修复并整份重渲染。自动 ink ratio、edge check 或“无法查看图片”不能作为人工视觉通过。
- Render QA 是否如实披露：远端和本地渲染都不可用时是否记录 `visualQaStatus: skipped` 和原因，且没有声称页面图像检查通过。
- Artifact 是否清晰：生成的 `.docx`、`.mmd`、`.png`、`.pdf`、诊断 JSON 等是否有路径、摘要和 warnings。

## Review 状态写法

需要记录状态时，用人工可读的 `PASS / PARTIAL / MISSING / N/A` 即可。`MISSING` 只表示该交付范围内缺少某项证据或产物，不应触发自动补图、自动合同规划或普通 QA 改道。

目标模块和每个重要子模块必须分别记录状态。全局汇总章节存在、图片总数正确或对象名称已列出，都不能单独使某个设计单元 `PASS`。窄范围任务只评估声明范围内的单元，并把未请求内容标记为未纳入范围，而不是 `MISSING`。

## 明确禁止

- 不要因为图没有 PNG 就在普通 QA 或全局运行时自动启动补图流程；显式 Word 工作流中的图片数量不一致只能复用已有 PNG 做局部修复。
- 不要因为 `.docx` 未生成就插入旧合同规划提示。
- 不要把 Word/Mermaid 参数写入临时 JSON 后用 shell 绕过原生工具，也不要安装或调用 `python-docx`、自建 Python/Node DOCX 生成器、Pandoc 或 shell LibreOffice/soffice 作为替代 authoring 路径。
- 不要在 `apply_word_document_edits` 中添加 image block；初始图片属于轻量骨架，迟到图片只能通过 `insert_mermaid_into_word` 定点插入。
- 不要把 Mermaid 源码、ASCII 图、文本框或纯文字伪图当成缺失 PNG 的替代品。
- 不要在 skill disabled、skill permission denied、或普通代码 QA 场景中触发本 skill 的 review 文案。
- 不要把 Markdown 草稿、Mermaid 源码、Word 输出、render QA 绑定成不可拆分的合同。
- 不要把 review checklist 的 `MISSING` 当成 runtime error。
- 不要用 review checklist、章节缺失或旧新差异结果触发 classifier、skill loader、普通 QA 或全局工具循环变化。
