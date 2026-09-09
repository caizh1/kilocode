# 待开发事项

本文件是当前项目跨 session 的统一待开发事项台账。后续 session 发现明确、可执行且决定延期的开发项时，必须在此新增或更新记录；重复事项更新原记录，不重复创建。

状态统一使用：`待开发`、`进行中`、`已完成`、`取消`。事项完成或取消后保留历史记录，只更新状态和结果。

普通代码 TODO、当前 session 内的临时步骤、推测性风险和证据不足的问题不进入本台账。

## DEV-016：降低 Webview 初始化阶段的最大长任务

- 状态：`待开发`
- 记录日期：2026-09-08
- 模块：`packages/chipmate-ui` 共享初始化、高亮链路与 `packages/chipmate-vscode/qa/low-end`。
- 证据：夜之城皮肤完整低配复测中，长会话返回已为 247/278ms，输入、滚动和内存指标通过；启动阶段最大长任务仍为 764/823ms，超过既有 500ms 门槛。原皮肤此前对照也存在该项失败。记录位于本地 `.qa-night-city-20260908/验收记录.md`，采样位于 `设置启动热点.cpuprofile`。
- 已完成：修复静态 GrowBox 的逐条同步高度测量；修复长历史夹具缺少 flex 高度约束导致全部 1500 行挂载的问题，保留全部 1000 条消息及原阈值。
- 延期原因：剩余热点位于共享初始化与高亮处理，尚未完成精确归因及安全拆分；本轮不以放宽阈值或排除启动数据宣称性能通过。
- 验收：分别追踪真实 Webview 与 Storybook 初始化，定位超长任务；完成必要的异步拆分或延迟加载后，保持数据和阈值不变，重跑两种皮肤的完整低配基准，并回归代码高亮、静态消息、流式消息及展开收起。

## DEV-015：修复原生 question 在会话中止后的等待清理

- 状态：`待开发`
- 记录日期：2026-09-08
- 模块：`packages/opencode/src/session/tools.ts`、原生 `question` 工具。
- 证据：真实 `/spec` 通过普通 Agent 调用 question 后执行会话取消，模型轮次已结束但问题等待记录仍存在；`SessionTools` 的 Promise 工具执行未将取消信号绑定到 question 的 Effect 等待。下一条普通消息会撤销旧问题，已验证不会续跑旧轮次。
- 本轮复查：图页改动验证中，Spec 和普通 QA 中断回归均超时 40 秒；保留原命令测试服务集合、排除新增读图权限/文件锁服务后仍复现。先前“下一条消息恢复”证据不覆盖本轮超时，需重新定位当前取消执行最后事件；记录见 `packages/opencode/src/chipmate/spec/validation/图页阅读验证.md`。
- 延期原因：本轮仅替换 Spec，保持普通 QA 工具调度与取消实现；该通用生命周期修复需独立实施。
- 验收：从普通 QA 和命令两种真实入口创建问题，中止后等待、ToolPart 与前端卡片均终止；旧回答不可推进新轮次，同时验证不影响其他正在运行的会话。

## DEV-014：完成 `/spec` 内网 Qwen、UFS 固件与人工效率验收

- 状态：`待开发（本地实现与固定测试已完成，目标环境验收明确延期）`
- 记录日期：2026-09-07
- 模块：`packages/opencode/src/chipmate/spec`
- 背景：用户确认当前机器没有目标模型，完成开发后自行带到内网真实机器验证。当前已切换为显式 Skill、原生 Agent 与 question，保留任务 Markdown 和验收统计；旧状态机的验收不覆盖新 Skill，不能据此宣称生产质量或减少人工 80%。
- 下一步：按模块使用说明，在实际部署核对建议使用的 Qwen 的图像、上下文、Skill 遵循、提问质量和取消恢复能力；完成协议处理、调度资源、FTL/NAND 各至少三个已评审真实任务及 Windows/内网编译和 FPGA 验证。
- 图页验收补充：按 `packages/opencode/src/chipmate/spec/validation/图页阅读验证.md` 完成人工标注长文档对照，检查上下文补读、否定分支/单位/脚注/跨页连接删除反例、关键漏项、主子会话实际 token 峰值及复核人工成本；本轮脚本化工具接入通过不能替代该质量验收。
- 放行指标：条款映射覆盖 100%、证据准确率至少 95%、固定标注样本严重问题漏检为零、阻塞误报率不高于 5%、包含 FPGA 操作的人工时间减少至少 80%。保存真实输入、部署版本、独立标注、输出及全部人工耗时，再运行 `script/chipmate-spec-acceptance.ts` 汇总。

## DEV-013：完成 Patent Server 六地区真实语料与 Patent Radar 质量发布验收

- 状态：`进行中（源码、确定性门禁和本地评审闭环已实现，真实语料与质量基准待完成）`
- 记录日期：2026-08-26
- 模块：`server/chipmate-patent-server`、`packages/opencode/src/chipmate/patent-radar`、`packages/chipmate-vscode/src/patent-radar`
- 背景：独立 Patent Server、流式导入、防覆盖 generation、混合检索、本地代码/文档候选提取、证据矩阵、20% 盲审和 VS Code 界面已经实现。当前没有六地区授权历史包与增量包、专用 Linux 主机、10 个真实嵌入式项目及人工金标准，因此不能宣称语料库已建成或达到生产质量。
- 目标：取得 CN、JP、KR、US、EP、RU 真实历史与增量样本，冻结地区适配器和批次规则，在专用 Linux x86-64 主机完成全量导入与灾难重建，并执行固定专利冲突集和真实项目盲审。

