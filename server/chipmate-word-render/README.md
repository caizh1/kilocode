# ChipMate Word / Mermaid Render Server

这是 ChipMate 可使用的独立渲染与内网分发服务。它将需要桌面或 Linux 原生工具的工作放到一台 Docker 主机中执行，ChipMate 扩展只通过 HTTP 调用服务，不在 VSIX 内捆绑 LibreOffice、Poppler 或 Chromium。

项目当前保留 `chipmate-word-render` 的镜像名、服务名和兼容 API，以保持与已有 ChipMate/ChipMate 配置及离线部署脚本兼容；迁入 ChipMate 并不意味着它已经改名或完成产品身份迁移。

## 作用与边界

### 1.2.2 LDAP 连接修复

相较 1.2.1，修复 `ldapts@8.2.0` 将非空 `tlsOptions` 解释为隐式 TLS 的兼容问题：Unencrypted 不再发送 TLS 握手；StartTLS 先建立普通连接再显式升级；LDAPS 保持直接 TLS 和原证书校验设置。真实本地 TCP/TLS 回归覆盖这三种方式、不受信证书拒绝、升级失败不降级，以及应急登录后的管理测试接口。真实 Microsoft AD 的网页测试与登录仍需在目标机升级后验收；本次不改变扩展版本或 LDAP 配置值。

服务默认监听 `6001`，包含七类能力：

| 能力 | 用途 | 关键依赖 |
|---|---|---|
| Word 渲染 | 通过受控 UNO 刷新原生目录字段，再把 DOCX 转为 PDF 和逐页 PNG，供聊天预览或文档检查使用。 | LibreOffice、python3-uno、Poppler |
| Mermaid 渲染 | 在 Chromium 中离线加载 Mermaid，将图表导出为裁剪后的 PNG。 | Chromium、Mermaid |
| 离线包分发 | 从挂载的 `/packages` 目录提供 VSIX 下载，并扫描生成更新清单。 | Node、JSZip |
| 内部 Skill Market | 读取、分发或写入 skill 压缩包和目录清单；通过 Server LDAP 身份识别上传者。 | Node、本地卷、Microsoft AD |
| Skill Market Web | 提供首页、目录、详情、发布、个人状态、聚合分析与服务诊断的同源 React 应用。 | Vite 构建产物、Fastify 静态路由 |
| VS Code 插件市场 | 结构校验、目录导入、Web 上传、手动 VSIX 下载、评价与聚合分析；不执行扩展代码。 | SQLite、Yauzl、本地可写卷、LDAP 身份 |
| Embedded Review 规则包 | 确定性解析团队编码规范 DOCX，保存不可变 RulePack 并发布当前版本。 | JSZip、本地可写卷、LDAP 身份 |

它不是 ChipMate 的主服务，也不会替代 `chipmate serve`。它是扩展配置的远端渲染端点和内网文件服务。

## 目录说明

```text
server/chipmate-word-render/
├── apps/api/                    # Fastify API、身份、SQLite 启动和 Web 静态托管
├── apps/web/                    # React + Vite Skill Market Web
├── packages/                    # contracts、market-db Worker 与 Skill validator
├── scripts/refresh-word-fields.py # 禁止宏和外部链接更新的 LibreOffice UNO 字段刷新器
├── server.js                    # 冻结的 Word/Mermaid/legacy compatibility core
├── Dockerfile                   # 多阶段 linux/amd64 构建与运行镜像定义
├── package.json                 # Node 运行时依赖和服务版本
├── install-render-server.sh     # 目标 Linux 主机的离线镜像安装脚本
├── build-offline-bundle.mjs     # 将内置运行时的镜像和预置 skills 组合成离线交付包
└── README.md
```

`node_modules/`、`out/`、Docker 镜像归档和校验文件是生成物，不随源码迁移或提交。首次开发或打包时按下面的步骤生成即可。

## HTTP 接口

