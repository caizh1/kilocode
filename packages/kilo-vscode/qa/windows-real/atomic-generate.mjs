#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const dir = dirname(fileURLToPath(import.meta.url))
const root = join(dir, "../../../..")
const matrix = JSON.parse(readFileSync(join(dir, "cases.json"), "utf8"))
const parents = new Map(matrix.cases.flatMap((item) => item.changesets.map((change) => [change, item.id])))
const checks = {
  "agent-console-webview": [
    "Agent Console 使用真实交互终端",
    "Agent 审批命令执行并显示输出",
    "高风险命令触发二次确认",
    "取消审批后命令没有执行",
    "侧边栏快捷入口打开同一个 Agent Console",
  ],
  "fix-agent-console-windows-powershell": [
    { id: "REG-AGENT-CONSOLE-SINGLE-SHELL-01", title: "Agent 模式不存在独立 textarea 且只有一个可见 Shell 提示符" },
    { id: "REG-AGENT-CONSOLE-SINGLE-SHELL-02", title: "已知命令直接执行且自然语言进入 Agent" },
    { id: "REG-AGENT-CONSOLE-SINGLE-SHELL-03", title: "连续 100 次 Enter 零丢失零重复" },
    { id: "REG-AGENT-CONSOLE-SINGLE-SHELL-04", title: "流式输出和 50 次模式切换没有空白帧或 DOM 重挂载" },
    { id: "REG-AGENT-CONSOLE-SINGLE-SHELL-05", title: "用户上滚后不被自动拉回底部" },
    { id: "REG-AGENT-CONSOLE-SINGLE-SHELL-06", title: "ARM VM 与原生 x64 结果分别记录且不能互相替代" },
    { id: "REG-FIX-AGENT-CONSOLE-WINDOWS-POWERSHELL-01", title: "Windows Agent Console 启动 PowerShell 7 或 Windows PowerShell 5.1" },
    { id: "REG-FIX-AGENT-CONSOLE-WINDOWS-POWERSHELL-02", title: "PSReadLine 捕获别名函数与 PATH 命令" },
    { id: "REG-FIX-AGENT-CONSOLE-WINDOWS-POWERSHELL-03", title: "中文 IME 第一 Enter 只提交候选且第二 Enter 才路由" },
    { id: "REG-FIX-AGENT-CONSOLE-WINDOWS-POWERSHELL-04", title: "PowerShell 捕获超时不清除当前编辑行" },
  ],
  "align-qa-liquid-glass": [
    "940px 下 Composer 工具栏保持单行且控件可操作",
    "560px 下语义选择器、索引和工具组不重叠",
    "420px 下关键动作不越界",
    "300px 下工具栏严格为两行且索引与 overflow 可操作",
    "Light、Dark 与高对比度主题结构一致",
    "任务统计、索引状态、工具和设置控件均未丢失",
    "任务头只显示一个分层 HUD",
    "消息和工具边界没有重复容器",
  ],
  "align-qwen-autocomplete": [
    "Qwen 触发时机符合固定 Continue 夹具",
    "FIM prompt 与 stop 序列符合固定夹具",
    "采样默认值符合固定夹具",
    "Python 文件可触发补全",
    "Shell 文件可触发补全",
    "Gitea Workflow 文件可触发补全",
  ],
  "align-subagent-model-controls": ["Models 设置页的子代理模型选择器状态与主模型选择器一致"],
  "atomic-skill-market-tools": [
    "普通 QA 未明确请求 Skill Market 时不暴露市场写工具",
    "明确请求后搜索工具返回远端 Skill 结果",
    "安装工具使用一次性审批并原子记录安装",
    "创建工具只写入隔离的 qa-e2e Skill 夹具",
    "发布工具以原子事务生成不可变 revision",
    "发布失败时不残留部分对象或中间状态",
    "进程崩溃后事务可恢复或返回可判定终态",
    "一次性审批或 intent 重放被拒绝",
    "撤销仅作用于当前 owner 的目标发布并恢复前态",
    "取消操作后未批准的 Market 副作用不会执行",
  ],
  "bounded-indexing-process": [
    "大工作区重建期间索引进程内存保持在预算内",
    "索引子进程失败不导致主 CLI 退出",
    "隔离进程重启后检索语义保持一致",
  ],
  "chipmate-chinese-branding": ["所有简体中文用户可见品牌文案显示 ChipMate"],
  "chipmate-default-chinese": ["新 Profile 首次启动默认使用简体中文", "Auto 语言选项仍可选择并持久化"],
  "chipmate-vscode-icons": ["扩展身份显示 ChipMate", "活动栏与扩展图标资源可加载"],
  "chipmate-windows-ripgrep": ["Windows 离线索引实际加载 VSIX 内的 rg.exe", "断网时没有 GitHub ripgrep 下载请求"],
  "clear-lions-compress": ["上下文压缩只显示一个状态卡", "内部 summary worker 消息不显示给用户"],
  "clear-recovered-rag-diagnostics": [
    "401 响应产生 RAG authentication failed 诊断",
    "再次失败的验证不会清除现有 RAG 诊断",
    "成功的 live validation 清除旧 RAG 认证诊断",
    "清除 RAG 诊断时保留 CodeGraph 诊断",
    "清除 RAG 诊断时保留 Document RAG 诊断",
  ],
  "close-skill-publication-progress": [
    "发布 API 返回后 progress 立即关闭",
    "后续 refresh 不重新打开 progress",
    "后续 repair 不阻塞 progress 关闭",
  ],
  "codebase-analysis-bm25-fusion": ["hybrid 模式结果包含 BM25 证据", "BM25 证据参与固定 fusion 排序"],
  "codebase-analysis-graph-evidence": ["graph-only 返回有效 C/C++ graph 证据", "每条 graph 证据包含文件路径与行号"],
  "codebase-analysis-phase-zero": ["工具列表包含 codebase_analysis", "工具返回受预算限制的 source-backed 结果"],
  "codebase-analysis-vector-fusion": ["hybrid 模式复用现有向量证据", "向量证据与 graph、BM25 一起参与固定 fusion"],
  "codegraph-parser-storage": [
    "C/C++ parser 生成固定 graph records",
    "graph sidecar 落盘到当前项目专属目录",
    "重新打开项目可读取兼容 sidecar",
  ],
  "codegraph-parser-worker-sidecar": [
    "打包客户端能启动 CodeGraph parser worker",
    "graph-only 扫描使用 worker pool",
    "worker 失败时回退路径仍完成扫描",
  ],
  "codegraph-sidecar-lifecycle": [
    "CodeGraph sidecar 随项目索引启动",
    "项目关闭后 sidecar 资源释放",
    "状态 API 报告当前项目 sidecar 状态",
  ],
  "configure-chipmate-server": [
    "设置页只显示一个 ChipMate Server 地址",
    "Server 地址保存后被 Skill Market 使用",
    "Server 地址保存后被文档渲染使用",
    "窄宽度下 Server 表单不越界",
  ],
  "default-document-rag-discovery": [
    "内部新 Profile 默认启用 Code RAG",
    "内部新 Profile 默认启用 Document RAG",
    "自动发现文档不超过数量和大小预算",
  ],
  "document-rag-v1": [
    "Document RAG 索引固定文档夹具",
    "document_search 召回固定证据与行号",
    "Windows 离线包实际加载 pdftotext.exe",
  ],
  "expose-internal-retrieval-tools": [
    "启用索引后立即暴露 codebase_analysis",
    "启用索引后立即暴露 semantic_search",
    "启用文档索引后立即暴露 document_search",
    "提示词优先指导索引检索再使用精确搜索",
  ],
  "extension-market-batch-upload": [
    "选择多个 VSIX 时按有界批次上传",
    "从文件夹只收集 VSIX",
    "ZIP 中 VSIX 可上传且无关文件不上传",
    "TAR.GZ 中 VSIX 可上传且无关文件不上传",
  ],
  "extension-market-unlimited-batches": [
    "选择数量不受 UI 人为上限限制",
    "上传按固定并发批次执行",
    "认证恢复后从未完成批次继续",
    "取消后不再开始新上传",
    "实例级资源上限在并发上传中生效",
  ],
  "fast-codegraph-full-scan": [
    "未变化 graph records 被复用",
    "未变化 BM25 postings 被复用",
    "删除文件在扫描完成后被清理",
    "支持文件通过 worker pool 解析",
    "worker pool 不可用时回退扫描完成",
  ],
  "fix-chipmate-work-style-welcome": [
    "首次安装 Welcome 全部显示 ChipMate",
    "无有效偏好时 chat model 保持未选择",
    "未选择模型时发送动作不可执行",
  ],
  "fix-indexing-model-blur": ["自定义 embedding model 在 blur 后保持", "自定义 dimension 在 blur 后保持"],
  "fix-local-skill-removal": ["删除本地 Skill 后列表立即移除", "删除失败时显示错误", "删除后本地 import registry 同步"],
  "fix-node-navigator": [
    "Node 22 Extension Host 可激活 ChipMate",
    "Qwen FIM 请求不发送不兼容 suffix",
    "自动补全选择状态说明正确",
    "切换到 Qwen 后旧 Classic provider 不触发认证等待",
  ],
  "focus-custom-provider-models": [
    "Prompt 模型选择器默认只展开已配置自定义 Provider",
    "无 Provider 首次设置态没有空白预览区域",
  ],
  "honor-packaged-chipmate-server-default": [
    "没有用户覆盖时读取打包 ChipMate Server 默认值",
    "用户覆盖优先于打包默认值",
    "清除用户覆盖后恢复打包默认值",
  ],
  "import-local-skills": [
    "从文件夹导入合法 Skill",
    "从 SKILL.md 导入合法 Skill",
    "从 ZIP 导入合法 Skill",
    "从 TAR.GZ 导入合法 Skill",
    "非法 Skill 在写入前被拒绝",
    "项目级导入原子提交",
    "全局导入原子提交",
    "Skill Hub 发布已验证快照",
  ],
  "indexing-abandoned-artifact-cleanup": [
    "中断 CodeGraph 产物在恢复时安全清理",
    "中断 RAG 产物在恢复时安全清理",
    "当前有效索引文件不会被清理",
  ],
  "indexing-failure-observability": [
    "索引失败显示在 VS Code 诊断",
    "状态 API 保留最近失败",
    "日志包含失败 pipeline 与项目且不含密钥",
  ],
  "indexing-settings-hot-reload": [
    "保存 embedding 设置不会重建 CodeGraph",
    "保存确认后 Settings save bar 清除",
    "新 embedding 设置用于下一次 RAG 构建",
  ],
  "indexing-toolbar-codicons": [
    "RAG 状态动作使用 VS Code Codicon",
    "CodeGraph 状态动作使用 VS Code Codicon",
    "窄宽度下状态图标保持可操作",
  ],
  "indexing-upgrade-recovery": [
    "stale indexing lock 不阻塞升级恢复",
    "兼容索引在升级后复用",
    "不兼容索引只重建受影响部分",
  ],
  "internal-linux-vsix": [
    "显式 linux-x64-baseline 构建生成离线 VSIX",
    "Linux 包包含索引运行时依赖",
    "Linux 包运行时不下载依赖",
  ],
  "internal-offline-gateway-login": ["内部离线首次启动不显示 Gateway 登录", "内部离线首次启动不请求公共 Profile"],
  "internal-vsix-update-check": ["内部更新检查读取 manifest", "无更新时不显示安装提示", "有兼容更新时显示安装提示"],
  "isolate-chipmate-v2": [
    "ChipMate 与 Kilo 可在同一 Profile 激活",
    "命令命名空间隔离",
    "配置命名空间隔离",
    "视图命名空间隔离",
    "storage 根隔离",
    "backend 状态隔离",
    "indexing 数据隔离",
    "autocomplete ownership 隔离",
    "后续 v2 更新校验不超过 256 MiB",
  ],
  "keep-indexing-project-bound": [
    "索引状态请求使用当前面板项目目录",
    "其他项目 indexing 事件被忽略",
    "两个项目面板的索引状态互不覆盖",
    "项目切换后旧 HTTP 响应被丢弃",
    "Document RAG 选目录相对当前面板项目",
    "项目切换后旧 Document RAG 动作被丢弃",
    "Agent Manager session 路由恢复到对应项目",
  ],
  "keep-packaged-mermaid-tools": [
    "打包客户端工具列表包含 Mermaid 工具",
    "普通 Mermaid 操作不提前加载图像裁剪运行时",
    "需要本地裁剪时才加载图像运行时",
  ],
  "lancedb-default-vector-store": ["新索引设置默认 vector store 为 LanceDB", "默认设置不要求 Qdrant 服务"],
  "lancedb-schema-rebuild-notice": [
    "旧 LanceDB schema 自动触发 RAG 重建",
    "重建通知对用户可见",
    "RAG schema 重建保留 CodeGraph 数据",
  ],
  "localize-indexing-settings": ["索引设置字段显示简体中文", "已知索引状态消息显示简体中文", "未知后端状态保留原文"],
  "marketplace-aligned-workspace": [
    "Skill Market 首页数据与服务一致",
    "详情与版本页数据一致",
    "收藏状态可持久化",
    "安装状态可持久化",
    "发布状态以服务端为准",
    "analytics 与 diagnostics 页面可访问",
    "legacy 与 Agent/MCP 模式仍可用",
  ],
  "marketplace-analytics-hardening": [
    "analytics 按固定批次发送匿名事件",
    "analytics payload 不含身份密钥",
    "重连后只刷新作用域内缓存",
    "实时状态在重连后恢复",
  ],
  "marketplace-identity-install-sync": [
    "Market 身份与当前 Provider 身份一致",
    "收藏在 Web 与 ChipMate 间同步",
    "已验证 Skill 安装在 Web 与 ChipMate 间同步",
  ],
  "marketplace-raw-skill-unpublish": [
    "内置 Skill 以原始 Markdown 发布",
    "作者可以下架自己的 Market Skill",
    "下架后历史 release 保持不可变",
  ],
  "marketplace-unified-publication": [
    "Web 与 VS Code 使用同一服务端验证",
    "修复结果由服务端权威返回",
    "发布生成不可变 revision",
    "相同输入在两个客户端得到相同发布状态",
  ],
  "memory-debug-recovery": ["CLI 意外退出后自动重连", "重连后当前会话恢复", "本地 memory diagnostics 可导出"],
  "open-extension-market": ["Skill Marketplace 面板入口打开配置的 Extension Market 地址", "未配置地址时显示可判定错误"],
  "preserve-slash-drafts": ["选择 slash command 后已有草稿保留", "Settings close 按钮关闭编辑器"],
  "prompt-input-legacy-icons": ["Prompt 选择器使用指定 legacy ChipMate 图标", "窄宽度 fallback 不遮挡发送与 overflow"],
  "publish-skill-risk-guidance": [
    "非阻断风险不禁止发布",
    "下载前显示中文风险提示",
    "安装前显示中文风险提示",
    "可直接从单个本地文件夹发布",
  ],
  "qwen-autocomplete-cache": ["相同 Qwen 请求命中内存缓存", "上下文改变时不错误复用缓存", "缓存命中返回相同候选"],
  "qwen-context-selection-hardening": [
    "同文件片段按固定优先级注入",
    "上下文诊断反映实际选择",
    "被排除片段不进入 prompt",
  ],
  "qwen-diagnostics-prompt-preview": ["Qwen diagnostics 不包含 prompt preview"],
  "qwen-direct-autocomplete": [
    "C 文件可启用 qwen-direct",
    "C++ 文件可启用 qwen-direct",
    "候选以 ghost text 显示",
    "Tab 接受候选",
    "取消动作移除候选",
  ],
  "qwen-direct-offline-observability": [
    "离线 diagnostics 包含请求阶段",
    "离线 diagnostics 包含响应解析状态",
    "diagnostics 不含 API Key",
    "diagnostics 不含完整敏感源码",
  ],
  "qwen-helpervars-token-budget": ["Prompt token 预算符合 HelperVars 固定夹具", "超预算上下文被确定性裁剪"],
  "qwen-import-root-context": [
    "启用后导入定义进入上下文",
    "启用后 root path 进入上下文",
    "禁用后两类上下文均不进入 prompt",
  ],
  "qwen-multiline-security-prefilter": [
    "多行候选按固定分类器判定",
    "不安全候选在显示前被过滤",
    "安全过滤 diagnostics 不泄露源码",
  ],
  "qwen-non-streaming-filters": [
    "non-stream 响应解析 choices[0].text",
    "空候选不显示 ghost text",
    "重复前缀候选被过滤",
    "diagnostics 记录过滤原因",
  ],
  "qwen-recently-edited-context": ["启用后 diagnostics 记录最近编辑范围", "禁用后不采集最近编辑范围"],
  "qwen-recently-edited-snippet-injection": ["启用后最近编辑 snippet 注入 prompt", "关闭设置后 snippet 不再注入"],
  "qwen-recently-opened-context": [
    "启用后最近打开文件进入上下文",
    "超过预算的最近文件被裁剪",
    "关闭设置后最近文件不进入 prompt",
  ],
  "remote-mermaid-render-response": [
    "解析当前服务端 Mermaid PNG 响应",
    "保留服务端 render width",
    "保留服务端 render height",
    "保留服务端 QA issues",
    "Word 插图保持请求顺序",
    "启动日志报告 renderer endpoint 来源",
  ],
  "remove-sidebar-history-shortcut": ["Welcome 状态不显示重复 history 按钮", "其他 History 入口仍可使用"],
  "render-service-vsix-auto-update": [
    "更新 manifest target 与当前平台匹配",
    "VSIX 下载后校验 SHA-256",
    "不兼容 target 不安装",
    "校验失败不安装",
    "安装完成后提示 Reload",
  ],
  "repair-targeted-dsml-calls": [
    "仅目标 Provider 和模型启用 DSML 修复",
    "泄漏 tool call 只重试一次",
    "截断 tool call 只重试一次",
    "重试工具没有业务副作用",
    "修复逻辑不猜测业务工具",
  ],
  "restore-indexing-field-input": [
    "embedding model 逐字符输入不丢字",
    "dimension 逐字符输入不丢字",
    "输入期间 provider 不被重置",
  ],
  "restore-native-reasoning-stream": [
    "流式 reasoning 分片按顺序显示",
    "流式文本分片按顺序显示",
    "reasoning 与文本不重复",
  ],
  "sequential-indexing": [
    "CodeGraph 在 Code RAG 前启动",
    "Code RAG 在 Document RAG 前启动",
    "三个 pipeline 不并发争用初始全量扫描",
  ],
  "skill-market-identity-icons": [
    "Market 用户身份来自活动 Provider",
    "Skill 动作状态与身份权限一致",
    "Market 图标可加载",
    "Market 文案显示简体中文",
  ],
  "soften-task-hud": ["任务 HUD 使用轻量 context strip", "HUD 不遮挡消息内容", "任务统计仍可读取"],
  "source-backed-word-visual-quality": [
    "context parent 与 target module 被正确区分",
    "每个确认子模块都有源码证据",
    "输出包含五类视图",
    "Word 内容按稳定顺序组装",
    "中文输出可读",
    "原生目录页码验证通过",
    "page evidence 与 visual review 状态分开记录",
  ],
  "stabilize-indexing-pipeline": [
    "自动索引在新项目稳定完成",
    "项目 A 与 B 索引数据隔离",
    "中断后自动恢复",
    "显式配置覆盖默认行为",
  ],
  "stabilize-long-session-navigation": [
    "长会话流式输出期间 UI 保持响应",
    "长历史切换期间 UI 保持响应",
    "崩溃重连后可继续导航",
  ],
  "start-indexing-pipelines": [
    "内部项目自动启动 CodeGraph",
    "CodeGraph 后自动启动 Code RAG",
    "Code RAG 后自动启动 Document RAG",
    "显式关闭时三个自动启动均不发生",
  ],
  "verify-macos-chipmate-v2": [
    "darwin-arm64 内部 VSIX 通过签名式 manifest 校验",
    "Open in Tab 命令在激活 probe 中存在",
    "无工作区启动时索引保持 idle",
  ],
  "vscode-193-support": ["VS Code 1.93 可激活扩展", "VS Code 1.93 可注册关键命令与视图"],
}