### 验收标准

- 用真实包验证字段映射、编码、归档格式、记录数、历史基线、增量连续性、修订、软删除和失败后旧 generation 在线；完成 PostgreSQL/OpenSearch/原始包抽样一致性与完整重建。
- 按实测单记录占用确认磁盘满足全部原始数据、规范化库、两代索引和 30% 余量，并完成 HTTPS、公司网段、模型端点和目标机恢复演练。
- 已知冲突 `Recall@50 ≥ 95%`，固定冲突样本不得进入 `continue-human-review`；100% 报告引用可解析。
- 至少覆盖 10 个真实嵌入式项目或模块和 100 个候选，主队列人工确认率至少 75%，相对人工基线减少至少 80% 阅读与初筛工作，同时保留至少 95% 人工已发现单篇冲突。

### 完成记录

2026-08-26 已完成源码实现和本地固定测试。当前机器缺少 Docker Compose，且尚未提供真实专利包、专用主机和人工基准，所以 Docker 全栈、目标机导入、六地区覆盖与质量指标均未验证。

2026-09-03 已在本机 Docker 试运行环境导入中国专利周包并完成真实全文检索。待修复项：运行状态不得携带逐条不支持文件清单并由设置页每秒全量拉取；运行列表必须分页或只返回轻量摘要；模块预览与实际扫描不得重复执行全仓解析；已有扫描只能在模型与范围完全一致时恢复；初始工作区解析需要可观测进度与真实取消；归档导入需要单次流式展开并跨归档条目累计批次，避免每个 XML 单独启动解压进程和数据库提交。完成这些修复后，仍需在内网 Linux x86-64 真实项目和完整语料上复验。

## DEV-012：完成 UFS Review 内网模型、真实固件与人工效率发布验收

- 状态：`进行中（独立 Agent、只读多 Session 工具和确定性门禁已实现，真实 UFS 固件盲测待完成）`
- 记录日期：2026-08-21
- 模块：`packages/opencode/src/chipmate/ufs-review`、`packages/opencode/src/chipmate/tool/ufs-review.ts`、`packages/chipmate-vscode/webview-ui/src/components/chat/UfsReviewToolCard.tsx`
- 背景：当前已实现专用 `UFS Review` Agent、自然语言强制工具门禁、Git/模块范围快照、2～4 路只读 Reviewer、一次格式重试、批量验证确认、对抗复核、证据降级、源码漂移检测、双门禁报告和 Code Agent 修复交接。公开代理样本和公司内部真实 UFS 设备固件的40组盲测、目标机证据及人工基线尚未执行，因此功能只能标记为技术预览。
- 目标：冻结至少40组多文件缺陷/修复样本，每个审核方向至少10组且30%保持盲测；使用实际部署的 `deepseek-v4-flash` 和内部真实 UFS 固件完成同预算单 Session/多 Session 对照与人工效率验收。

### 验收标准

- P0/P1 召回率为100%，高影响问题召回率不低于95%，finding 精确率不低于90%，干净样本阻塞误报率不高于5%，P0/P1证据有效率为100%。
- A1召回率不低于90%，干净样本错误 `NEEDS REWORK` 不高于5%，`LIMITED/INCOMPLETE/STALE/CANCELLED` 错误产生可批准结论的比例为0。
- 同模型、同推理等级、同总 Token 预算下，多 Session 的 P0/P1 不低于单 Session；宏平均召回至少提升10个百分点，或无证据/重复 finding 减少30%，精确率下降不超过2个百分点。
- 与同一批评审人员、相同代码范围的纯人工流程相比，主动阅读、判断和重复验证时间至少减少80%。
- 在真实 VS Code Extension Host 中验证自然语言、全部范围快捷入口、批量命令确认、子 Session 查看、窄宽度/长文本/深浅色/高对比主题，以及切换 Code 修复后重新审核闭环。

### 完成记录

2026-08-21 已完成源码闭环、CLI与Webview类型检查、范围/漂移/调度/证据门禁固定测试及真实工具注册隔离测试。未使用 CodeGraph、代码RAG或Document RAG；未执行内部真实固件盲测、人工耗时对照和目标机运行，因此不得宣称生产可用或已减少人工80%。

## DEV-011：完成本地聊天历史统一迁移的 Windows x64 真实 Profile 验收

- 状态：`进行中（源码实现和 macOS 固定样本验证已完成，Windows x64 真实升级待验收）`
- 记录日期：2026-08-19
- 模块：`packages/opencode/src/chipmate/history`、`packages/chipmate-vscode/src/commands/chat-history-migration.ts`
- 背景：当前已实现当前 VS Code Profile 内 `kilo.db`、旧 JSON 与 `chipmate.db` 的手动备份、幂等合并、冲突双份保留和安全恢复，并完成 WAL、恶意路径、重复执行和恢复不覆盖新聊天的固定测试；真实 Windows x64 安装态仍未验证。
- 目标：在真实 Windows x64 当前 Profile 中准备 1.0.19 旧聊天，再由 1.1/1.2 创建新聊天并升级到包含迁移功能的版本，执行插件命令后验证两批历史并存且可继续对话。

### 验收标准

