# ChipMate Bug 自动修复中心

本服务用于收集内部 Bug，通过 Mac 上的独立执行器触发 Codex 修复、确定性测试、独立 P0/P1 审查、双平台打包、Windows ARM 与 Linux 验收，并调用现有受保护发布流程。

## 安全边界

- Web 服务不保存源码、SSH 密钥或发布凭据。
- Codex 只在独立 worktree 中工作，不获得发布命令的环境和凭据。
- Worker Token 仅用于领取任务和回传状态。
- 公开注册必须提交邀请码；新账号固定为 `reporter`，不能通过注册接口提升权限。
- 邀请码只以摘要保存，明文仅在创建时显示一次。每个用户一生只能生成一个邀请码，每个邀请码最多成功注册3人。
- 所有发布均由确定性执行器调用外部受保护命令。
- 任务空闲时只有 SSE 连接，不调用模型、不消耗模型 Token。
- 登录用户提交 Bug 后会立即创建自动修复任务；在线执行器通过 SSE 收到事件并自动领取，不需要用户再次点击“开始”。
- 任务详情通过登录态 SSE 实时同步当前步骤、运行时长、结构化执行日志和 Codex 输出摘要；断线时保留30秒轮询兜底。
- 页面以折叠详情展示 Codex Assistant 输出、工作区命令、退出码、命令输出、文件变更和受控工具结果；
  不展示 Codex 推理链。Runner 与服务端会分别脱敏并限制单条长度，每个任务只保留最近500条日志。

## 本地开发

```bash
npm install
export CHIPMATE_WORKER_TOKEN="$(openssl rand -hex 32)"
export CHIPMATE_ADMIN_PASSWORD="替换为至少12位的密码"
npm run admin:create -- admin admin
npm run dev
```

另一个终端运行 Web 开发服务器：

```bash
npm run dev:web
```

生产构建与最小质量门禁：

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## 服务端部署

1. 在服务器安装 Node.js 24 或更高版本。
2. 从受保护包服务的当前清单确认 ChipMate 最新版本，写入 `CHIPMATE_RELEASE_BASE`。
3. 生成至少32字符的 Worker Token，创建 `/etc/chipmate-bug-manager.env`，权限设置为 `0600`。
4. 运行 `deploy/install-server.sh <源码目录>`。
5. 将 `deploy/nginx-chipmate-bugs.conf` 加入现有 HTTPS server。
6. 执行 `nginx -t`，通过后热重载 Nginx。
7. 加载服务环境变量后，设置一次性的 `CHIPMATE_ADMIN_PASSWORD`，运行
   `npm run admin:create:prod -- <用户名> admin` 创建首个管理员账号。
8. 生成 `CM-` 加24位十六进制字符的初始邀请码，通过一次性的
   `CHIPMATE_INVITE_CODE` 运行 `npm run invite:default:prod`。该邀请码与普通用户邀请码一样，
   最多成功注册3人；明文应保存到系统钥匙串，不能写入源码、日志或部署配置。

现有 AI 接口、包首页、manifest 和包下载路径不能被新服务覆盖。

## 团队注册

- 登录页允许切换到“邀请码注册”，用户名为3至32位中英文、数字、点、下划线或连字符，密码至少12位。
- 注册成功后直接建立安全会话，账号角色固定为报告者。
- 每个登录用户都能生成一个邀请码并邀请3人；生成后的明文只显示一次，需要立即复制并妥善传递。
- 第3次成功注册会立即令邀请码失效。用户名冲突、参数错误或失败请求不会消耗邀请名额。
- 邀请关系可以继续扩展团队规模，因此这套机制控制的是增长速度和准入链路，不是全局人数硬上限。

## Mac 自动执行器

执行器可以读取正在使用的日常工作仓库，不要求用户暂停开发或清理工作区。领取任务时会使用独立
Git 索引把当前分支、全部已跟踪修改和配置范围内的未跟踪源码固化为不可变快照，再从该快照创建
自动化专属工作树；不会提交、暂存、锁定或覆盖用户工作区。任务开始后的用户修改不会混入已经
运行的任务；新任务或重新执行会重新获取当时的工作区快照。工作树创建后会按冻结锁文件离线准备
依赖并禁用安装脚本，避免复用历史构建产物或执行依赖中的任意生命周期脚本。

