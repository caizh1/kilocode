# 待开发事项

本文件是当前项目跨 session 的统一待开发事项台账。后续 session 发现明确、可执行且决定延期的开发项时，必须在此新增或更新记录；重复事项更新原记录，不重复创建。

状态统一使用：`待开发`、`进行中`、`已完成`、`取消`。事项完成或取消后保留历史记录，只更新状态和结果。

普通代码 TODO、当前 session 内的临时步骤、推测性风险和证据不足的问题不进入本台账。

## DEV-001：ChipMate Server 自签名或私有 CA 的插件级证书信任

- 状态：`待开发`
- 记录日期：2026-07-22
- 模块：`packages/kilo-vscode`、`packages/opencode/src/kilocode`
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
- 模块：`packages/opencode/src/kilocode/embedded-review`、ChipMate Server 部署环境
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
- 模块：`packages/kilo-vscode/webview-ui`（样式层 `src/styles/`、`ChatView`/`PromptInput`/`WelcomeEmptyState` 等组件）
- 背景：当前 QA 界面沿用 Kilo 布局骨架叠加 Titanium Studio 蓝色玻璃材质，视觉上接近 Kilo 换皮。2026-07-28 第一版 Signal Workbench 设计稿（石墨 + 琥珀仪器风）被用户否决；同日交付第二版 Liquid Glass 设计稿（类 iOS 26：静态极光底色 + 磨砂玻璃面 + 紫→青品牌渐变 + iMessage 式用户气泡），性能约束为常驻模糊面 ≤3 处、blur ≤20px、背景单次绘制零动画，待用户评审确认。
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
- 模块：`packages/kilo-vscode/src/services/update-check`、`packages/kilo-vscode/qa/windows-real`
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

## DEV-006：Ultra 三路深化与三路验证组合模式 A/B 验收

- 状态：`已完成（组合模式未通过优于纯三路验证的验收）`
- 记录日期：2026-07-29
- 模块：`packages/opencode/src/kilocode/agent/ultra-verify.ts`、`packages/opencode/src/kilocode/tool/ultra-verify.ts`
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
