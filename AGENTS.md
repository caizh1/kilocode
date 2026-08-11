# AGENTS.md

本文件只定义 `/Users/archer/Work/chipmate` 的仓库级规则。进入含有更深层 `AGENTS.md` 的目录时，同时遵循更具体的子目录规则；易变化的架构、文件清单和实现细节应由源码、测试、脚本或专项文档维护，不要继续堆入本文件。

## 工作原则

- 能并行执行的独立读取、搜索和验证应并行执行。
- 默认分支是 `main`。
- 在安全、权限和信息充分的前提下优先自动完成请求，不为可逆的常规步骤反复确认。
- 只修改当前工作目录，不跨到其他 checkout 或 worktree；保留用户已有的脏工作区和无关改动。
- 构建产物、日志、截图、缓存、QA 临时目录和传输文件默认保持本地且不进入 Git。

## 跨会话开发待办

- 根目录 `DEVELOPMENT_TODO.md` 是唯一的跨会话开发待办。
- 只有在本次任务发现了具体、可执行且被明确延期的开发项时才新增或更新；优先更新已有项，避免重复。
- 已完成或已取消的事项更新状态，不删除历史。
- 不记录猜测风险、普通代码 TODO、一次性执行步骤或当前会话仍在完成的工作。

## 命令与质量门禁

- 开发：根目录运行 `bun run dev`；传参示例为 `bun run dev -- help`。
- 扩展开发：根目录运行 `bun run extension`；可传 `--no-build`。
- 仓库类型检查：`bun run typecheck`（等价于 `bun turbo typecheck`）。
- 后端与 SDK 的程序化验证遵循 `TESTING.md`，使用开发入口，不用已安装的生产 `chipmate serve` 替代源码验证。
- 禁止在根目录运行 `bun test`；根脚本会主动失败。测试必须在对应 package 中运行。

| 范围 | 最小相关检查 |
|---|---|
| 根目录或跨包 | `bun run lint`、`bun run typecheck` |
| CLI | 在 `packages/opencode/` 运行 `bun run typecheck`，并运行目标测试或 `bun test` |
| VS Code 扩展 | 在 `packages/chipmate-vscode/` 运行 `bun run typecheck`、`bun run lint`、目标单测或 `bun run test:unit` |
| 扩展构建/打包 | 在 `packages/chipmate-vscode/` 运行 `bun run compile` 或实际打包命令 |
| JetBrains | 在 `packages/chipmate-jetbrains/` 运行 `./gradlew typecheck`、`./gradlew test` |

- 修改 `packages/opencode/src/server/` 端点后，从根目录运行 `./script/generate.ts` 更新 JS SDK。
- 修改 `packages/chipmate-vscode/`、其 webview 或 `packages/opencode/src/` 中的 URL 后，运行 `bun run script/extract-source-links.ts` 并提交更新后的 `packages/chipmate-docs/source-links.md`。
- VS Code 扩展按需运行 `bun run knip` 和 `bun run check-chipmate-change`。
- 修改共享 OpenCode 文件时运行 `bun run script/check-opencode-annotations.ts --worktree`；修改 Effect service adapter 时再运行 `bun run script/check-opencode-promise-facades.ts`。
- 增删 `.github/workflows/` 文件时运行 `bun run script/check-workflows.ts`。
- Markdown 表格只使用紧凑格式；运行 `bun run script/check-md-table-padding.ts --fix` 修复填充空格。
- 只运行能覆盖本次改动的最小相关检查；无法运行或存在既有失败时，明确报告范围和原因。

## 子目录规则与架构真源

| 范围 | 必读规则 |
|---|---|
| `packages/opencode/` | `packages/opencode/AGENTS.md` |
| `packages/chipmate-vscode/` | `packages/chipmate-vscode/AGENTS.md` |
| `packages/chipmate-jetbrains/` | `packages/chipmate-jetbrains/AGENTS.md` |
| `server/chipmate-word-render/` | `server/chipmate-word-render/AGENTS.md` |

- 当前产品和进程架构以 `packages/chipmate-docs/pages/contributing/architecture/` 下的文档及当前源码为准，不在根规则中复制易漂移的产品表、进程拓扑或具体行号。
- `packages/sdk/js/src/gen/` 是生成代码，不手工编辑。
- VS Code 原生相邻的工具栏和图标规则以 `packages/chipmate-vscode/AGENTS.md` 为准；其 Codicon、主题 token 和原生交互要求优先于通用视觉风格。

## VS Code 扩展打包

