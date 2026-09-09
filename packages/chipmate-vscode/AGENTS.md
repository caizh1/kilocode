# packages/chipmate-vscode/AGENTS.md

本文件适用于 `packages/chipmate-vscode/`，并继承仓库根 `AGENTS.md`。根规则负责仓库级质量、Git 和最终包发布；本文件只保留 VS Code 扩展的架构、UI、打包和平台约束。

## 产品边界

- 本 package 是 ChipMate VS Code 扩展；Agent Manager 是扩展内的编辑器面板，不是独立产品。
- 扩展捆绑 ChipMate CLI，通过 HTTP、SSE，以及少量 PTY/WebSocket 通道连接扩展拥有的 `chipmate serve`。
- 最新的跨产品架构以 `packages/chipmate-docs/pages/contributing/architecture/vscode-extension.md`、CLI 架构文档和当前源码为准，不在本文件复制完整产品表。

## 常用命令

| 目的 | 命令 |
|---|---|
| 构建并启动扩展 | `bun run extension` |
| 编译检查 | `bun run compile` |
| Watch | `bun run watch` |
| 类型检查 | `bun run typecheck` |
| Lint | `bun run lint` |
| 单元测试 | `bun run test:unit` |
| VS Code 集成测试 | `bun run test` |
| 未使用导出检查 | `bun run knip` |
| ChipMate marker 检查 | `bun run check-chipmate-change` |

- 根目录也可运行 `bun run extension`。启动参数包括 `--insiders`、`--workspace PATH`、`--clean`、`--wait`、`--app-path` 和 `VSCODE_EXEC_PATH`。
- 单个 Bun 单测直接运行 `bun test tests/unit/<file>.test.ts`；VS Code 集成测试按当前测试 runner 的 grep 参数筛选。
- 只格式化本次改动涉及的文件，避免用全 package 格式化制造无关 diff。

## CLI 与进程

- 扩展使用 `bin/chipmate` 或目标平台的 `chipmate.exe`，不依赖系统安装的 CLI。
- 本地 CLI 准备脚本是 `bun script/local-bin.ts`；需要强制重建时传 `--force`。
- 打包必须使用本次全新生成的 `packages/opencode/dist/@chipmate/cli-*`，不得复用当前 `bin/`、历史 VSIX 或从旧包解压的 CLI。
- `script/build.ts` 必须在编译扩展前自动清空并全新构建本次目标对应的 release CLI，固定目标版本、`CHIPMATE_RELEASE=1` 和禁止 CLI 自行上传，并生成、复核 `dist/.chipmate-release-cli-build.json`；复制每个目标前必须再次核验凭证和实际二进制哈希，防止并发构建替换 CLI。交付打包禁止通过 `CLI_DIST_DIR` 或预先手工构建绕过该流程。
- 激活时只创建一个共享 `ChipMateConnectionService`。首次连接时 `ServerManager` 启动 `chipmate serve --port 0`，通过随机 `CHIPMATE_SERVER_PASSWORD` 认证，并在当前子进程存活时复用它。
- Sidebar、Open in Tab 面板和 Agent Manager chat 共用该连接；每个 `ChipMateProvider` 按 session 过滤 SSE。Agent Manager 的终端通道不代表存在独立 `chipmate serve`。
- 后端状态是否隔离取决于状态分配位置：`InstanceState` 按 directory 隔离，service closure 中的状态跨同一扩展宿主请求共享。修改 Snapshot、并发或 worktree 行为时必须验证该边界。

## VSIX 打包

