---
name: source-backed-detail-design
description: Generate or update source-backed detailed design documents with ChipMate native code/document evidence tools, Mermaid PNG artifacts, Word docx output, and render diagnostics.
allowed-tools: [source_backed_design_job,task,codebase_analysis,semantic_search,document_search,read,grep,glob,write,edit,declare_artifact,list_artifacts,open_artifact,export_artifact_diagnostics,validate_mermaid_diagram,render_mermaid_diagram,save_mermaid_artifact,insert_mermaid_into_word,create_word_document,inspect_word_document,validate_word_document,apply_word_document_edits,apply_word_template_styles,materialize_word_fields,merge_word_documents,diff_word_documents,normalize_word_table_spec,render_word_document]
metadata:
  keywords: [source backed detail design,source-backed detail design,enhanced detail design,detailed design document,源码驱动详细设计,增强版详细设计,基于源码生成详设,模块详细设计,状态机,业务流程,代码流程]
---

`SBDD_JOB_REVISION=2026-08-chunked-v1`

# Source-backed Detail Design

## 关键规则

完整源码详设 Word 必须使用 `source_backed_design_job`。控制器是范围、进度、工作项、图形、Word 和最终状态的唯一真源；不要再自行创建工作包、批量编写 Mermaid、拼接 DOCX 或根据聊天上下文推测进度。

- 新任务：定位工作区内的目标源码目录后调用 `start`，传入用户原始请求。对每个返回工作项，必须原样使用 `workItem.worker` 中的 `subagentType`、`command` 和 `prompt` 调用前台 `task`，再提交该隔离工作进程写好的精确路径；根会话不得自行读取源码或编写结果。
- 当前会话续作：用户说“继续”时调用 `resume`，随后重复“隔离 `task` → `submit`”，直到控制器返回 `awaiting-continuation`、`blocked` 或 `complete`；不要求用户重新描述目标或指导修复。
- 跨会话续作：仅在用户通过现有 `/source-backed-detail-design 继续` 显式加载本 Skill 后调用 `resume`。新会话中的普通“继续”不能扫描或恢复任务。
- 提交：根会话不修改 `draftPath`；隔离工作进程只修改该路径。根会话随后用相同 `jobId`、`workItemId`、`revision` 和该精确路径调用 `submit`。不得把源码、DiagramSpec 或大段正文塞进根会话工具参数。
- 失败：依据工具给出的具体诊断修复当前文件，然后重新 `resume`；不要绕过校验、改用临时脚本或让用户决定怎么修。
- 边界：当控制器返回 `awaiting-continuation` 时，只告诉用户当前完成度并请其回复“继续”；返回 `blocked` 时报告可复现阻塞；返回 `complete` 时必须逐字输出 `absoluteFinalDocxPath`。

完整任务中禁止直接调用 `declare_artifact`、`render_mermaid_diagram`、`create_word_document`、Word edit/merge 或目录物化工具。控制器内部会使用现有原生实现并执行事务校验。不得用 Python、Node、Pandoc、LibreOffice shell、包管理器、临时 JSON 桥或第三方 DOCX 库建立替代链路。

普通 QA、普通 Mermaid、普通 Word、小范围状态机分析、单张图、单章节和旧文档差异不自动创建任务。用户转而提出普通问题时直接按普通流程回答；不要读取 `.chipmate-v2/artifacts`、不要提及续作状态。以后恢复完整任务必须重新显式加载本 Skill。

## 当前工作项的处理方式

控制器会先创建可编辑模板，并返回完整的 `workItem.worker` 调用参数。根会话只能用这些参数启动一个全新前台 `task`；不得在根会话调用 `read`、`grep`、`write`、`edit`、源码检索或文档工具。隔离工作进程可在自己的短上下文中读取必要源码并且只修改模板；完成后只返回路径，不能创建后续章节、图片或 Word。

每个用户回合由控制器最多接收 3 个正文工作项或 5 个图形工作项；达到预算后必须返回 `awaiting_continuation`。不要在根会话续跑子任务规避预算。该节奏使“范围与首批正文 → 其余正文 → 两批图 → 收尾与 Word”可在初始请求加最多四次普通“继续”内完成，同时避免源码读取历史跨工作项累积。

### 范围工作项

分别确认：用户请求中的唯一目标模块、目标内部的确认子模块、排除对象、源码归属、所属上级模块、系统位置、调用关系、数据/状态/控制权传递、依赖、协作、管理和所有权。不同关系必须分别取证，禁止从目录包含、行业常识或单一调用关系推导其他关系。

用户明确指定主体时以用户表达为准；多个名称经源码证明构成祖先—后代链时，选择最深、最具体的对象作为目标，其上层对象只用于说明“所属上级模块”。同级候选或层级证据不足时，在范围工作项中保留待确认，不能擅自扩成多个主体。

范围 JSON 必须将目标目录下每个实现文件恰好映射到 target、一个 confirmed submodule 或带直接证据的排除项。目标、子模块分解表、正文单元和图形矩阵必须使用同一冻结集合。

### 正文工作项

目标和每个确认子模块都要完成以下十四项本地详细设计，按控制器模板原序填写：