- 迁移前 ZIP 位于当前 Profile 的 `v2/data/migration-backups`，清单、CRC、SHA-256、数据库统计与未 checkpoint WAL 内容均通过校验。
- 1.0.19 历史和 1.1/1.2 新聊天均可列出、打开、搜索和继续发送；当前聊天零覆盖、零删除，重复迁移零重复。
- 活动回复、工具调用或后台会话任务存在时命令立即拒绝；空闲迁移后共享 Server、SSE 和历史列表自动恢复。
- 使用代表性大库记录峰值 RSS、耗时和人工步骤，确认额外峰值 RSS 不超过 256 MiB，且人工操作相对手工停服、复制、合库、校验和重启减少至少 80%。

### 完成记录

2026-08-19 已完成 CLI、维护门禁、插件命令、备份/恢复安全校验和固定单测。随后在 macOS arm64 隔离 VS Code Profile 中实际安装 1.0.19、通过其捆绑 Server 创建中文会话，再覆盖安装 1.2.2 并从插件命令完成备份与迁移；新版捆绑 Server 可列出、打开并继续该旧会话，重复执行后仍为 1 个会话、2 条消息，最终插件命令执行期间旧 `kilo.db` 的修改时间保持不变。迁移 ZIP 的 CRC、清单 SHA-256、统计和数据库完整性独立校验通过，安装态 CLI 安全恢复后也未删除新消息。2,205,581,312 字节基准库迁移得到 1 个会话、1,401 条消息和 1,401 个 Part，源库 SHA-256 前后一致；最终 CLI 空载峰值 RSS 为 337,510,400 字节，迁移峰值为 571,260,928 字节，额外峰值 233,750,528 字节（约 222.9 MiB），低于 256 MiB 门禁。另一次真实中断留下 1 个会话、98 条消息、0 个 Part 和失主锁，修复后无需等待 stale 超时即可续迁为 1/1,401/1,401，只有一个完成标记且完整性检查通过。用户已明确允许以本次 macOS 实测作为当前发布门禁；仅 Windows x64 真实 Profile 互操作仍待完成，因此本事项继续保持进行中。

## DEV-010：回收 Windows ChipMate 1.2.0 压缩诊断日志并确认根因

- 状态：`待开发（源码诊断与模拟验证已完成，目标 Windows 现场复现待执行）`
- 记录日期：2026-08-17
- 模块：`packages/opencode/src/chipmate/session/compaction-diagnostics.ts`、Windows ChipMate 1.2.0 安装态
- 背景：用户在 GLM 5.2 长对话切换到 DeepSeek V4 Flash 后观察到自动压缩及 `Compaction worker returned an empty response`，随后继续发送消息仍可工作。当前源码已增加仅含白名单元数据的 `compaction_diag` INFO/WARN 日志，并完成跨模型触发、reasoning-only 长度耗尽、正常摘要、无输出、provider 错误和失败后下一请求的模拟验证；尚无目标 Windows 现场日志，不能据此确认真实根因或压缩是否成功。
- 目标：在发生问题的 Windows VS Code profile 中复现一次，从 `%APPDATA%\Code\User\globalStorage\chipmate.chipmate\v2\data\log\opencode.log` 回收同一 session 的 `compaction_diag` 记录，按消息 ID 串联触发、preflight、worker 和最终结果。

### 验收标准

- 若判定跨模型旧 token 误触发，必须同时观察到旧/新 provider 或 model 不一致、`reported_usage_check.triggered=true`，且下一条当前模型 `preflight_check` 明显低于阈值。
- 若判定 reasoning 耗尽 worker 预算，必须同时观察到 `finish=length`、`textChars=0`、`reasoningChars>0`，且 reasoning token 接近 `workerBudgetTokenLimit=2048`。
- 只有 `compaction_result` 无错误、`summaryTextChars>0`、`boundaryEligible=true` 且 `compactedEvent=true` 才判定压缩成功；后续消息能继续工作不能替代该证据。
- 现场日志不得包含对话或摘要正文、reasoning 内容、文件路径、请求或响应体、endpoint、header 或凭据；回收前后均执行敏感信息检查。

### 完成记录

2026-08-17 已完成源码与固定模拟验证，未打包、未发布，目标 Windows 实机复现与日志回收未验证。

## DEV-009：完成 ChipMate DeepSeek Harness 官方会话投影与双平台发布验收

- 状态：`进行中（官方客户端投影已接通，双平台真实机和质量发布验收待完成）`
- 记录日期：2026-08-15
- 模块：`packages/chipmate-vscode/src/services/deepseek-harness`、`packages/chipmate-vscode/webview-ui/src/components/deepseek-harness`、`server/chipmate-word-render`
- 背景：ChipMate 原有 QA 已接入未经修改的官方 DSH Web Profile，运行时、环境、工具和索引隔离、任务到官方 Session 映射、远程内容寻址安装、跨窗口租约、独立 Supervisor 与 Server 1.2.0 分发接口已经实现。固定版本的官方客户端通过官方 `ClientModuleSystem`、Cordis Loader 和固定 Web seed 表在 QA Webview 中运行，当前任务由官方 `SessionFace` 与 `ConversationSnapshot` 驱动；仍需完成 Windows/Linux 真实机和质量发布验收。
- 目标：使用不修改官方投影逻辑的加载方式运行 `@deepseek-ai/dsh-client-runtime` 与 `@deepseek-ai/dsh-client-ui-conversation`，把官方节点投影到 ChipMate 原有 QA；完成 Windows 与 Linux 真实机、自动升级和质量对照后再发布 1.2.0。

### 验收标准