const mac = {
  "WIN-PACKAGE-INSTALL": "MAC-PACKAGE-INSTALL",
  "WIN-IDENTITY-UPGRADE": "MAC-IDENTITY-UPGRADE",
  "WIN-BRANDING-FIRST-RUN": "MAC-BRANDING-VISUAL",
  "WIN-SETTINGS-PROVIDER": "MAC-SETTINGS-PROVIDER",
  "WIN-QA-SESSION": "MAC-QA-SESSION",
  "WIN-INDEXING-LIFECYCLE": "MAC-INDEXING",
  "WIN-RETRIEVAL-EVIDENCE": "MAC-RETRIEVAL",
  "WIN-QWEN-AUTOCOMPLETE": "MAC-QWEN",
  "WIN-AGENT-CONSOLE": "MAC-AGENT-CONSOLE",
  "WIN-MARKETPLACE": "MAC-MARKETPLACE",
  "WIN-DOCUMENTS": "MAC-DOCUMENTS",
  "WIN-UPDATE": "MAC-UPDATE-FAILURES",
}
const win = new Set(["WIN-PACKAGE-INSTALL", "WIN-SETTINGS-PROVIDER", "WIN-INDEXING-LIFECYCLE", "WIN-AGENT-CONSOLE"])
const source = {
  "agent-console-webview": [
    "packages/kilo-vscode/tests/unit/agent-console-provider.test.ts",
    "packages/kilo-vscode/tests/agent-console.spec.ts",
  ],
  "fix-agent-console-windows-powershell": [
    "packages/kilo-vscode/tests/unit/agent-console-provider.test.ts",
    "packages/kilo-vscode/tests/agent-console.spec.ts",
    "packages/kilo-vscode/tests/unit/agent-manager-terminal-font.test.ts",
  ],
  "clear-recovered-rag-diagnostics": ["packages/kilo-indexing/test/kilocode/indexing/manager.test.ts"],
  "keep-indexing-project-bound": [
    "packages/kilo-vscode/tests/unit/kilo-provider-indexing-refresh.test.ts",
    "packages/kilo-vscode/tests/unit/agent-manager-indexing-routing.test.ts",
  ],
}
const windows = {
  "agent-console-webview": 5,
  "fix-agent-console-windows-powershell": 10,
}
const evidence = {
  "WIN-PACKAGE-INSTALL": ["manifest", "archive-inventory", "sha256"],
  "WIN-IDENTITY-UPGRADE": ["extension-list", "probe", "storage-snapshot"],
  "WIN-BRANDING-FIRST-RUN": ["screenshot", "accessibility-tree"],
  "WIN-SETTINGS-PROVIDER": ["before-after-screenshot", "settings-snapshot", "provider-requests"],
  "WIN-QA-SESSION": ["screenshot", "session-events", "extension-host-log"],
  "WIN-INDEXING-LIFECYCLE": ["provider-requests", "pipeline-status", "storage-inventory", "extension-host-log"],
  "WIN-RETRIEVAL-EVIDENCE": ["tool-result", "source-evidence", "provider-requests"],
  "WIN-QWEN-AUTOCOMPLETE": ["request-fixture", "editor-screenshot", "redacted-diagnostics"],
  "WIN-AGENT-CONSOLE": ["terminal-transcript", "approval-screenshot", "filesystem-snapshot"],
  "WIN-MARKETPLACE": ["api-transcript", "screenshot", "storage-snapshot"],
  "WIN-DOCUMENTS": ["tool-transcript", "artifact-inventory", "rendered-output"],
  "WIN-UPDATE": ["manifest", "download-transcript", "extension-list"],
}