1. 业务定位与设计结论；
2. 职责、非职责与边界；
3. 触发、前置条件、输入与输出；
4. 内部架构、上下游与依赖；
5. 业务能力与完整业务流程；
6. 核心对象、队列、缓存与生命周期；
7. 函数功能覆盖与代码执行流程；
8. 状态、事件、guard、action 与转换；
9. 外部、内部、跨模块、异步、队列及硬件接口；
10. 异常、等待、重试、超时、取消、恢复与清理；
11. 算法、配置、并发、资源与性能；
12. 构建、注册、初始化、feature flag 与平台差异；
13. 调试、日志、计数器、失败症状与源码点读；
14. 源码证据、置信度、缺口与审核项。

每项必须包含“设计结论、机制与流程、异常与边界、源码证据”。函数名、结构体名、状态名、宏、列表、表格或一句简介都不能代替解释。证据使用工作区相对 `path:start-end`，必须与当前源码一致。

只有第 8 项可在完整审计确认不存在状态、阶段、事件或生命周期语义后标为 `N/A`；其他主题必须解释“没有专门机制”这一源码结论，不能用 `N/A` 逃避分析。状态机存在时必须说明 `current state → event → guard → action → next state`、失败/恢复和终止状态。

### DiagramSpec 工作项

不要手写 Mermaid。填写控制器提供的结构化 `DiagramSpec`：节点、边、关系类型、分组、证据和各语义覆盖集合。控制器会校验源码哈希、符号、归属、调用方向、状态转换与生命周期关系，确定性生成 Mermaid、拆分不可读大图并渲染 PNG。

目标及每个确认子模块分别需要：架构图、业务流程图、代码流程图、状态机图或证据化 `N/A`、数据/生命周期图。每张图都必须详细展示真实机制：

- 架构图：边界、入口、内部组件、共享对象、输入输出、依赖和资源；
- 业务流程图：触发、全部主要分支、异步交接、等待/重试/超时/取消、失败恢复、终止结果和副作用；
- 代码流程图：入口函数、调用层、条件、循环、回调、写入、错误返回和清理；
- 状态机图：状态、事件、guard、action、失败/恢复、终止及忽略事件；
- 数据/生命周期图：创建、初始化、所有者、读写、跨层传递、持久化、并发、失效与释放。

简单总览不能冒充详细图。边必须有明确中文语义标签并绑定源码证据；强关系使用精确源码符号。无法证明但不存在直接矛盾的关系，必须在规格和可见标签中同时写“待确认”。不要反转调用方向、虚构符号、重复图片或用一张图跨多个槽位计数。

图超出 Word 正文可读范围时保留导航语义并拆成“详细总览＋聚焦图”；聚焦图组合必须覆盖原规格的节点和边。禁止通过无限缩小、删除异常路径或降低 DPI 通过验收。

### 收尾工作项

用中文总结跨模块协作、全局对象/接口/状态/配置/构建索引、算法/并发/资源/性能、调试点读、覆盖、风险和待确认项。全局章节只做跨单元关系和索引，不能替代任何本地十四项正文。

## 输出与语言

Word 标题、正文、表头、图题、图注、结论和 review notes 默认使用简体中文。源码符号、函数、类型、变量、宏、路径、配置键、协议、标准、产品、库、工具名、技术缩写和固定证据状态保持原文；译名不确定时保留英文并用中文解释，不创造未经证据确认的名称。

正式封面使用动态权威标题和有信息量的副标题，包含简洁范围、源码基线和证据状态。禁止只写“详细设计”作为副标题。默认作者为 `ChipMate source-backed-detail-design`，用户明确指定作者时除外。目录位于封面之后、第一章之前。

控制器只有在全部正文、图形、XML/OPC、目录、图片关系和页面渲染门禁通过后才返回最终 DOCX。最终回答必须明确输出唯一权威 `.docx` 的绝对路径；中间文件、计划路径和旧文件不能作为交付路径。生成失败时明确说明失败，不能伪造路径或宣称完成。

## References

控制器工作包已经包含执行当前小块所需的固定格式。完整控制器任务不读取 references，也不把旧手工工作流重新注入上下文。以下 references 只服务于用户明确要求的单章节、单图、旧文档差异等非控制器窄范围任务：

- 范围与证据：`references/02-input-and-module-scope-rules.md`、`03-source-exploration-rules.md`；
- 控制流与状态：`04-control-flow-evidence-schema.md`、`05-submodule-business-flow-rules.md`、`06-state-machine-extraction-rules.md`；
- 正文语义：`10-detail-design-output-templates.md`、`15-business-flow-abstraction-rules.md`；
- 窄范围手工图：`07-diagram-planning-and-splitting-rules.md`、`08-mermaid-png-rendering-rules.md`；
- 窄范围 Word 或旧文档更新：`11-feature-diff-completeness-rules.md`、`12-word-export-rules.md`、`13-quality-gates-and-validator.md`。

`14-continuation-checkpoint-protocol.md` 只解释控制器任务恢复语义。完整控制器任务不得借 references 恢复旧的模型自编排工作包、批次 Mermaid 或分块 Word 流程。