- 官方 `ConversationNodeAssembler`、Conversation Definitions 和 `ConversationSnapshot` 直接消费 Relay 的官方帧；删除原始 JSON 事件展示，不实现 ChipMate 自有 Harness 状态机。
- 消息、reasoning、工具树、retry、compaction、queue、审批、问题、plan、子 Agent、workflow 和 unknown surface 的顺序与官方 DSH Web UI 一致。
- 独立 Supervisor 在 Windows 与 Linux 上验证正常信号清理、15 秒强制终止、Extension Host 崩溃孤儿清理、多窗口租约和 PID 重用保护。
- 完成固定 30 个真实任务的官方 Web UI 对照；综合评分、成功率和耗时达到 1.2.0 计划门槛。
- P0/P1 审查为 `PASS`，Windows/Linux VSIX、运行时、Server 和真实升级门禁全部通过后，才允许进入自动更新清单。

### 完成记录

2026-08-15 已移除独立页面并恢复原有 QA 壳、Agent 和模型入口；完成命名空间迁移、DeepSeek-only 模型门禁、任务 Session 映射、私有 Home/Profile 校验、环境清洗、安装后逐文件复核和独立 Supervisor。随后删除服务层手写历史、Prompt、取消和审批状态机，Relay 改为转发完整官方 HTTP、mux、host 和插件事件流；QA 由官方 `SessionFace.prompt/cancel`、`PendingWait.respond` 和 `ConversationSnapshot.chat.order` 驱动。使用真实官方 `dsh web 0.1.0-rc.6` 模块图、真实 Session 和 Chromium 完成投影烟测，结果为 `open`。Windows/Linux 真实机、30 个质量任务和发布 P0/P1 总审查仍未完成，因此独立发布门禁继续禁止打包、部署和发布。

2026-08-18 已在锁定的 AlmaLinux 8.10、glibc 2.28、linux/amd64 构建环境重建 Linux 运行时，补齐并实际加载 `sharp`、`node-pty` 和 Koffi，完成官方 DSH Web 监听、握手、双 WebSocket 与 SIGTERM 容器冒烟；同时全新生成 Windows x64 运行时并通过静态 PE 审计。Server 1.2.0 Docker/离线包和双平台 1.2.0 VSIX 手动验证候选已完成本地构建、哈希与内容审计；仍缺真实 Windows x64、真实 Linux x64、30 个质量任务及同版本替换回滚验收，因此未部署、未发布、未替换现有 1.2.0。

## DEV-008：高可信 C/C++ 代码注释发布定标

- 状态：`进行中（入口和安全写入链路已实现，模型质量门槛未通过）`
- 记录日期：2026-07-31
- 模块：`packages/chipmate-vscode/src/services/code-comments`、`packages/chipmate-vscode/qa/code-comments`
- 背景：当前已实现光标函数定位、临时只读 Code 会话、双会话复核、确定性注释校验、原生 Diff 和原子应用。首轮 A/B 的 54.6/31.6 总分因交互工具和认证环境污染已作废；去干扰后的双会话 5 函数重测中，完成样本内容平均 86.0、估算事实正确率 97.1%、严重幻觉为 0，但可用完成率只有 2/5。2026-08-01 已将大体量 JSON 与第三轮仲裁替换为两轮原始 Code QA 和 comment-only Diff；随后 OpenSSD 3 函数回归达到 3/3 完成，但人工核验发现 1 处复核漏过的事实错误。新换的 5 个 OpenSSD 分级函数回归达到 5/5 完成、10/10 会话无超时、最终事实正确率 100%、严重幻觉为 0、平均 93.6 分；复核实际修正了 `AllocateTempDataBuf` 的 1 处错误定性。
- 目标：继续以 OpenSSD 真实函数验证简化协议的完成率、事实正确率和克制性；当前 5 函数分级回归已通过小样本门槛，下一步完成 45 个未见函数和人工效率验收。小样本通过不能替代发布门槛。

### 验收标准

- 5 个固定函数平均分不低于 85，事实正确率不低于 95%，严重幻觉为 0。
- 5 个固定回归样本通过后，完成 45 个未见真实函数验收；首轮可接受率不低于 80%，自动恢复后生成候选的完成率不低于 95%。模型返回“无需注释”属于协议违规，不得计为完成。
- 与同一评审者的手工基线相比，主动阅读、判断和编辑时间至少减少 80%。
- 真实 Extension Host 能从命令面板、编辑器右键和灯泡入口进入模型会话，成功时打开 Diff；应用前后非注释 token 流完全一致。
- 任一门槛未通过时继续标记“未验证”，不得以安全拒绝或超时作为成功样本。

### 完成记录

2026-07-31 已完成源码实现、36 个目标单测、类型检查、Lint、实际 Extension Host 入口与进度验证，并修复 Tree-sitter 运行时资源缺失、CJS 初始化引用变化和本地开发脚本误用异平台 CLI 三个实机问题。2026-08-01 完成两轮原始 Code QA 改造、28 个当前目标单测、OpenSSD 3 函数诊断和 5 个全新 OpenSSD 分级函数回归。2026-08-05 已取消模型决定“无需注释”的分支，改为始终生成函数说明候选、仅由用户在 Diff 中决定是否应用；注释专用基准同步将该回答记录为协议违规，并仅对 `ready` 结果评分。同日完成选区内最多 10 个函数的批量入口、已有说明显式修订、4 路并发、实时通知与状态栏、二次候选选择、统一 Diff 和原子应用；真实 Extension Host 已验证入口、默认选择与运行进度，干净宿主因未登录模型返回 `401 PAID_MODEL_AUTH_REQUIRED`，成功态仍由目标单测覆盖。设计图的多行通知卡片与“查看详情”按钮无法由 VS Code 稳定通知 API 1:1 实现，待产品决定接受原生通知或改用非浮动 Webview 进度中心。当前仍未执行剩余 45 个未见函数和 50 函数发布验收。

