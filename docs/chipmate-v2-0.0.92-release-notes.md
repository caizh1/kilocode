# ChipMate v2 0.0.92 Release Notes

对比版本：ChipMate `0.2.0-build.91`

本次版本以 ChipMate `7.4.8` 的成熟 Agent Runtime 为基础，完成 ChipMate 品牌、运行时、索引、技能市场、文档工具与离线交付体系的整合。与上一代以单会话直连模型为主的 ChipMate 相比，ChipMate v2 已升级为可处理多步骤工程任务、多会话并行协作和大型代码库分析的完整编码 Agent。

## 重点更新

- 从“聊天助手”升级为完整工程 Agent：支持规划、编码、调试、审查等工作模式，可连续读取、修改和验证代码，并在关键操作前执行权限确认。
- 新增 Agent Manager：可同时管理多个任务和会话，并通过 Git worktree 隔离开发分支；内置终端、变更对比、脚本运行、PR 状态和快捷键导航。
- 新增 Agent Console：在独立混合终端中直接执行 Shell 命令，将自然语言请求交给 Agent，并在同一时间线中查看输出、回复和审批。
- 新增完整的 Skill Market：支持搜索、收藏、安装、版本查看、发布、下架和诊断；可从目录、`SKILL.md`、ZIP 或 TAR.GZ 导入本地 Skill，并通过原子事务保证安装与发布可恢复。
- 新增项目记忆、会话内搜索、任务时间线、多会话标签页、聊天独立编辑器、图片预览、浏览器自动化、Notebook 操作和可选图像生成等能力。
- 新增插件内更新：可从统一 ChipMate Server 自动检查、下载并安装匹配当前平台的 VSIX，安装前校验目标平台、文件大小和 SHA-256。

## 新增功能

### 多会话与并行开发

- 在侧边栏和编辑器中同时打开多个会话，并保留各会话的草稿、上下文和运行状态。
- Agent Manager 支持创建、打开和关闭 worktree，切换会话与终端，查看实时 diff，并打开关联 Pull Request。
- 支持以同一提示词启动多版本并行任务，并为子任务选择模型和 reasoning effort。
- 支持 Agent 间受控协作；跨会话发送任务需要独立授权，避免误操作其他工作区。

### 更完整的工程工具链

- 提供文件读写、精确编辑、代码搜索、终端执行、诊断、LSP、Git、网页访问、MCP、Skill、Notebook 和后台任务等统一工具。
- 新增 Explain、Fix、Improve、Generate Commit Message、Terminal Explain/Fix、Add to Context 等编辑器与终端入口。
- 支持自动审批总开关、细粒度工具权限、外部目录授权和可选 macOS/Linux 沙箱。
- 支持会话成本提醒、完成/报错/待输入通知，以及 CLI 异常退出后的自动恢复。

### Skill 与扩展市场

- Skill Market 支持首页、详情、版本、收藏、安装、发布、下架、分析和诊断等完整流程。
- 发布前执行结构与安全校验；风险项以中文提示，但允许用户在知情后继续发布或安装。
- 支持从文件、文件夹、ZIP、TAR.GZ 批量选择 VSIX，自动拆分为有界批次上传，并支持鉴权恢复和准确取消。
- 市场可按当前项目文件和已安装扩展推荐相关 Skill、Agent 与 MCP Server。

### 项目记忆与上下文

- 新增项目级长期记忆，可在设置、任务头部、消息区域或 `/memory` 命令中查看和控制。
- 支持 `@` 文件引用、工作区外文件选择、图片附件、最近提示历史和会话内全文搜索。
- 配置、Skill、Agent、命令或 MCP 内容变更后可热重载，无需丢失现有会话。

## 能力增强

### C/C++ 代码理解与检索

上一代分散的 CodeGraph、文本检索和向量检索能力已整合为独立的 `codebase_analysis` 工具：

- `graph-only` 模式只读取本地 C/C++ 图数据，不调用 embedding 或向量检索。
- `hybrid` 模式融合 C/C++ 符号图、BM25 词法检索和现有向量索引，兼顾精确符号关系与自然语言问题。
- 支持定义、引用、调用者/被调用者、调用链、宏、寄存器、MMIO、错误与清理路径、候选状态迁移和模块影响分析。
- 每条关键证据尽量返回文件路径和行号，并执行 evidence item、单条 snippet 和总字符数预算，防止超大证据包挤占模型上下文。
- 当证据不足时使用保守回答策略，明确限制和下一步建议，不允许把无来源推断包装成代码事实。

通用概念检索继续使用 `semantic_search`，文档检索使用 `document_search`；三类检索入口职责更加清晰。

### 索引稳定性与大型工程支持

- Code Graph、Code RAG 和 Document RAG 按顺序启动，优先让结构化代码图可用，避免大型工作区并发建索引造成资源争抢。
- 索引运行在隔离进程中，单次解析或向量服务故障不再直接拖垮主 CLI 与聊天会话。
- 新增工作区隔离、运行锁、取消与恢复、文件 watcher 补偿、增量复用、损坏产物清理和升级兼容重建。
- 默认使用本地 LanceDB，无需额外部署 Qdrant；模型或 schema 不兼容时仅重建受影响的 RAG 数据并保留 CodeGraph。
- 设置页提供中文状态、进度和近期错误；修复 embedding 鉴权恢复后仍显示旧错误、快速保存产生旧 worker、空窗口误建索引等问题。
- Windows 离线包内置 `rg.exe`、Tree-sitter 和 LanceDB 原生运行库，不再依赖运行时访问 GitHub 或 npm。

