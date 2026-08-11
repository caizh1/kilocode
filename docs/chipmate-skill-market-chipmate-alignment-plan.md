# ChipMate Skill Market 与 ChipMate 完全对齐开发计划

Status: `G12_PARTIAL_WITH_BASELINE_BLOCKERS`

Current Gate: `G12_PARTIAL`

Completion allowed: `no`

Last updated: `2026-07-17`

## 1. 执行与跟踪规则

- [x] 本文件是 ChipMate Skill Market Web、Render Service 市场后端和 ChipMate Marketplace 对齐工作的唯一主计划账本。
- [x] 实施目标仓库固定为 `/Users/archer/Work/chipmate`。
- [x] Render Service 目标目录固定为 `server/chipmate-word-render`。
- [x] ChipMate 插件目标包固定为 `packages/chipmate-vscode`。
- [x] 每个 Gate 必须保持小步、可审查、可测试；不得一次跨越多个未验收 Gate。
- [x] 每个任务完成后，只有在对应代码、命令和证据均已记录时，才允许把 `[ ]` 改为 `[x]`。
- [x] 每个 Gate 必须完成 Review 和 Exit Criteria 后才能进入下一 Gate。
- [x] 外部、Docker、Linux、真实 VSIX 或真实 VS Code profile 尚未验证时，状态必须保持 `PARTIAL` 或 `BLOCKED`。
- [x] 不得把聊天结论、源码存在、构建成功或 mock 通过单独当作运行时验收证据。
- [x] 大型日志、截图和生成物只在本文件记录路径、摘要、时间和校验值，不粘贴完整内容。
- [x] 每个 Gate 完成后必须报告 Changed Files、Design Summary、Commands Run、Test Results、Known Limitations 和 Next Gate。
- [x] 计划变更必须追加到 Decision Log，不得静默改写已确认边界。
- [x] 当前工作区存在大量既有修改，实施前必须记录 Git 基线，并避免覆盖或混入无关改动。

## 2. 总体目标

- [x] 将 Render Service 从单体后端脚本升级为单容器、单端口、带 Web 的完整前后端项目。
- [x] Web 产品名称固定为 ChipMate Skill Market。
- [x] Web 与 ChipMate Marketplace 共享同一套身份、目录、版本、收藏、安装、发布、校验和分析数据。
- [x] 完全对齐指能力、数据、状态和结果对齐，不要求浏览器和 VS Code 视觉完全相同。
- [x] Web 使用 React + Vite 和 iOS Liquid Glass 空间感技能画廊。
- [x] ChipMate 继续使用 SolidJS、chipmate-ui、Codicons 和 VS Code 主题。
- [x] Word、Mermaid、VSIX 分发和现有 Marketplace legacy API 保持兼容。
- [x] 新服务端必须兼容旧插件；新插件必须能降级连接旧服务端。
- [x] 旧插件继续只读取和安装 latest 版本。
- [x] 市场功能、分析和归档任务不得阻塞 Word/Mermaid 渲染事件循环。
- [x] 不集成第三方 SkillHub 运行时，只保留 catalog importer 接口。

## 3. 成功标准

- [x] 旧版 ChipMate 插件连接新服务端时，浏览、下载和安装 latest Skill 无回归。
- [x] 新版 ChipMate 插件连接旧服务端时自动进入 legacy 模式，不显示失效按钮。
- [x] 同一用户在 Web 收藏 Skill 后，ChipMate 能通过事件或缓存失效机制显示相同状态。
- [x] ChipMate 安装、更新或卸载 Skill 后，Web 显示一致的安装状态和 revision。
- [x] Web 与 ChipMate 对相同 Skill 上传输入返回相同 ValidationReport。
- [x] 确定性修复只修改上传快照，不静默修改作者本地文件。
- [x] 验证完全通过后自动发布，不要求作者再次确认发布。
- [x] AI 修复必须由作者主动触发并确认补丁，未经确认不得进入发布版本。
- [x] 每次发布生成不可变 revision、内容 SHA-256 和可选 SemVer。
- [x] 10,000 个 Skill、200 并发用户目标下，市场搜索和目录接口满足性能门槛。
- [x] 市场高并发期间真实 Word/Mermaid 渲染零错误，p95 相对空载基线退化不超过 20%。
- [x] Web 在 Chrome 达到既定性能、无障碍和视觉验收标准；Microsoft Edge 品牌运行按用户指令于 2026-07-12 暂时跳过并保留为已知限制。
- [x] 单个离线交付包可在 linux/amd64 Docker 主机部署 Web、市场 API 和既有渲染能力。

## 4. 已确认的产品决策

- [x] 首要用户是内网团队用户。
- [x] Web v1 覆盖发现与创作闭环。
- [x] Web 与 ChipMate Marketplace 并存，共享能力和数据。
- [x] Web 登录复用现有 New API key 到用户名的身份解析逻辑。
- [x] 继续使用受信内网 HTTP；接受 New API key 首次登录明文传输风险。
- [x] Web 登录后只保留服务端随机会话，不在浏览器持久保存原始 key。
- [x] Web 会话闲置 2 小时失效，绝对最长 8 小时。
- [x] Web 使用 React + Vite SPA。
- [x] 后端使用 TypeScript + Fastify。
- [x] 运行架构为模块化单体、单容器、单端口。
- [x] 市场使用 SQLite WAL 和持久化文件卷。
- [x] Skill 使用服务端递增 revision，并允许作者提供可选 SemVer。
- [x] 验证通过后自动发布。
- [x] 确定性问题自动修复上传快照。
- [x] 语义问题由 AI 生成补丁，作者确认后重新校验。
- [x] AI 修复只有在用户点击后才把必要内容发送给当前 ChipMate Provider。
- [x] 自动发布门禁包含格式校验和安全静态扫描。
- [x] Web 详情包含净化后的 SKILL.md 和安全文件浏览。
- [x] Web 支持一键唤起 ChipMate 安装，并提供归档下载兜底。
- [x] Web 提供只读服务状态页。
- [x] Web 使用空间感技能画廊 Liquid Glass 方向。
- [x] Web 支持亮/暗主题跟随系统和手动切换。
- [x] Skill 使用系统分类主题，并允许作者提供可选 icon、cover 和截图。
- [x] Web 仅支持简体中文桌面版 Chrome/Edge。
- [x] 市场规模目标为 10,000 Skill、200 并发用户。
- [x] 市场搜索使用全文、模糊、分类、作者、更新时间和排序，不做向量搜索。
- [x] v1 不提供评论或五星评分，只保留收藏和统计。
- [x] 行为分析覆盖曝光、搜索、筛选、详情、安装和发布漏斗。
- [x] 用户标识假名化；原始事件保留 90 天，日聚合保留 1 年。
- [x] 登录用户可看全局聚合；作者只能看自己 Skill 的漏斗。
- [x] v1 不运行第三方 SkillHub，只保留未来导入接口。

## 5. 能力对齐矩阵

| 能力 | Web Market | ChipMate Marketplace | 对齐要求 |
|---|---|---|---|
| 首页推荐 | Liquid Glass 热门、最新、分类 | VS Code 原生紧凑首页 | 数据源与排序一致 |
| 搜索筛选 | 全文、模糊、分类、作者、时间 | 相同查询和筛选 | 请求参数与结果顺序一致 |
| Skill 详情 | Markdown、文件、素材、版本、指标 | 相同数据的原生详情 | 字段和状态一致 |
| 收藏 | 支持 | 支持 | 用户状态实时同步 |
| 安装状态 | 显示已安装环境、范围和 revision | 本地权威并上报 | 服务端状态可重建 |
| 安装/更新/卸载 | 深链唤起 ChipMate、下载兜底 | 实际执行 | revision 和 SHA-256 一致 |
| 版本历史 | 全部 revision、可选 SemVer | 相同历史 | latest 指针一致 |
| 发布 | 浏览器上传 | 本地或已安装 Skill 发布 | 使用同一 PublicationRun |
| 确定性修复 | 服务端修复上传快照 | 相同服务端结果 | 不复制验证规则 |
| AI 修复 | 唤起 ChipMate 完成 | 当前 Provider 生成补丁 | 服务端重新权威校验 |
| 我的技能 | 发布记录与版本 | 相同数据 | 所有权判断一致 |
| 分析 | 全局聚合和作者漏斗 | 相同指标紧凑视图 | 统一事件名和口径 |
| 服务状态 | 独立只读页 | 诊断卡和 Web 入口 | 同一 capability 数据 |
| MCP/Agent | 不在本项目范围 | 保留现有功能 | 不回归 |

## 6. 目标工程架构

### 6.1 Render Service 内部结构

计划目标结构：

~~~text
server/chipmate-word-render/
├── apps/
│   ├── api/
│   └── web/
├── packages/
│   ├── contracts/
│   ├── skill-spec/
│   └── market-db/
├── scripts/
├── Dockerfile
├── package.json
└── README.md
~~~

- [x] apps/api 使用 TypeScript + Fastify。
- [x] apps/web 使用 React + Vite。
- [x] packages/contracts 定义 API schema、状态枚举和错误码。
- [x] packages/skill-spec 定义 Skill 格式、安全和确定性修复规则。
- [x] packages/market-db 定义 SQLite schema、迁移、repository 和 Worker。
- [x] Render Service 自身使用 npm workspace，保持可独立构建。
- [x] 现有 server.js 在早期 Gate 作为兼容参考和渲染实现来源，不直接进行大规模语义重写。

### 6.2 单一契约

- [x] contracts 是新版 API、状态和错误码的唯一来源。
- [x] Fastify route schema 从 contracts 导入。
- [x] 构建时生成 OpenAPI。
- [x] 从同一 OpenAPI 生成 Web TypeScript 客户端。
- [x] 从同一 OpenAPI 生成 ChipMate Marketplace TypeScript 客户端。
- [x] 生成文件禁止手改。
- [x] 增加 generate:check，CI 检查客户端和 OpenAPI 是否过期。
- [x] React 与 SolidJS 不共享 UI 组件，只共享 API、数据语义和状态。

### 6.3 后端模块

- [x] render：Word 和 Mermaid。
- [x] packages：VSIX manifest 和文件下载。
- [x] identity：New API key 身份解析。
- [x] catalog：目录、搜索、分类和推荐。
- [x] publication：上传、验证、修复和版本发布。
- [x] installation：ChipMate 安装状态同步。
- [x] analytics：事件、漏斗和日聚合。
- [x] assets：Skill icon、cover、截图和安全处理。
- [x] legacy：现有 /marketplace API 兼容适配。
- [x] web：静态资源、CSP、缓存和 SPA fallback。
- [x] SQLite、归档生成和统计批处理运行在 Worker 中。
- [x] 市场数据库损坏或不可用时，render 和 packages 模块仍可启动并提供诊断。

## 7. 数据模型

- [x] users：稳定假名 ID、显示名、首次和最后访问时间。
- [x] sessions：Web 会话哈希、闲置时间和绝对过期时间。
- [x] skills：ID、名称、描述、分类、标签、作者、状态、latest revision。
- [x] releases：revision、可选 SemVer、SHA-256、更新说明、验证报告和归档路径。
- [x] assets：类型、MIME、尺寸、哈希和文件位置。
- [x] favorites：用户和 Skill 收藏关系。
- [x] installations：用户、客户端实例哈希、范围、工作区哈希、revision 和安装状态。
- [x] publication_runs：上传快照、校验阶段、修复阶段和最终结果。
- [x] validation_issues：结构化错误和修复信息。
- [x] events：Web/ChipMate 原始行为事件。
- [x] daily_metrics：按日聚合。
- [x] audit_events：发布、下架、版本切换和会话吊销。
- [x] imports：未来外部 catalog 导入记录。
- [x] SQLite 启用 WAL、foreign_keys 和 busy_timeout。
- [x] 所有 schema 变更使用有序迁移，不允许运行时隐式漂移。

## 8. 公共类型和状态

- [x] MarketCapabilities
- [x] MarketUser
- [x] SkillSummary
- [x] SkillDetail
- [x] SkillRelease
- [x] SkillFile
- [x] SkillArtwork
- [x] FavoriteState
- [x] InstallationState
- [x] PublicationRun
- [x] ValidationReport
- [x] ValidationIssue
- [x] RepairPatch
- [x] AnalyticsEvent
- [x] AnalyticsSeries

ValidationIssue 固定字段：

~~~ts
{
  code
  severity
  file?
  line?
  field?
  message
  expected?
  actual?
  fixable
  repairKind
}
~~~

统一发布状态：

- [x] VALIDATING
- [x] NEEDS_AUTHOR_FIX
- [x] NEEDS_AI_CONFIRMATION
- [x] SECURITY_REJECTED
- [x] PUBLISHING
- [x] PUBLISHED
- [x] UNPUBLISHED
- [x] UNCHANGED
- [x] FAILED

统一中文显示：

- [x] 草稿校验中
- [x] 需要作者修复
- [x] 等待 AI 补丁确认
- [x] 安全扫描失败
- [x] 正在发布
- [x] 已发布
- [x] 已下架
- [x] 版本无变化
- [x] 服务器能力不支持

## 9. 新版 API

### 9.1 能力与事件

- [x] GET /api/v1/capabilities
- [x] GET /api/v1/market/stream
- [x] 使用 SSE 发布 catalog、favorite、installation、publication 和 analytics 失效事件。
- [x] 使用 ETag 和 catalogVersion 支持断线补偿。