| 方法和路径 | 说明 |
|---|---|
| `GET /health` | 返回工具探测结果、可用接口和能力状态；这是部署后的首要检查。 |
| `POST /render/word` | 接收 `filename`、`docxBase64` 和可选 `timeoutMs`，返回 PDF、逐页 PNG、字段刷新状态和目录计数。仅在 UNO 刷新后标题、Heading、drawing、目录条目及数字页码全部验证通过时返回 `updatedDocxBase64`；无目录返回 `not-required`。 |
| `POST /render/mermaid` | 接收 `source`、可选 `filename`、`scale`（1–4）和 `timeoutMs`，返回裁剪后的 PNG 和尺寸信息。 |
| `GET /packages/manifest.json` | 扫描包目录内的 VSIX，生成 schema v2 更新清单；按内部发行目标返回版本、SHA-256、大小、下载 URL 与 `latestByTarget`。 |
| `GET /packages/runtimes/deepseek-harness/manifest.json` | 返回固定的 DeepSeek Harness 运行时清单；不依赖插件市场开关。 |
| `GET /packages/runtimes/deepseek-harness/<version>/<target>/<sha256>.zip` | 按内容哈希分发不可变运行时，支持完整下载与 Range。 |
| `GET /packages/<file>` | 下载包目录中的文件，路径越界会被拒绝。 |
| `GET /marketplace/skills` | 返回 ChipMate 兼容的 Skill Market 目录，下载链接被规范化为同源 URL。 |
| `GET /marketplace/manifest.json` | 返回 Skill Market 的概要与告警。 |
| `GET /marketplace/skills/<id>.tar.gz` | 下载一个 skill 的归档，并增加下载计数。 |
| `GET /marketplace/skills/<id>/files` | 返回 skill 的文件列表，供客户端安装流程使用。 |
| `POST /marketplace/skills`、`POST /marketplace/skills/<id>/stars` | 已废止的旧写接口；返回 `410 client-upgrade-required`。 |
| `POST /auth/new-api/resolve-user` | 已废止；返回 `410 client-upgrade-required`。 |
| `POST /api/v1/auth/session`、`GET/DELETE /api/v1/auth/session` | LDAP 用户名/密码网页登录，以及当前会话读取和退出。 |
| `POST /api/v1/auth/device/code`、`device/approve`、`device/token` | VS Code 浏览器设备码登录；LDAP 密码只进入 Server 网页。 |
| `POST /api/v1/auth/token/refresh`、`token/revoke` | 插件访问令牌轮换与撤销。 |
| `GET/PUT /api/v1/admin/auth/ldap`、`POST /api/v1/admin/auth/ldap/test` | 测试、保存和读取脱敏后的 LDAP 配置。 |
| `GET/POST/DELETE /api/v1/admin/auth/identity-mappings` | 把 AD `objectGUID` 显式映射到历史本地用户。 |
| `GET/POST/DELETE /api/v1/admin/auth/session` | 验证管理权限、创建或退出应急管理会话。 |
| `GET/POST /api/v1/admin/auth/admins`、`DELETE /api/v1/admin/auth/admins/:subject` | 查询、授予和撤销 Server 本地管理员。 |
| `POST /api/v1/admin/auth/admins/resolve` | 查询待授权的唯一 LDAP 身份，授权前核对不可变标识。 |
| `GET /api/v1/capabilities` | 发现 aligned-v1 版本、catalogVersion 与能力开关。 |
| `GET /api/v1/skills` | SQLite/FTS 目录、筛选、排序和游标分页。 |
| `GET /api/v1/skills/<id>/releases/<revision>/archive` | 下载不可变 Skill 归档；文件名固定为 `<skill-id>-r<revision>.tar.gz`，拒绝 Range，并仅在完整 `GET 200` 响应结束后原子增加一次下载量。 |
| `POST /api/v1/publications` | 运行统一校验、快照修复、安全扫描和不可变 revision 发布。 |
| `POST /api/v1/events/batch` | 接收最多 100 条假名化行为事件并异步聚合。 |
| `GET /api/v1/analytics/overview` | 返回登录用户可见的全局日聚合。 |
| `GET /api/v1/analytics/skills/:id` | 仅向 Skill 作者返回自己的漏斗。 |
| `GET /api/v1/market/stream` | SSE 状态同步，支持 `Last-Event-ID` 与 `catalogVersion` 补偿。 |
| `GET /api/v1/extensions`、`GET /api/v1/extensions/:id` | 浏览 VS Code 插件目录与版本、平台、SHA 构建详情。 |
| `POST /api/v1/extension-publications` | 使用 Web Session、CSRF 和幂等键流式上传单个 VSIX；单包上限 512 MiB，使用实例级并发、磁盘预留和超时保护，不设用户小时限额。 |
| `GET /api/v1/extensions/:id/artifacts/:artifactId/download` | 手动下载指定构建；拒绝 Range，仅在完整响应结束后计数。 |
| `GET /api/v1/analytics/extensions/overview` | 返回公开、匿名的插件市场聚合分析。 |
| `POST /api/v1/review-rule-packs` | 上传 DOCX 草稿；必须提供 `x-rulepack-version`，且登录名必须在 `REVIEW_RULE_PUBLISHERS` 中。 |
| `POST /api/v1/review-rule-packs/:hash/publish` | 原子切换当前已发布 RulePack；历史包保持不可变。 |
| `GET /api/v1/review-rule-packs/latest` | 返回 Review 启动时应固定的最新已发布 RulePack；服务不可用时客户端将规范轨标为 `NOT_EVALUATED`。 |
| `GET /`、`/skills`、`/publish`、`/me`、`/analytics`、`/status` | 同源 Web 应用与安全响应头。 |
| `GET /extensions`、`/extensions/:id`、`/extensions/publish`、`/extensions/me`、`/extensions/analytics` | VS Code 插件市场 Web 路由。 |