### Document RAG 与文档交付

- Document RAG 可自动发现工作区或显式配置目录中的 `.pdf`、`.docx`、`.xlsx`、`.ods`、`.txt`、`.md`、`.rst`、`.csv` 和 `.tsv` 文件。
- `document_search` 返回有界、可引用的文档片段，并支持限定工作区子目录。
- Word 工具支持读取、创建、精确编辑、样式审计、模板样式应用、字段处理、表格导出、文档比较和合并。
- “源码驱动详细设计”流程强化为逐子模块证据闭环，要求覆盖业务流程、代码流程、状态机、接口/数据和异常路径，并改进中文排版、稳定组装、原生目录页码和图文顺序。
- Mermaid 渲染结果会明确区分成功、警告和失败，保留尺寸、诊断和来源信息，避免将失败图片误报为已完成。

### Inline Autocomplete

- 保留 Qwen Coder FIM 路线，并对齐 Continue 的触发、Prompt 预算、停止条件、采样默认值和内存缓存行为。
- 支持最近编辑、最近打开文件、import definition 和根路径定义等可选上下文来源。
- 加强单行范围、前后缀去重、空结果、重复注释、suffix duplication、多行输出和敏感内容预过滤。
- 扩展到 Python、Shell、Gitea Workflow 和 Jupyter Notebook，并增加生成、取消、Next Edit 接受/跳转及诊断导出入口。

### 模型、会话与交互体验

- 从单个 OpenAI-compatible Chat Model 配置升级为多 Provider、多 Model 和 reasoning variant 管理；内部离线包默认聚焦已配置的自定义 Provider。
- 支持流式 reasoning、工具调用、多步骤任务、子 Agent、Plan 完成后的“实施/继续完善”交互，以及会话 checkpoint、回滚和 redo。
- 新增任务时间线、工具调用定位、会话搜索、变更审查、Markdown diff、token/cache 使用明细和更清晰的权限展示。
- 默认简体中文，并重做响应式设置页、QA Composer、任务 HUD、市场和首次使用流程；窄侧边栏下仍保留完整的模型、索引和工具入口。

### 安装、离线与共存

- 扩展命令、设置、视图、存储、CLI 状态和索引数据统一迁移到 `chipmate.v2` 隔离命名空间，可与 ChipMate 安装在同一个 VS Code Profile 中。
- 支持 macOS、Windows x64 baseline 和显式 Linux x64 baseline 包；内部 Windows 默认采用无音频、中文优先、Custom Provider only 的离线精简方案。
- ChipMate Server 地址统一用于 Skill Market、插件市场、文档渲染和更新服务，减少多处重复配置。

## 升级说明与已知差异

- 本次扩展身份由旧版 `local.chipmate` 迁移为 `chipmate.chipmate`。首次升级需要手动安装一次 v2 VSIX；之后可使用插件内更新。
- 配置键由 `chipmate.*` 迁移为 `chipmate.v2.*`，存储和索引目录也已隔离。旧 Provider、API Key、RAG endpoint 和补全设置不会被当作 v2 当前配置，请在新设置页重新确认。
- Inline Autocomplete 在 v2 源码默认关闭；启用后，最近编辑、最近文件和定义注入仍为独立的可选项，避免未确认的上下文自动进入 FIM Prompt。
- 旧版独立的 CodeGraph 命令面板入口已改为设置页状态/控制和 Agent 自动选择 `codebase_analysis`；旧的多个 graph tool 名称不再一一暴露。
- `codebase_analysis` v1 不启用独立 rerank 服务和模块摘要；hybrid 模式使用图、BM25 与现有向量结果进行融合。
- Document RAG v2 当前不索引旧 `.doc`、`.xls`、`.xlsm`、`.ppt` 或 `.pptx` 文件；请先转换为 `.docx`、`.xlsx`、`.pdf` 或受支持的文本格式。
- 旧版“AI 注释候选”专用命令与 CodeLens 审批面板未原样保留；通用注释、解释、修复和代码修改由 Agent、编辑器上下文命令及 diff review 流程完成。
- 旧版“生成模块详细设计文档”单独命令改为调用内置 `source-backed-detail-design` Skill 和文档工具，不再维护一条独立业务运行时。
- 内部 Windows baseline 包默认不包含 FFmpeg，因此语音/音频功能需要系统 FFmpeg 或单独的 audio-enabled 包；聊天、Agent、RAG、CodeGraph、文档和 diff 不受影响。

## 一句话总结

ChipMate v2 将上一代的本地问答、C/C++ 检索、Document RAG、Qwen 补全和文档生成能力，整合进更成熟的 ChipMate Agent Runtime，并新增多会话并行、worktree 隔离、Agent Console、Skill/扩展市场、项目记忆、沙箱权限和可靠离线更新，面向真实大型工程形成了更完整的开发闭环。