## DEV-007：启用 ChipMate Bug 自动修复发布执行器

- 状态：`进行中（影子执行器已上线，正式发布门禁待验收）`
- 记录日期：2026-07-30
- 模块：`server/chipmate-bug-manager`、独立自动发布基线仓库
- 背景：ChipMate Bug 管理服务已部署到受保护 HTTPS 入口，提交即排队、Worker SSE、租约、关键改动审批、双平台产物门禁和现有包发布适配均已实现。用户日常工作区允许存在并行开发和未提交修改；执行器不能因此永久阻塞，也不能直接改写用户工作区。
- 目标：任务领取时以独立 Git 索引固化当前分支、已跟踪修改和限定范围内的未跟踪源码，创建不可变快照和自动化专属工作树；完成影子模式与真实故障样本验收后，再启用受保护发布。

### 验收标准

- 快照操作不修改用户索引、分支和工作树；快照提交、源分支、扩展版本、上游包清单版本和构建工具版本可追溯。
- 从任务快照全新构建的 Windows x64 baseline 与 Linux x64 baseline 包通过 manifest、运行时、离线依赖、大小和 SHA-256 审计。
- 影子任务能够完成 Bug 读取、Codex 修复、确定性测试和独立 P0/P1 审查，但禁止调用真实发布命令。
- Windows ARM 虚拟机与 Linux x64 验收全部通过后，才允许发布 Windows x64 baseline 与 Linux x64 baseline。
- 关键路径任务在服务器端无法越过管理员审批；发布结果必须与预留版本一致并恰好包含两个目标平台。
- 验证上游服务对双平台顺序发布的中途失败具备幂等补发或原子可见性；任一平台已发布但另一平台失败时，不得丢失已发布证据或把任务标记为完整发布。
- 使用至少 20 个有人工金标准的代表性 Bug 对比人工流程，记录修复成功率、误修率、总耗时、Token 和人工介入时间；未证明人工精力减少至少 80% 前不得宣称完成生产验收。

### 完成记录

2026-07-30 已完成管理服务、Web UI、SQLite 状态机、权限与安全门禁、Mac Runner、双平台 QA 脚本和部署配置；服务器 HTTPS、健康检查、管理员登录、CSRF、列表读取、退出和 Worker SSE 心跳通过。

2026-07-31 已安装 Mac LaunchAgent，增加 `monitor`、`shadow`、`release` 三种显式模式和线上执行器状态提示。根据用户反馈，基线策略改为任务启动瞬间固化日常工作区快照，不再要求用户清理或停止当前开发。任务 #1 首次诊断因外层系统沙箱与 Codex 子进程冲突而在读取业务源码前失败，未产生修复；现已改用 Codex 独立权限配置档，并验证任务工作树可写、Git 元数据可读、执行器配置和认证入口不可读。提交 Bug 后会直接排队并由在线执行器自动领取，详情页已上线状态机驱动的阶段进度条、当前步骤、运行时长、结构化实时日志，以及可展开的脱敏 Codex 输出、工作区命令、退出码、命令输出和文件变更；隐藏 reasoning 事件不会持久化或展示。修复与独立审查默认使用 `gpt-5.6-terra` 的 `max` 推理强度。已取消 Runner 默认120000 Token 硬上限，交由 Codex 管理和压缩单轮上下文，同时保留90分钟超时与最多3轮门禁。仍需用真实 Bug 重新执行影子修复，并完成处理中阶段崩溃恢复、双平台和发布幂等性验收。

## DEV-001：ChipMate Server 自签名或私有 CA 的插件级证书信任

- 状态：`待开发`
- 记录日期：2026-07-22
- 模块：`packages/chipmate-vscode`、`packages/opencode/src/chipmate`
- 背景：ChipMate Server 切换 HTTPS 后，如果服务器使用自签名证书或企业私有 CA，用户目前需要在实际运行扩展宿主的 Windows、macOS、Linux 或 Remote-SSH 环境中预先配置证书信任。期望允许用户在插件内确认指定远端证书，同时不降低其他 HTTPS 连接的安全性。
- 目标：为 ChipMate Server 提供按精确 `https://host:port` 隔离的证书探测、用户确认、持久信任和撤销能力，使用户无需全局关闭 TLS 校验即可使用受信任的自签名或私有 CA 服务。

### 验收标准