默认限制包括 50 MiB DOCX、512 KiB Mermaid 源码、最多 500 页 Word、128 MiB PDF、256 MiB 页面 PNG、384 MiB JSON 响应、50 MiB 总 skill 上传量和 120 秒渲染超时。不要仅靠客户端限制来放宽这些边界；如有必要，应审查 `server.js` 中的对应环境变量和资源风险后再改。

Skill 发布以 `SKILL.md` frontmatter 的合法 `name` 作为标准 ID；兼容的 frontmatter `id` 或 `skill.json.id` 如存在，必须与其一致。发布后的数据库 ID、归档唯一根目录、`SKILL.md name` 与 `skill.json.id` 必须完全一致。只有缺少身份字段时才回退到唯一包装目录；无身份且根结构歧义的归档会被拒绝，`examples/`、`references/`、`scripts/` 等内部资源目录不会被推导为 Skill ID。

Review 规则包上传上限为 20 MiB，持久化目录默认为 `/data/review-rules`。部署时必须在受限环境文件中用逗号分隔配置 `REVIEW_RULE_PUBLISHERS`；未配置时读接口仍可用，但所有上传和发布操作都会拒绝。插件只读取已发布包，规则内容不随 VSIX 打包。

Word 字段刷新以 `MacroExecutionMode=NEVER_EXECUTE` 和 `UpdateDocMode=NO_UPDATE` 隐藏打开文档，不更新外部链接，并跳过 DDE、数据库和脚本字段。Docker 镜像通过 fontconfig 将 `Microsoft YaHei` 映射到 `Noto Sans CJK SC`；`GET /health` 的 `microsoftYaHeiMatch` 必须显示该实际匹配字体。

插件发布页可一次选择任意数量的多文件、文件夹、ZIP、TAR.GZ 或 TGZ。浏览器先在本地递归扫描，并只把其中的 VSIX 逐个发送到上述发布接口；归档本身和无关文件不会上传。清单自动拆成每组最多 20 个、合计不超过 10 GiB 的逻辑批次并串行上传，嵌套归档不会递归展开。

## 本地开发