- 用户未限定平台时，默认交付 `darwin-arm64` 和 `win32-x64-baseline`；用户明确限定版本、平台或包类型时只构建指定范围。Windows 基线包不得用通用 `win32-x64` 目标替代。
- 内网离线构建使用 `bun script/build.ts --internal-offline`。该命令不传 `--targets` 时只构建 `win32-x64-baseline`；需要默认双平台时显式传 `--targets=win32-x64-baseline,darwin-arm64`。
- 所有 Windows VSIX 都必须是纯 x64；即使目标名是 `win32-x64-baseline`，也必须传 `--windows-x64-only`。不得构建或打入 Windows ARM64/AArch64 CLI、Indexer、PTY、LanceDB 或其他架构 sidecar，并审计包内不存在任何 ARM/AArch64 资源。
- `RELEASE_NOTES.md` 必须非空，并以 `# ChipMate <version>` 开头；构建脚本会同时验证 VSIX 内副本。
- `RELEASE_NOTES.md` 默认是逐版本增量说明：先从受保护发布清单确认目标版本之前紧邻的 ChipMate 已发布版本，再以该版本对应的已发布产物和可追溯源码为基线，只写此后新增、修复或变化的用户可见内容。不得用当前源码 manifest、最近 Git 标签、最后找到的旧包或更早版本代替基线；例如 `1.0.11` 只能默认写“相较 `1.0.10`”，不能写“相较 `1.0.6`”。前序产物或源码无法核验时停止生成并报告；累计说明或跨 minor 汇总必须由用户明确要求。
- 内网 provider、ChipMate Server、render、marketplace 和 indexing 默认值只允许从忽略的本地输入或环境变量注入。源码 manifest 必须在成功或失败退出后恢复，不得留下私有 endpoint、模型或 `chipmatePackageTarget`。
- 统一服务入口是 `chipmate.v2.chipmateServer.baseUrl`。`chipmate.v2.documents.wordRender.remoteEndpoint` 和 `chipmate.v2.documents.mermaidRender.remoteEndpoint` 仅为兼容配置；不得再使用旧的 `chipmate.documents.*` 命名空间。
- 每个 VSIX 的包内 manifest 必须包含与目标一致的临时 `chipmatePackageTarget`；checked-in `package.json` 不保留该字段。
- 内网 `models-snapshot.json` 必须是至少包含一个 provider 的对象；不得把“裁剪”实现为空对象。自定义 provider 配置和模型选择必须仍可工作。
- Windows 内网基线默认仅保留 `en` fallback 和 `zh`，不捆绑 FFmpeg 和 source map；必须包含离线 ripgrep、LanceDB、Tree-sitter、CLI、扩展运行时以及所有当前 webview bundle。
- `script/build.ts` 的最终 archive 审计是必需/禁止文件的唯一真源。新增 bundle、sidecar 或 runtime 资源时更新脚本和测试，不在 `AGENTS.md` 维护第二份文件清单。

### ChipMate DeepSeek Harness 运行时分发

- ChipMate DeepSeek Harness 使用的 Windows 和 Linux 官方 DSH 运行时由 ChipMate Server 发行镜像统一内置并通过运行时接口分发。ChipMate Server 只负责托管和分发；下载后的官方 DSH 必须在用户本机及对应工作区中执行。
- 禁止把完整官方 DSH 运行时、运行时 ZIP、为官方 DSH 单独捆绑的 Node 运行时或 `bin/dsh-runtime/**` 打入 VSIX。`packages/chipmate-vscode/dsh-runtime/` 仅用于构建和校验官方运行时归档，不属于 VSIX 内容。
- VSIX 只允许包含当前目标平台的 `bin/dsh-runtime-lock.json`、生命周期 Supervisor，以及下载、校验、安装和启动本机官方 DSH 所需的代码。锁文件不得同时包含 Windows、Linux 或其他非当前目标平台。
- 扩展必须从 ChipMate Server 下载与 VSIX 锁文件逐字段匹配的运行时，在临时目录完成完整性与归档安全校验后原子安装到本机缓存。版本、目标、SHA-256、大小或文件清单哈希不一致时必须拒绝使用。
- ChipMate Server 不可用、下载失败或运行时校验失败时，禁止回退到 VSIX 内置运行时、半成品缓存或普通 ChipMate Agent。`script/build.ts` 的归档审计必须继续拒绝 `extension/bin/dsh-runtime/**`，并验证锁文件只包含当前目标平台。