const changes = [...parents.keys()].sort()
const missing = changes.filter((change) => !checks[change])
const extra = Object.keys(checks).filter((change) => !parents.has(change))
if (missing.length || extra.length)
  throw new Error(`Atomic catalog mismatch: missing=${missing.join(",")} extra=${extra.join(",")}`)

const problems = changes.map((change) => {
  const parent = parents.get(change)
  const text = readFileSync(join(root, ".changeset", `${change}.md`), "utf8")
    .replace(/^---[\s\S]*?---\s*/, "")
    .trim()
  return {
    changeset: change,
    parent,
    summary: text,
    assertions: checks[change].map((entry, index) => ({
      id: typeof entry === "string" ? `REG-${change.toUpperCase()}-${String(index + 1).padStart(2, "0")}` : entry.id,
      title: typeof entry === "string" ? entry : entry.title,
      oracle: "boolean",
      evidence: evidence[parent],
      source: {
        required: true,
        executor: source[change]?.join(",") ?? "unassigned",
        state: source[change] ? "implemented" : "planned",
      },
      macos: { required: true, executor: mac[parent], state: "planned" },
      windows: {
        required: win.has(parent),
        executor: parent,
        state: index < (windows[change] ?? 0) ? "implemented" : "planned",
      },
    })),
  }
})