前置条件：Node.js 24 或更高版本；若要执行实际 Word/Mermaid 渲染，还需安装并能在 `PATH` 中找到 `soffice`（或 `libreoffice`）、`pdftoppm` 和 Chromium/Chrome。

```bash
cd /Users/archer/Work/chipmate/server/chipmate-word-render
npm install
npm run dev
```

另开一个终端做最小验证：

```bash
curl -fsS http://127.0.0.1:6001/health

curl -fsS -X POST http://127.0.0.1:6001/render/mermaid \
  -H 'content-type: application/json' \
  --data '{"source":"flowchart TD\nA[Start] --> B[Done]","filename":"smoke.mmd","scale":2}'
```

Word 接口需要 Base64 编码的真实 `.docx`，示例负载为：

```json
{
  "filename": "example.docx",
  "docxBase64": "<base64-encoded-docx>",
  "timeoutMs": 120000,
  "maxPages": 500
}
```

## 构建 Linux x86-64 离线镜像

Docker 镜像是服务的核心可交付物。Dockerfile 第一阶段安装完整 workspace 依赖、检查生成契约并构建 Web；第二阶段只安装运行依赖和系统渲染工具。Web 构建失败会直接终止镜像构建。以下命令从源码生成一个供离线 Linux Docker 主机导入的 `linux/amd64` 镜像归档及 SHA-256 文件：

```bash
cd /Users/archer/Work/chipmate/server/chipmate-word-render

VERSION=$(node -p 'require("./package.json").version')
IMAGE="chipmate-word-render:${VERSION}"
ARCHIVE="chipmate-word-render-${VERSION}-linux-amd64.docker.tar.gz"

CHIPMATE_DSH_RUNTIME_CATALOG=/path/to/dsh-runtimes/manifest.json npm run runtime:seed
docker build --pull --no-cache --platform linux/amd64 -t "$IMAGE" .
docker save "$IMAGE" | gzip -9 > "$ARCHIVE"
shasum -a 256 "$ARCHIVE" > "${ARCHIVE}.sha256"
```

构建前先做轻量静态检查：

```bash
node --check server.js
node --check build-offline-bundle.mjs
```

在 Apple Silicon Mac 上必须保留 `--platform linux/amd64`；它会通过 Docker 的跨架构构建能力产出面向 x86-64 Linux 的镜像。若 Docker daemon 不可用，静态检查可以通过，但镜像构建和运行验证尚未完成，不能当作打包成功。

生成后至少检查文件与归档元数据：

```bash
shasum -a 256 -c "${ARCHIVE}.sha256"
gzip -t "$ARCHIVE"
```

## 生成包含预置 skills 的完整离线交付包

`build-offline-bundle.mjs` 会把已经内置 Windows/Linux DeepSeek Harness 运行时的 Docker 归档、安装脚本，以及 ChipMate 仓库 `.chipmate/skills/` 中的 `source-backed-detail-design` 和 `documents` 组合到 `out/chipmate-server-offline-<version>-linux-amd64.tar.gz`。运行时不会在离线包外层重复保存；脚本总是按当前 Docker 归档重新计算内外层校验文件。执行前必须已经完成上一节的镜像归档构建：

```bash
node build-offline-bundle.mjs
```

不要把这一步的 `out/` 产物或 Docker 归档提交到 Git；它们是给离线交付的二进制产物。脚本使用 Python 的 `tarfile` 清除 macOS xattr，交付前仍应检查外层和嵌套归档不含 Apple 扩展属性：

```bash
gzip -dc "out/chipmate-server-offline-${VERSION}-linux-amd64.tar.gz" \
  | strings \
  | rg 'com\\.apple|LIBARCHIVE\\.xattr|SCHILY\\.xattr|AppleDouble|__MACOSX'
```

命令没有输出才符合 Linux 可移交的预期。

## 在离线 Linux Docker 主机安装

将以下文件复制到目标机同一目录：