- 常规受公共 CA 信任的 HTTPS 服务保持现有行为，不出现额外弹窗。
- 仅在 ChipMate Server 因证书不受信任而连接失败时执行证书探测；探测阶段不得发送 API Key、文档、更新请求或其他业务数据。
- 弹窗展示精确服务器地址、证书主体、颁发者、有效期和 SHA-256 指纹，并提供“仅本次信任”“永久信任”“取消”。
- 永久信任按精确 `host:port` 保存为当前机器专属状态，不跨机器同步，也不扩展到其他服务器。
- 域名或 IP 与证书 SAN 不匹配、证书已过期或尚未生效时必须阻断，不得提供绕过选项。
- 已信任证书的指纹发生变化时必须阻断连接并重新确认，不能静默更新信任记录。
- 不得使用 `NODE_TLS_REJECT_UNAUTHORIZED=0` 或其他进程级、系统级全局关闭证书校验的方案。
- 信任策略覆盖 ChipMate Server 健康检查、Marketplace 普通请求与 SSE、自动更新 Manifest 与 VSIX 下载、Word/Mermaid 独立 CLI 请求，避免出现部分功能成功、部分功能仍报证书错误。
- 提供查看和撤销已信任证书的入口；撤销后下一次连接必须重新执行标准证书校验。
- 自动更新路径仍需执行现有同源 URL、扩展身份、大小和 SHA-256 校验，证书信任不能绕过任何更新包验证。
- Windows、macOS、Linux 和 Remote-SSH 至少覆盖相关单元测试；发布前必须在目标 Windows 安装态完成真实连接验证。

### 风险与约束

- 首次信任属于 TOFU 模型；弹窗必须提示用户通过管理员提供的可信渠道核对 SHA-256 指纹。
- 扩展宿主和独立 CLI 是两个请求运行时，必须共用同一份受限信任决策，不能只修复“测试连接”路径。
- 自动更新、Marketplace API Key 和文档渲染内容属于高敏感路径，任何未经指纹确认的连接都不得发送这些数据。
- 私有 CA 签发的服务器通常不会发送根 CA；实现需要明确区分服务器叶子证书固定与用户导入 CA PEM，不能假设可以从远端自动取得可信根证书。

### 完成记录

待开发。完成时在此补充实现摘要、验证环境、执行命令和已知限制。

## DEV-002：部署 ChipMate 插件一键发布闭环到当前 Server

- 状态：`待开发`
- 记录日期：2026-07-22
- 模块：`server/chipmate-word-render`
- 背景：一键上传、owner 绑定、动态 schema v2 manifest、下架回退和客户端自动安装已在当前工作区与隔离 VS Code Profile 验证。当前本机 `6001` 服务运行自只读参考仓库 `/Users/archer/Work/opencode`，本工作区没有目标 Linux/Docker 主机或获授权的部署入口，因此本次未替换该进程。
- 目标：获得明确部署目标后，按离线镜像安装流程升级当前 ChipMate Server，并完成旧 `chipmate.chipmate` owner 的一次性绑定。

### 验收标准

- 目标主机完成数据库备份和 schema 9 迁移，现有 Skill、插件产物、收藏与下载数据保持可用。
- 设置 `EXTENSION_MARKET_ENABLED=1`，并仅在迁移阶段配置一次 `EXTENSION_OWNER_BINDINGS_JSON`。
- 真实服务的 `/health`、`/api/v1/status`、`/packages/manifest.json`、Mermaid 与既有 Skill 市场回归通过。
- 使用发布者账号上传各平台 VSIX 后，动态 manifest 立即出现相应 target；下载内容与 SHA-256 一致，无需复制文件、维护 `latest.json` 或重启服务。
- 使用非 owner 账号验证上传、重复上传和下架均被拒绝；owner 下架后 manifest 回退到剩余最高版本。

### 完成记录

待部署。需要明确目标 Linux/Docker 主机与部署入口后执行。

## DEV-003：Embedded Review V1 内网模型与人工效率发布验收

- 状态：`进行中（薄 Runtime 机制覆盖通过，生产门槛未验证）`
- 记录日期：2026-07-28
- 模块：`packages/opencode/src/chipmate/embedded-review`、ChipMate Server 部署环境
- 背景：`/embedded-review` 的确定性范围解析、RulePack、机械规则、证据封印和固定 224 案例（112 组正反配对）基准已实现。重证据包 Runtime 的首轮 3 组 OpenSSD 缺陷/干净对照盲测未达到发布质量，且禁止了模型自主源码检索，不能用于判断模型能力上限。现已切换为允许 `deepseek-v4-flash max` 自主调用 `read/grep/glob` 的薄 Runtime。
- 目标：在真实内网部署模型上运行直接 `grep/glob/read`、B0 和最终 Runtime 三组盲测，并以未参与调优的新案例完成人工耗时对照。

### 验收标准

- 固定基准与独立盲测集分别留存版本、输入、原始输出、封印后 finding 和人工金标准。
- P0/P1 召回率为 100%，高严重度逻辑召回率不低于 95%。
- finding 精确率不低于 90%，干净案例误报率不高于 5%，阻塞结论证据有效率为 100%。
- 与同一批人工审查人员、相同代码范围的纯人工流程对比，人工主动阅读、判断和复核时间至少减少 80%。
- 任一门槛未通过时不得发布为“高质量完成”，应记录失败案例并修正规则、上下文选择或确定性校验后重新盲测，不能只追加长 Prompt。

### 完成记录

2026-07-28 完成 G2 首轮冻结盲测：6 次 Review 均加载 RulePack `0.3.1`，实现文件运行前后哈希一致。3 个干净对照均无阻塞误报；3 个 P1 缺陷的最终有效召回为 `0/3`，其中两个为模型漏检，一个为 Runtime 类别路由过滤了模型已提交的正确 `MEMORY_SECURITY/P1` 候选。当前不得宣称减少人工 80%。

下一步先修复通用类别路由、逐行证据编号、门禁拒绝原因和引用内容绑定，再将本轮样本降级为回归集并创建全新盲测集。禁止为 G2-09、G2-10、G2-11 追加专用 Prompt 或样本规则。

