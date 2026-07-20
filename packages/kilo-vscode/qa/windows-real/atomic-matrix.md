# ChipMate 历史修复原子回归矩阵

状态约定：`✅ 已实现`、`⬜ 未实现`、`🟨 待复核`、`🚫 非当前范围`。已完成项后续不得退回套件级笼统描述；每次执行必须按原子 ID 上报结果。

- 历史 changeset：85
- 原子断言：296
- macOS 是全部原子断言的代理验收主通道。
- Windows 只要求安装、设置输入、索引和 Agent Console 高风险断言。

| 原子 ID | 历史修复 | 父 case | 单一判定 | 源码测试 | macOS 安装态 | Windows 冒烟 |
|---|---|---|---|---|---|---|
| `REG-AGENT-CONSOLE-WEBVIEW-01` | `agent-console-webview` | `WIN-AGENT-CONSOLE` | Agent Console 使用真实交互终端 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-AGENT-CONSOLE-WEBVIEW-02` | `agent-console-webview` | `WIN-AGENT-CONSOLE` | 普通命令在审批后执行并显示输出 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-AGENT-CONSOLE-WEBVIEW-03` | `agent-console-webview` | `WIN-AGENT-CONSOLE` | 高风险命令触发二次确认 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-AGENT-CONSOLE-WEBVIEW-04` | `agent-console-webview` | `WIN-AGENT-CONSOLE` | 取消审批后命令没有执行 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-AGENT-CONSOLE-WEBVIEW-05` | `agent-console-webview` | `WIN-AGENT-CONSOLE` | 侧边栏快捷入口打开同一个 Agent Console | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-ALIGN-QA-LIQUID-GLASS-01` | `align-qa-liquid-glass` | `WIN-QA-SESSION` | 940px 下 Composer 工具栏保持单行且控件可操作 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-ALIGN-QA-LIQUID-GLASS-02` | `align-qa-liquid-glass` | `WIN-QA-SESSION` | 560px 下语义选择器、索引和工具组不重叠 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-ALIGN-QA-LIQUID-GLASS-03` | `align-qa-liquid-glass` | `WIN-QA-SESSION` | 420px 下关键动作不越界 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-ALIGN-QA-LIQUID-GLASS-04` | `align-qa-liquid-glass` | `WIN-QA-SESSION` | 300px 下工具栏严格为两行且索引与 overflow 可操作 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-ALIGN-QA-LIQUID-GLASS-05` | `align-qa-liquid-glass` | `WIN-QA-SESSION` | Light、Dark 与高对比度主题结构一致 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-ALIGN-QA-LIQUID-GLASS-06` | `align-qa-liquid-glass` | `WIN-QA-SESSION` | 任务统计、索引状态、工具和设置控件均未丢失 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-ALIGN-QA-LIQUID-GLASS-07` | `align-qa-liquid-glass` | `WIN-QA-SESSION` | 任务头只显示一个分层 HUD | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-ALIGN-QA-LIQUID-GLASS-08` | `align-qa-liquid-glass` | `WIN-QA-SESSION` | 消息和工具边界没有重复容器 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-ALIGN-QWEN-AUTOCOMPLETE-01` | `align-qwen-autocomplete` | `WIN-QWEN-AUTOCOMPLETE` | Qwen 触发时机符合固定 Continue 夹具 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-ALIGN-QWEN-AUTOCOMPLETE-02` | `align-qwen-autocomplete` | `WIN-QWEN-AUTOCOMPLETE` | FIM prompt 与 stop 序列符合固定夹具 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-ALIGN-QWEN-AUTOCOMPLETE-03` | `align-qwen-autocomplete` | `WIN-QWEN-AUTOCOMPLETE` | 采样默认值符合固定夹具 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-ALIGN-QWEN-AUTOCOMPLETE-04` | `align-qwen-autocomplete` | `WIN-QWEN-AUTOCOMPLETE` | Python 文件可触发补全 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-ALIGN-QWEN-AUTOCOMPLETE-05` | `align-qwen-autocomplete` | `WIN-QWEN-AUTOCOMPLETE` | Shell 文件可触发补全 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-ALIGN-QWEN-AUTOCOMPLETE-06` | `align-qwen-autocomplete` | `WIN-QWEN-AUTOCOMPLETE` | Gitea Workflow 文件可触发补全 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-ALIGN-SUBAGENT-MODEL-CONTROLS-01` | `align-subagent-model-controls` | `WIN-SETTINGS-PROVIDER` | Models 设置页的子代理模型选择器状态与主模型选择器一致 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-ATOMIC-SKILL-MARKET-TOOLS-01` | `atomic-skill-market-tools` | `WIN-MARKETPLACE` | 普通 QA 未明确请求 Skill Market 时不暴露市场写工具 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-ATOMIC-SKILL-MARKET-TOOLS-02` | `atomic-skill-market-tools` | `WIN-MARKETPLACE` | 明确请求后搜索工具返回远端 Skill 结果 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-ATOMIC-SKILL-MARKET-TOOLS-03` | `atomic-skill-market-tools` | `WIN-MARKETPLACE` | 安装工具使用一次性审批并原子记录安装 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-ATOMIC-SKILL-MARKET-TOOLS-04` | `atomic-skill-market-tools` | `WIN-MARKETPLACE` | 创建工具只写入隔离的 qa-e2e Skill 夹具 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-ATOMIC-SKILL-MARKET-TOOLS-05` | `atomic-skill-market-tools` | `WIN-MARKETPLACE` | 发布工具以原子事务生成不可变 revision | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-ATOMIC-SKILL-MARKET-TOOLS-06` | `atomic-skill-market-tools` | `WIN-MARKETPLACE` | 发布失败时不残留部分对象或中间状态 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-ATOMIC-SKILL-MARKET-TOOLS-07` | `atomic-skill-market-tools` | `WIN-MARKETPLACE` | 进程崩溃后事务可恢复或返回可判定终态 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-ATOMIC-SKILL-MARKET-TOOLS-08` | `atomic-skill-market-tools` | `WIN-MARKETPLACE` | 一次性审批或 intent 重放被拒绝 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-ATOMIC-SKILL-MARKET-TOOLS-09` | `atomic-skill-market-tools` | `WIN-MARKETPLACE` | 撤销仅作用于当前 owner 的目标发布并恢复前态 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-ATOMIC-SKILL-MARKET-TOOLS-10` | `atomic-skill-market-tools` | `WIN-MARKETPLACE` | 取消操作后未批准的 Market 副作用不会执行 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-BOUNDED-INDEXING-PROCESS-01` | `bounded-indexing-process` | `WIN-INDEXING-LIFECYCLE` | 大工作区重建期间索引进程内存保持在预算内 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-BOUNDED-INDEXING-PROCESS-02` | `bounded-indexing-process` | `WIN-INDEXING-LIFECYCLE` | 索引子进程失败不导致主 CLI 退出 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-BOUNDED-INDEXING-PROCESS-03` | `bounded-indexing-process` | `WIN-INDEXING-LIFECYCLE` | 隔离进程重启后检索语义保持一致 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-CHIPMATE-CHINESE-BRANDING-01` | `chipmate-chinese-branding` | `WIN-BRANDING-FIRST-RUN` | 所有简体中文用户可见品牌文案显示 ChipMate | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-CHIPMATE-DEFAULT-CHINESE-01` | `chipmate-default-chinese` | `WIN-BRANDING-FIRST-RUN` | 新 Profile 首次启动默认使用简体中文 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-CHIPMATE-DEFAULT-CHINESE-02` | `chipmate-default-chinese` | `WIN-BRANDING-FIRST-RUN` | Auto 语言选项仍可选择并持久化 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-CHIPMATE-VSCODE-ICONS-01` | `chipmate-vscode-icons` | `WIN-PACKAGE-INSTALL` | 扩展身份显示 ChipMate | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-CHIPMATE-VSCODE-ICONS-02` | `chipmate-vscode-icons` | `WIN-PACKAGE-INSTALL` | 活动栏与扩展图标资源可加载 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-CHIPMATE-WINDOWS-RIPGREP-01` | `chipmate-windows-ripgrep` | `WIN-PACKAGE-INSTALL` | Windows 离线索引实际加载 VSIX 内的 rg.exe | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-CHIPMATE-WINDOWS-RIPGREP-02` | `chipmate-windows-ripgrep` | `WIN-PACKAGE-INSTALL` | 断网时没有 GitHub ripgrep 下载请求 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-CLEAR-LIONS-COMPRESS-01` | `clear-lions-compress` | `WIN-QA-SESSION` | 上下文压缩只显示一个状态卡 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-CLEAR-LIONS-COMPRESS-02` | `clear-lions-compress` | `WIN-QA-SESSION` | 内部 summary worker 消息不显示给用户 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-CLEAR-RECOVERED-RAG-DIAGNOSTICS-01` | `clear-recovered-rag-diagnostics` | `WIN-INDEXING-LIFECYCLE` | 401 响应产生 RAG authentication failed 诊断 | ✅ 已实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-CLEAR-RECOVERED-RAG-DIAGNOSTICS-02` | `clear-recovered-rag-diagnostics` | `WIN-INDEXING-LIFECYCLE` | 再次失败的验证不会清除现有 RAG 诊断 | ✅ 已实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-CLEAR-RECOVERED-RAG-DIAGNOSTICS-03` | `clear-recovered-rag-diagnostics` | `WIN-INDEXING-LIFECYCLE` | 成功的 live validation 清除旧 RAG 认证诊断 | ✅ 已实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-CLEAR-RECOVERED-RAG-DIAGNOSTICS-04` | `clear-recovered-rag-diagnostics` | `WIN-INDEXING-LIFECYCLE` | 清除 RAG 诊断时保留 CodeGraph 诊断 | ✅ 已实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-CLEAR-RECOVERED-RAG-DIAGNOSTICS-05` | `clear-recovered-rag-diagnostics` | `WIN-INDEXING-LIFECYCLE` | 清除 RAG 诊断时保留 Document RAG 诊断 | ✅ 已实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-CLOSE-SKILL-PUBLICATION-PROGRESS-01` | `close-skill-publication-progress` | `WIN-MARKETPLACE` | 发布 API 返回后 progress 立即关闭 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-CLOSE-SKILL-PUBLICATION-PROGRESS-02` | `close-skill-publication-progress` | `WIN-MARKETPLACE` | 后续 refresh 不重新打开 progress | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-CLOSE-SKILL-PUBLICATION-PROGRESS-03` | `close-skill-publication-progress` | `WIN-MARKETPLACE` | 后续 repair 不阻塞 progress 关闭 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-CODEBASE-ANALYSIS-BM25-FUSION-01` | `codebase-analysis-bm25-fusion` | `WIN-RETRIEVAL-EVIDENCE` | hybrid 模式结果包含 BM25 证据 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-CODEBASE-ANALYSIS-BM25-FUSION-02` | `codebase-analysis-bm25-fusion` | `WIN-RETRIEVAL-EVIDENCE` | BM25 证据参与固定 fusion 排序 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-CODEBASE-ANALYSIS-GRAPH-EVIDENCE-01` | `codebase-analysis-graph-evidence` | `WIN-RETRIEVAL-EVIDENCE` | graph-only 返回有效 C/C++ graph 证据 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-CODEBASE-ANALYSIS-GRAPH-EVIDENCE-02` | `codebase-analysis-graph-evidence` | `WIN-RETRIEVAL-EVIDENCE` | 每条 graph 证据包含文件路径与行号 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-CODEBASE-ANALYSIS-PHASE-ZERO-01` | `codebase-analysis-phase-zero` | `WIN-RETRIEVAL-EVIDENCE` | 工具列表包含 codebase_analysis | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-CODEBASE-ANALYSIS-PHASE-ZERO-02` | `codebase-analysis-phase-zero` | `WIN-RETRIEVAL-EVIDENCE` | 工具返回受预算限制的 source-backed 结果 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-CODEBASE-ANALYSIS-VECTOR-FUSION-01` | `codebase-analysis-vector-fusion` | `WIN-RETRIEVAL-EVIDENCE` | hybrid 模式复用现有向量证据 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-CODEBASE-ANALYSIS-VECTOR-FUSION-02` | `codebase-analysis-vector-fusion` | `WIN-RETRIEVAL-EVIDENCE` | 向量证据与 graph、BM25 一起参与固定 fusion | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-CODEGRAPH-PARSER-STORAGE-01` | `codegraph-parser-storage` | `WIN-RETRIEVAL-EVIDENCE` | C/C++ parser 生成固定 graph records | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-CODEGRAPH-PARSER-STORAGE-02` | `codegraph-parser-storage` | `WIN-RETRIEVAL-EVIDENCE` | graph sidecar 落盘到当前项目专属目录 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-CODEGRAPH-PARSER-STORAGE-03` | `codegraph-parser-storage` | `WIN-RETRIEVAL-EVIDENCE` | 重新打开项目可读取兼容 sidecar | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-CODEGRAPH-PARSER-WORKER-SIDECAR-01` | `codegraph-parser-worker-sidecar` | `WIN-RETRIEVAL-EVIDENCE` | 打包客户端能启动 CodeGraph parser worker | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-CODEGRAPH-PARSER-WORKER-SIDECAR-02` | `codegraph-parser-worker-sidecar` | `WIN-RETRIEVAL-EVIDENCE` | graph-only 扫描使用 worker pool | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-CODEGRAPH-PARSER-WORKER-SIDECAR-03` | `codegraph-parser-worker-sidecar` | `WIN-RETRIEVAL-EVIDENCE` | worker 失败时回退路径仍完成扫描 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-CODEGRAPH-SIDECAR-LIFECYCLE-01` | `codegraph-sidecar-lifecycle` | `WIN-RETRIEVAL-EVIDENCE` | CodeGraph sidecar 随项目索引启动 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-CODEGRAPH-SIDECAR-LIFECYCLE-02` | `codegraph-sidecar-lifecycle` | `WIN-RETRIEVAL-EVIDENCE` | 项目关闭后 sidecar 资源释放 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-CODEGRAPH-SIDECAR-LIFECYCLE-03` | `codegraph-sidecar-lifecycle` | `WIN-RETRIEVAL-EVIDENCE` | 状态 API 报告当前项目 sidecar 状态 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-CONFIGURE-CHIPMATE-SERVER-01` | `configure-chipmate-server` | `WIN-SETTINGS-PROVIDER` | 设置页只显示一个 ChipMate Server 地址 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-CONFIGURE-CHIPMATE-SERVER-02` | `configure-chipmate-server` | `WIN-SETTINGS-PROVIDER` | Server 地址保存后被 Skill Market 使用 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-CONFIGURE-CHIPMATE-SERVER-03` | `configure-chipmate-server` | `WIN-SETTINGS-PROVIDER` | Server 地址保存后被文档渲染使用 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-CONFIGURE-CHIPMATE-SERVER-04` | `configure-chipmate-server` | `WIN-SETTINGS-PROVIDER` | 窄宽度下 Server 表单不越界 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-DEFAULT-DOCUMENT-RAG-DISCOVERY-01` | `default-document-rag-discovery` | `WIN-INDEXING-LIFECYCLE` | 内部新 Profile 默认启用 Code RAG | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-DEFAULT-DOCUMENT-RAG-DISCOVERY-02` | `default-document-rag-discovery` | `WIN-INDEXING-LIFECYCLE` | 内部新 Profile 默认启用 Document RAG | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-DEFAULT-DOCUMENT-RAG-DISCOVERY-03` | `default-document-rag-discovery` | `WIN-INDEXING-LIFECYCLE` | 自动发现文档不超过数量和大小预算 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-DOCUMENT-RAG-V1-01` | `document-rag-v1` | `WIN-RETRIEVAL-EVIDENCE` | Document RAG 索引固定文档夹具 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-DOCUMENT-RAG-V1-02` | `document-rag-v1` | `WIN-RETRIEVAL-EVIDENCE` | document_search 召回固定证据与行号 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-DOCUMENT-RAG-V1-03` | `document-rag-v1` | `WIN-RETRIEVAL-EVIDENCE` | Windows 离线包实际加载 pdftotext.exe | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-EXPOSE-INTERNAL-RETRIEVAL-TOOLS-01` | `expose-internal-retrieval-tools` | `WIN-RETRIEVAL-EVIDENCE` | 启用索引后立即暴露 codebase_analysis | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-EXPOSE-INTERNAL-RETRIEVAL-TOOLS-02` | `expose-internal-retrieval-tools` | `WIN-RETRIEVAL-EVIDENCE` | 启用索引后立即暴露 semantic_search | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-EXPOSE-INTERNAL-RETRIEVAL-TOOLS-03` | `expose-internal-retrieval-tools` | `WIN-RETRIEVAL-EVIDENCE` | 启用文档索引后立即暴露 document_search | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-EXPOSE-INTERNAL-RETRIEVAL-TOOLS-04` | `expose-internal-retrieval-tools` | `WIN-RETRIEVAL-EVIDENCE` | 提示词优先指导索引检索再使用精确搜索 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-EXTENSION-MARKET-BATCH-UPLOAD-01` | `extension-market-batch-upload` | `WIN-MARKETPLACE` | 选择多个 VSIX 时按有界批次上传 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-EXTENSION-MARKET-BATCH-UPLOAD-02` | `extension-market-batch-upload` | `WIN-MARKETPLACE` | 从文件夹只收集 VSIX | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-EXTENSION-MARKET-BATCH-UPLOAD-03` | `extension-market-batch-upload` | `WIN-MARKETPLACE` | ZIP 中 VSIX 可上传且无关文件不上传 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-EXTENSION-MARKET-BATCH-UPLOAD-04` | `extension-market-batch-upload` | `WIN-MARKETPLACE` | TAR.GZ 中 VSIX 可上传且无关文件不上传 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-EXTENSION-MARKET-UNLIMITED-BATCHES-01` | `extension-market-unlimited-batches` | `WIN-MARKETPLACE` | 选择数量不受 UI 人为上限限制 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-EXTENSION-MARKET-UNLIMITED-BATCHES-02` | `extension-market-unlimited-batches` | `WIN-MARKETPLACE` | 上传按固定并发批次执行 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-EXTENSION-MARKET-UNLIMITED-BATCHES-03` | `extension-market-unlimited-batches` | `WIN-MARKETPLACE` | 认证恢复后从未完成批次继续 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-EXTENSION-MARKET-UNLIMITED-BATCHES-04` | `extension-market-unlimited-batches` | `WIN-MARKETPLACE` | 取消后不再开始新上传 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-EXTENSION-MARKET-UNLIMITED-BATCHES-05` | `extension-market-unlimited-batches` | `WIN-MARKETPLACE` | 实例级资源上限在并发上传中生效 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-FAST-CODEGRAPH-FULL-SCAN-01` | `fast-codegraph-full-scan` | `WIN-RETRIEVAL-EVIDENCE` | 未变化 graph records 被复用 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-FAST-CODEGRAPH-FULL-SCAN-02` | `fast-codegraph-full-scan` | `WIN-RETRIEVAL-EVIDENCE` | 未变化 BM25 postings 被复用 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-FAST-CODEGRAPH-FULL-SCAN-03` | `fast-codegraph-full-scan` | `WIN-RETRIEVAL-EVIDENCE` | 删除文件在扫描完成后被清理 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-FAST-CODEGRAPH-FULL-SCAN-04` | `fast-codegraph-full-scan` | `WIN-RETRIEVAL-EVIDENCE` | 支持文件通过 worker pool 解析 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-FAST-CODEGRAPH-FULL-SCAN-05` | `fast-codegraph-full-scan` | `WIN-RETRIEVAL-EVIDENCE` | worker pool 不可用时回退扫描完成 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-FIX-CHIPMATE-WORK-STYLE-WELCOME-01` | `fix-chipmate-work-style-welcome` | `WIN-BRANDING-FIRST-RUN` | 首次安装 Welcome 全部显示 ChipMate | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-FIX-CHIPMATE-WORK-STYLE-WELCOME-02` | `fix-chipmate-work-style-welcome` | `WIN-BRANDING-FIRST-RUN` | 无有效偏好时 chat model 保持未选择 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-FIX-CHIPMATE-WORK-STYLE-WELCOME-03` | `fix-chipmate-work-style-welcome` | `WIN-BRANDING-FIRST-RUN` | 未选择模型时发送动作不可执行 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-FIX-INDEXING-MODEL-BLUR-01` | `fix-indexing-model-blur` | `WIN-SETTINGS-PROVIDER` | 自定义 embedding model 在 blur 后保持 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-FIX-INDEXING-MODEL-BLUR-02` | `fix-indexing-model-blur` | `WIN-SETTINGS-PROVIDER` | 自定义 dimension 在 blur 后保持 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-FIX-LOCAL-SKILL-REMOVAL-01` | `fix-local-skill-removal` | `WIN-MARKETPLACE` | 删除本地 Skill 后列表立即移除 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-FIX-LOCAL-SKILL-REMOVAL-02` | `fix-local-skill-removal` | `WIN-MARKETPLACE` | 删除失败时显示错误 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-FIX-LOCAL-SKILL-REMOVAL-03` | `fix-local-skill-removal` | `WIN-MARKETPLACE` | 删除后本地 import registry 同步 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-FIX-NODE-NAVIGATOR-01` | `fix-node-navigator` | `WIN-QWEN-AUTOCOMPLETE` | Node 22 Extension Host 可激活 ChipMate | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-FIX-NODE-NAVIGATOR-02` | `fix-node-navigator` | `WIN-QWEN-AUTOCOMPLETE` | Qwen FIM 请求不发送不兼容 suffix | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-FIX-NODE-NAVIGATOR-03` | `fix-node-navigator` | `WIN-QWEN-AUTOCOMPLETE` | 自动补全选择状态说明正确 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-FIX-NODE-NAVIGATOR-04` | `fix-node-navigator` | `WIN-QWEN-AUTOCOMPLETE` | 切换到 Qwen 后旧 Classic provider 不触发认证等待 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-FOCUS-CUSTOM-PROVIDER-MODELS-01` | `focus-custom-provider-models` | `WIN-SETTINGS-PROVIDER` | Prompt 模型选择器默认只展开已配置自定义 Provider | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-FOCUS-CUSTOM-PROVIDER-MODELS-02` | `focus-custom-provider-models` | `WIN-SETTINGS-PROVIDER` | 无 Provider 首次设置态没有空白预览区域 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-HONOR-PACKAGED-CHIPMATE-SERVER-DEFAULT-01` | `honor-packaged-chipmate-server-default` | `WIN-SETTINGS-PROVIDER` | 没有用户覆盖时读取打包 ChipMate Server 默认值 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-HONOR-PACKAGED-CHIPMATE-SERVER-DEFAULT-02` | `honor-packaged-chipmate-server-default` | `WIN-SETTINGS-PROVIDER` | 用户覆盖优先于打包默认值 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-HONOR-PACKAGED-CHIPMATE-SERVER-DEFAULT-03` | `honor-packaged-chipmate-server-default` | `WIN-SETTINGS-PROVIDER` | 清除用户覆盖后恢复打包默认值 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-IMPORT-LOCAL-SKILLS-01` | `import-local-skills` | `WIN-MARKETPLACE` | 从文件夹导入合法 Skill | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-IMPORT-LOCAL-SKILLS-02` | `import-local-skills` | `WIN-MARKETPLACE` | 从 SKILL.md 导入合法 Skill | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-IMPORT-LOCAL-SKILLS-03` | `import-local-skills` | `WIN-MARKETPLACE` | 从 ZIP 导入合法 Skill | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-IMPORT-LOCAL-SKILLS-04` | `import-local-skills` | `WIN-MARKETPLACE` | 从 TAR.GZ 导入合法 Skill | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-IMPORT-LOCAL-SKILLS-05` | `import-local-skills` | `WIN-MARKETPLACE` | 非法 Skill 在写入前被拒绝 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-IMPORT-LOCAL-SKILLS-06` | `import-local-skills` | `WIN-MARKETPLACE` | 项目级导入原子提交 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-IMPORT-LOCAL-SKILLS-07` | `import-local-skills` | `WIN-MARKETPLACE` | 全局导入原子提交 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-IMPORT-LOCAL-SKILLS-08` | `import-local-skills` | `WIN-MARKETPLACE` | Skill Hub 发布已验证快照 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-INDEXING-ABANDONED-ARTIFACT-CLEANUP-01` | `indexing-abandoned-artifact-cleanup` | `WIN-INDEXING-LIFECYCLE` | 中断 CodeGraph 产物在恢复时安全清理 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-INDEXING-ABANDONED-ARTIFACT-CLEANUP-02` | `indexing-abandoned-artifact-cleanup` | `WIN-INDEXING-LIFECYCLE` | 中断 RAG 产物在恢复时安全清理 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-INDEXING-ABANDONED-ARTIFACT-CLEANUP-03` | `indexing-abandoned-artifact-cleanup` | `WIN-INDEXING-LIFECYCLE` | 当前有效索引文件不会被清理 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-INDEXING-FAILURE-OBSERVABILITY-01` | `indexing-failure-observability` | `WIN-INDEXING-LIFECYCLE` | 索引失败显示在 VS Code 诊断 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-INDEXING-FAILURE-OBSERVABILITY-02` | `indexing-failure-observability` | `WIN-INDEXING-LIFECYCLE` | 状态 API 保留最近失败 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-INDEXING-FAILURE-OBSERVABILITY-03` | `indexing-failure-observability` | `WIN-INDEXING-LIFECYCLE` | 日志包含失败 pipeline 与项目且不含密钥 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-INDEXING-SETTINGS-HOT-RELOAD-01` | `indexing-settings-hot-reload` | `WIN-INDEXING-LIFECYCLE` | 保存 embedding 设置不会重建 CodeGraph | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-INDEXING-SETTINGS-HOT-RELOAD-02` | `indexing-settings-hot-reload` | `WIN-INDEXING-LIFECYCLE` | 保存确认后 Settings save bar 清除 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-INDEXING-SETTINGS-HOT-RELOAD-03` | `indexing-settings-hot-reload` | `WIN-INDEXING-LIFECYCLE` | 新 embedding 设置用于下一次 RAG 构建 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-INDEXING-TOOLBAR-CODICONS-01` | `indexing-toolbar-codicons` | `WIN-INDEXING-LIFECYCLE` | RAG 状态动作使用 VS Code Codicon | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-INDEXING-TOOLBAR-CODICONS-02` | `indexing-toolbar-codicons` | `WIN-INDEXING-LIFECYCLE` | CodeGraph 状态动作使用 VS Code Codicon | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-INDEXING-TOOLBAR-CODICONS-03` | `indexing-toolbar-codicons` | `WIN-INDEXING-LIFECYCLE` | 窄宽度下状态图标保持可操作 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-INDEXING-UPGRADE-RECOVERY-01` | `indexing-upgrade-recovery` | `WIN-INDEXING-LIFECYCLE` | stale indexing lock 不阻塞升级恢复 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-INDEXING-UPGRADE-RECOVERY-02` | `indexing-upgrade-recovery` | `WIN-INDEXING-LIFECYCLE` | 兼容索引在升级后复用 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-INDEXING-UPGRADE-RECOVERY-03` | `indexing-upgrade-recovery` | `WIN-INDEXING-LIFECYCLE` | 不兼容索引只重建受影响部分 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-INTERNAL-LINUX-VSIX-01` | `internal-linux-vsix` | `WIN-PACKAGE-INSTALL` | 显式 linux-x64-baseline 构建生成离线 VSIX | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-INTERNAL-LINUX-VSIX-02` | `internal-linux-vsix` | `WIN-PACKAGE-INSTALL` | Linux 包包含索引运行时依赖 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-INTERNAL-LINUX-VSIX-03` | `internal-linux-vsix` | `WIN-PACKAGE-INSTALL` | Linux 包运行时不下载依赖 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-INTERNAL-OFFLINE-GATEWAY-LOGIN-01` | `internal-offline-gateway-login` | `WIN-BRANDING-FIRST-RUN` | 内部离线首次启动不显示 Gateway 登录 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-INTERNAL-OFFLINE-GATEWAY-LOGIN-02` | `internal-offline-gateway-login` | `WIN-BRANDING-FIRST-RUN` | 内部离线首次启动不请求公共 Profile | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-INTERNAL-VSIX-UPDATE-CHECK-01` | `internal-vsix-update-check` | `WIN-UPDATE` | 内部更新检查读取 manifest | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-INTERNAL-VSIX-UPDATE-CHECK-02` | `internal-vsix-update-check` | `WIN-UPDATE` | 无更新时不显示安装提示 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-INTERNAL-VSIX-UPDATE-CHECK-03` | `internal-vsix-update-check` | `WIN-UPDATE` | 有兼容更新时显示安装提示 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-ISOLATE-CHIPMATE-V2-01` | `isolate-chipmate-v2` | `WIN-IDENTITY-UPGRADE` | ChipMate 与 Kilo 可在同一 Profile 激活 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-ISOLATE-CHIPMATE-V2-02` | `isolate-chipmate-v2` | `WIN-IDENTITY-UPGRADE` | 命令命名空间隔离 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-ISOLATE-CHIPMATE-V2-03` | `isolate-chipmate-v2` | `WIN-IDENTITY-UPGRADE` | 配置命名空间隔离 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-ISOLATE-CHIPMATE-V2-04` | `isolate-chipmate-v2` | `WIN-IDENTITY-UPGRADE` | 视图命名空间隔离 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-ISOLATE-CHIPMATE-V2-05` | `isolate-chipmate-v2` | `WIN-IDENTITY-UPGRADE` | storage 根隔离 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-ISOLATE-CHIPMATE-V2-06` | `isolate-chipmate-v2` | `WIN-IDENTITY-UPGRADE` | backend 状态隔离 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-ISOLATE-CHIPMATE-V2-07` | `isolate-chipmate-v2` | `WIN-IDENTITY-UPGRADE` | indexing 数据隔离 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-ISOLATE-CHIPMATE-V2-08` | `isolate-chipmate-v2` | `WIN-IDENTITY-UPGRADE` | autocomplete ownership 隔离 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-ISOLATE-CHIPMATE-V2-09` | `isolate-chipmate-v2` | `WIN-IDENTITY-UPGRADE` | 后续 v2 更新校验不超过 256 MiB | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-KEEP-INDEXING-PROJECT-BOUND-01` | `keep-indexing-project-bound` | `WIN-INDEXING-LIFECYCLE` | 索引状态请求使用当前面板项目目录 | ✅ 已实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-KEEP-INDEXING-PROJECT-BOUND-02` | `keep-indexing-project-bound` | `WIN-INDEXING-LIFECYCLE` | 其他项目 indexing 事件被忽略 | ✅ 已实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-KEEP-INDEXING-PROJECT-BOUND-03` | `keep-indexing-project-bound` | `WIN-INDEXING-LIFECYCLE` | 两个项目面板的索引状态互不覆盖 | ✅ 已实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-KEEP-INDEXING-PROJECT-BOUND-04` | `keep-indexing-project-bound` | `WIN-INDEXING-LIFECYCLE` | 项目切换后旧 HTTP 响应被丢弃 | ✅ 已实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-KEEP-INDEXING-PROJECT-BOUND-05` | `keep-indexing-project-bound` | `WIN-INDEXING-LIFECYCLE` | Document RAG 选目录相对当前面板项目 | ✅ 已实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-KEEP-INDEXING-PROJECT-BOUND-06` | `keep-indexing-project-bound` | `WIN-INDEXING-LIFECYCLE` | 项目切换后旧 Document RAG 动作被丢弃 | ✅ 已实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-KEEP-INDEXING-PROJECT-BOUND-07` | `keep-indexing-project-bound` | `WIN-INDEXING-LIFECYCLE` | Agent Manager session 路由恢复到对应项目 | ✅ 已实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-KEEP-PACKAGED-MERMAID-TOOLS-01` | `keep-packaged-mermaid-tools` | `WIN-PACKAGE-INSTALL` | 打包客户端工具列表包含 Mermaid 工具 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-KEEP-PACKAGED-MERMAID-TOOLS-02` | `keep-packaged-mermaid-tools` | `WIN-PACKAGE-INSTALL` | 普通 Mermaid 操作不提前加载图像裁剪运行时 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-KEEP-PACKAGED-MERMAID-TOOLS-03` | `keep-packaged-mermaid-tools` | `WIN-PACKAGE-INSTALL` | 需要本地裁剪时才加载图像运行时 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-LANCEDB-DEFAULT-VECTOR-STORE-01` | `lancedb-default-vector-store` | `WIN-INDEXING-LIFECYCLE` | 新索引设置默认 vector store 为 LanceDB | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-LANCEDB-DEFAULT-VECTOR-STORE-02` | `lancedb-default-vector-store` | `WIN-INDEXING-LIFECYCLE` | 默认设置不要求 Qdrant 服务 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-LANCEDB-SCHEMA-REBUILD-NOTICE-01` | `lancedb-schema-rebuild-notice` | `WIN-INDEXING-LIFECYCLE` | 旧 LanceDB schema 自动触发 RAG 重建 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-LANCEDB-SCHEMA-REBUILD-NOTICE-02` | `lancedb-schema-rebuild-notice` | `WIN-INDEXING-LIFECYCLE` | 重建通知对用户可见 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-LANCEDB-SCHEMA-REBUILD-NOTICE-03` | `lancedb-schema-rebuild-notice` | `WIN-INDEXING-LIFECYCLE` | RAG schema 重建保留 CodeGraph 数据 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-LOCALIZE-INDEXING-SETTINGS-01` | `localize-indexing-settings` | `WIN-SETTINGS-PROVIDER` | 索引设置字段显示简体中文 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-LOCALIZE-INDEXING-SETTINGS-02` | `localize-indexing-settings` | `WIN-SETTINGS-PROVIDER` | 已知索引状态消息显示简体中文 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-LOCALIZE-INDEXING-SETTINGS-03` | `localize-indexing-settings` | `WIN-SETTINGS-PROVIDER` | 未知后端状态保留原文 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-MARKETPLACE-ALIGNED-WORKSPACE-01` | `marketplace-aligned-workspace` | `WIN-MARKETPLACE` | Skill Market 首页数据与服务一致 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-MARKETPLACE-ALIGNED-WORKSPACE-02` | `marketplace-aligned-workspace` | `WIN-MARKETPLACE` | 详情与版本页数据一致 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-MARKETPLACE-ALIGNED-WORKSPACE-03` | `marketplace-aligned-workspace` | `WIN-MARKETPLACE` | 收藏状态可持久化 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-MARKETPLACE-ALIGNED-WORKSPACE-04` | `marketplace-aligned-workspace` | `WIN-MARKETPLACE` | 安装状态可持久化 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-MARKETPLACE-ALIGNED-WORKSPACE-05` | `marketplace-aligned-workspace` | `WIN-MARKETPLACE` | 发布状态以服务端为准 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-MARKETPLACE-ALIGNED-WORKSPACE-06` | `marketplace-aligned-workspace` | `WIN-MARKETPLACE` | analytics 与 diagnostics 页面可访问 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-MARKETPLACE-ALIGNED-WORKSPACE-07` | `marketplace-aligned-workspace` | `WIN-MARKETPLACE` | legacy 与 Agent/MCP 模式仍可用 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-MARKETPLACE-ANALYTICS-HARDENING-01` | `marketplace-analytics-hardening` | `WIN-MARKETPLACE` | analytics 按固定批次发送匿名事件 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-MARKETPLACE-ANALYTICS-HARDENING-02` | `marketplace-analytics-hardening` | `WIN-MARKETPLACE` | analytics payload 不含身份密钥 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-MARKETPLACE-ANALYTICS-HARDENING-03` | `marketplace-analytics-hardening` | `WIN-MARKETPLACE` | 重连后只刷新作用域内缓存 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-MARKETPLACE-ANALYTICS-HARDENING-04` | `marketplace-analytics-hardening` | `WIN-MARKETPLACE` | 实时状态在重连后恢复 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-MARKETPLACE-IDENTITY-INSTALL-SYNC-01` | `marketplace-identity-install-sync` | `WIN-MARKETPLACE` | Market 身份与当前 Provider 身份一致 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-MARKETPLACE-IDENTITY-INSTALL-SYNC-02` | `marketplace-identity-install-sync` | `WIN-MARKETPLACE` | 收藏在 Web 与 ChipMate 间同步 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-MARKETPLACE-IDENTITY-INSTALL-SYNC-03` | `marketplace-identity-install-sync` | `WIN-MARKETPLACE` | 已验证 Skill 安装在 Web 与 ChipMate 间同步 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-MARKETPLACE-RAW-SKILL-UNPUBLISH-01` | `marketplace-raw-skill-unpublish` | `WIN-MARKETPLACE` | 内置 Skill 以原始 Markdown 发布 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-MARKETPLACE-RAW-SKILL-UNPUBLISH-02` | `marketplace-raw-skill-unpublish` | `WIN-MARKETPLACE` | 作者可以下架自己的 Market Skill | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-MARKETPLACE-RAW-SKILL-UNPUBLISH-03` | `marketplace-raw-skill-unpublish` | `WIN-MARKETPLACE` | 下架后历史 release 保持不可变 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-MARKETPLACE-UNIFIED-PUBLICATION-01` | `marketplace-unified-publication` | `WIN-MARKETPLACE` | Web 与 VS Code 使用同一服务端验证 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-MARKETPLACE-UNIFIED-PUBLICATION-02` | `marketplace-unified-publication` | `WIN-MARKETPLACE` | 修复结果由服务端权威返回 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-MARKETPLACE-UNIFIED-PUBLICATION-03` | `marketplace-unified-publication` | `WIN-MARKETPLACE` | 发布生成不可变 revision | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-MARKETPLACE-UNIFIED-PUBLICATION-04` | `marketplace-unified-publication` | `WIN-MARKETPLACE` | 相同输入在两个客户端得到相同发布状态 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-MEMORY-DEBUG-RECOVERY-01` | `memory-debug-recovery` | `WIN-QA-SESSION` | CLI 意外退出后自动重连 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-MEMORY-DEBUG-RECOVERY-02` | `memory-debug-recovery` | `WIN-QA-SESSION` | 重连后当前会话恢复 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-MEMORY-DEBUG-RECOVERY-03` | `memory-debug-recovery` | `WIN-QA-SESSION` | 本地 memory diagnostics 可导出 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-OPEN-EXTENSION-MARKET-01` | `open-extension-market` | `WIN-MARKETPLACE` | Skill Marketplace 面板入口打开配置的 Extension Market 地址 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-OPEN-EXTENSION-MARKET-02` | `open-extension-market` | `WIN-MARKETPLACE` | 未配置地址时显示可判定错误 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-PRESERVE-SLASH-DRAFTS-01` | `preserve-slash-drafts` | `WIN-QA-SESSION` | 选择 slash command 后已有草稿保留 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-PRESERVE-SLASH-DRAFTS-02` | `preserve-slash-drafts` | `WIN-QA-SESSION` | Settings close 按钮关闭编辑器 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-PROMPT-INPUT-LEGACY-ICONS-01` | `prompt-input-legacy-icons` | `WIN-QA-SESSION` | Prompt 选择器使用指定 legacy ChipMate 图标 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-PROMPT-INPUT-LEGACY-ICONS-02` | `prompt-input-legacy-icons` | `WIN-QA-SESSION` | 窄宽度 fallback 不遮挡发送与 overflow | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-PUBLISH-SKILL-RISK-GUIDANCE-01` | `publish-skill-risk-guidance` | `WIN-MARKETPLACE` | 非阻断风险不禁止发布 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-PUBLISH-SKILL-RISK-GUIDANCE-02` | `publish-skill-risk-guidance` | `WIN-MARKETPLACE` | 下载前显示中文风险提示 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-PUBLISH-SKILL-RISK-GUIDANCE-03` | `publish-skill-risk-guidance` | `WIN-MARKETPLACE` | 安装前显示中文风险提示 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-PUBLISH-SKILL-RISK-GUIDANCE-04` | `publish-skill-risk-guidance` | `WIN-MARKETPLACE` | 可直接从单个本地文件夹发布 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-QWEN-AUTOCOMPLETE-CACHE-01` | `qwen-autocomplete-cache` | `WIN-QWEN-AUTOCOMPLETE` | 相同 Qwen 请求命中内存缓存 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-QWEN-AUTOCOMPLETE-CACHE-02` | `qwen-autocomplete-cache` | `WIN-QWEN-AUTOCOMPLETE` | 上下文改变时不错误复用缓存 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-QWEN-AUTOCOMPLETE-CACHE-03` | `qwen-autocomplete-cache` | `WIN-QWEN-AUTOCOMPLETE` | 缓存命中返回相同候选 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-QWEN-CONTEXT-SELECTION-HARDENING-01` | `qwen-context-selection-hardening` | `WIN-QWEN-AUTOCOMPLETE` | 同文件片段按固定优先级注入 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-QWEN-CONTEXT-SELECTION-HARDENING-02` | `qwen-context-selection-hardening` | `WIN-QWEN-AUTOCOMPLETE` | 上下文诊断反映实际选择 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-QWEN-CONTEXT-SELECTION-HARDENING-03` | `qwen-context-selection-hardening` | `WIN-QWEN-AUTOCOMPLETE` | 被排除片段不进入 prompt | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-QWEN-DIAGNOSTICS-PROMPT-PREVIEW-01` | `qwen-diagnostics-prompt-preview` | `WIN-QWEN-AUTOCOMPLETE` | Qwen diagnostics 不包含 prompt preview | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-QWEN-DIRECT-AUTOCOMPLETE-01` | `qwen-direct-autocomplete` | `WIN-QWEN-AUTOCOMPLETE` | C 文件可启用 qwen-direct | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-QWEN-DIRECT-AUTOCOMPLETE-02` | `qwen-direct-autocomplete` | `WIN-QWEN-AUTOCOMPLETE` | C++ 文件可启用 qwen-direct | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-QWEN-DIRECT-AUTOCOMPLETE-03` | `qwen-direct-autocomplete` | `WIN-QWEN-AUTOCOMPLETE` | 候选以 ghost text 显示 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-QWEN-DIRECT-AUTOCOMPLETE-04` | `qwen-direct-autocomplete` | `WIN-QWEN-AUTOCOMPLETE` | Tab 接受候选 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-QWEN-DIRECT-AUTOCOMPLETE-05` | `qwen-direct-autocomplete` | `WIN-QWEN-AUTOCOMPLETE` | 取消动作移除候选 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-QWEN-DIRECT-OFFLINE-OBSERVABILITY-01` | `qwen-direct-offline-observability` | `WIN-QWEN-AUTOCOMPLETE` | 离线 diagnostics 包含请求阶段 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-QWEN-DIRECT-OFFLINE-OBSERVABILITY-02` | `qwen-direct-offline-observability` | `WIN-QWEN-AUTOCOMPLETE` | 离线 diagnostics 包含响应解析状态 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-QWEN-DIRECT-OFFLINE-OBSERVABILITY-03` | `qwen-direct-offline-observability` | `WIN-QWEN-AUTOCOMPLETE` | diagnostics 不含 API Key | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-QWEN-DIRECT-OFFLINE-OBSERVABILITY-04` | `qwen-direct-offline-observability` | `WIN-QWEN-AUTOCOMPLETE` | diagnostics 不含完整敏感源码 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-QWEN-HELPERVARS-TOKEN-BUDGET-01` | `qwen-helpervars-token-budget` | `WIN-QWEN-AUTOCOMPLETE` | Prompt token 预算符合 HelperVars 固定夹具 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-QWEN-HELPERVARS-TOKEN-BUDGET-02` | `qwen-helpervars-token-budget` | `WIN-QWEN-AUTOCOMPLETE` | 超预算上下文被确定性裁剪 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-QWEN-IMPORT-ROOT-CONTEXT-01` | `qwen-import-root-context` | `WIN-QWEN-AUTOCOMPLETE` | 启用后导入定义进入上下文 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-QWEN-IMPORT-ROOT-CONTEXT-02` | `qwen-import-root-context` | `WIN-QWEN-AUTOCOMPLETE` | 启用后 root path 进入上下文 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-QWEN-IMPORT-ROOT-CONTEXT-03` | `qwen-import-root-context` | `WIN-QWEN-AUTOCOMPLETE` | 禁用后两类上下文均不进入 prompt | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-QWEN-MULTILINE-SECURITY-PREFILTER-01` | `qwen-multiline-security-prefilter` | `WIN-QWEN-AUTOCOMPLETE` | 多行候选按固定分类器判定 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-QWEN-MULTILINE-SECURITY-PREFILTER-02` | `qwen-multiline-security-prefilter` | `WIN-QWEN-AUTOCOMPLETE` | 不安全候选在显示前被过滤 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-QWEN-MULTILINE-SECURITY-PREFILTER-03` | `qwen-multiline-security-prefilter` | `WIN-QWEN-AUTOCOMPLETE` | 安全过滤 diagnostics 不泄露源码 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-QWEN-NON-STREAMING-FILTERS-01` | `qwen-non-streaming-filters` | `WIN-QWEN-AUTOCOMPLETE` | non-stream 响应解析 choices[0].text | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-QWEN-NON-STREAMING-FILTERS-02` | `qwen-non-streaming-filters` | `WIN-QWEN-AUTOCOMPLETE` | 空候选不显示 ghost text | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-QWEN-NON-STREAMING-FILTERS-03` | `qwen-non-streaming-filters` | `WIN-QWEN-AUTOCOMPLETE` | 重复前缀候选被过滤 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-QWEN-NON-STREAMING-FILTERS-04` | `qwen-non-streaming-filters` | `WIN-QWEN-AUTOCOMPLETE` | diagnostics 记录过滤原因 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-QWEN-RECENTLY-EDITED-CONTEXT-01` | `qwen-recently-edited-context` | `WIN-QWEN-AUTOCOMPLETE` | 启用后 diagnostics 记录最近编辑范围 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-QWEN-RECENTLY-EDITED-CONTEXT-02` | `qwen-recently-edited-context` | `WIN-QWEN-AUTOCOMPLETE` | 禁用后不采集最近编辑范围 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-QWEN-RECENTLY-EDITED-SNIPPET-INJECTION-01` | `qwen-recently-edited-snippet-injection` | `WIN-QWEN-AUTOCOMPLETE` | 启用后最近编辑 snippet 注入 prompt | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-QWEN-RECENTLY-EDITED-SNIPPET-INJECTION-02` | `qwen-recently-edited-snippet-injection` | `WIN-QWEN-AUTOCOMPLETE` | 关闭设置后 snippet 不再注入 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-QWEN-RECENTLY-OPENED-CONTEXT-01` | `qwen-recently-opened-context` | `WIN-QWEN-AUTOCOMPLETE` | 启用后最近打开文件进入上下文 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-QWEN-RECENTLY-OPENED-CONTEXT-02` | `qwen-recently-opened-context` | `WIN-QWEN-AUTOCOMPLETE` | 超过预算的最近文件被裁剪 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-QWEN-RECENTLY-OPENED-CONTEXT-03` | `qwen-recently-opened-context` | `WIN-QWEN-AUTOCOMPLETE` | 关闭设置后最近文件不进入 prompt | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-REMOTE-MERMAID-RENDER-RESPONSE-01` | `remote-mermaid-render-response` | `WIN-DOCUMENTS` | 解析当前服务端 Mermaid PNG 响应 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-REMOTE-MERMAID-RENDER-RESPONSE-02` | `remote-mermaid-render-response` | `WIN-DOCUMENTS` | 保留服务端 render width | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-REMOTE-MERMAID-RENDER-RESPONSE-03` | `remote-mermaid-render-response` | `WIN-DOCUMENTS` | 保留服务端 render height | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-REMOTE-MERMAID-RENDER-RESPONSE-04` | `remote-mermaid-render-response` | `WIN-DOCUMENTS` | 保留服务端 QA issues | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-REMOTE-MERMAID-RENDER-RESPONSE-05` | `remote-mermaid-render-response` | `WIN-DOCUMENTS` | Word 插图保持请求顺序 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-REMOTE-MERMAID-RENDER-RESPONSE-06` | `remote-mermaid-render-response` | `WIN-DOCUMENTS` | 启动日志报告 renderer endpoint 来源 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-REMOVE-SIDEBAR-HISTORY-SHORTCUT-01` | `remove-sidebar-history-shortcut` | `WIN-QA-SESSION` | Welcome 状态不显示重复 history 按钮 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-REMOVE-SIDEBAR-HISTORY-SHORTCUT-02` | `remove-sidebar-history-shortcut` | `WIN-QA-SESSION` | 其他 History 入口仍可使用 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-RENDER-SERVICE-VSIX-AUTO-UPDATE-01` | `render-service-vsix-auto-update` | `WIN-UPDATE` | 更新 manifest target 与当前平台匹配 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-RENDER-SERVICE-VSIX-AUTO-UPDATE-02` | `render-service-vsix-auto-update` | `WIN-UPDATE` | VSIX 下载后校验 SHA-256 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-RENDER-SERVICE-VSIX-AUTO-UPDATE-03` | `render-service-vsix-auto-update` | `WIN-UPDATE` | 不兼容 target 不安装 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-RENDER-SERVICE-VSIX-AUTO-UPDATE-04` | `render-service-vsix-auto-update` | `WIN-UPDATE` | 校验失败不安装 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-RENDER-SERVICE-VSIX-AUTO-UPDATE-05` | `render-service-vsix-auto-update` | `WIN-UPDATE` | 安装完成后提示 Reload | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-REPAIR-TARGETED-DSML-CALLS-01` | `repair-targeted-dsml-calls` | `WIN-QA-SESSION` | 仅目标 Provider 和模型启用 DSML 修复 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-REPAIR-TARGETED-DSML-CALLS-02` | `repair-targeted-dsml-calls` | `WIN-QA-SESSION` | 泄漏 tool call 只重试一次 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-REPAIR-TARGETED-DSML-CALLS-03` | `repair-targeted-dsml-calls` | `WIN-QA-SESSION` | 截断 tool call 只重试一次 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-REPAIR-TARGETED-DSML-CALLS-04` | `repair-targeted-dsml-calls` | `WIN-QA-SESSION` | 重试工具没有业务副作用 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-REPAIR-TARGETED-DSML-CALLS-05` | `repair-targeted-dsml-calls` | `WIN-QA-SESSION` | 修复逻辑不猜测业务工具 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-RESTORE-INDEXING-FIELD-INPUT-01` | `restore-indexing-field-input` | `WIN-SETTINGS-PROVIDER` | embedding model 逐字符输入不丢字 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-RESTORE-INDEXING-FIELD-INPUT-02` | `restore-indexing-field-input` | `WIN-SETTINGS-PROVIDER` | dimension 逐字符输入不丢字 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-RESTORE-INDEXING-FIELD-INPUT-03` | `restore-indexing-field-input` | `WIN-SETTINGS-PROVIDER` | 输入期间 provider 不被重置 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-RESTORE-NATIVE-REASONING-STREAM-01` | `restore-native-reasoning-stream` | `WIN-QA-SESSION` | 流式 reasoning 分片按顺序显示 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-RESTORE-NATIVE-REASONING-STREAM-02` | `restore-native-reasoning-stream` | `WIN-QA-SESSION` | 流式文本分片按顺序显示 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-RESTORE-NATIVE-REASONING-STREAM-03` | `restore-native-reasoning-stream` | `WIN-QA-SESSION` | reasoning 与文本不重复 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-SEQUENTIAL-INDEXING-01` | `sequential-indexing` | `WIN-INDEXING-LIFECYCLE` | CodeGraph 在 Code RAG 前启动 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-SEQUENTIAL-INDEXING-02` | `sequential-indexing` | `WIN-INDEXING-LIFECYCLE` | Code RAG 在 Document RAG 前启动 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-SEQUENTIAL-INDEXING-03` | `sequential-indexing` | `WIN-INDEXING-LIFECYCLE` | 三个 pipeline 不并发争用初始全量扫描 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-SKILL-MARKET-IDENTITY-ICONS-01` | `skill-market-identity-icons` | `WIN-MARKETPLACE` | Market 用户身份来自活动 Provider | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-SKILL-MARKET-IDENTITY-ICONS-02` | `skill-market-identity-icons` | `WIN-MARKETPLACE` | Skill 动作状态与身份权限一致 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-SKILL-MARKET-IDENTITY-ICONS-03` | `skill-market-identity-icons` | `WIN-MARKETPLACE` | Market 图标可加载 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-SKILL-MARKET-IDENTITY-ICONS-04` | `skill-market-identity-icons` | `WIN-MARKETPLACE` | Market 文案显示简体中文 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-SOFTEN-TASK-HUD-01` | `soften-task-hud` | `WIN-QA-SESSION` | 任务 HUD 使用轻量 context strip | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-SOFTEN-TASK-HUD-02` | `soften-task-hud` | `WIN-QA-SESSION` | HUD 不遮挡消息内容 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-SOFTEN-TASK-HUD-03` | `soften-task-hud` | `WIN-QA-SESSION` | 任务统计仍可读取 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-SOURCE-BACKED-WORD-VISUAL-QUALITY-01` | `source-backed-word-visual-quality` | `WIN-DOCUMENTS` | context parent 与 target module 被正确区分 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-SOURCE-BACKED-WORD-VISUAL-QUALITY-02` | `source-backed-word-visual-quality` | `WIN-DOCUMENTS` | 每个确认子模块都有源码证据 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-SOURCE-BACKED-WORD-VISUAL-QUALITY-03` | `source-backed-word-visual-quality` | `WIN-DOCUMENTS` | 输出包含五类视图 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-SOURCE-BACKED-WORD-VISUAL-QUALITY-04` | `source-backed-word-visual-quality` | `WIN-DOCUMENTS` | Word 内容按稳定顺序组装 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-SOURCE-BACKED-WORD-VISUAL-QUALITY-05` | `source-backed-word-visual-quality` | `WIN-DOCUMENTS` | 中文输出可读 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-SOURCE-BACKED-WORD-VISUAL-QUALITY-06` | `source-backed-word-visual-quality` | `WIN-DOCUMENTS` | 原生目录页码验证通过 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-SOURCE-BACKED-WORD-VISUAL-QUALITY-07` | `source-backed-word-visual-quality` | `WIN-DOCUMENTS` | page evidence 与 visual review 状态分开记录 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-STABILIZE-INDEXING-PIPELINE-01` | `stabilize-indexing-pipeline` | `WIN-INDEXING-LIFECYCLE` | 自动索引在新项目稳定完成 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-STABILIZE-INDEXING-PIPELINE-02` | `stabilize-indexing-pipeline` | `WIN-INDEXING-LIFECYCLE` | 项目 A 与 B 索引数据隔离 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-STABILIZE-INDEXING-PIPELINE-03` | `stabilize-indexing-pipeline` | `WIN-INDEXING-LIFECYCLE` | 中断后自动恢复 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-STABILIZE-INDEXING-PIPELINE-04` | `stabilize-indexing-pipeline` | `WIN-INDEXING-LIFECYCLE` | 显式配置覆盖默认行为 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-STABILIZE-LONG-SESSION-NAVIGATION-01` | `stabilize-long-session-navigation` | `WIN-QA-SESSION` | 长会话流式输出期间 UI 保持响应 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-STABILIZE-LONG-SESSION-NAVIGATION-02` | `stabilize-long-session-navigation` | `WIN-QA-SESSION` | 长历史切换期间 UI 保持响应 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-STABILIZE-LONG-SESSION-NAVIGATION-03` | `stabilize-long-session-navigation` | `WIN-QA-SESSION` | 崩溃重连后可继续导航 | ⬜ 未实现 | ⬜ 未实现 | 🚫 非 Windows 冒烟范围 |
| `REG-START-INDEXING-PIPELINES-01` | `start-indexing-pipelines` | `WIN-INDEXING-LIFECYCLE` | 内部项目自动启动 CodeGraph | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-START-INDEXING-PIPELINES-02` | `start-indexing-pipelines` | `WIN-INDEXING-LIFECYCLE` | CodeGraph 后自动启动 Code RAG | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-START-INDEXING-PIPELINES-03` | `start-indexing-pipelines` | `WIN-INDEXING-LIFECYCLE` | Code RAG 后自动启动 Document RAG | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-START-INDEXING-PIPELINES-04` | `start-indexing-pipelines` | `WIN-INDEXING-LIFECYCLE` | 显式关闭时三个自动启动均不发生 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-VERIFY-MACOS-CHIPMATE-V2-01` | `verify-macos-chipmate-v2` | `WIN-PACKAGE-INSTALL` | darwin-arm64 内部 VSIX 通过签名式 manifest 校验 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-VERIFY-MACOS-CHIPMATE-V2-02` | `verify-macos-chipmate-v2` | `WIN-PACKAGE-INSTALL` | Open in Tab 命令在激活 probe 中存在 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-VERIFY-MACOS-CHIPMATE-V2-03` | `verify-macos-chipmate-v2` | `WIN-PACKAGE-INSTALL` | 无工作区启动时索引保持 idle | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-VSCODE-193-SUPPORT-01` | `vscode-193-support` | `WIN-PACKAGE-INSTALL` | VS Code 1.93 可激活扩展 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
| `REG-VSCODE-193-SUPPORT-02` | `vscode-193-support` | `WIN-PACKAGE-INSTALL` | VS Code 1.93 可注册关键命令与视图 | ⬜ 未实现 | ⬜ 未实现 | ⬜ 未实现 |