- `chipmate-word-render-<version>-linux-amd64.docker.tar.gz`
- `chipmate-word-render-<version>-linux-amd64.docker.tar.gz.sha256`
- `install-render-server.sh`
- （可选）完整交付包解压出的 `packages/skill-market/`

然后执行：

```bash
sha256sum -c chipmate-word-render-<version>-linux-amd64.docker.tar.gz.sha256
chmod +x install-render-server.sh
./install-render-server.sh chipmate-word-render-<version>-linux-amd64.docker.tar.gz
curl -fsS http://127.0.0.1:6001/health
```

安装脚本会先校验同目录 `.sha256`（如存在），再导入镜像，把镜像内置的 DeepSeek Harness 运行时逐个校验并原子合并到宿主机 package root，最后以 `--restart unless-stopped` 启动容器。合并只新增或替换当前内容寻址文件和 manifest，不删除旧运行时。默认把宿主机 `/home/share/chipmate/packages` 只读挂载为 `/packages`，把 `/home/share/chipmate/data/skill-market` 和 `/home/share/chipmate/data/review-rules` 分别可写挂载为 `/data/skill-market` 与 `/data/review-rules`，避免升级丢失市场和规则发布状态。升级前会把现有 `skills.json`、归档、SQLite、legacy-latest 和整个 `extensions/` 复制到带 UTC 时间戳的备份目录。预置 `source-backed-detail-design` 与 `documents` 只替换其受管归档和元数据，同时保留用户自建 skill、现有下载数与收藏数。可按部署环境覆盖服务名、端口和宿主机目录：

```bash
PORT=6001 \
SERVICE_NAME=chipmate-word-render \
PACKAGE_ROOT_ON_HOST=/srv/chipmate/packages \
SKILL_MARKET_ROOT_ON_HOST=/srv/chipmate/skill-market \
REVIEW_RULE_ROOT_ON_HOST=/srv/chipmate/review-rules \
BACKUP_ROOT_ON_HOST=/srv/chipmate/backups \
./install-render-server.sh ./chipmate-word-render-<version>-linux-amd64.docker.tar.gz
```

安装脚本首次运行会在宿主机数据目录的 `auth/` 下生成 `master.key` 和 `break-glass.key`，权限设为 `0600`，并分别只读挂载到容器。主密钥用于 AES-256-GCM 加密 Bind 密码；break-glass 只允许配置认证、历史身份映射及管理员授权，不代表普通市场身份。脚本只输出文件路径，不输出密钥内容。可用 `AUTH_SECRET_ROOT_ON_HOST` 或两个具体文件变量覆盖位置。生产部署应设置 `CHIPMATE_PUBLIC_BASE_URL=https://<server>`；覆盖升级会保留该地址及市场、规则配置，但不会继承任何 `NEW_API_*` 人员认证变量。

首次上线后由运维取得宿主机 `break-glass.key`，打开不在公共导航中的 `/admin/login`，完成应急登录后进入 `/admin/auth`，测试并保存 Microsoft AD BindDN 配置。保存成功才递增认证版本并启用配置，同时撤销旧网页、插件及应急会话。Bind 密码只写不读。选择 `Unencrypted` 时必须显式确认风险，且 `/status` 会持续显示告警；生产环境建议在域控条件允许时切换 STARTTLS 或 LDAPS。

管理员改由 Server 本地名单管理，LDAP Admin Filter 仅保留旧配置、不再参与授权。首次设置及从数据库 v10 升级时名单均为空，不会根据 LDAP 标记或用户名自动授权。配置保存后重新进入 `/admin/login`，在“管理员管理”输入 LDAP 用户名，查询并核对目录 DN、邮箱、不可变身份和市场账号 ID，再点击“确认授予管理员”。被授权用户重新使用 LDAP 登录后才显示“认证设置”入口，并可继续授权其他管理员；系统禁止撤销名单中的最后一人。应急登录有效期为 15 分钟，可主动退出。