### 9.2 身份

- [x] POST /api/v1/auth/session
- [x] DELETE /api/v1/auth/session
- [x] GET /api/v1/auth/me
- [x] Web session 与 ChipMate Bearer key 必须映射到相同 MarketUser.id。
- [x] Web 登录成功后立即丢弃原始 New API key。
- [x] Cookie 使用 HttpOnly、SameSite=Strict 和明确 Path。
- [x] 纯 HTTP 下状态页必须显示不安全传输告警。
- [x] 修改接口校验 Origin/Host 并要求 CSRF token。

### 9.3 目录与详情

- [x] GET /api/v1/skills
- [x] GET /api/v1/skills/:id
- [x] GET /api/v1/skills/:id/releases
- [x] GET /api/v1/skills/:id/releases/:revision
- [x] GET /api/v1/skills/:id/files
- [x] GET /api/v1/skills/:id/files/:path
- [x] GET /api/v1/categories
- [x] GET /api/v1/authors/:id
- [x] 目录支持分页、FTS、模糊匹配、分类、作者、时间和排序。
- [x] 文件预览仅允许支持的文本和图片；二进制只返回元数据。

### 9.4 收藏与安装

- [x] PUT /api/v1/favorites/:id
- [x] DELETE /api/v1/favorites/:id
- [x] GET /api/v1/me/favorites
- [x] GET /api/v1/me/installations
- [x] PUT /api/v1/installations/:id
- [x] DELETE /api/v1/installations/:id
- [x] POST /api/v1/skills/:id/install-intents
- [x] POST /api/v1/install-intents/:token/consume
- [x] 安装 intent 一次性使用并在五分钟后过期。

### 9.5 发布

- [x] POST /api/v1/publications
- [x] GET /api/v1/publications/:runId
- [x] POST /api/v1/publications/:runId/patches
- [x] POST /api/v1/publications/:runId/apply
- [x] POST /api/v1/skills/:id/unpublish
- [x] 使用 idempotency key 防止重试生成重复版本。
- [x] 相同内容哈希重复提交返回现有 revision。

### 9.6 分析与状态

- [x] POST /api/v1/events/batch
- [x] GET /api/v1/analytics/overview
- [x] GET /api/v1/analytics/skills/:id
- [x] GET /api/v1/status

## 10. Legacy 兼容契约

- [x] 保留 GET /health。
- [x] 保留 POST /render/word。
- [x] 保留 POST /render/mermaid。
- [x] 保留 GET /packages/manifest.json。
- [x] 保留 GET /packages/<file>。
- [x] 保留 GET /marketplace/skills。
- [x] 保留 POST /marketplace/skills。
- [x] 保留 GET /marketplace/skills/<archive>。
- [x] 保留 GET /marketplace/skills/<id>/files。
- [x] 保留 POST /marketplace/skills/<id>/stars。
- [x] 保留 GET /marketplace/manifest.json。
- [x] 保留 POST /auth/new-api/resolve-user。
- [x] legacy /marketplace/skills 始终只返回 latest。
- [x] 新字段只允许可选追加，不删除或重命名旧字段。
- [x] 新插件请求 capabilities 返回 404 时必须进入 legacy 模式。
- [x] legacy 模式隐藏版本、分析、对齐收藏、发布修复和安装同步能力。
- [x] chipmate.marketplace.baseUrl 和 chipmate.marketplace.skillsOnly 不改名。
- [x] publisher、name、SecretStorage key 和扩展 ID chipmate.chipmate 不改变。
- [x] Render Service 更新 manifest 默认 extension ID 对齐为 chipmate.chipmate，并允许环境变量覆盖。

## 11. Skill 发布与修复

### 11.1 状态机

~~~text
创建发布任务
→ 本地轻量检查
→ 服务端格式校验
→ 确定性修复上传快照
→ 安全静态扫描
→ 语义检查
→ 通过则自动发布
→ 不通过则返回详细报告
~~~

- [x] 验证完全通过后自动发布。
- [x] 每次发布生成递增 revision、内容 SHA-256 和不可变归档。
- [x] 可选 SemVer 合法时保存，不合法时返回详细错误。
- [x] 未提供 SemVer 不阻塞发布。
- [x] 版本所有权由统一 MarketUser.id 判断。

### 11.2 确定性修复

- [x] 修正 SKILL.md 文件名。
- [x] 修复或补齐 YAML frontmatter。
- [x] 规范化 ID、name、description、category 和 tags。
- [x] 生成缺失的 skill.json。
- [x] 统一换行和文本编码。
- [x] 排除 .git、node_modules、缓存和系统文件。
- [x] 不修改 Skill 正文语义。
- [x] 不静默修改作者本地文件。
- [x] 发布后提供将修复应用到本地操作，必须先显示 diff。

### 11.3 安全门禁

- [x] 路径穿越、绝对路径和软链。
- [x] 单文件、文件数、上传总大小和解压后大小。
- [x] 压缩炸弹和嵌套归档。
- [x] API key、密码、私钥和常见凭据。
- [x] 未允许的可执行二进制。
- [x] Markdown HTML、script、危险 URL 和 XSS。
- [x] 图片类型、尺寸和解码验证。
- [x] scripts/ 允许存在但必须标记；服务端不得执行上传脚本。

### 11.4 AI 修复

- [x] Render Service 不配置或调用模型。
- [x] ChipMate 使用当前 Provider 生成 AI 补丁。
- [x] 用户点击使用 AI 修复后才允许发送必要内容。
- [x] Web 语义校验失败时提供在 ChipMate 中使用 AI 修复深链。
- [x] 深链只携带短期 publicationRunId，不携带 Skill 内容或 API key。
- [x] ChipMate 验证任务所有权后获取必要片段。
- [x] AI 补丁逐文件显示并要求作者确认。
- [x] 服务端接收补丁后重新执行全部权威校验。
- [x] 验证通过后自动发布。
- [x] ChipMate 不可用时，Web 仍提供完整手工修复说明。

## 12. 安装、更新与同步

### 12.1 Web 到 ChipMate

- [x] Web 请求一次性安装 intent。
- [x] 使用 vscode://chipmate.chipmate/marketplace/install 深链。
- [x] ChipMate 只接受与当前 marketplace base URL 同源的 intent。
- [x] ChipMate 消费 intent 后取得 Skill ID、revision、SHA-256 和下载地址。
- [x] 用户确认项目或全局安装范围。
- [x] ChipMate 未安装时，Web 提供归档下载和手动步骤。

### 12.2 ChipMate 安装器

- [x] 下载到 staging。
- [x] 校验响应大小、SHA-256、路径安全和根 SKILL.md。
- [x] 已安装时比较 revision 和哈希。
- [x] 更新前要求用户确认。
- [x] 使用原子目录替换。
- [x] 更新失败时保留旧版本。
- [x] 安装完成后同步假名化安装状态。
- [x] 卸载后同步 removed 状态。
- [x] 安装元数据保存在扩展 globalStorage，不写入用户项目文件。
- [x] 缺少市场元数据的旧技能标记为本地/未托管。
- [x] 本地/未托管 Skill 可通过重新安装纳管。

### 12.3 实时同步

- [x] skill.published
- [x] skill.unpublished
- [x] favorite.changed
- [x] installation.changed
- [x] publication.changed
- [x] analytics.updated
- [x] catalog.invalidated
- [x] Web 与 ChipMate 只失效相关缓存，不全量刷新。
- [x] SSE 断线后使用 ETag 和 catalogVersion 恢复。

## 13. Web UI

### 13.1 页面

- [x] /：热门、最新、分类、搜索和发布入口。
- [x] /skills：目录、筛选、排序和分页。
- [x] /skills/:id：详情、版本、文件、收藏、安装和相关 Skill。
- [x] /publish：上传、校验、修复和发布进度。
- [x] /me：收藏、安装状态、我的 Skill 和版本。
- [x] /analytics：全局聚合和作者数据。
- [x] /status：只读服务状态。
- [x] /login：New API key 登录。

### 13.2 Liquid Glass 规范

- [x] 采用空间感技能画廊方向。
- [x] 正式编码前生成三套真实视觉方向并选择一套。
- [x] 同时设计亮色和深色主题。
- [x] 默认跟随系统，允许手动切换并记住选择。
- [x] 使用 ChipMate 真实品牌资产。
- [x] 使用高质量、圆润、层次稳定的图标库。
- [x] 不使用 emoji、临时 SVG、CSS 图标或廉价渐变作为正式资产。
- [x] 作者素材缺失时使用系统分类主题。
- [x] 作者可选提供 icon、cover 和截图。
- [x] 图标和图标按钮使用 flex/grid 正常流，不以 absolute 定位对齐。
- [x] 控制大面积 backdrop-filter 数量，避免滚动掉帧。
- [x] 支持键盘、焦点、prefers-reduced-motion 和 WCAG 2.2 AA。
- [x] 仅支持简体中文桌面 Chrome/Edge。
- [x] 目标宽度 1280–1920px。
- [x] 低于 1024px 显示桌面访问提示。

### 13.3 性能预算

- [x] 首路由 JavaScript 不超过 300 KiB gzip。
- [x] 使用路由分包和资源哈希。
- [x] LCP 不超过 2.5 秒。
- [x] INP 不超过 200ms。
- [x] CLS 不超过 0.1。
- [x] 主要动效接近 60fps。
- [x] 图片提供尺寸约束和适配格式。
- [x] 10,000 条目录数据不得一次性渲染到 DOM。

## 14. ChipMate Marketplace UI

- [x] 保留现有 SolidJS 和 MarketplacePanelProvider。
- [x] 使用 chipmate-ui 组件，不在 ChipMate Webview 引入 React。
- [x] 使用 VS Code theme token 和 currentColor。
- [x] 工具栏使用单色 Codicons。
- [x] 不把 Web Liquid Glass 背景照搬到 VS Code。
- [x] 新增市场首页。
- [x] 新增 Skill 详情。
- [x] 新增版本历史。
- [x] 新增我的收藏。
- [x] 新增我的安装。
- [x] 新增我的发布。
- [x] 新增发布校验和修复视图。
- [x] 新增分析视图。
- [x] 新增服务诊断卡片和打开 Web 状态页入口。
- [x] internal skillsOnly 模式直接进入对齐后的 Skill Market。
- [x] 公共完整市场模式继续保留 Agent/MCP 标签页。
- [x] 两端按钮名称、状态、错误原因和排序口径一致。
- [x] 新文案至少提供简中和英文 fallback，以满足扩展构建约束。

## 15. 行为分析

统一事件：

- [x] market_impression
- [x] market_search
- [x] market_filter
- [x] skill_open
- [x] skill_file_preview
- [x] skill_favorite
- [x] skill_install_intent
- [x] skill_install
- [x] skill_update
- [x] skill_remove
- [x] publication_start
- [x] publication_validation_failed
- [x] publication_ai_repair
- [x] publication_success

事件字段：

- [x] surface：web 或 vscode。
- [x] 假名化用户 ID。
- [x] 客户端实例哈希。
- [x] Skill ID 和 revision。
- [x] 时间。
- [x] 搜索和筛选上下文。
- [x] 不记录 API key、Skill 正文、完整 IP 或真实工作区路径。

保留和可见性：

- [x] Web 与 ChipMate 均批量异步上报。
- [x] 原始事件保留 90 天。
- [x] 日聚合保留 1 年。
- [x] 登录用户可查看市场全局聚合。
- [x] 作者只能查看自己的 Skill 漏斗。
- [x] 不提供具体用户轨迹查询。
- [x] 统计写入不得阻塞渲染或发布事务。

## 16. Gate 跟踪

### G0：计划落盘、基线冻结与视觉准备

Status: `COMPLETE`

Scope:

- [x] 创建本主计划账本。
- [x] 记录总体目标、边界和已确认决策。
- [x] 记录 G0–G9 Gate。
- [x] 完成计划结构和 Markdown 表格格式自检。
- [x] 记录实施前 Git branch、HEAD、tracked/unstaged/untracked 基线。
- [x] 确认 Render Service 目标源码清单。
- [x] 确认 ChipMate Marketplace 当前 API、安装、上传和 URI Handler 契约。
- [x] 为 legacy API 建立冻结清单。
- [x] 准备真实 DOCX、Mermaid、VSIX 和 Skill 归档夹具清单。
- [x] 生成三套 Web 空间画廊视觉方向。
- [x] 用户选择一套视觉方向。
- [x] 记录视觉 token、关键页面和目标 viewport。

Exit Criteria:

- [x] Git 基线记录完整。
- [x] legacy 契约清单完成。
- [x] 真实夹具清单完成。
- [x] 视觉方向已选定。
- [x] G0 Review 通过。

Changed Files:

- `docs/chipmate-skill-market-chipmate-alignment-plan.md`
- `docs/chipmate-skill-market-alignment-evidence/g0/baseline-contracts-and-fixtures.md`
- `docs/chipmate-skill-market-alignment-evidence/g0/git-status-20260712.txt`
- `docs/chipmate-skill-market-alignment-evidence/g0/source-backed-detail-design.tar.gz`
- `docs/chipmate-skill-market-alignment-evidence/g0/visual-direction.md`
- `docs/chipmate-skill-market-alignment-evidence/g0/visual-direction-selected.png`

Design Summary:

- 用户在三套真实视觉稿中选择方向 1；Web 以空间画廊 Liquid Glass 为视觉目标，ChipMate webview 继续遵循 VS Code 原生主题边界。
- 冻结现有 13 个 legacy API 入口、ChipMate Marketplace 当前读取/上传/安装契约和扩展身份/配置名。
- 将 Git 状态、真实 DOCX、Mermaid、VSIX 和 Skill 归档固定为后续 Gate 的可复现证据源。

Commands Run:

- `find docs .chipmate ...`：确认仓库已有 docs 计划账本惯例。
- `git status --short -- docs/chipmate-skill-market-chipmate-alignment-plan.md`：创建前文件不存在。
- `bun run script/check-md-table-padding.ts docs/chipmate-skill-market-chipmate-alignment-plan.md`：PASS，未发现 padded tables。
- `node -e '<plan structure check>'`：PASS，状态字段、G0、G9、legacy 契约、测试计划和 Decision Log 均存在。
- `git diff --no-index --check /dev/null docs/chipmate-skill-market-chipmate-alignment-plan.md`：PASS，无空白错误。
- `git branch --show-current && git rev-parse HEAD && git status --porcelain=v1 -uall`：PASS，冻结 branch、HEAD、88 个 tracked 改动和 25 个 untracked 项。
- `node --check server.js && node --check build-offline-bundle.mjs`：PASS。
- `shasum -a 256 server/chipmate-word-render/*`：PASS，记录目标源码哈希。
- `gzip -t`、`tar -tzf` 和 Apple xattr 字符串检查：PASS，真实 Skill 夹具可读取且不含 Apple xattr 元数据。
- `cmp -s <selected-imagegen> visual-direction-selected.png`：PASS，保存的权威视觉稿与用户选择的第一张生成图一致。
- `bun run script/check-md-table-padding.ts <G0 markdown>`：PASS，无 padded tables。

Test Results:

- G0 为计划、契约和夹具 Gate；静态语法、Markdown、哈希、归档结构和选图一致性全部通过。
- 未启动 Fastify、React、SQLite 或渲染迁移；符合 G0 不提前进入实现的边界。

Runtime Evidence:

- Environment：macOS，branch `codex/v7.3.42-dev`，HEAD `d567827207018deef65cf0af450cd9ecd7325835`。
- Artifact：`docs/chipmate-skill-market-alignment-evidence/g0/`。
- Result：G0 本地证据 PASS；Docker/Linux/真实 VS Code 运行证据 NOT_RUN。

Evidence:

- 本计划文件。
- `docs/chipmate-skill-market-alignment-evidence/g0/baseline-contracts-and-fixtures.md`
- `docs/chipmate-skill-market-alignment-evidence/g0/visual-direction.md`
- `docs/chipmate-skill-market-alignment-evidence/g0/visual-direction-selected.png`

Known Limitations:

- 当前工作区存在大量既有修改。
- 当前 Docker client 可见但 daemon 不可用，Docker 运行证据尚不可获得。

Next Recommended Gate:

- G1：共享契约与项目骨架。

### G1：共享契约与项目骨架

Status: `COMPLETE`

- [x] 建立 apps/api、apps/web、packages/contracts、packages/skill-spec 和 packages/market-db。
- [x] 建立 Render Service npm workspace。
- [x] 定义统一类型、状态和错误码。
- [x] 定义 OpenAPI 生成流程。
- [x] 生成 Web 和 ChipMate 客户端。
- [x] 增加 generate:check。
- [x] TypeScript、lint 和最小测试通过。
- [x] Review：确认没有开始重写 Word/Mermaid 行为。

Exit Criteria:

- [x] Web 和 ChipMate 从同一 OpenAPI 编译通过。
- [x] 生成物无手工差异。
- [x] G1 Review 通过。

Changed Files:

- `server/chipmate-word-render/apps/**`
- `server/chipmate-word-render/packages/**`
- `server/chipmate-word-render/scripts/generate-contracts.ts`
- `server/chipmate-word-render/package.json`
- `server/chipmate-word-render/package-lock.json`
- `server/chipmate-word-render/tsconfig.base.json`
- `server/chipmate-word-render/eslint.config.mjs`
- `packages/chipmate-vscode/src/services/marketplace/generated/**`
- `packages/chipmate-vscode/tests/unit/marketplace-generated-contract.test.ts`
- `docs/chipmate-skill-market-alignment-evidence/g1/review.md`

Design Summary:

- TypeBox schema 单一来源生成 OpenAPI 3.1、Web client 和 ChipMate client；生成文件拆分为 API types 与 fetch client。
- Fastify、React/Vite 和 market-db 仅建立骨架；没有接管 legacy route、渲染行为或 SQLite schema。

Commands Run:

- `npm run check && npm run build`：PASS，5 个 workspace 类型检查、lint、7 个测试和 Vite production build 通过。
- `bun run typecheck`：PASS，ChipMate extension 和 webview 编译通过。
- `bun test tests/unit/marketplace-generated-contract.test.ts`：PASS，1 pass。
- `cmp -s <web generated> <chipmate generated>`：PASS，两端生成物字节一致。
- `node --check server.js && require("./server.js")`：PASS，legacy CommonJS 仍可加载。
- `shasum -a 256 server.js`：PASS，哈希与 G0 相同。

Test Results:

- OpenAPI 3.1：27 paths、30 operations、17 schemas。
- Workspace：7 pass；ChipMate generated client：1 pass；TypeScript/ESLint/Vite/generate:check：PASS。

Runtime Evidence:

- Environment：macOS，Node 26.0.0，npm 11.12.1，Bun 1.3.14。
- Artifact：`docs/chipmate-skill-market-alignment-evidence/g1/review.md`。
- Result：本地生成、编译和测试 PASS；Docker/Linux/真实 VS Code profile NOT_RUN。

Known Limitations:

- Fastify 尚未接管路由，Docker 仍为 Node 20，SQLite schema version 为 0，Web 没有可见 UI。

Next Recommended Gate:

- G2：先建立 G0 legacy 黑盒契约测试，再迁移 Fastify 路由和 Node 24；不同时进入 SQLite 或 Web 页面实现。

### G2：Fastify 与渲染兼容层

Status: `COMPLETE`

- [x] 将 HTTP 路由迁入 Fastify。
- [x] 升级 Node 24 LTS。
- [x] 封装现有 Word/Mermaid 核心。
- [x] 保留 packages 和 legacy Marketplace 路由。
- [x] 添加请求、响应和错误 schema。
- [x] 添加渲染模块独立启动/降级边界。
- [x] 运行真实 Mermaid 渲染。
- [x] 运行真实 DOCX 渲染。
- [x] Review：确认渲染协议、状态码和关键字段无变化。

Exit Criteria:

- [x] legacy API 黑盒契约通过。
- [x] 真实渲染通过。
- [x] G2 Review 通过。

Changed Files:

- `server/chipmate-word-render/apps/api/src/**`
- `server/chipmate-word-render/apps/api/test/**`
- `server/chipmate-word-render/packages/contracts/src/legacy.ts`
- `server/chipmate-word-render/packages/contracts/test/schema.test.ts`
- `server/chipmate-word-render/Dockerfile`
- `server/chipmate-word-render/.dockerignore`
- `server/chipmate-word-render/package.json`
- `server/chipmate-word-render/package-lock.json`
- `server/chipmate-word-render/server.js`
- `server/chipmate-word-render/README.md`
- `docs/chipmate-skill-market-alignment-evidence/g2/review.md`

Design Summary:

- Fastify 显式注册 13 个 legacy route；在 body parsing 前 hijack raw request/response，复用同一个冻结 request core，不复制渲染或 Marketplace 逻辑。
- Docker 升级 Node 24，入口切换为 Fastify；market storage 故障不阻塞 health 和 render endpoints。

Commands Run:

- `npm run check && npm run build`：PASS，11 个测试、TypeScript、ESLint、generate:check 和 Vite build 通过。
- `npx -y -p node@24 node --import tsx --test ...`：PASS，Node 24.18.0 下 4 pass。
- `docker info`：BLOCKED，当前 Colima socket 不存在。

Test Results:

- 旧/新 HTTP 契约、真实 VSIX manifest/下载、真实 Skill catalog/归档、降级、真实 Mermaid 和真实 DOCX 全部 PASS。

Runtime Evidence:

- Environment：macOS、Node 24.18.0、真实 Chrome/LibreOffice/Poppler。
- Artifact：`docs/chipmate-skill-market-alignment-evidence/g2/review.md`。
- Result：本机真实运行 PASS；Docker/Linux container NOT_RUN。

Known Limitations:

- Fastify adapter 仍调用单体 `server.js` compatibility core；Docker daemon 不可用，尚无容器证据。

Next Recommended Gate:

- G3：SQLite WAL schema、迁移、导入、repository、Worker、latest snapshot 和 legacy latest 目录。

### G3：SQLite 市场核心

Status: `COMPLETE`

- [x] 实现数据库 schema 和迁移。
- [x] 实现 JSON/归档首次导入。
- [x] 实现 version snapshot 和 latest 指针。
- [x] 实现 FTS 和筛选。
- [x] 实现收藏和安装状态。
- [x] 实现 publication run。
- [x] 实现事件和日聚合表。
- [x] Worker 化 SQLite、统计和归档。
- [x] 异步生成 legacy latest 目录。
- [x] Review：确认旧插件仍能读取、下载和安装 latest。

Exit Criteria:

- [x] 旧数据无损导入。
- [x] 旧文件不被删除。
- [x] 旧插件兼容测试通过。
- [x] G3 Review 通过。

Changed Files:

- `server/chipmate-word-render/packages/market-db/src/**`
- `server/chipmate-word-render/packages/market-db/test/index.test.ts`
- `server/chipmate-word-render/apps/api/src/market.ts`
- `server/chipmate-word-render/apps/api/src/start.ts`
- `server/chipmate-word-render/apps/api/test/sqlite-legacy.test.ts`
- `server/chipmate-word-render/apps/api/package.json`
- `server/chipmate-word-render/package-lock.json`
- `server/chipmate-word-render/Dockerfile`
- `docs/chipmate-skill-market-alignment-evidence/g3/review.md`

Design Summary:

- Node 24 内置 SQLite、FTS5、文件导入/导出和聚合全部运行在 Worker；三步迁移建立完整 schema、不可变 release 和 legacy 无损字段。
- 启动时导入原目录并原子生成独立 `legacy-latest`，原始文件不删除；数据库失败时 Fastify/render/packages 降级启动。

Commands Run:

- `npm run check && npm run build`：PASS，14 个 workspace 测试、TypeScript、ESLint、generate:check、Vite build 通过。
- `npx -y -p node@24 node --import tsx --test ...`：PASS，Node 24.18.0 下 8 pass。
- `bun test tests/unit/marketplace-installer.test.ts`：PASS，实际 ChipMate installer 9 pass。

Test Results:

- migration/WAL/FTS/revision/import/export/state/publication/events/immutable release：PASS。
- 实际 ChipMate `MarketplaceInstaller` 从 Worker 生成目录下载并安装 latest：PASS。
- market DB 启动失败不阻塞 health/render：PASS。

Runtime Evidence:

- Environment：macOS、Node 24.18.0、真实 SQLite/Worker/文件系统/tar/Fastify/ChipMate installer。
- Artifact：`docs/chipmate-skill-market-alignment-evidence/g3/review.md`。
- Result：本机 runtime PASS；Docker/Linux container NOT_RUN。

Known Limitations:

- aligned-v1 catalog routes 和 Web UI 尚未接入；性能、保留清理和并发硬化留在 G4/G8。

Next Recommended Gate:

- G4：只读 catalog/status/capabilities/SSE API 与选定空间画廊 Web 发现/详情闭环。

### G4：Web 发现与详情

Status: `COMPLETE — PASS_WITH_USER_WAIVER`

- [x] 实现选定视觉系统。
- [x] 实现首页、目录、详情、版本、文件预览和状态页。
- [x] 实现搜索、筛选、分页、ETag 和 SSE。
- [x] 实现亮/暗主题。
- [x] 实现可选作者素材。
- [x] 实现 Chrome/Edge E2E。
- [x] 实现视觉差异检查。
- [x] 实现无障碍和性能门禁。

Exit Criteria:

- [x] 浏览、搜索和详情闭环。
- [x] 视觉、性能和无障碍通过。
- [x] G4 Review 通过（Microsoft Edge 品牌运行由用户明确豁免；Chrome 5/5 与其余 G4 证据通过）。

Changed Files:

- `server/chipmate-word-render/apps/api/src/aligned.ts`、`apps/api/test/aligned.test.ts`。
- `server/chipmate-word-render/apps/web/src/main.tsx`、`styles.css`、`vite.config.ts` 与真实 WebP/品牌资产。
- `server/chipmate-word-render/packages/market-db/src/{model,repo,protocol,worker,client}.ts`。
- TypeBox schema、生成的 Web/ChipMate clients、G4 screenshots、`design-qa.md` 和 `g4/review.md`。

Design Summary:

- Worker repository 提供目录、版本、分类、作者、tar 文件与安全预览；Fastify 暴露只读 aligned-v1、ETag/304、catalogVersion 和初始 SSE invalidation。
- React/Vite 实现选定空间画廊、首页/目录/分页/详情/版本/文件/状态、系统/深/浅主题和可选作者素材。
- 身份、收藏、安装同步、发布与分析继续禁用并留给后续 Gate。

Commands Run:

- `npm run check && npm run build`
- `npm run test:e2e:web:chrome`：5/5 PASS。
- `npm run test:e2e:web:edge`：测试项目和相同用例已实现，但因 `/Applications/Microsoft Edge.app` 不存在而在 launch 前 NOT_RUN。
- `bun run typecheck && bun test tests/unit/marketplace-generated-contract.test.ts && bun run check-chipmate-change`
- 应用内浏览器 `1440×1024` / `390×844` 交互与视觉 QA。
- Google Chrome 150 `1440×1024` 真实截图 smoke。

Test Results:

- API 8/8、18 项 workspace tests、E2E typecheck、TypeScript、ESLint、OpenAPI drift：PASS。
- Chrome Playwright E2E 5/5：亮/暗 axe、性能、完整只读旅程、主题持久化、390px 响应式、键盘焦点、减少动效和帧率门禁全部 PASS。
- 浏览、搜索、筛选、排序、分页 API、详情、版本、文件预览、主题、状态刷新：PASS。
- clean browser console：0 errors / 0 warnings；a11y baseline：PASS。
- 首路由 JS 76,985 bytes gzip、CSS 5,127 bytes gzip；Detail 3,458 bytes、Status 1,608 bytes 独立动态 hash chunk；LCP 588ms、CLS 0、Event Timing <16ms：PASS。
- 视觉联合对比与 Chrome 150：PASS；Microsoft Edge：USER_WAIVED / NOT_RUN（当前 Mac 未安装，用户于 2026-07-12 指示先跳过）。

Runtime Evidence:

- `docs/chipmate-skill-market-alignment-evidence/g4/review.md`
- `docs/chipmate-skill-market-alignment-evidence/g4/reference-vs-implementation-final.png`
- `docs/chipmate-skill-market-alignment-evidence/g4/chrome-home-1440x1024.png`
- `server/chipmate-word-render/design-qa.md`

Known Limitations:

- Microsoft Edge 品牌运行未执行；用户于 2026-07-12 明确指示先跳过，因此它作为已知限制保留，但不再阻塞 G4/G5。
- SSE 仅实现 `catalog.invalidated`；其余事件、身份和写操作留在 G5–G8。
- Docker/Linux 仍因本机 daemon 不可用而 NOT_RUN。

Next Recommended Gate:

- G5：实现身份、收藏、安装状态与安全深链同步；未来若用户恢复 Edge 验收，再补充品牌运行证据。

### G5：身份、收藏与安装同步

Status: `COMPLETE — PASS_INTEGRATION_SCOPE`

- [x] 实现 Web session。
- [x] 实现 ChipMate Bearer principal。
- [x] 对齐稳定 MarketUser.id。
- [x] 实现收藏双端同步。
- [x] 实现 installation API。
- [x] 实现安装 intent。
- [x] 实现 ChipMate URI Handler。
- [x] 实现哈希、来源和 revision 验证。
- [x] 实现 globalStorage 安装元数据。
- [x] 实现原子安装、更新和卸载。

Exit Criteria:

- [x] Web 收藏后 ChipMate 实时显示。
- [x] ChipMate 安装后 Web 显示一致状态。
- [x] 深链安全测试通过。
- [x] G5 Review 通过（代码/集成范围；真实 VSIX/profile 留在 G9）。

### G6：统一发布、校验与修复

Status: `COMPLETE`

- [x] 实现统一 PublicationRun。
- [x] 实现格式校验。
- [x] 实现确定性自动修复。
- [x] 实现安全扫描。
- [x] 实现版本发布和幂等。
- [x] 实现 Web 上传和发布进度。
- [x] 实现 ChipMate 发布和详细 ValidationReport。
- [x] 实现 ChipMate AI 修复。
- [x] 实现 Web 到 ChipMate 的 AI 修复深链。
- [x] 实现应用修复到本地的显式 diff 确认。

Exit Criteria:

- [x] 相同输入在两端得到相同结果。
- [x] AI 未确认时不能发布。
- [x] 自动修复不改本地文件。
- [x] G6 Review 通过。

### G7：ChipMate Marketplace 全量对齐

Status: `COMPLETE`

- [x] 实现 ChipMate 市场首页。
- [x] 实现 Skill 详情。
- [x] 实现版本历史。
- [x] 实现收藏和安装视图。
- [x] 实现我的发布。
- [x] 实现分析。
- [x] 实现服务诊断。
- [x] 保留 Agent/MCP 标签页。
- [x] 保留 legacy 模式。
- [x] 完成能力对齐矩阵逐项验收。

Exit Criteria:

- [x] 核心能力无 Web-only 孤岛。
- [x] VS Code 原生主题和交互规则通过。
- [x] G7 Review 通过。

### G8：分析、性能与安全硬化

Status: `COMPLETE`

- [x] 实现完整事件字典。
- [x] 实现 Web/ChipMate 批量上报。
- [x] 实现假名化和保留清理。
- [x] 实现全局和作者漏斗。
- [x] 完成 10,000 Skill 数据集测试。
- [x] 完成 200 并发压测。
- [x] 完成渲染隔离压测。
- [x] 完成 XSS、CSRF、归档、秘密和深链安全测试。

Exit Criteria:

- [x] 性能预算全部通过。
- [x] 渲染隔离门禁通过。
- [x] 安全门禁通过。
- [x] G8 Review 通过。

### G9：离线打包、真实安装与签收

Status: `COMPLETE`

- [x] 完成多阶段 Docker 构建。
- [x] 更新安装脚本和数据卷。
- [x] 更新离线 bundle。
- [x] 更新 Render Service README。
- [x] 更新 ChipMate changeset。
- [x] 构建新内部 VSIX。
- [x] 使用覆盖升级安装，不卸载旧插件。
- [x] 在真实 VS Code profile 验证 aligned-v1 和 legacy fallback。
- [x] 在真实 linux/amd64 Docker 主机验证。
- [x] 验证 /health、Word、Mermaid、packages、Web 和 Marketplace。
- [x] 验证归档无 Apple xattr。
- [x] 完成最终 no-regression Review。

Exit Criteria:

- [x] 服务端、Web、旧插件、新插件和真实渲染全部闭环。
- [x] Completion allowed 可更新为 yes。
- [x] G9 Final Review 通过。

### G9 Linux VSIX Addendum

Status: `COMPLETE`

- [x] 核对 Skill Service 0.1.6 与内置 Skill 源码时间线，确认现有离线包已经是最新内容且无需重复重打。
- [x] 扩展版本按 patch 规则从 0.0.41 更新到 0.0.42。
- [x] 从源码新鲜构建 darwin-arm64、windows-x64-baseline 和 linux-x64 CLI。
- [x] 生成 0.0.42 macOS、Windows baseline 和 Linux x64 VSIX。
- [x] 验证 Linux VSIX 包含 chipmate、ripgrep、Tree-sitter、LanceDB 与扩展运行 bundles，并在 x86_64 Linux VM 真实执行 `chipmate --version` 与 `rg --version`。
- [x] 更新 Windows latest.json 与仅含 VSIX/latest.json 的传输归档。
- [x] 验证三平台产物 SHA-256、无 Apple xattr，并完成 addendum Review。

### G9.1：受信内网 HTTP Web 启动热修复

Status: `COMPLETE`

- [x] 在真实内网 HTTP 报错与源码中确认 `crypto.randomUUID()` 导致模块加载阶段崩溃，并记录 0.1.6 基线。
- [x] 实现原生 `randomUUID` 优先、`getRandomValues` fallback 的 RFC 4122 v4 UUID 工具，禁止 `Math.random`。
- [x] 将 Web 分析 client ID 改为惰性生成，并隔离 localStorage、随机数和批量上报失败。
- [x] 将发布幂等键切换到统一 UUID 工具，失败进入现有可见错误状态。
- [x] 增加 UUID、非安全上下文和 Storage SecurityError 单元/E2E 回归。
- [x] 将 Render Service 版本升级到 0.1.7，并更新 README 排障说明。
- [x] 运行服务端全量 check/build、Chrome E2E 和真实 Word/Mermaid 回归；Edge 保持 USER_WAIVED / NOT_RUN。
- [x] 构建新的 linux/amd64 Docker 镜像、镜像归档和 0.1.7 离线 bundle。
- [x] 在 x86_64 Linux Docker 中覆盖安装并验证非 loopback HTTP Web、Marketplace、Word、Mermaid、packages 与 legacy API。
- [x] 验证 SHA-256、无 Apple xattr、保留 0.1.6 回滚材料并完成 G9.1 Review。

### G9.2：离线 Linux 插件工具栏空白回归

Status: `READY_FOR_USER_VALIDATION`

- [x] 将故障目标纠正为离线 Linux Workbench，并作废本机 macOS 安装态结论。
- [x] 确认 0.1.7 离线服务包不携带 VSIX，Render Service 覆盖安装不会直接替换插件。
- [x] 对 0.0.42 Linux VSIX 移除 `crypto.randomUUID` 后执行主 Webview 启动实验，确认 React 正常挂载且无 `pageerror`。
- [x] 确认 0.0.42 错用 AVX2 `linux-x64` CLI，偏离此前离线 Linux `linux-x64-baseline` 交付边界。
- [x] 将插件版本升级到 0.0.43，并恢复显式 internal `linux-x64-baseline` VSIX 目标。
- [x] 从源码新鲜构建 `cli-linux-x64-baseline`，不得复用 0.0.42 二进制。
- [x] 生成并校验 `chipmate-0.0.43-linux-x64-baseline.vsix` 的 CLI、Webview、ripgrep、Tree-sitter 和 LanceDB runtime。
- [x] 目标离线 Linux 覆盖安装与真实进程确认移交用户手动执行（`USER_HANDOFF / NOT_RUN`；不声明通过）。
- [x] 聊天首页、New Task、History、市场、Settings 与旧会话验证移交用户手动执行（`USER_HANDOFF / NOT_RUN`）；G9.2 agent scope Review 完成。

### G9.3：New API 身份解析 429 hotfix

Status: `COMPLETE — PASS_LOCAL_LINUX_SCOPE`

- [x] 确认 Web `token-resolver-disabled` 与 ChipMate“未验证”来自同一服务端 resolver 配置缺失。
- [x] 确认手动注入三项 `NEW_API_*` 后的 429 来自 New API 上游，而非 ChipMate API Key 读取失败。
- [x] 确认现有 resolver 会逐 token 读取完整 key、对任意列表错误切换分页参数且缺少并发合并，可能放大上游请求。
- [x] 优先使用 New API 只读 token usage 接口直接解析当前 key 的 token 名称，旧 New API 才进入 admin catalog fallback。
- [x] 为同一 key 的并发解析和 admin catalog 刷新增加 single-flight，429 不得触发分页参数重试。
- [x] 将上游 429 映射为明确的 `new-api-rate-limited`，日志保留安全的状态/Retry-After 证据但不得输出 key。
- [x] 覆盖安装时在未显式提供 `ENV_FILE` 的情况下安全继承旧容器的 `NEW_API_*`，并在删除旧容器前验证显式环境文件。
- [x] 增加直接解析、并发合并、429、旧接口回退和安装器继承测试。
- [x] 将 Render Service 升级到 0.1.8，运行 check/build 与真实 HTTP resolver 登录回归；Edge 保持 `USER_WAIVED / NOT_RUN`。
- [x] 重新生成 linux/amd64 镜像及 0.1.8 离线包，校验 SHA-256、无 Apple xattr 并完成 G9.3 Review。

### G10：ChipMate Skill Hub 本地导入与跨平台 Skill 兼容

Status: `COMPLETE`

Baseline: `2026-07-15`

- [x] G10.0 冻结实施基线：当前 worktree 共 373 条变更，计划文档和 Render Service 子树未跟踪；不清理、重置或覆盖既有修改。
- [x] G10.0 记录关键基线 SHA-256：MarketplacePanelProvider `c2288f96`、types `abc31420`、upload `ac912633`、MarketplaceView `e4aa84ee`、marketplace.css `f5a16246`、skill-spec `f61e55d2`。
- [x] G10.1 将 `@chipmate/skill-spec` 提升为 ChipMate 扩展和 ChipMate Server 共享规范包。
- [x] G10.1 实现文件夹、`SKILL.md`、ZIP 和 TAR.GZ 发现、批量候选、格式 hints 和确定性快照。
- [x] G10.1 保留 Agent Skills 核心、Codex/Claude/OpenCode 扩展字段和任意安全配套目录。
- [x] G10.1 实现路径、链接、容量、二进制、秘密、PDF 和无宏 OOXML 安全门禁。
- [x] G10.2 实现 10 分钟 import token、预检、交互修复、原子安装、回滚和批量汇总。
- [x] G10.2 实现项目/全局 scope、同品去重、普通替换和市场版转 `local-unmanaged`。
- [x] G10.2 新增仅保存指纹的 `local-imports.json`，不持久化完整来源路径。
- [x] G10.3 实现 SolidJS Liquid Glass 导入流、批量选择、兼容性报告、冲突确认和进度汇总。
- [x] G10.3 实现原生选择器与 capability-gated 拖放降级提示，补齐中英文、键盘和 reduced-motion。
- [x] G10.4 发布使用共享规范的确定性 TAR.GZ，不再使用固定目录白名单。
- [x] G10.4 服务端保留标准与厂商 frontmatter，新增可选 `skillSpecVersion` 并保持新旧客户端兼容。
- [x] G10.5 通过共享规范、ChipMate 扩展、服务端、发布往返和真实 CLI Skill 发现门禁。