2026-07-28 模型 A/B 前发现 Qwen 服务会把多包连续空提交误判为重复工具调用。已增加 Runtime `packet` 序号回传协议，相关 52 个测试和 CLI typecheck 通过，真实 Qwen 单例连续 12 次工具调用正常完成。相同版本的 DeepSeek 控制组最终目标缺陷召回 `1/3`、有效 P1 finding 精确率 `1/2`、阻塞误报 `1/3`，仍不达标。

Qwen 组仅完成 G2-09-D 且漏检；随后端点持续返回 `403 AccessDenied.Unpurchased`，其余样本不计分。等待具备 `qwen3.6-27b` 资格的凭据后，在不修改 Runtime、Prompt、RulePack 和样本的条件下重跑完整 Qwen 组。

用户随后决定停止 Qwen A/B，默认继续使用 `deepseek/deepseek-v4-flash max`。Qwen 临时 Provider 未持久化，无需配置回滚；保留已验证的通用 packet 序号协议修复。后续质量改进仍聚焦 Runtime 类别路由、证据行绑定和静默过滤可观测性。

2026-07-28 完成薄 Runtime 五组新缺陷机制验证：五个有效会话均真实调用 `read` 或 `grep`，没有工具次数硬上限；五类预声明高、中高、较高缺陷机制最终覆盖 `5/5`。其中 THIN-09 行内锚点错误，THIN-15 的“变砖”影响缺少后续提交链证据，严格位置与影响证据完整为 `3/5`。五个计分会话平均约 `86,499` telemetry token，相比旧重 Runtime 约下降 `80.3%`；该数字不代表人工精力下降。本轮只运行缺陷版，没有修复版和干净对照，仍不能计算精确率、误报率或宣称减少人工 80%。

下一步冻结薄 Runtime、Prompt、RulePack 和五类支持边界，用全新缺陷/干净对照执行一次泛化盲测，并补齐人工复核时间对照。旧的 5/5 调优集与禁止源码工具的 3 组盲测只能保留为对应历史产品架构的结果，不能再作为原始模型能力结论。

## DEV-004：QA 对话界面 Signal Workbench 视觉重构落地

- 状态：`待开发`
- 记录日期：2026-07-28
- 模块：`packages/chipmate-vscode/webview-ui`（样式层 `src/styles/`、`ChatView`/`PromptInput`/`WelcomeEmptyState` 等组件）
- 背景：当前 QA 界面沿用 ChipMate 布局骨架叠加 Titanium Studio 蓝色玻璃材质，视觉上接近 ChipMate 换皮。2026-07-28 第一版 Signal Workbench 设计稿（石墨 + 琥珀仪器风）被用户否决；同日交付第二版 Liquid Glass 设计稿（类 iOS 26：静态极光底色 + 磨砂玻璃面 + 紫→青品牌渐变 + iMessage 式用户气泡），性能约束为常驻模糊面 ≤3 处、blur ≤20px、背景单次绘制零动画，待用户评审确认。
- 目标：用户确认设计稿后，以 CSS token 层替换 `titanium-studio.css` / `qa-liquid-glass.css` 材质，落地欢迎态、悬浮胶囊头、气泡消息流、玻璃输入坞与权限坞新视觉，深浅色双主题，高对比主题保持现有兜底。

### 验收标准

- 常驻模糊面 ≤3 处（胶囊头/输入坞/权限卡）且 blur ≤20px；工具芯片与代码卡使用无模糊深色玻璃；极光背景静态单次绘制；动画仅 transform/opacity；`prefers-reduced-transparency` 与 `@supports` 兜底退化为不透明面板。
- 输入坞控件收敛：常驻上限为 3 枚选择器 chip + 索引状态 chip + ≤3 图标 + 发送光球；低频项（沙盒/收起/重置模型/新会话/Fork/Worktree）进入 ＋/⋯ 玻璃菜单；todos/上下文/用量收进胶囊头抽屉；窄栏 <340px 自动并入 ⋯。自动批准开启时输入坞边常驻 AUTO 徽章。
- 浅色、深色、高对比三套主题下对比度满足现有可访问性基线，视觉回归截图更新。
- 仅改样式 token 与 class 结构映射，不改动组件事件与数据契约；`bun run typecheck`、`bun run test:unit`、相关视觉回归通过。
- 设计稿源文件与截图位于会话临时目录（不入库）；实施时以设计令牌表为准重新落在仓库样式文件中。

### 完成记录

待用户评审设计稿（A 欢迎深色 / B 对话深色 / C 宽栏权限坞 / D 欢迎浅色 / E 令牌规格板）后启动实施。

## DEV-005：离线 Windows 自动更新 native-x64 发布验收

- 状态：`进行中`
- 记录日期：2026-07-28
- 模块：`packages/chipmate-vscode/src/services/update-check`、`packages/chipmate-vscode/qa/windows-real`
- 背景：Windows 内置 CLI 安装适配、专用更新日志、设置页原始错误展示和独立 `update` lane 已实现并完成 macOS 自动化验证；当前会话没有 native-x64 Windows 运行环境，且按当前源码版本增加一个 patch 后的 `1.0.9` Windows baseline 产物已存在，不能覆盖同名产物或伪报真实闭环通过。
- 目标：准备两个新鲜、连续版本的 Windows baseline VSIX，在原生 Windows x64 上完成旧版到候选版的真实离线自动更新与故障矩阵，确认后再发布 handoff 产物。