const output = { version: 1, generatedAt: new Date().toISOString(), problems }
writeFileSync(join(dir, "atomic-cases.json"), `${JSON.stringify(output, null, 2)}\n`)
const rows = problems
  .flatMap((problem) =>
    problem.assertions.map((check) => {
      const sourceState = check.source.state === "implemented" ? "✅ 已实现" : "⬜ 未实现"
      const macState = check.macos.state === "implemented" ? "✅ 已实现" : "⬜ 未实现"
      const winState = !check.windows.required
        ? "🚫 非 Windows 冒烟范围"
        : check.windows.state === "implemented"
          ? "✅ 已实现"
          : "⬜ 未实现"
      return `| \`${check.id}\` | \`${problem.changeset}\` | \`${problem.parent}\` | ${cell(check.title)} | ${sourceState} | ${macState} | ${winState} |`
    }),
  )
  .join("\n")
writeFileSync(
  join(dir, "atomic-matrix.md"),
  `# ChipMate 历史修复原子回归矩阵\n\n状态约定：\`✅ 已实现\`、\`⬜ 未实现\`、\`🟨 待复核\`、\`🚫 非当前范围\`。已完成项后续不得退回套件级笼统描述；每次执行必须按原子 ID 上报结果。\n\n- 历史 changeset：${problems.length}\n- 原子断言：${problems.reduce((sum, item) => sum + item.assertions.length, 0)}\n- macOS 是全部原子断言的代理验收主通道。\n- Windows 只要求安装、设置输入、索引和 Agent Console 高风险断言。\n\n| 原子 ID | 历史修复 | 父 case | 单一判定 | 源码测试 | macOS 安装态 | Windows 冒烟 |\n|---|---|---|---|---|---|---|\n${rows}\n`,
)
process.stdout.write(
  `${JSON.stringify({ changesets: problems.length, assertions: problems.reduce((sum, item) => sum + item.assertions.length, 0) }, null, 2)}\n`,
)

function cell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", "<br>")
}