## Embedding 与索引默认值

- 内网默认配置为 `openai-compatible`、`qwen3-embedding-8b`、`dimensionMode: auto` 和 `lancedb`。
- 自动模式不发送 OpenAI `dimensions` 字段；先验证服务真实返回向量，再用真实长度创建或校验 LanceDB schema。
- 当前内网还提供 `bge-m3`，它不支持 `dimensions` 请求字段。不得把 schema 维度、返回长度校验和请求参数绑定为同一开关。
- 只有用户明确选择固定维度、目标服务确认支持且返回长度一致时，才允许固定模式发送 `dimensions`。
- 修改这些行为时至少覆盖自动探测、固定模式、返回长度不一致、已有 LanceDB schema 兼容和 `bge-m3` 不发送字段的测试。

## 发布边界

- 最终包必须按根 `AGENTS.md` 原子写入 `public-packages`，并通过 `/Users/archer/.local/bin/chipmate-publish-package` 完成 ECS 私有平台验收。
- 面向扩展自动更新的内网 VSIX 还必须按现有 render-service 发布流程，以临时文件上传、核对 SHA-256 后原子改名，并验证动态 `/packages/manifest.json`。该更新清单与 ECS 私有平台的 `/manifest.json` 是不同契约。
- 不创建或传输手写 `latest.json`，也不额外包装 `.tar.gz`。自动更新渠道未配置或验收失败时必须明确报告，不得用 ECS 下载页冒充客户端更新已可用。

## 构建结构

- Extension 是 Node/CJS bundle：`src/extension.ts` → `dist/extension.js`。
- Webview 是 browser bundle，当前包含 Sidebar、Agent Manager 和 diff 等入口；具体输出列表以 `esbuild.js` 和打包审计为准。
- Extension 源码位于 `src/`，webview 位于 `webview-ui/`；webview 使用 SolidJS，不是 React。
- 测试输出到 `out/`，产品 bundle 输出到 `dist/`，两者不能互相替代。
- CSP 必须使用 nonce 并覆盖实际字体来源；不要用易漂移的源码行号记录 CSP 位置。
- VS Code 操作顺序使用确定性的事件或状态等待，避免用任意 `setTimeout` 猜测 UI 已就绪。

## Extension 与 Webview 功能链路

需要把 CLI 数据展示到 webview 时，通常同时检查：

1. `src/services/cli-backend/` 下的响应类型和 HTTP client；
2. `src/ChipMateProvider.ts` 的请求处理、缓存和消息发送；
3. `webview-ui/src/types/messages/` 下的双向消息类型；
4. `webview-ui/src/context/` 的订阅、请求和重试；
5. `webview-ui/src/components/` 的消费与渲染；
6. 对应单测、浏览器测试或 VS Code 集成测试。

- 消息订阅必须能处理 webview mount 前到达的缓存推送。
- 重试应绑定连接或请求状态并可取消，避免无界 timer、重复请求和 panel dispose 后继续更新。
- Extension 与 webview 不共享 JavaScript 内存状态，所有跨边界状态都必须通过消息或后端接口传递。

## Agent Manager

- Extension 代码位于 `src/agent-manager/`，webview 位于 `webview-ui/agent-manager/`。
- Agent Manager 在编辑器 tab 中管理多个 session，可为 session 创建独立 worktree；状态文件是 `.chipmate/agent-manager.json`，setup script 是 `.chipmate/setup-script`。
- Worktree session 把 `directory` 传给共享后端，不启动每 worktree 一个 server。终端、Git 子进程、setup script 和另开的 VS Code window 属于独立进程或 extension-host 边界。
- `src/agent-manager/` 的文件行数上限由 `tests/unit/agent-manager-arch.test.ts` 强制执行；不得提高上限，超限时提取无 VS Code 依赖的 helper。

## Webview UI 与图标