- 开始任何 VSIX 打包前先读取 `packages/chipmate-vscode/AGENTS.md`，并以 `packages/chipmate-vscode/script/build.ts` 的当前校验为包内容真源。
- 用户只说“打包”且未限定平台时，默认构建 macOS Apple Silicon 和 `win32-x64-baseline`；用户限定版本、平台或包类型时严格缩小到该范围，不额外构建。
- 每次都先全新构建目标 CLI，再从本次生成的 `packages/opencode/dist/@chipmate/cli-*` 打包；不得复用旧 VSIX、旧 CLI、旧 `bin/` 或历史包解压内容。
- 生成目标版本的更新说明时，默认只描述相对同一产品发布序列中紧邻已发布版本的增量；例如 `1.0.11` 必须对比 `1.0.10`，不得因为源码版本、Git 标签或手边旧包停留在 `1.0.6` 就生成累计说明。前序版本必须从受保护发布清单和对应已发布产物确认；无法确认时报告阻塞，不得猜测。只有用户明确要求累计说明、跨 minor 汇总或指定其他基线时才允许扩大比较范围。
- 每次发布 ChipMate 新版本时，必须先在 `packages/chipmate-vscode/CHIPMATE_CHANGELOG.md` 新增该版本章节并保留全部既有版本记录，同时让 `packages/chipmate-vscode/RELEASE_NOTES.md` 仅记录该版本相对紧邻已发布版本的增量；两者对应版本的正文必须一致，同版本所有平台必须使用同一份说明。VSIX 打包必须将完整 `CHIPMATE_CHANGELOG.md` 作为 VS Code Extensions 详情页的 changelog，并校验包内不含 ChipMate 上游发行记录；不得覆盖、截断或漏掉历史版本。
- 内网/离线默认值只能来自忽略的本地配置或当前进程环境。不得把私有 provider、模型或 endpoint 写入 tracked source、`package.json` 默认值、测试、README 或可提交文档；打包结束必须恢复 manifest。
- 内网索引默认使用 `openai-compatible`、`qwen3-embedding-8b`、`dimensionMode: auto` 和 `lancedb`。向量服务的真实返回长度用于 LanceDB schema 和一致性校验；自动模式不发送 OpenAI `dimensions` 字段。
- 当前内网还支持 `bge-m3`；该模型不接受 `dimensions` 请求字段。只有用户明确选择固定维度且目标服务确认支持时，才允许发送该字段。
- 所有 Windows VSIX 都只交付纯 x64：构建时必须使用 `--windows-x64-only`，不得构建或打入 Windows ARM64/AArch64 CLI、Indexer、PTY、LanceDB 或其他架构 sidecar，并在归档审计中确认不存在 ARM/AArch64 资源。
- 后续凡打包目标包含 Windows x64，都必须通过 `CHIPMATE_INTERNAL_LANCEDB_WIN32_X64_BINARY` 注入与当前 LanceDB 版本和 ABI 匹配、已经审计的 internal/local-only x64 原生二进制；打包前必须确认该变量指向真实文件，打包后必须核对包内 PE 架构、SHA-256 和文件大小。变量缺失、文件不可用、版本或 ABI 不匹配时必须停止打包并报告阻塞，禁止静默回退到上游完整 `@lancedb/lancedb-win32-x64-msvc` 二进制。
- Windows 内网基线包默认无 FFmpeg、无 source map，保留 `en` fallback 与 `zh`，并包含离线 ripgrep、LanceDB、Tree-sitter、扩展运行时和 webview 资源；具体必需/禁止文件由打包脚本审计，不在本文件复制清单。
- 从 macOS 生成供 Linux 解压的归档时必须去除 Apple xattr，并检查内外层归档不含 `com.apple`、`LIBARCHIVE.xattr`、`SCHILY.xattr`、AppleDouble 或 `__MACOSX` 元数据。

## 最终包发布

- 所有完成的 VSIX、离线归档、Docker 归档和 ZIP 最终包都必须发布到 `/Users/archer/Work/chipmate/public-packages`；先写临时文件，核对大小与 SHA-256，再原子改名并生成同名 `.sha256`。
- 每次打包都必须对每个最终包运行：

  ```bash
  /Users/archer/.local/bin/chipmate-publish-package <最终包绝对路径> <产品> <版本> <平台>
  ```