Exit Criteria:

- [x] 四种输入、多 Skill 包、安全文档和跨平台扩展全部通过共享校验。
- [x] 导入后真实 CLI `app.skills` 可发现并读取完整 `SKILL.md`。
- [x] 本地导入→卡片发布→服务端 revision→下载重装闭环通过。
- [x] Word、Mermaid、Agent、MCP 和 legacy Marketplace 无回归。
- [x] G10 Review 通过，`Completion allowed` 恢复为 `yes`。

### G10.0 Update — 2026-07-15

Status: `COMPLETE`

Changed Files:

- `docs/chipmate-skill-market-chipmate-alignment-plan.md`
- `.changeset/import-local-skills.md`

Design Summary:

- 保留 G0–G9 历史，冻结 373 条既有 dirty worktree 基线和六个关键文件哈希；G10 实施期间不清理或覆盖用户修改。
- 新增用户可见功能 changeset；未生成、提交或暂存 VSIX、日志、截图和传输归档。

Commands Run:

- `git status --short`、`shasum -a 256 <G10 关键文件>`
  - Result: `PASS`
  - Evidence: 本节 Baseline 记录。

Test Results:

- G10 变更边界、账本状态和保护对象均已在编码前记录。

Known Limitations:

- Render Service 子树与大量 Marketplace 修改在基线时已未跟踪或未提交；G10 只按本账本和文件级证据报告，不宣称仓库整体 clean。

Next Recommended Gate:

- G10.1：建立共享 Skill 规范和安全归档边界。

### G10.1 Update — 2026-07-15

Status: `COMPLETE`

Changed Files:

- `package.json`、`bun.lock`
- `server/chipmate-word-render/packages/skill-spec/package.json`
- `server/chipmate-word-render/packages/skill-spec/src/index.ts`
- `server/chipmate-word-render/packages/skill-spec/src/node.ts`
- `server/chipmate-word-render/packages/skill-spec/src/zip.ts`
- `server/chipmate-word-render/packages/skill-spec/test/index.test.ts`
- `packages/chipmate-vscode/package.json`

Design Summary:

- `@chipmate/skill-spec` 成为 Render Service 与 ChipMate 扩展的同一 workspace 依赖；纯文件校验、归档校验、Node 来源发现、YAML AST 修复和确定性 TAR.GZ 均由同一包导出。
- 支持文件夹、直接 `SKILL.md`、ZIP、TAR.GZ、wrapper 目录、多 Skill 和嵌套 Skill 排除；保留未知 frontmatter、注释、`agents/openai.yaml`、平台 hints 和所有安全资源。
- 落实 500 文件、10 MiB 单文件、50 MiB 压缩包、100 MiB 解压后上限，并拒绝穿越、绝对路径、大小写碰撞、链接、设备、加密 ZIP、压缩炸弹、嵌套归档、可执行二进制、秘密和主动文档；安全 PDF 与无宏 OOXML 为允许边界。

Commands Run:

- `npm run check`，目录 `server/chipmate-word-render`
  - Result: `PASS`
  - Evidence: skill-spec 11/11 tests，全部 workspace typecheck、lint 和 tests 通过。

Test Results:

- Agent Skills、Codex、Claude、OpenCode、缺失元数据修复、未知字段/注释往返、四种输入、多 Skill、归档攻击、PDF/OOXML 和跨平台确定性 SHA-256：`PASS`。

Known Limitations:

- ChipMate 不模拟 Claude hooks/model/context、Codex MCP 自动安装或 OpenCode 专属运行语义；这些字段只保真保存并显示兼容性提示。

Next Recommended Gate:

- G10.2：在扩展宿主实现 token 化预检与原子安装。

### G10.2 Update — 2026-07-15

Status: `COMPLETE`

Changed Files:

- `packages/chipmate-vscode/src/services/marketplace/local-import.ts`
- `packages/chipmate-vscode/src/services/marketplace/local-import-registry.ts`
- `packages/chipmate-vscode/src/services/marketplace/types.ts`
- `packages/chipmate-vscode/src/MarketplacePanelProvider.ts`
- `packages/chipmate-vscode/src/services/marketplace/actions.ts`
- `packages/chipmate-vscode/src/services/marketplace/skills.ts`
- `packages/chipmate-vscode/src/types/messages.ts`
- `packages/chipmate-vscode/tests/unit/marketplace-local-import.test.ts`
- `packages/chipmate-vscode/tests/unit/marketplace-registry.test.ts`

Design Summary:

- 扩展宿主持有 10 分钟 `importToken`、源路径、临时字节和候选快照；Webview 只能提交 token、候选 ID、统一 scope、修复值和冲突动作。
- 项目与全局安装均使用同文件系统 staging、backup、原子 rename 和 registry 后置提交；单项失败回滚，批量继续，取消只阻止下一项。
- 哈希相同去重，普通差异显式替换，市场管理版显式转 `local-unmanaged`；`local-imports.json` 只保存版本、指纹、basename、workspace 哈希、hints 和时间。
- 安装完成后复用 CLI instance/config 失效机制重新读取 `client.app.skills`，不修改共享 OpenCode loader。

Commands Run:

- `bun test ./tests/unit/marketplace-*.test.ts`，目录 `packages/chipmate-vscode`
  - Result: `PASS`
  - Evidence: 57/57 tests、247 assertions。

Test Results:

- 真实临时目录的项目/全局安装、来源不变、隐私 registry、同品去重、普通替换、市场版冲突、registry 失败回滚、批量部分成功和取消：`PASS`。

Known Limitations:

- 导入是一次性快照，不链接、不移动、不监听原目录；这是已确认产品边界。

Next Recommended Gate:

- G10.3：实现 SolidJS Liquid Glass 导入流程和可访问性状态。

### G10.3 Update — 2026-07-15

Status: `COMPLETE`

Changed Files:

- `packages/chipmate-vscode/webview-ui/src/components/marketplace/LocalSkillImportDialog.tsx`
- `packages/chipmate-vscode/webview-ui/src/components/marketplace/MarketplaceView.tsx`
- `packages/chipmate-vscode/webview-ui/src/components/marketplace/ItemCard.tsx`
- `packages/chipmate-vscode/webview-ui/src/components/marketplace/AlignedSkillMarket.tsx`
- `packages/chipmate-vscode/webview-ui/src/components/marketplace/marketplace.css`
- `packages/chipmate-vscode/webview-ui/src/stories/marketplace.stories.tsx`
- `packages/chipmate-vscode/webview-ui/src/types/marketplace.ts`
- `packages/chipmate-i18n/src/en.ts`、`packages/chipmate-i18n/src/zh.ts`

Design Summary:

- 标题区新增本地导入主入口；六阶段弹窗覆盖来源、候选、兼容/安全、元数据修复、scope/冲突和结果，长操作提供阶段、取消与立即错误反馈。
- 使用 chipmate-ui、Codicons、VS Code token、`currentColor` 和正常 flex/grid 流；Glass 内容采用通透分层、柔和高光、材质边界、内外阴影与 reduced-motion。
- 卡片显示本地导入、市场管理、本地覆盖及发布状态；导入不登录、不自动上传，发布仍从卡片触发。
- 当前 VS Code 宿主无法安全暴露拖放文件句柄，因此明确显示原生选择器降级提示；核心路径保持文件/文件夹选择器可达。

Commands Run:

- `bun run build-storybook`
  - Result: `PASS`
  - Evidence: Storybook production build 完成。
- Chrome 本地 Storybook 视觉 QA
  - Result: `PASS`
  - Evidence: 1131×616 宽屏与 480×760 窄屏；修复 Dialog provider、512px 溢出和 flex 收缩导致步骤条不可见问题后复验通过。

Test Results:

- 中英文、候选批量选择、修复、冲突、项目/全局 scope、键盘语义、窄屏单列、滚动边界和 reduced-motion：`PASS`。

Known Limitations:

- 首版不提供浏览器端本地安装；Web 无权写入 ChipMate Skill 目录。

Next Recommended Gate:

- G10.4：统一发布归档和服务端权威复验。

### G10.4 Update — 2026-07-15

Status: `COMPLETE`

Changed Files:

- `packages/chipmate-vscode/src/services/marketplace/upload.ts`
- `packages/chipmate-vscode/src/services/marketplace/archive.ts`
- `packages/chipmate-vscode/tests/unit/marketplace-upload.test.ts`
- `server/chipmate-word-render/packages/contracts/src/market.ts`
- `server/chipmate-word-render/apps/api/src/market.ts`
- `server/chipmate-word-render/packages/market-db/test/index.test.ts`
- `server/chipmate-word-render/apps/web/src/generated/market-api.ts`
- `packages/chipmate-vscode/src/services/marketplace/generated/market-api.ts`

Design Summary:

- 卡片发布从已安装 Skill 根重新调用共享规范，完整包含全部安全文件并直接上传确定性 TAR.GZ；不再维护目录白名单。
- 服务端 YAML AST 修复和 `skill.json` 合并保留 license、compatibility、metadata、allowed-tools、厂商字段和未知市场字段；`skill.json.semver` 优先。
- capabilities 新增可选 `skillSpecVersion`；新扩展对旧服务端仍可离线导入，旧扩展对新服务端仍可浏览、下载和安装 latest，服务端始终权威复验。
- Word/Mermaid 路由、算法、扩展身份、配置命名空间和共享 OpenCode loader 均未修改。

Commands Run:

- `npm run check`，目录 `server/chipmate-word-render`
  - Result: `PASS`
  - Evidence: API 22、Web 10、contracts 4、market DB 3、skill-spec 11 tests 全通过。
- `SKILL_LOAD_EVIDENCE=docs/chipmate-skill-market-alignment-evidence/g10/load.json node --import tsx scripts/g8-load.ts`
  - Result: `PASS`
  - Evidence: 10,000 Skill、200 并发、market errors 0、market p95 32.62ms、render errors 0、render p95 退化 -2.91%。

Test Results:

- 本地安全资源归档、服务端不可变 revision、下载归档、Codex/Claude/OpenCode 字段往返、legacy latest 安装和能力降级：`PASS`。
- 真实 Mermaid 与 DOCX 渲染测试在市场压力下零错误：`PASS`。

Runtime Evidence:

- Artifact: `docs/chipmate-skill-market-alignment-evidence/g10/load.json`
- Result: 市场和渲染预算全部通过。

Known Limitations:

- 旧服务端不声明发布能力时，新扩展隐藏远程发布，但本地导入与 ChipMate 使用不受影响。

Next Recommended Gate:

- G10.5：真实 CLI 发现、全量静态门禁和最终 Review。

### G10.5 Update — 2026-07-15

Status: `COMPLETE`

Changed Files:

- `docs/chipmate-skill-market-chipmate-alignment-plan.md`
- `docs/chipmate-skill-market-alignment-evidence/g10/load.json`

Design Summary:

- 用当前源码启动真实 `chipmate serve`，在同一服务进程运行期间写入项目 `.chipmate/skills/g10-runtime-skill`，仅调用 instance dispose 失效机制后重新读取 `app.skills`。
- 返回 Skill 的真实 location、description 和 `contentLoaded: true`，证明无需重启服务即可发现并读取完整 `SKILL.md` 正文。

Commands Run:

- `bun dev serve --port 0` 与真实 `/instance/dispose`、`/skill?directory=...`
  - Result: `PASS`
  - Evidence: `g10-runtime-skill` 返回 `contentLoaded: true`，服务进程未重启。
- `bun run typecheck`、`bun run lint`、`bun run compile`、`bun run knip`、`bun run check-chipmate-change`
  - Result: `PASS`
- `bun run script/check-md-table-padding.ts`
  - Result: `PASS`，399 个 Markdown 文件。

Test Results:

- ChipMate 本地导入即时加载、共享规范、扩展事务、发布往返、服务端兼容、Word/Mermaid 压测和 Liquid Glass 视觉 Review 均通过。

Runtime Evidence:

- Environment: macOS，本仓库当前 Bun/Node 运行时，真实 HTTP/SSE CLI server、真实临时工作区和文件系统。
- Artifact: `docs/chipmate-skill-market-alignment-evidence/g10/load.json`。
- Result: `G10_COMPLETE`。

Known Limitations:

- 首版不做实时链接、自动监听、自动发布、浏览器本地安装、任意二进制、宏文档、加密包或嵌套归档。
- 平台专属运行语义只保留和提示，不伪装为 ChipMate 已执行。

Next Recommended Gate:

- G10 已完成；后续可独立规划本地 Skill 编辑/差异同步、签名与信任、团队私有集合和发布审核，不回开 G10。

### G10.6 Update — 2026-07-15

Status: `COMPLETE_WITH_BASELINE_BLOCKERS`

Changed Files:

- CLI Skill Service 与 ChipMate-owned HTTP handler：安全删除、两级缓存失效、回滚和内置保护。
- VS Code 扩展与共享 Marketplace 服务：10 分钟 token、旧 CLI dispose fallback、目录复验、注册表对账和项目/全局 scope。
- Settings 与 Marketplace SolidJS UI：非乐观确认、阶段进度、错误反馈、本地卡片删除和无障碍状态。
- 定向真实文件系统测试、消息契约测试、中英文 i18n、changeset 与本账本。

Design Summary:

- 删除请求只允许使用宿主签发的 `targetToken + skillId + scope`；扩展宿主在操作前重新读取 `app.skills` 并精确匹配 location，Webview 不能指定任意目标路径。
- CLI 只允许删除当前已发现的非内置 Skill。它先同盘重命名 `SKILL.md` 标记文件，使所有扫描器立即失去入口，再失效 discovery/state 缓存并复读；失败则恢复标记文件，成功后清理整个 Skill 根目录。
- CLI 和扩展共同要求安装目录名与 Skill ID 匹配；工作区根、项目根、用户目录、ChipMate 配置/数据根、文件系统根以及包含其他已发现 Skill 的父目录均不可删除。
- 新扩展连接旧 CLI 时，如果首次复读仍命中旧 location，会调用 `instance.dispose` 后再次读取；最终还要求安装目录不存在。
- 删除成功后按 scope 清理 `local-imports.json`；Marketplace 刷新会对当前项目和全局记录执行目录对账，修复历史脏记录。
- 项目与全局同名 Skill 只删除当前可见 location；缓存重建后另一个 scope 的同名 Skill 会重新出现，不被连带删除。

Baseline Freeze:

- 实施前 dirty worktree：391 条；未清理、重置或覆盖既有修改。
- SHA-256：Skill Service `dee9aeb649bd`、ChipMate handler `a72e8d546c6c`、ChipMateProvider `7fb9178c85db`、session context `515a2d626a4d`、MarketplacePanelProvider `088a747f723b`、local registry `c6472901d8ed`。

Commands Run:

- `packages/opencode: bun test ./test/chipmate/skill-removal.test.ts ./test/session/system.test.ts`
  - Result: `PASS`，5 tests、18 assertions；覆盖即时缓存刷新、任意路径/物化内置拒绝、工作区根保护和同名跨 scope 保留。
- `packages/opencode: bun run typecheck`
  - Result: `PASS`。
- `packages/chipmate-vscode: targeted Marketplace/removal/message tests`
  - Result: `PASS`，21 tests、109 assertions；使用真实临时目录验证 token、旧 CLI fallback、目录删除、目录名约束、registry 清理和历史记录对账。
- `packages/chipmate-vscode: bun run typecheck && bun run lint && bun run compile && bun run knip && bun run check-chipmate-change`
  - Result: `PASS`；compile 强制重建当前 macOS CLI、重生成 SDK并完成八个 webview/extension bundle。
- `bunx prettier --check <G10.6 touched TypeScript files>`
  - Result: `PASS`。
- `bun run script/check-md-table-padding.ts`
  - Result: `PASS`，399 个 Markdown 文件。
- `bun run script/check-opencode-annotations.ts`
  - Result: `BASELINE_FAIL`；失败仅来自当前分支已有的 `packages/opencode/script/build.ts`、provider 和 control/global handler 等提交内容，本次 `skill/index.ts` 新增内容均位于 `chipmate_change` block/inline marker，ChipMate-owned handler/test 路径免标记。
- `bun run script/check-opencode-promise-facades.ts`
  - Result: `BASELINE_FAIL`；失败来自既有 `internal-offline-provider.test.ts` 未分类 AppRuntime 使用，本次未新增 Promise facade 或 AppRuntime 测试依赖。
- `server/chipmate-word-render: npm run check`
  - Result: `PASS`；contracts/typecheck/lint 和 50 个 API/Web/contracts/DB/skill-spec 测试全部通过，包含真实 Fastify Mermaid/DOCX compatibility core。
- `packages/chipmate-vscode: marketplace-installer + local removal tests`
  - Result: `PASS`，13 tests、47 assertions；远程 Skill/MCP/Agent 安装删除路径未回归。
- `packages/opencode: Mermaid/Word targeted regression tests`
  - Result: Mermaid `PASS` 4/4；Word 9/10 通过，远程端点用例首次触发 5 秒超时，15 秒复跑仍因当前返回 `visualQaStatus: completed`、既有断言期望 `skipped` 而失败。G10.6 未触碰 Word 实现或测试，该既有语义差异作为基线 blocker 保留。

Test Results:

- Settings 删除不再乐观隐藏；成功响应和权威复读完成后才移除，失败保留弹窗并显示中文错误。
- Marketplace 本地导入/本地覆盖卡片具备 trash 操作，使用与 Settings 相同的宿主删除服务；远程市场管理删除保持原路径。
- 本地来源快照不被修改，已发布 revision 不被撤销，Word/Mermaid/Agent/MCP 路由未触及。

Known Limitations:

- 未在本轮手工启动 VS Code 点击 UI；UI 证据为消息契约、SolidJS typecheck、ESLint、compile 和实际删除服务测试。
- 当前分支的两个仓库级 guard 和 CLI Word 既有 visual-QA 断言有本次之前已存在的失败，因此仓库总 `Completion allowed` 保持 `no`；G10.6 scoped implementation 与相关测试已完成。

Next Recommended Gate:

- 在不混入用户其他修改的前提下，单独清理或隔离现有 annotation/AppRuntime guard 与 Word visual-QA 断言基线，再恢复仓库总 `Completion allowed: yes`。

### G10.7 Update — 2026-07-15

Status: `COMPLETE`

Changed Files:

- `.changeset/close-skill-publication-progress.md`
- `docs/chipmate-skill-market-chipmate-alignment-plan.md`
- `packages/chipmate-vscode/src/MarketplacePanelProvider.ts`
- `packages/chipmate-vscode/src/services/marketplace/publication.ts`
- `packages/chipmate-vscode/tests/unit/marketplace-publication.test.ts`
- `packages/chipmate-vscode/tests/unit/marketplace-upload.test.ts`

Baseline Freeze:

- 当前 `HEAD`: `3579480822`（`merge: upstream v7.4.8`）。
- 相关 Marketplace 合并冲突已解决；tracked worktree 无修改。
- 既有未跟踪 VSIX、截图、证据、模型快照和文档产物保持原状，不纳入本 Gate。

Design Summary:

- 服务端返回 `PUBLISHED` 或 `UNCHANGED` 后，上传进度必须立即结束；市场刷新、确定性修复提示和本地 diff 属于发布后的独立工作。
- 原生通知只展示客户端真实可观测阶段：准备规范快照、提交并等待服务端权威复验、收到服务端终态；不伪造服务端内部百分比。
- 无 VS Code 依赖的发布协调器先完整等待 progress promise 结束，再调用结果处理；`marketplacePublicationResult`、blocked 状态、analytics、后台 `fetchData()` 和本地修复交互均位于该边界之外。
- 确定性修复只显示一个“发布完成 + 查看 diff”后续通知；用户不选择、长时间不返回或本地应用失败都不会重新占用上传通知。
- 不修改 ChipMate Server、OpenAPI、SSE、Webview 消息、市场顶部 UI 或规范化归档逻辑。

Commands Run:

- `bun test tests/unit/marketplace-publication.test.ts tests/unit/marketplace-upload.test.ts tests/unit/marketplace-panel-arch.test.ts`
  - Result: `PASS`，18 tests、112 assertions。
- `packages/chipmate-vscode: bun run typecheck && bun run lint && bun run compile`
  - Result: `PASS`；compile 强制重建当前 CLI、重生成 SDK并完成扩展/webview bundle。
- `packages/chipmate-vscode: bun run knip && bun run check-chipmate-change`
  - Result: `PASS`。
- `bunx prettier --check <G10.7 touched TypeScript files>`
  - Result: `PASS`。
- `bun run script/check-md-table-padding.ts`
  - Result: `PASS`，435 个 Markdown 文件。
- 根目录 `bun test`
  - Result: `NOT_RUN`，按仓库约束禁止从根目录运行。

Test Results:

- `PUBLISHED`、`UNCHANGED`、`NEEDS_AUTHOR_FIX`、`SECURITY_REJECTED` 和网络异常均先关闭 progress；完成阶段只在 `submit` 返回后出现。
- 永不立即返回的修复/diff 选择和延迟或失败的后台对账均不会让 progress 重新打开或继续 pending。
- 真实临时安装目录 `publication-skill` 通过共享规范构建确定性发布归档，返回有效 `PUBLISHED` 报告；发布前后来源 `SKILL.md` 字节一致。
- `marketplacePublicationResult`、卡片 blocked 状态、analytics 和后台刷新保持原协议，不需要修改 ChipMate Server 或 Webview 消息。

Runtime Evidence:

- Environment: macOS，本仓库 Bun/TypeScript 运行时、真实临时目录和共享 Skill 规范实现。
- Result: `G10.7_COMPLETE`；扩展 compile 通过，未生成或纳入新的 VSIX 交付物。

Known Limitations:

- 本 Gate 未手工启动 VS Code 点击真实通知；通知关闭顺序由无 VS Code 依赖的协调器边界测试、真实 Skill 归档测试、类型检查和完整扩展 bundle 共同验证。
- 当前工作区另有与本 Gate 无关的 Word/Skill 文档修改和既有未跟踪产物，均保持原状且未计入 G10.7 Changed Files。
- 既有 annotation/AppRuntime guard 与 Word visual-QA 基线 blocker 未在本 Gate 处理，因此总 `Completion allowed` 继续为 `no`。

Next Recommended Gate:

- 在不混入 G10.7 和用户其他修改的前提下，单独清理或隔离现有 annotation/AppRuntime guard 与 Word visual-QA 断言基线，再恢复仓库总 `Completion allowed: yes`。

### G11 Update — 2026-07-17

Status: `COMPLETE`

Scope:

- 将 Skill 风险分为无风险、中风险、严重风险和历史未评估；中风险允许发布，严重风险继续阻断。
- 所有凭据命中（包括真实私钥文本）按用户明确决策归为中风险，不再单独阻断发布。
- Web 与 VS Code 卡片显示风险标记，详情显示中文扫描结果；下载、安装或更新风险版本前必须确认。
- 历史版本不后台重扫，统一显示“未评估”，继续下载或安装前显示中性确认。
- Web 发布页新增“一个文件夹即一个 Skill”的本地打包入口；根目录必须包含 `SKILL.md`，不新增 ZIP、TGZ 或多 Skill 文件夹发布协议。

Implementation Ledger:

- [x] 扫描器增加 `skill-risk-v2`、风险级别、中文问题说明和中风险不阻断策略。
- [x] aligned-v1 契约、SQLite 查询映射、OpenAPI 与生成客户端携带风险摘要和逐项风险级别。
- [x] Web 卡片、详情、下载与安装深链前增加风险提示和确认。
- [x] Web 文件夹选择、单目录拖放、本地 USTAR + Gzip 确定性打包和真实 XHR 上传进度。
- [x] VS Code 卡片、详情与安装弹窗增加原生主题风险标记、中文详情和确认门禁。
- [x] 单元和 API 测试覆盖私钥/凭据可发布、中风险中文报告、严重风险阻断和历史未评估。
- [x] 完成服务端全量 check、Web 生产构建、VS Code lint/compile/targeted tests/knip/guard。
- [x] 完成真实 Chrome 三视口交互与视觉签收，并记录截图证据。

Known Baseline:

- 本轮开始时工作区已有大量与 G11 无关的 tracked/untracked 修改；G11 只记录本节列出的服务端市场、Web、VS Code Marketplace、i18n、契约、测试和 changeset 文件，不覆盖其他用户修改。
- 仓库总 `Completion allowed` 继续为 `no`，直到既有 annotation/AppRuntime 与 Word visual-QA 基线阻塞被单独处理；该状态不否定 G11 的 scoped 验收。

Changed Files:

- Skill 规范与契约：`packages/skill-spec/src/index.ts`、`packages/contracts/src/schema.ts`、OpenAPI、生成客户端及对应测试。
- 服务端市场：`apps/api/src/aligned.ts`、`packages/market-db/src/model.ts`、`packages/market-db/src/repo.ts` 及 API/数据库测试。
- Web 市场：`risk.tsx`、`skill-folder.ts`、首页/详情/发布页、Liquid Glass 样式、单元测试和 Chrome E2E。
- VS Code Marketplace：共享类型/API、卡片、详情、安装弹窗、VS Code 主题样式、i18n、stories 与定向测试。
- 发布记录：`.changeset/publish-skill-risk-guidance.md`。

Design Summary:

- `skill-risk-v2` 将自动扫描结论稳定映射为 `none`、`medium`、`critical`、`unknown`；只有严重风险阻断发布，凭据、脚本和 Office 外部链接作为中风险随版本保存并持续提示。
- 旧报告不使用遗留英文问题推断当前安全状态，统一归一为“未评估”；Web 与 VS Code 客户端均对滚动升级期间缺失 `risk` 字段的旧响应安全降级。
- Web 卡片使用绿色/黄色/中性标记；详情展示中文逐项风险；中风险下载、安装和更新必须勾选确认，未评估版本使用中性确认。
- 文件夹上传只读取一个根目录，要求根目录存在 `SKILL.md`，忽略本地噪声，浏览器按排序、零时间戳和固定权限生成确定性 USTAR + Gzip；网络仍只发送最终归档到既有发布 API。
- VS Code 侧继续使用 Codicons、主题 token 和正常文档流，没有增加自定义彩色工具栏图标或绝对定位图标布局。

Commands Run:

- `server/chipmate-word-render: npm run check`
  - Result: `PASS`；41 API、23 Web、6 contracts、3 database、12 skill-spec tests。
- `server/chipmate-word-render: npm run build`
  - Result: `PASS`；生成契约无 drift，API/Web/contracts/database/skill-spec 生产构建完成。