### 验收标准

- 使用隔离的中文、空格 `user-data-dir` 和 `extensions-dir`，PATH 中 `Get-Command code` 无结果。
- 旧版启动后完成 manifest 请求、单次 VSIX 下载、大小、SHA-256、身份、版本和 target 校验，并通过当前 `Code.exe + out/cli.js` 覆盖安装。
- Reload Window 提示可见且可点击；重载后 installed-host probe 确认候选版本已激活，不以文件落盘或扩展列表代替激活证据。
- 错误 target、跨源 URL、SHA-256 不符、大小不符和安装器路径缺失均显示真实错误；安装失败保留已校验缓存，重试不重新下载。
- 更新日志按钮、复制详情、并发单安装和敏感信息扫描通过。
- 结果必须来自 `-Lane update -Gate native-x64`；ARM64 虚拟机结果只能作为补充。
- 新 VSIX 使用 `win32-x64-baseline`、无 FFmpeg、无 source map，并完成离线内容审计后原子发布到 `public-packages`。

### 完成记录

已按用户指定版本生成并原子发布独立文件 `chipmate-1.0.8-auto-update-fix-win32-x64-baseline.vsix`，保留原有同版本产物且未覆盖；包内扩展身份仍为 `chipmate.chipmate@1.0.8`，归档身份、目标、离线依赖、排除项和 fresh CLI 哈希审计通过。先前生成的 `chipmate-1.0.10-win32-x64-baseline.vsix` 仍保留。由于同版本不能通过版本比较触发自动升级，1.0.8 修复包仅作为首次手动覆盖安装基线；当前也没有 native-x64 Windows 执行环境，因此真实自动更新闭环与故障矩阵仍未验证。

2026-08-04 的 LanceDB 0.33.0 Windows x64 候选包为 `276,696,060` 字节，超过旧客户端 `268,435,456` 字节的下载门禁；重新以最高 Deflate 等级压缩后仍为 `275,721,760` 字节。发布该升级前必须通过可复现的本地文件系统专用 LanceDB native 构建或其他受审计的包内容优化，把 VSIX 降到旧客户端可下载范围，再执行 native-x64 自动更新验收；仅提高新版本自身的下载上限不能解决旧版本下载候选包时的拦截。

2026-08-05 已按 1.0.15 基线重新生成并发布 `chipmate-1.0.16-win32-x64-only.vsix`：通过受审计的 Windows x64 LanceDB 精简构建将包缩小到 `260,363,235` 字节，低于旧客户端门禁 `8,072,221` 字节；新客户端默认下载上限已提高到 `536,870,912` 字节，并新增 Windows 发布包不得超过旧门禁的构建检查。包内版本、扩展身份、target、fresh CLI 与 LanceDB native 哈希、纯 x64 架构及禁入项审计通过，ECS 公网发布与鉴权下载验收通过。ChipMate Server `10.10.5.23:6001` 当前仍仅能建立 TCP、所有 HTTP 路径均返回空响应，因此动态 manifest 发布与 native-x64 Windows 自动升级激活验收仍未完成。

## DEV-006：Ultra 三路深化与三路验证组合模式 A/B 验收

- 状态：`已完成（组合模式未通过优于纯三路验证的验收）`
- 记录日期：2026-07-29
- 模块：`packages/opencode/src/chipmate/agent/ultra-verify.ts`、`packages/opencode/src/chipmate/tool/ultra-verify.ts`
- 背景：与既有实验一致的纯三路验证模式已完成 12 题公平 A/B，并交付 ChipMate 1.0.9 Linux/Windows baseline VSIX。组合模式实现为“冻结 Code 基准 → 三路并行深化 → 三路并行验证全部深化报告 → 独立 Ask 综合”。两种模式均已使用同一 `deepseek-v4-flash` Judge、相同题目和 rubric 完成双轮反向 A/B。
- 目标：验证组合模式是否同时优于配对 Code 和纯三路验证，并据此决定是否保留额外深化阶段。

### 验收标准

- 回答阶段只能访问公开题面和固定 revision 源码，不得访问秘密 rubric、旧答案、旧分数或评审反馈。
- 每题的 Code 基准与组合模式必须来自同一次配对运行；组合模式须证明三路深化、三路验证和独立综合均执行完成。
- 采用两个全新 Judge Session 做源码核验盲评，第二轮交换 A/B 位置。
- 组合模式总体分数高于配对 Code，且高于纯三路验证基线 `91.42`；如未通过，不针对本题集继续调参。
- 运行前后源码指纹一致，产品代码不得出现题号、仓库名或具体符号特判。

### 完成记录

2026-07-29 余额恢复后完成 12/12 组合模式配对回答和双轮反向源码盲评。12 个有效样本均证明冻结 Code 基准、三路深化、三路验证、独立 Ask、8 个内部会话及最终文本精确交付；源码和产品哈希前后不变。

同一 DeepSeek Judge 下，纯三路验证为 `95.42`，配对 Code 为 `77.58`；组合模式为 `93.46`，其配对 Code 为 `75.75`。两种 Ultra 都在 12/12 题上胜过各自 Code，但组合模式比纯三路验证低 `1.96` 分，且平均耗时从 `296.6` 秒增加到 `417.3` 秒（`1.41×`）。按单题差值大于 1 分计，组合相对纯验证为 1 胜、3 平、8 负。因此组合模式未通过验收；按协议不再针对这 12 题调参，推荐发布和继续验证纯三路验证模式。