- 自定义 webview 页面、弹窗、卡片、表单和状态反馈默认遵循 iOS 26 Liquid Glass；使用通透分层、细腻边界、柔和高光、轻盈阴影和流畅反馈，避免粗糙网页默认样式。
- 新功能优先复用 `@chipmate/chipmate-ui` 和现有 webview 组合方式；不要用 raw HTML 加 inline style 重新实现已有组件。
- 复用现有 token、`data-component`、`data-slot` 和共享 CSS。确实缺少通用能力时先补到 `chipmate-ui`，再由 webview 使用。
- VS Code 原生相邻的工具栏动作是特例：优先 Codicons 或现有 `IconButton`，单色继承 `currentColor`，遵循主题 token；不使用自定义彩色图标、无上下文圆形徽标或廉价渐变。
- 图标、图标按钮和状态图标必须留在正常文档流中，使用 `inline-flex`、flex 或 grid 对齐；禁止用 `position: absolute` 做图标布局。
- 新图标先检查相邻动作和项目现有资源，匹配尺寸、视觉重量、间距以及 hover、active、focus、disabled 状态。
- UI 改动必须验证窄宽度、长文本、缩放、键盘焦点和主题切换，不得只验证单一桌面宽度。
- VS Code Webview 中，工作动画的 reduced-motion 最终真源必须是 `body.vscode-reduce-motion`；原始 `prefers-reduced-motion` 只允许作为 `body:not([data-vscode-theme-id])` 的非 VS Code fallback。禁止用 `.chat-view`、`.settings-shell` 或其他祖先的通配后代规则仅凭原始媒体查询设置 `animation: none`、`animation-duration` 或 `animation-iteration-count`，从而覆盖 `WorkingIndicator`、动态 Spinner 或其运动层。新增或修改相关组件、全局/容器级 motion CSS、样式入口或打包流程时，必须运行并按需扩展 `tests/dynamic-spinner-motion.spec.ts`：至少覆盖“操作系统 reduce + VS Code Off”仍持续运动、“VS Code On”静态降级，并验证计算动画时长/循环次数及两个时点的 transform 或像素确实变化；只检查资源存在、DOM、`display` 或 `data-spinner-variant` 不算通过。`script/build.ts` 必须继续对最终 VSIX 的 `extension/dist/webview.css` 执行同一动画契约审计，审计失败时禁止交付或发布。

## Diff 与性能

- Changes/review 链路保留 hunk-bounded patch，并在可用时向渲染器传递 patch 派生的 metadata。
- 不因 changed-line 数量很小就同步解析巨大完整文件；初次渲染保持 hunk-bounded，并按可见性或激活状态延迟高成本工作。
- 修改 diff 调度时同时验证快速切换 session 和快速滚动 review，不能把一侧卡顿转移到另一侧。

## Windows 进程

- 不直接从 `child_process` 导入 `spawn`、`execFile` 或 `exec`。使用 `src/util/process.ts` 的 wrapper，确保 `windowsHide: true`。
- 必须使用原始 API 时显式设置 `windowsHide: true`；涉及 MCP 第三方 transport 时保留现有 process shim 行为。

## 调试、命名和测试

- 扩展日志查看 Extension Host Output，webview 日志查看 Webview Developer Tools。
- Chrome/VS Code performance trace 必须按 `Profile.id` 关联 `ProfileChunk`；`v8:ProfEvntProc` 不是应用工作已离开主线程的证据。
- 新增 debug 输出沿用 `[ChipMate New]` 前缀，并避免记录密钥、凭据、完整请求或敏感配置。
- VS Code command 和 view ID 使用 `chipmate.v2.` 前缀；Sidebar 保留 `chipmate.v2.SidebarProvider` 兼容升级位置。
- 本 package 和 `packages/chipmate-ui/` 不使用 `chipmate_change` marker。
- 文档截图 story 必须先与对应文档状态对齐；更新视觉基线时同步检查 `tests/visual-regression.spec.ts` 的 docs 映射。
- 完成实现前运行根质量表中适用于本次改动的最小检查；打包相关修改必须至少执行实际构建或打包审计。