管理员权限绑定 AD `objectGUID`，不会因同名用户或历史市场账号重新映射而转移。角色与映射变更会撤销受影响身份的旧 Web、访问／刷新令牌和待兑换设备授权，但不会改写插件的上传者或作品归属。升级前备份整个市场数据目录（包含 SQLite 及其 WAL），停止服务后制作一致性备份；本次迁移保留历史业务数据并清除旧认证会话，回滚需使用升级前镜像及对应完整备份，不应只替换数据库文件。

插件市场在镜像和全新安装中默认关闭。覆盖升级未显式传 `EXTENSION_MARKET_ENABLED` 时，安装脚本会保留旧容器的开关状态，避免升级意外关闭或开放插件路由；需要变更时必须显式传入 `EXTENSION_MARKET_ENABLED=0` 或 `1`。默认扫描周期为 `EXTENSION_DROP_SCAN_MS=5000`。上传资源保护默认值为 `EXTENSION_UPLOAD_MAX_ACTIVE=20`、`EXTENSION_UPLOAD_MIN_FREE_BYTES=2147483648`、`EXTENSION_UPLOAD_IDLE_MS=60000`、`EXTENSION_UPLOAD_MAX_MS=7200000`，可在受限权限的 `ENV_FILE` 中调整。默认宿主机目录如下：

```text
/home/share/chipmate/data/skill-market/extensions/
├── drop/       # 运维人员复制 VSIX；稳定两轮后自动导入
├── artifacts/  # Web 上传的内容寻址产物
└── .tmp/       # 上传临时文件，失败、取消或超限后清理
```

只需把 `.vsix` 复制到 `drop/`。建议先复制为非 `.vsix` 临时文件，完成后原子重命名；删除 `drop/` 中的文件会自动下架该系统导入来源。无效文件保留在原位，具体结构告警可在 `/status` 查看。服务只做 ZIP/manifest/版本/体积等结构校验，不执行扩展，也不进行代码、签名或病毒审计。

## ChipMate 接入

部署成功后，将 ChipMate 的如下设置指向服务基础地址，例如 `http://<server-ip>:6001`：

- `chipmate.v2.documents.wordRender.remoteEndpoint`
- `chipmate.v2.documents.mermaidRender.remoteEndpoint`

内网 VSIX 更新使用动态的 `GET /packages/manifest.json`。日常发布只需登录 ChipMate Server 的插件上传页并上传各平台 VSIX；Server 会解析扩展 ID、SemVer、大小、SHA-256 和 `chipmatePackageTarget`，把网页市场存储中的原始文件直接纳入更新候选，不复制到 `/packages`，不生成 `latest.json`，也不需要重启。官方 `chipmate.chipmate` 包必须带以下内部发行目标之一：`win32-x64-baseline`、`linux-x64-baseline`、`darwin-x64` 或 `darwin-arm64`。

扩展 ID 首次成功上传时绑定当前 Server 登录身份。后续只有原始发布者可以上传或下架；同版本、同 target、不同 SHA-256 会返回 `EXTENSION_VERSION_CONFLICT`，Server 不会自动覆盖或删除任何一方。下架后动态 manifest 立即回退到该 target 的剩余最高版本，已安装客户端不会自动降级。

旧只读 `/packages` 目录仍作为兼容来源并与网页产物合并。升级已有系统记录时，可在受限环境文件中临时设置一次 `EXTENSION_OWNER_BINDINGS_JSON`，先把扩展 ID 绑定到历史本地用户，再在 `/admin/auth` 将该本地用户显式映射到 LDAP 用户；绑定成功后即可移除环境设置。旧 `/packages` 文件仍保持原下载 URL，数据库网页产物使用 `/packages/artifacts/<artifactId>.vsix` 直接流式下载。

当前自更新扩展 ID 固定为 `chipmate.chipmate`，且不改变 publisher、name、SecretStorage key 或配置命名空间。发布后应访问真实 `/packages/manifest.json` 确认 target、版本、SHA-256 和下载 URL。

Skill Market 的宿主机目录结构如下：

```text
<package-root>/
└── skill-market/
    ├── skills.json
    └── skills/
        └── <skill-id>.tar.gz
```

