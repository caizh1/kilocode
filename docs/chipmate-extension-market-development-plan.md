# ChipMate VS Code 插件市场开发账本

> 状态：`G9_LOCAL_COMPLETE_DEPLOYMENT_PENDING`
> 视觉基线：用户批准的 8 张桌面设计稿；上传进度页使用已纠正的“上传 VS Code 插件”版本。
> 发布策略：单次协调发布，`EXTENSION_MARKET_ENABLED=0` 默认关闭，完成部署验收后启用。

## 不变量

- 在 `server/chipmate-word-render` 内扩展，共用身份、SQLite、SSE 和 Web 外壳，不新建服务。
- `/` 继续是技能市场；插件市场使用 `/extensions` 路由族。
- `/health`、Word/Mermaid 渲染、packages manifest、Skill Market 与旧客户端契约不得回归。
- 插件只做 VSIX 结构校验，不执行扩展代码，不做代码、签名或病毒审计。
- 匿名浏览、下载和查看公开分析；登录用户可以上传、收藏和评价。
- 单个 VSIX 上传上限 512 MiB；批次最多 20 个且合计不超过 10 GiB；用户上传每小时最多 100 次；下载完成后才计数；不支持 Range。
- 任意登录用户可以补版本；只有首位 Web 上传者可以删除对应产物；系统导入由 `drop/` 文件控制。
- 插件页面统一使用“ChipMate Market / VS Code 插件 / 发布插件”，不得复用技能审核文案。

## Gate 状态

| Gate | 内容 | 状态 | 证据/备注 |
|---|---|---|---|
| G0 | 账本与设计基线 | COMPLETE | 8 张批准稿已归档；上传页使用纠正文案版本 |
| G1 | SQLite 与文件存储 | COMPLETE | Schema v6、Worker、内容寻址产物与删除审计已落地 |
| G2 | VSIX 解析与 drop 导入 | COMPLETE | 流式 ZIP 校验、稳定扫描、删除下架与告警状态已覆盖 |
| G3 | 上传和明显进度条 | COMPLETE | XHR 真实进度、SSE 状态机、取消清理、限流与幂等已完成 |
| G4 | 目录、详情和下载 | COMPLETE | `/extensions` 路由族、冲突选择、Range 拒绝和完成计数已完成 |
| G5 | 收藏、评价和个人中心 | COMPLETE | 一人一评、编辑删除、收藏与产物所有权已完成 |
| G6 | 分析与服务状态 | COMPLETE | 公开分析、私有来源桶、保留策略和运行状态已完成 |
| G7 | VS Code CTA | COMPLETE | 仅增加浏览器入口，不下载、安装或追踪 VSIX |
| G8 | 本地测试与视觉验收 | COMPLETE | 已通过真实 macOS Chrome 三视口验收，无 P0/P1/P2 |
| G9 | 批量上传与能力缓存修复 | COMPLETE | 多文件、文件夹、ZIP/TAR.GZ 本地过滤；能力 ETag 随开关变化 |
| DEPLOY | Linux 部署与开关启用 | PENDING | 尚未获得/操作目标宿主机；功能保持默认关闭 |

## 锁定实现

- 容器目录：`/data/skill-market/extensions/{drop,artifacts,.tmp}`。
- 默认宿主机导入目录：`/home/share/chipmate/data/skill-market/extensions/drop/`。
- 插件 ID 为规范化 `publisher.name`；产物身份为 `(extensionId, version, target, sha256)`。
- 完全重复 SHA 返回已有产物且不增加上传者；同版本、同平台、不同 SHA 并存并强制下载前选择确认。
- 最高 SemVer（含预发布）作为默认版本；目标平台必须显式选择；兼容性警告不阻止下载。
- 评价为 1–5 分必填、纯文本评论可选且不超过 2000 字；不实现回复、举报或审核。
- VS Code 端只增加“在浏览器中打开 VS Code 插件市场”入口。

## 每个 Gate 的完成记录

### G0：账本与设计基线

- 改动摘要：归档 8 张批准稿到 `.runtime/design-qa/references/extension-market/`，插件页面统一纠正为“ChipMate Market / VS Code 插件 / 发布插件 / 上传 VS Code 插件”。
- 真实证据：批准稿 `06-upload-progress-corrected.png` 是上传中间态的视觉基线；状态卡和弹窗只作为交互状态出现。
- 已知限制：设计稿和本地截图位于 `.runtime/`，不属于生产运行文件。

### G1–G2：数据、文件与 VSIX 导入

- 改动摘要：SQLite Worker 升级至 schema v6；新增插件、产物、来源、发布任务、收藏、评价、下载事件、日聚合和审计模型。新增 VSIX 流式解析器与 `drop/` 稳定扫描器。
- 测试结果：覆盖规范化 `publisher.name`、SemVer/预发布排序、完全重复、同版本不同 SHA、元数据重算、危险路径、缺失 manifest、压缩炸弹、非法版本、临时文件清理、导入新增/删除/重新导入和无效文件告警清除。
- 已知限制：只做结构合法性校验，不执行扩展代码，不做签名、代码质量或病毒审计。

### G3：上传与发布状态

- 改动摘要：使用单次 XHR 流式上传与 `upload.onprogress`；显著进度条显示百分比、字节、平滑速度、ETA 和取消动作；服务端通过 SSE 推送校验、发布和终态。
- 测试结果：覆盖 CSRF、取消/失败清理、客户端任务 ID 幂等、完全重复与冲突构建；G9 将滚动一小时限额调整为 100 次并增加边界回归。
- 真实证据：`server/chipmate-word-render/.runtime/design-qa/evidence/extension-market/09-extension-upload-progress-1484x1060.png`。
- 已知限制：Playwright 拦截上传时不会产生连续的网络上传事件，因此自动截图停在 0%；中间百分比视觉以批准稿为准，生产 XHR 进度回调和几何由功能测试单独验证。