- `server/chipmate-word-render: npm run test:e2e:web:chrome`
  - Result: `PASS`；真实安装版 macOS Chrome 24/24，通过风险确认、文件夹本地打包、无障碍、性能和既有插件市场回归。
- `packages/chipmate-vscode: bun run typecheck && bun run lint`
  - Result: `PASS`。
- `packages/chipmate-vscode: bun test tests/unit/marketplace-api.test.ts tests/unit/marketplace-panel-arch.test.ts`
  - Result: `PASS`；17 tests、104 assertions。
- `packages/chipmate-vscode: bun run compile && bun run knip && bun run check-chipmate-change`
  - Result: `PASS`；强制重建当前 macOS CLI、SDK、扩展与 Webview bundle，未发现 unused export 或非法 marker。
- `bun run script/check-md-table-padding.ts`、`git diff --check`
  - Result: `PASS`。

Test Results:

- 真实私钥/凭据文本、scripts 和 Office 外链均返回中文中风险报告且状态为 `PUBLISHED`；Markdown XSS、危险路径、链接、可执行内容、嵌套归档和主动文档仍返回严重风险并阻断。
- Web 与 VS Code 对新报告显示绿色/黄色风险标记，对旧报告显示“未评估”；中风险继续按钮在确认前保持 disabled。
- Chrome 验证文件夹输入只上传浏览器生成的 Gzip 字节，归档包含 `SKILL.md` 和子目录文件且不包含 `.DS_Store`；原有 `.tar.gz` 发布入口保持可用。
- 风险弹窗在 `1484×1060`、`1440×1024`、`1050×1024` 无横向溢出，遮罩覆盖完整视口，关闭图标和操作按钮处于正常文档流。

Runtime Evidence:

- Environment: macOS，真实安装版 Google Chrome、真实 Vite/Fastify/SQLite 预览服务、真实目录输入和真实 XHR。
- Risk dialog: `.runtime/design-qa/g11/risk-dialog-1484x1060-real-chrome.png`、`risk-dialog-1440x1024-real-chrome.png`、`risk-dialog-1050x1024-real-chrome.png`。
- Folder upload: `.runtime/design-qa/g11/folder-upload-1440x1024-real-chrome.png`。
- Result: `G11_COMPLETE`；应用内浏览器检查额外发现并修复了旧能力缓存响应导致的风险字段缺失白屏，以及风险弹窗遮罩未覆盖视口的问题。

Known Limitations:

- 历史版本按已锁定决策不重扫，显示“未评估”；只有再次发布后才获得 `skill-risk-v2` 结论。
- 自动扫描不是安全背书；所有凭据命中均按用户明确决策作为中风险提示，不阻断公开发布。
- 文件夹入口不接收 ZIP、TGZ、嵌套多 Skill 或多个根目录；单文件 `.tar.gz` 入口保持原协议。
- 本 Gate 未生成 Render Service Linux 包或新 VSIX；用户当前请求只包含实现和验证。
- 工作区已有的大量无关修改保持原状；仓库级 annotation/AppRuntime 与 Word visual-QA 基线 blocker 不属于 G11，因此总 `Completion allowed` 仍为 `no`。

Next Recommended Gate:

- 如需交付部署，下一步单独打包 Render Service Linux 归档和目标平台 VSIX，并在真实部署目录执行覆盖升级与下载/安装风险提示验收。

### G11.1 Offline Linux Package Update — 2026-07-17

Status: `READY_FOR_OFFLINE_LINUX_VALIDATION`

Changed Files:

- `server/chipmate-word-render/package.json`、`package-lock.json`：Render Service 版本从 `0.1.12` 升级为 `0.1.13`。
- 本执行账本：记录原生 linux/amd64 构建、容器冒烟、离线归档与校验证据。
- 本地交付物（不纳入 Git）：`server/chipmate-word-render/out/chipmate-server-offline-0.1.13-linux-amd64.tar.gz` 及 SHA-256 sidecar。

Design Summary:

- 使用 x86_64 Colima Docker 守护进程执行 `--platform linux/amd64 --pull --no-cache` 全新构建，不复用 0.1.12 镜像或归档。
- 完整离线包包含 0.1.13 Docker 镜像、安装脚本、Skill Market catalog 和两个托管 Skill 种子；服务器默认仍保持 `EXTENSION_MARKET_ENABLED=0`，部署时可显式启用。
- 归档继续由 `build-offline-bundle.mjs` 的 Python `tarfile` 路径生成，清空 pax header，避免 macOS extended attribute 被写入 Linux 交付包。

Commands Run:

- `npm run generate:check`、`node --check server.js`、`node --check build-offline-bundle.mjs`、`bash -n install-render-server.sh`
  - Result: `PASS`。
- `docker build --pull --no-cache --platform linux/amd64 -t chipmate-word-render:0.1.13 .`
  - Result: `PASS`；镜像 `sha256:88bfaadf7dd873d5532dbfed81e9a0d300f2390f1489475aa10672f8a2179768`，架构 `linux/amd64`。
- 独立临时容器启动并请求 `/health`、`/api/v1/capabilities`、`/`、`/publish`
  - Result: `PASS`；健康检查正常，启用开关后 `features.extensions=true`，两个 Web 页面均为 HTTP 200。
- 镜像内生产 Web bundle 文案检查
  - Result: `PASS`；包含“选择 Skill 归档或文件夹”“此 Skill 存在风险隐患”“严重风险”。
- `docker save`、`build-offline-bundle.mjs`、两层 `shasum -a 256 -c`、`gzip -t`
  - Result: `PASS`。
- 使用 0.1.13 Linux 容器执行完整包 `tar -xzf`、内层镜像 SHA、`bash -n install-render-server.sh`、执行位和 Skill 种子检查
  - Result: `PASS`。
- 外层包、Docker 归档和两个嵌套 Skill 归档执行 Apple xattr/AppleDouble/归档路径扫描
  - Result: `PASS`；未发现 `com.apple`、`LIBARCHIVE.xattr`、`SCHILY.xattr`、`AppleDouble`、`__MACOSX` 或 `._` 归档条目。

Runtime Evidence:

- Environment: macOS host + 原生 x86_64 Colima VM + Docker `linux/amd64` 容器。
- Complete bundle: `server/chipmate-word-render/out/chipmate-server-offline-0.1.13-linux-amd64.tar.gz`，约 624 MiB，SHA-256 `bab7751d351dfb95639888baa31a47fc759801c0314975e743d3c986d471da73`。
- Raw image archive: `server/chipmate-word-render/chipmate-word-render-0.1.13-linux-amd64.docker.tar.gz`，约 624 MiB，SHA-256 `72e3d919c5bc68e207be62ef7bedc87c5aa643a922975013b60fc34d5f0e4432`。
- Result: `READY_FOR_OFFLINE_LINUX_VALIDATION`。

Known Limitations:

- 当前证据证明原生 linux/amd64 构建、Linux 容器运行与 Linux 解包通过；用户目标离线 Linux 主机的 Docker 版本、挂载目录、身份变量、真实 Skill 上传/下载仍需在目标环境验收。
- 仓库总 `Completion allowed` 继续为 `no`；既有 annotation/AppRuntime 与 Word visual-QA 基线不属于本交付包范围。

Next Recommended Gate:

- 在目标离线 Linux 主机校验外层 SHA，解包并执行 `install-render-server.sh` 覆盖升级；使用真实中风险、严重风险和文件夹 Skill 验证发布、详情和下载确认闭环。

### G12 Model Skill Market Tools and Atomic Transactions — 2026-07-17

Status: `PARTIAL`

Scope:

- 新增 `skill_market_search`、`skill_market_install`、`skill_create`、`skill_market_publish` 和 `skill_transaction` 五个 VS Code Host 工具。
- 普通 QA 不暴露上述工具 schema，不触发市场网络、审批、事务恢复或市场上下文注入。
- 单 Skill 写操作使用持久化 staging/backup 日志，支持失败回滚、崩溃恢复、七天或最近二十笔成功后撤销。
- 多工具创建和发布使用父事务；发布撤销恢复发布前目录指针，保留不可变 revision 和审计。

Implementation Ledger:

- [x] 纯本地 Skill Market 意图分类、逐工具可见性与执行入口二次门禁。
- [x] CLI `SkillMarketHost` request/list/reply/reject 协议、SDK 和五个模型工具。
- [x] VS Code `SkillMarketBridge`、持久化事务管理器、跨进程 Skill 锁、恢复和保留策略。
- [x] verified install、创建、本地导入记录、CLI invalidation 与父事务接线。
- [x] 服务端 publication baseline、幂等精确 undo 和兼容迁移。
- [ ] 普通 QA 零 schema/零网络/零状态回归测试与事务故障注入测试。
- [x] 受影响 typecheck、lint、unit、compile、SDK/市场契约生成和可运行 CI guard。

Hard Gates:

- 普通 QA、RAG QA、文档 QA、Review、Plan 和 Completion 不得收到任何 G12 工具定义。
- 隐藏工具即使被异常直接调用，也必须在 Host 请求前返回 `intent_required`。
- 自动回滚不得覆盖事务提交后被用户或其他进程修改的 Skill；此类情况进入 `MANUAL_INTERVENTION` 并保留快照。
- 当前工作树已有大量与 G12 无关修改；G12 不覆盖、不格式化、不提交这些既有文件。

Evidence:

- `packages/opencode`: `bun test ./test/chipmate/skill-market-intent.test.ts`，13/13 通过；新增“上轮市场搜索后分析包含 install skill 的代码”仍保持零市场工具回归；`bun run typecheck` 通过。
- `packages/chipmate-vscode`: G12 transaction targeted tests 4/4 通过；覆盖本地 commit/undo、用户后改冲突、远端响应不确定恢复，以及 `COMMITTING` 在首次目录 rename 前崩溃且遗留锁时不删除原 Skill；typecheck、lint、compile、knip 和 `check-chipmate-change` 通过。
- Linux baseline VSIX 于 2026-07-18 从当前源码 fresh build：`chipmate-0.0.89-linux-x64-baseline.vsix`，SHA-256 `04ab493a17588e53d70fd389693d05d6ce1992944be0d9c54fa6cc9bcb6d85e8`；包内版本 `0.0.89`、`TargetPlatform=linux-x64`、`chipmatePackageTarget=linux-x64-baseline`，包含当前 Skill Market Host Bridge、Linux CLI、ripgrep、LanceDB 和 Tree-sitter，且无 FFmpeg、无 `dist/*.map`。
- `server/chipmate-word-render`: contract generation check、全 workspace typecheck、lint、Market DB 3/3、Market API 41/41 通过。
- 根级 `check-opencode-promise-facades` 与 Markdown table guard 通过；annotation guard 因当前工作树已检测到 upstream merge 而按脚本规则跳过。
- 扩展 compile 重新构建并 smoke-test 当前 macOS CLI；Linux baseline VSIX 已打包并完成静态成员校验，但尚未在真实 Linux VS Code Profile 安装，也未完成目标离线 Linux 运行验收。

Known Limitations:

- 尚未完成“每一个提交/补偿步骤”故障注入、每个状态 Extension Host kill/restart、两个真实 VS Code 窗口并发和七天时钟推进/二十笔淘汰的完整系统矩阵；当前证据覆盖本地创建 commit/undo、用户后改冲突、父事务远端响应不确定恢复、服务端幂等撤销和 stale revision 拒绝。
- 安装归档在解压前执行共享 Skill Spec 校验和 50 MiB 压缩包上限；事务锁与本地导入注册表锁记录进程所有者，可回收崩溃进程遗留锁，活跃进程锁不会被覆盖。
- 市场 `installations` 远端镜像仍沿用既有 Marketplace 同步/恢复链路；G12 事务已原子维护 Skill 目录与本地导入记录，但尚未把远端安装镜像的逐键 before/after 补偿纳入同一事务记录。
- 既有 `tool-registry-indexing.test.ts` 当前有 3 个与本 Gate 无关且互相矛盾的 baseline 断言失败（同一结果同时要求包含和不包含 `semantic_search`，以及重复预期项）；G12 自有测试、类型检查和构建均通过，因此仓库总 `Completion allowed` 保持 `no`。

## 17. 测试计划

### 17.1 契约和后端

- [x] OpenAPI 生成无 drift。
- [x] legacy 请求和响应快照。
- [x] Fastify route integration。
- [x] SQLite migration、事务、并发和恢复。
- [x] revision、SemVer、SHA-256、幂等和所有权冲突。
- [x] SSE 重连和 ETag 补偿。
- [x] 使用真实临时目录、SQLite 和 tar，尽量避免 mock。

### 17.2 发布和安全

- [x] 缺失或损坏 frontmatter。
- [x] 错误文件名、非法 ID 和空 description。
- [x] 自动修复只修改上传快照。
- [x] AI 补丁确认、拒绝和过期。
- [x] 路径穿越、软链和压缩炸弹。
- [x] 秘密凭据和危险文件。
- [x] Markdown XSS 和危险 URL。
- [x] 非所有者更新、下架或读取发布快照。
- [x] 重复请求不创建重复版本。

### 17.3 Web

- [x] React 单元和交互测试。
- [x] Chrome Playwright E2E 7/7；Microsoft Edge 项目和相同用例已实现，品牌运行按用户指令于 2026-07-12 暂时跳过。
- [x] 设计稿与实现截图联合视觉差异检查。
- [x] 键盘、焦点、减少动效和 axe 检查。
- [x] 首路由 JavaScript、LCP、INP 和 CLS 门禁。