`skills.json` 可以是数组或 `{ "items": [...] }`。每个条目至少应有安全的 `id`；`content` 可以是 `skills/<skill-id>.tar.gz`。服务对外会把该字段转换为同源的 `/marketplace/skills/<skill-id>.tar.gz`。

可写市场操作统一使用 LDAP 网页会话或设备码签发的短期访问令牌。Provider、Embedding 和 Rerank 的 API Key 仍只用于模型服务，不参与人员登录，也不会被市场功能读取或发送。

## 修改与交付检查清单

1. 修改 `server.js`、`Dockerfile` 或依赖后，更新 `package.json` 中由发布者决定的版本号。
2. 执行 `node --check server.js` 和 `node --check build-offline-bundle.mjs`。
3. 构建新的 `linux/amd64` 镜像，并验证 `.sha256` 与 `gzip -t`。
4. 在真实 Linux Docker 主机执行 `install-render-server.sh`，检查 `/health`、Mermaid 渲染；涉及 Word 时再用真实 DOCX 验证 `/render/word`。
5. 验证 `/api/v1/status`、Web `/`、`/packages/manifest.json`、legacy `/marketplace/manifest.json` 和 aligned `/api/v1/skills` 的实际响应。
6. 仅交付生成的归档；提交代码时排除 `node_modules/`、`out/`、镜像归档、校验文件和运行日志。

## 常见问题

- `/health` 失败：先查看容器日志 `docker logs --tail 100 chipmate-word-render`，确认 Chromium、LibreOffice、python3-uno、Poppler 和 CJK 字体映射已在镜像中。
- Mermaid 返回 `mermaid-runtime-missing`：检查镜像内的 `npm install --omit=dev` 是否成功，及 `node_modules/mermaid` 是否存在。
- Word 渲染超时：确认 DOCX 大小、`RENDER_TIMEOUT_MS`、LibreOffice 和 `pdftoppm` 可用性；不要无上限提高超时或响应大小。
- Word 返回 `fieldRefreshStatus: failed`：查看 `fieldRefreshDiagnostics`。服务会继续渲染原始 DOCX，但不会返回一个未经标题、Heading、drawing 和真实目录页码验证的 `updatedDocxBase64`。
- `/packages/manifest.json` 未发现网页上传包：确认插件市场已启用、扩展 ID 为 `chipmate.chipmate`、上传者是 owner，并且包内 `chipmatePackageTarget` 是允许的内部目标；旧系统包仍检查只读 `/packages` 根目录。
- Skill Market 为空：检查 `skill-market/skills.json` 的 JSON 格式、归档是否位于 `skill-market/skills/`，再访问 `/marketplace/manifest.json` 查看告警。
- 登录返回 `AUTH_NOT_CONFIGURED`：使用 break-glass 打开 `/admin/login`，进入认证设置并完成 LDAP 测试和保存。
- 普通账号看不到“认证设置”：这是正常权限限制。通过 `/admin/login` 应急入口明确授权管理员；若已授权，请重新登录。姓名相同不能证明是同一身份，应核对不可变目录标识。
- 登录返回 `RATE_LIMITED`：同一来源和用户名连续失败次数过多；按 `Retry-After` 等待，并检查域账号密码与禁用状态。
- 旧插件返回 `client-upgrade-required`：Server 不提供 New API Key 认证回退，需升级到支持浏览器设备码登录的 VSIX。
- 内网 HTTP 打开 Skill Market 后白屏且控制台提示 `crypto.randomUUID is not a function`：这是 0.1.6 Web 在非 localhost HTTP 下的兼容问题；升级到 0.1.7 或更高版本。0.1.7 使用 `crypto.getRandomValues` 安全生成 fallback UUID，不要求为了该问题关闭浏览器安全策略。

认证配置、令牌和设备码只在 SQLite 中保存密文或哈希；日志不得记录 LDAP 密码、Bind 密码、Cookie、访问令牌、刷新令牌或 break-glass 内容。