### G4–G6：目录、下载、社交与分析

- 改动摘要：完成目录、详情、上传、个人中心、公开分析和状态页面；实现目标平台显式选择、冲突构建风险确认、完整 SHA 展示、Range 拒绝、响应 `finish` 后计数、收藏、一人一评、上传者删除和来源桶聚合。
- 测试结果：覆盖第二用户补版本、重复上传不转移删除权、评价构建归属、越权删除、单构建下载、Range 416、完成下载计数、增长/最近活动和来源统计。
- 已知限制：不实现评价回复、举报、审核后台、自动过滤、自动安装或安装追踪。

### G7：VS Code 入口

- 改动摘要：现有 Marketplace Panel 在服务声明 `extensions` 能力时显示“在浏览器中打开 VS Code 插件市场”，打开配置市场源的 `/extensions?source=vscode`。
- 测试结果：VS Code 类型检查、lint、10 个 Marketplace 单元测试、Knip 和 `check-kilocode-change` 全部通过。
- 已知限制：扩展内没有 VSIX 下载、安装、升级或安装状态追踪。

### G8：本地回归与视觉验收

- 执行命令：`npm run check`、`npm run build`、`bash -n install-render-server.sh`、真实 Chrome Playwright、VS Code `typecheck`、`lint`、目标单测、`knip` 和 `check-kilocode-change`。
- 测试结果：服务端 API 26/26、Web 10/10、Contracts 4/4、Market DB 3/3、Skill Spec 11/11；真实 Chrome 5/5；VS Code Marketplace 10/10；生产构建成功。
- 真实证据：`design-qa.md` 的“ChipMate VS Code 插件市场 Design QA”及 `server/chipmate-word-render/.runtime/design-qa/evidence/extension-market/`；视口为 `1484×1060`、`1440×1024`、`1050×1024`，无 P0/P1/P2。
- 回归结论：既有 `/health`、Word/Mermaid、packages manifest、Skill Market、旧客户端兼容链路测试通过。

### DEPLOY：待执行

- 当前状态：代码、本地契约、自动化测试和真实 Chrome 视觉验收完成；未执行目标 Linux 宿主机部署、数据库/`extensions/` 备份、真实复制 VSIX 到 `/home/share/chipmate/data/skill-market/extensions/drop/` 或生产开关启用。
- 部署顺序：先以 `EXTENSION_MARKET_ENABLED=0` 升级并验证既有服务，再备份数据库和整个 `extensions/`，复制真实 VSIX 验证导入，最后以 `EXTENSION_MARKET_ENABLED=1` 重启启用。
- 回滚边界：关闭 `EXTENSION_MARKET_ENABLED`；不回滚或删除 Skill Market、渲染服务及已有数据。

### G9：批量上传与能力缓存修复

- 改动摘要：能力 ETag 改为完整能力响应的稳定 SHA-256 摘要；上传页支持多文件、递归文件夹、ZIP、TAR.GZ 和 TGZ 的浏览器本地扫描，先展示可选清单，再按顺序逐个复用现有单 VSIX 发布 API。普通文件、链接、设备节点、归档本体和归档内非 VSIX 不产生发布请求；能力请求失败时显示真实错误。
- 安全与资源边界：每批最多 20 个 VSIX、合计不超过 10 GiB、单个不超过 512 MiB；归档最多 100,000 个条目且展开不超过 10 GiB；拒绝危险路径、异常压缩比和无法支持的加密 ZIP；不递归嵌套归档；同时只物化一个待上传 VSIX。
- 队列行为：每项使用独立 run ID、幂等键、XHR 上传进度和既有 SSE 状态；单项失败或 429 不阻断后续项；取消会终止当前 XHR 和剩余队列，已成功发布不回滚；失败项可单独重试。服务端限额调整为每用户滚动一小时 100 个 VSIX。
- 测试结果：`npm run check` 通过 64 个包级测试（API 27、Web 19、Contracts 4、DB 3、Skill Spec 11），类型检查、lint、生成契约校验和 `npm run build` 全部通过。真实安装版 macOS Chrome 的批量网络边界测试与视觉测试通过；首页 INP 隔离复跑 3/3 通过。
- 网络证据：Playwright 拦截确认 ZIP、TAR.GZ、文件夹内普通文件和其他无关字节从未作为发布请求发送，只有筛选后的 VSIX 逐项进入 `POST /api/v1/extension-publications`。
- 视觉证据：`server/chipmate-word-render/.runtime/design-qa/evidence/extension-market/08-extension-upload-review-1484x1060.png`、`09-extension-upload-progress-1484x1060.png`、`extension-upload-idle-1440x1024.png` 和 `extension-upload-idle-1050x1024.png`；无 P0/P1/P2。
- 已知限制：仅验收桌面 Chromium；嵌套归档不递归；TAR.GZ/TGZ 依赖现代 Chromium 的 `DecompressionStream`。完整旧 Skill Market 只读旅程仍有一个与本次改动无关的硬编码文件大小断言（期望 16.0 KB，当前种子为 17.9 KB），G9 相关测试不受影响。
- 状态：本地实现和验收完成；目标 Linux 部署、备份、真实 `drop/` 导入及生产开关启用仍归属 `DEPLOY`，保持待执行。