- 产品、版本和平台必须来自用户要求、构建目标或包内 manifest，不能只猜文件名。发布脚本负责 SSH 临时上传、服务器原子发布、macOS 钥匙串登录、清单/SHA-256/长度核对和受保护 Range 下载验证。
- 只有发布脚本最终输出 `ECS 公网发布与鉴权下载验收通过` 才能报告 ECS 发布完成；脚本、专用 SSH 权限或钥匙串凭据失败时，保留已验证本地包并准确报告阻塞，不得绕过脚本手工上传。
- 发布命令缺失时，只能从 `/Users/archer/.local/share/chipmate-package-deploy/publish-local.sh` 恢复到上述固定路径；恢复源也不存在时直接报告阻塞，不自行另写上传流程。
- 不得读取、输出、复制或记录密码、Cookie、会话密钥和 SSH 私钥，也不得通过匿名 `curl` 把受保护资源的 `401` 或登录跳转误判为发布失败。
- 稳定私有平台使用 `https://106.14.118.87/`，清单和下载需要登录。不得降级到 HTTP 传输凭据或包文件，也不得为包发布修改服务器 `/v1/`、HTTPS `443` 或其他既有服务。
- Cloudflare Quick Tunnel 只作为本机目录的临时备用入口。需要启用时只运行一个端口 `8765` 的 Tunnel，并使用 `cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8765 --http-host-header 127.0.0.1:8765 --protocol http2`；从最新日志确认 `protocol=http2`，`lax` 等美国节点不得判定可用，应优先重连到 `hkg`，再验证目录、长度和实际下载。使用当前动态 URL，不复用旧地址。
- 自动化任务只有在用户明确指定准确包并要求永久删除时才有删除权限；普通打包、上传、保留版本或磁盘清理不包含删除授权。
- 最终答复应给出 HTTPS 平台首页、登录后下载 URL、文件名、大小和 SHA-256，并分开说明源码/构建验证、本地发布、ECS 验收和目标机安装运行验收。
- `/Users/archer/Work/opencode` 只作只读参考，禁止把 ChipMate 产物发布到该 checkout。

## 代码风格与测试

- 保持函数内聚；只有可复用或可组合的逻辑才提取。
- 优先 `const`、提前返回和类型推断；确需重赋值时才使用 `let`。
- 避免不必要的解构、`try/catch`、`else`、`any` 和冗余显式类型。
- `catch` 不得为空；必须恢复、重试、重新抛出或通过现有 logger 记录错误。
- 新增局部变量、参数和 helper 默认使用清晰的单词名；只有单词名会歧义时才使用复合名。
- 优先使用 Bun API 和仓库现有抽象，不假定依赖存在。
- 测试应覆盖真实实现，尽量避免 mock，不在测试中复制生产逻辑。
- 新增或修改代码前先检查相邻实现、导入、现有测试和 package 约定。

## OpenCode fork 隔离

- 修改共享 OpenCode 文件是最后手段。优先把 ChipMate 逻辑放在 `packages/opencode/src/chipmate/`，测试放在 `packages/opencode/test/chipmate/`，或使用其他路径名含 `chipmate` 的 ChipMate-owned package。
- 必须修改共享文件时，保持改动最小，并使用 `chipmate_change` 单行、区块或新文件标记；路径名含 `chipmate` 的文件不需要标记。
- `packages/chipmate-vscode/` 和 `packages/chipmate-ui/` 完全属于 ChipMate，不得加入 `chipmate_change`。
- 向 `packages/opencode/src/config/config.ts` 的 `Config.Info` 添加 ChipMate 配置键时，同时更新 cloud 仓库 `apps/web/src/app/config.json/extras.ts` 的 schema。
- 详细的抽取决策、标记方式和验证命令以 `.chipmate/skills/chipmate-merge-minimizer/SKILL.md` 为准。
- `bun install` 会把仓库本地 `merge.conflictStyle` 设为 `zdiff3`；不要覆盖回其他冲突格式。

## 提交与发布说明

- Commit 和 PR 标题使用 `type(scope): summary`，类型限 `feat`、`fix`、`docs`、`chore`、`refactor`、`test`；scope 使用受影响 package 或功能域。
- 面向用户的功能、修复或破坏性变更需要一个简洁 changeset；描述使用面向用户的祈使句，相关改动优先合并为一个 changeset。
- 提交或推送前检查 staged/unstaged 文件，只包含本次任务相关源码、测试、文档和 changeset。
- 不提交 VSIX、归档、日志、截图、缓存、QA 目录、source map 或其他本地产物，除非用户明确要求且仓库本来就跟踪该类文件。
- PR 描述说明改了什么、为什么改，以及 reviewer 无法从 diff 推断的约束；不写逐文件清单或重复显而易见的测试日志。
- 创建或管理 VS Code/JetBrains GitHub issue 时，读取 `.chipmate/skills/gh-issues/SKILL.md`。