- 日常源码仓库、快照范围与独立工作树目录。
- 当前扩展源码相对目录。
- 确定性验证命令。
- 双平台打包命令。
- Windows ARM 与 Linux 验收命令。
- 仓库规定的受保护发布命令。
- 公共包目录。

敏感配置写入 `~/.config/chipmate/bug-runner.env`，权限设置为 `0600`。Worker Token 从 macOS
钥匙串读取，安装过程不会显示明文。Codex 使用独立权限配置档：只允许写任务工作树、只读任务所需
的 Git 元数据，并拒绝读取执行器配置、Codex 认证入口、SSH 目录和系统钥匙串：

```bash
bash deploy/install-mac-runner.sh "$(pwd)" monitor
bash deploy/install-mac-runner.sh "$(pwd)" shadow /工作目录/chipmate-source packages/chipmate-extension
```

`monitor` 只维持连接并报告在线状态，不领取任务；`shadow` 会自动修复、测试和审查，但强制停在
人工检查前，禁止打包发布；`release` 必须单独完成发布凭据和双平台验收配置，安装脚本不会自动启用。

专用 Codex 配置默认使用 `gpt-5.6-terra` 和 `max` 推理强度，修复与独立审查会分别创建隔离会话。
`max` 会增加单次任务的时间和 Token 消耗，但不会改变空闲时仅维持 SSE 连接的行为。任务详情按服务端
状态机展示“等待领取、分析问题、修改代码、运行测试、独立审查、等待确认”等真实阶段；进度条不根据
时间估算百分比，也不承诺剩余时间。

`CHIPMATE_MAX_TOKENS=0` 表示不再施加 Runner 自己的总 Token 硬上限，由 Codex 在单轮执行中管理
上下文并按需压缩；页面仍持续记录实际 Token。自动化仍受单任务90分钟超时、最多3轮修复、确定性测试
和独立审查约束。如需额外控制成本，可以把该值改成正整数重新启用自定义上限。

Runner 会把工作区准备、Codex 会话、受控命令、退出码、命令输出、文件变更、确定性测试、独立审查、
打包、验收和发布记录为结构化日志。Codex JSON 流只提取可公开事件与 Assistant 输出，明确忽略
reasoning 内容；日志写入服务端 SQLite 后再通知有权查看该 Bug 的登录用户刷新，短时间内连续事件会
合并为一次刷新，服务器或浏览器短暂断线不会丢失历史记录。Codex 最终消息和独立审查文件只保留在
任务工作树的临时结果目录，不会加入修复提交。

独立审查使用普通的隔离 `codex exec` 会话加载仓库规则和严格 P0/P1 Prompt，并由 Prompt 明确要求检查
当前未提交改动。不要把自定义 Prompt 传给 `codex exec review --uncommitted`；当前 CLI 不允许
`--uncommitted` 与 `[PROMPT]` 同时使用。

## 自动打包契约

`scripts/package-release.ts` 会：

1. 校验任务预留版本与扩展 manifest 一致。
2. 全新构建 Windows x64 baseline、Windows ARM sidecar 和 Linux x64 baseline CLI。
3. 生成 Windows 与 Linux 内网离线 VSIX。
4. 将最终包和 `.sha256` 原子写入公共包目录。
5. 生成仅包含两个平台的 `artifacts.json`。

执行器随后并行运行 Windows ARM 与 Linux 验收，全部通过后逐包调用受保护发布命令。只有两个发布命令都输出规定的 ECS 鉴权下载验收成功标志，任务才会进入 `released`。

## 状态恢复

- Worker 每10秒续租，租约有效期120秒。
- 排队和打包阶段的租约过期后可由同一或另一执行器重新领取；处理中阶段的崩溃恢复仍需完成专项验收。
- 关键改动在测试和审查通过后停在 `approval_wait`。
- 发布失败不会被标记为成功；已经通过上游发布验收的平台会保留在任务产物记录中，供恢复时核对。
- 已发布的故障版本只能撤回公开索引并发布更高 patch 热修复，不依赖自动降级。