### 17.4 ChipMate

- [x] capability 检测和 legacy fallback。
- [x] URI Handler 来源、过期、重放和哈希。
- [x] 收藏、安装、更新、卸载和发布同步。
- [x] globalStorage 安装元数据恢复。
- [x] Webview 详情、版本、分析和错误状态。
- [x] bun run typecheck。
- [x] bun run lint。
- [x] bun run test:unit（已执行；2819 pass、77 个非 Marketplace 基线失败和 2 个 runner error 已记录于 G9 Review）。
- [x] bun run compile。
- [x] bun run knip（已执行；既有未使用导出基线已记录于 G9 Review）。
- [x] bun run check-chipmate-change。
- [x] 新增或修改 URL 后运行 source-link extraction。

### 17.5 真实运行

- [x] 200 并发市场请求期间执行真实 Word/Mermaid 渲染。
- [x] 渲染零错误且 p95 退化不超过 20%。
- [x] Web 构建失败时禁止生成可交付镜像。
- [x] Market 数据故障时 render 仍可启动。
- [x] SQLite 或分析故障时市场进入可诊断降级。
- [x] 真实 linux/amd64 Docker 验证。
- [x] 真实安装 VSIX 和真实 VS Code profile 验证。

## 18. 迁移与发布顺序

- [x] 备份现有 skill-market 目录。
- [x] 发布兼容新版 Render Service。
- [x] 用旧 ChipMate 插件验证浏览和安装。
- [x] 执行 SQLite 导入并保留 legacy 文件。
- [x] 开放 Web 只读发现。
- [x] 开放身份、收藏和发布。
- [x] 发布新版 ChipMate VSIX。
- [x] 使用覆盖升级安装。
- [x] 验证 aligned-v1 模式。
- [x] 验证连接旧服务端时的 legacy 模式。
- [x] 保留至少一个发布周期的旧 API 和旧镜像回退能力。

## 19. 非目标

- [x] 不做手机端。
- [x] 不支持 Safari 或 Firefox。
- [x] 不做评论或五星评分。
- [x] 不做完整管理员控制台。
- [x] 不做向量搜索。
- [x] 不做 AI 对话导购。
- [x] 不运行第三方 SkillHub。
- [x] 不引入 PostgreSQL 或对象存储。
- [x] 不做多节点部署。
- [x] 不修改 Word/Mermaid 协议和算法。
- [x] 不修改 ChipMate 扩展身份和现有配置命名空间。
- [x] 不重做 Agent/MCP 市场。
- [x] 不对纯 HTTP 内网模式做公网安全承诺。

## 20. Gate 更新模板

后续每个 Gate 完成或状态变化时追加：

~~~md
### Gate N Update — YYYY-MM-DD HH:mm

Status: PARTIAL | COMPLETE | BLOCKED

#### Changed Files

- ...

#### Design Summary

- ...

#### Commands Run

- command
  - Result: PASS | FAIL | NOT_RUN
  - Evidence: ...

#### Test Results

- ...

#### Runtime Evidence

- Environment:
- Artifact:
- Result:

#### Known Limitations

- ...

#### Next Recommended Gate

- ...
~~~

## 21. Decision Log

| Date | Decision | Reason | Impact |
|---|---|---|---|
| 2026-07-12 | 使用 Markdown 作为唯一执行账本 | 避免依赖聊天上下文，支持 Gate、证据和阻塞跟踪 | 所有实施状态必须更新本文件 |
| 2026-07-12 | Web 与 ChipMate 能力和数据完全对齐，视觉不强求一致 | 浏览器与 VS Code 的平台约束不同 | 共用契约，分别实现 React 和 SolidJS UI |
| 2026-07-12 | Web 使用 React + Vite | 独立浏览器产品需要成熟生态和丰富交互 | 不复用 ChipMate SolidJS UI |
| 2026-07-12 | 后端使用 TypeScript + Fastify | 当前单文件服务难以长期维护 | 必须先建立 legacy 契约门禁 |
| 2026-07-12 | 市场使用 SQLite + 文件卷 | 支持并发、版本、搜索、分析和离线部署 | 需要迁移和回退方案 |
| 2026-07-12 | 验证通过后自动发布 | 减少作者重复确认 | 服务端校验和幂等必须权威 |
| 2026-07-12 | 自动修复只修改上传快照 | 防止静默修改用户本地文件 | 应用到本地必须显式 diff 确认 |
| 2026-07-12 | AI 修复由 ChipMate 当前 Provider 执行 | Render Service 不保存模型配置或凭据 | Web 使用深链进入 ChipMate 修复 |
| 2026-07-12 | 继续使用纯 HTTP 受信内网模式 | 用户明确选择现有部署形态 | 状态页必须显示传输风险 |
| 2026-07-12 | 不运行外部 SkillHub | 保持单容器、低运维和可离线交付 | 仅保留 importer 接口 |
| 2026-07-12 | 冻结 G0 Git、legacy 契约和真实夹具基线 | 工作区已有大量改动，后续迁移必须能区分既有内容并做黑盒回归 | 后续 Gate 使用 G0 哈希、状态快照和夹具作为证据源 |
| 2026-07-12 | 用户选择视觉方向 1：空间画廊 | 三套真实方向中，方向 1 最符合 ChipMate 品牌和 Liquid Glass 发现体验 | G4 以选定 PNG、视觉 token 和 1440×1024 viewport 为权威视觉目标 |
| 2026-07-12 | TypeBox schema 作为 aligned-v1 单一契约来源 | Fastify、React 和 SolidJS 需要共享类型和状态，但不能共享 UI | 同一生成脚本产出 OpenAPI、Web client 和 ChipMate client；生成文件禁止手改 |
| 2026-07-12 | Fastify 先通过 raw compatibility adapter 复用冻结 request core | G2 要迁移路由但不能重写 Word/Mermaid 或破坏 legacy body/response 语义 | Fastify 拥有路由和 schema；后续模块拆分必须持续通过 G2 黑盒门禁 |
| 2026-07-12 | SQLite、归档与聚合全部放入 Worker，并生成独立 legacy-latest | 市场负载不能阻塞渲染，原始 legacy 文件必须可回退 | 主线程只走 typed RPC；导入无损保留未知字段，release 不可变，旧插件继续安装 latest |
| 2026-07-12 | 用户指示 Microsoft Edge 品牌运行测试先跳过 | 当前 Mac 未安装 Edge，Chrome 5/5、应用内 Chromium、视觉、性能和无障碍证据均已通过 | 以 `USER_WAIVED / NOT_RUN` 保留已知限制并关闭 G4；不得表述为 Edge PASS，继续 G5 |
| 2026-07-12 | G5 身份采用服务端解析、会话哈希与同一稳定假名用户 | Web 原始 key 不得持久化，ChipMate 必须使用真实 auth store 的 Bearer key，双端状态必须由服务端权威映射 | Cookie 写操作使用 Origin/Host + CSRF；intent 哈希落盘、五分钟、一次性；globalStorage 仅保存假名化安装元数据 |
| 2026-07-12 | G6 使用服务端单一 PublicationRun 与权威 Skill 校验器 | Web 与 ChipMate 必须对相同归档给出相同结果，自动修复和 AI 修复不得绕开安全复验 | 确定性修复只作用上传快照；AI 仅由当前 ChipMate Provider 在双重确认后生成；revision 和归档不可变 |
| 2026-07-12 | G7 以 capabilities 驱动 ChipMate Marketplace 信息架构 | internal skillsOnly、公共完整市场和旧服务端必须在同一扩展中安全共存 | aligned-v1 提供首页/详情/版本/收藏/安装/发布/分析/诊断；legacy 隐藏失效动作；Agent/MCP 保留 |
| 2026-07-12 | G8 使用服务端派生假名身份、批量事件和 Worker 保留策略 | 分析不得接收凭据、工作区路径或阻塞渲染，且需在 10,000 Skill、200 并发下可签收 | 原始事件保留 90 天、日聚合保留 1 年；市场 p95 40.12ms，真实渲染 p95 退化 0.99% |
| 2026-07-12 | G9 以 x86_64 Linux、真实 VS Code profile 和离线归档完成最终签收 | 构建成功不能替代原生架构、覆盖升级、legacy 降级和真实渲染证据 | 交付 0.1.6 server bundle 与 0.0.41 双平台 VSIX；Edge 保持 USER_WAIVED / NOT_RUN；仓库级非 Marketplace 基线失败单独记录 |
| 2026-07-12 | G9 addendum 增加显式 internal linux-x64 VSIX 目标并统一插件版本为 0.0.42 | 原 G9 只有 macOS 与 Windows，Linux 公共包又不包含完整离线 LanceDB runtime | 保持默认 internal-offline 仍只打 Windows；显式 Linux 包在 x86_64 VM 真实执行并与三平台产物共同签收 |
| 2026-07-12 | G9.1 Web UUID 在 trusted HTTP 下使用 `getRandomValues` fallback，分析初始化改为非阻塞 | 非 localhost HTTP 中 Chrome 不提供 `randomUUID`，而 0.1.6 在模块加载阶段调用它导致首屏崩溃 | 发布 0.1.7 server bundle；不改变 API/数据合同，不重打 0.0.42 VSIX，0.1.6 保留回滚 |
| 2026-07-13 | G9.2 恢复离线 Linux `linux-x64-baseline` 插件目标 | 0.0.42 使用 AVX2 `linux-x64` CLI，不能覆盖旧离线 x86_64 主机；macOS 安装态不能作为 Linux 证据 | 发布 0.0.43 baseline VSIX；0.1.7 Render Service 保持不变；必须以目标 Linux 覆盖安装闭环 |
| 2026-07-13 | G9.3 身份优先使用 New API token usage，并为 resolver 增加可关联结构化日志 | admin catalog 逐 key 反查、无 single-flight 和错误分页回退会放大请求并掩盖 429 层级 | 发布 0.1.8 server bundle；同 key 并发合并，429 保留层级/endpoint/Retry-After 且不泄露凭据，升级自动继承旧容器 `NEW_API_*` |
| 2026-07-13 | Web 首页推荐区改为累计下载量 Top 10 轮播 | 让下载榜头部 Skill 在空间画廊内可连续发现，同时保留真实目录、详情与服务边界 | 仅修改 React Web 首页、样式、预览种子和 E2E；继续使用现有下载排序 API，不改 schema、OpenAPI、数据库、ChipMate Marketplace 或 G0–G9 状态 |
| 2026-07-15 | G10 采用共享 Agent Skills 规范、本地快照导入和卡片后续发布 | 同时保证 ChipMate 立即可用、ChipMate Server 权威复验和 Codex/Claude/OpenCode 往返保真 | 项目默认 scope，支持文件夹/SKILL.md/ZIP/TAR.GZ、批量候选、原子替换、离线导入和仅指纹 provenance |
| 2026-07-15 | G10.6 删除采用宿主 token、CLI marker tombstone 和双缓存复读 | 修复磁盘已删但 Skill 被旧缓存重新推回 UI，同时阻止 Webview 任意路径删除 | Settings 与 Marketplace 共用删除闭环；旧 CLI 使用 instance dispose fallback；registry 自动对账 |
| 2026-07-15 | G10.7 上传 progress 只包围规范快照准备和服务端权威请求 | 服务端已返回并更新卡片后，后台刷新或用户 diff 选择不得继续占用原生上传通知 | 发布结果、analytics、后台对账和本地修复全部在 progress promise 结束后执行 |
| 2026-07-17 | G11 使用 `skill-risk-v2` 分离中风险提示与严重风险阻断 | 旧规则把脚本、凭据和外部链接全部当成发布失败，无法承载需用户知情但可正常使用的 Skill | 中风险发布后在卡片、详情、下载和安装处持续提示；严重风险仍拒绝公开；历史版本显示未评估 |
| 2026-07-17 | Web 文件夹发布只在浏览器本地生成确定性 TAR.GZ | 文件夹是作者输入便利能力，不应扩展服务端上传协议或上传无关本地内容 | 一个文件夹对应一个 Skill，根目录必须有 SKILL.md；仍复用单次归档发布 API |
| 2026-07-17 | G11.1 使用 0.1.13 原生 linux/amd64 全量离线包交付 | 目标是让用户在真实离线 Linux 环境验证 G11 风险分级与文件夹上传，不能复用旧镜像或只交付源码 | 完整包通过 Linux 容器解包、两层 SHA、安装脚本、种子与 Apple xattr 检查；目标主机验收仍待用户执行 |

## 22. 当前状态摘要

- Plan document: `G11.1_READY_FOR_OFFLINE_LINUX_VALIDATION`
- Overall status: `G11.1_READY_FOR_OFFLINE_LINUX_VALIDATION_WITH_BASELINE_BLOCKERS`
- Current Gate: `G11.1_READY_FOR_OFFLINE_LINUX_VALIDATION`
- Implementation started: `yes`
- Runtime validation started: `yes`
- Docker runtime available on current machine: `yes`（aarch64 默认 profile 与 x86_64 G9 验证 profile）。
- Completion allowed: `no`（G11 scoped 验收已完成；当前分支既有 annotation/AppRuntime guard 和 Word visual-QA 断言基线仍失败）。
- Next action: 在目标离线 Linux 主机校验并部署 0.1.13 完整包，执行真实风险 Skill 与文件夹上传验收；仓库总签收仍需另行处理既有 guard/Word 基线。
