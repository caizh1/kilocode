# ChipMate Word / Mermaid Render Server

这是 Kilo Code 可使用的独立渲染与内网分发服务。它将需要桌面或 Linux 原生工具的工作放到一台 Docker 主机中执行，Kilo Code 扩展只通过 HTTP 调用服务，不在 VSIX 内捆绑 LibreOffice、Poppler 或 Chromium。

项目当前保留 `chipmate-word-render` 的镜像名、服务名和兼容 API，以保持与已有 ChipMate/Kilo Code 配置及离线部署脚本兼容；迁入 Kilo Code 并不意味着它已经改名或完成产品身份迁移。

## 作用与边界

服务默认监听 `6001`，包含六类能力：

| 能力 | 用途 | 关键依赖 |
|---|---|---|
| Word 渲染 | 把调用方提交的 DOCX 转为 PDF 和逐页 PNG，供聊天预览或文档检查使用。 | LibreOffice、Poppler |
| Mermaid 渲染 | 在 Chromium 中离线加载 Mermaid，将图表导出为裁剪后的 PNG。 | Chromium、Mermaid |
| 离线包分发 | 从挂载的 `/packages` 目录提供 VSIX 下载，并扫描生成更新清单。 | Node、JSZip |
| 内部 Skill Market | 读取、分发或写入 skill 压缩包和目录清单；可选地通过 New API key 识别上传者。 | Node、本地卷、可选 New API |
| Skill Market Web | 提供首页、目录、详情、发布、个人状态、聚合分析与服务诊断的同源 React 应用。 | Vite 构建产物、Fastify 静态路由 |
| VS Code 插件市场 | 结构校验、目录导入、Web 上传、手动 VSIX 下载、评价与聚合分析；不执行扩展代码。 | SQLite、Yauzl、本地可写卷、可选 New API |

它不是 Kilo Code 的主服务，也不会替代 `kilo serve`。它是扩展配置的远端渲染端点和内网文件服务。

## 目录说明

```text
server/chipmate-word-render/
├── apps/api/                    # Fastify API、身份、SQLite 启动和 Web 静态托管
├── apps/web/                    # React + Vite Skill Market Web
├── packages/                    # contracts、market-db Worker 与 Skill validator
├── server.js                    # 冻结的 Word/Mermaid/legacy compatibility core
├── Dockerfile                   # 多阶段 linux/amd64 构建与运行镜像定义
├── package.json                 # Node 运行时依赖和服务版本
├── install-render-server.sh     # 目标 Linux 主机的离线镜像安装脚本
├── build-offline-bundle.mjs     # 将镜像和预置 skills 组合成离线交付包的辅助脚本
└── README.md
```

`node_modules/`、`out/`、Docker 镜像归档和校验文件是生成物，不随源码迁移或提交。首次开发或打包时按下面的步骤生成即可。

## HTTP 接口

| 方法和路径 | 说明 |
|---|---|
| `GET /health` | 返回工具探测结果、可用接口和能力状态；这是部署后的首要检查。 |
| `POST /render/word` | 接收 `filename`、`docxBase64` 和可选 `timeoutMs`，返回 PDF、逐页 PNG 与渲染信息。文件名必须以 `.docx` 结尾。 |
| `POST /render/mermaid` | 接收 `source`、可选 `filename`、`scale`（1–4）和 `timeoutMs`，返回裁剪后的 PNG 和尺寸信息。 |
| `GET /packages/manifest.json` | 扫描包目录内的 VSIX，生成 schema v2 更新清单；按内部发行目标返回版本、SHA-256、大小、下载 URL 与 `latestByTarget`。 |
| `GET /packages/<file>` | 下载包目录中的文件，路径越界会被拒绝。 |
| `GET /marketplace/skills` | 返回 Kilo 兼容的 Skill Market 目录，下载链接被规范化为同源 URL。 |
| `GET /marketplace/manifest.json` | 返回 Skill Market 的概要与告警。 |
| `GET /marketplace/skills/<id>.tar.gz` | 下载一个 skill 的归档，并增加下载计数。 |
| `GET /marketplace/skills/<id>/files` | 返回 skill 的文件列表，供客户端安装流程使用。 |
| `POST /marketplace/skills` | 上传 skill 文件清单；需要 `Authorization: Bearer <New API key>`。 |
| `POST /marketplace/skills/<id>/stars` | 对 skill 点赞；同样需要 New API key。 |
| `POST /auth/new-api/resolve-user` | 使用 New API 管理端配置反查调用方身份，只返回用户信息，不返回原始密钥。 |
| `GET /api/v1/capabilities` | 发现 aligned-v1 版本、catalogVersion 与能力开关。 |
| `GET /api/v1/skills` | SQLite/FTS 目录、筛选、排序和游标分页。 |
| `POST /api/v1/publications` | 运行统一校验、快照修复、安全扫描和不可变 revision 发布。 |
| `POST /api/v1/events/batch` | 接收最多 100 条假名化行为事件并异步聚合。 |
| `GET /api/v1/analytics/overview` | 返回登录用户可见的全局日聚合。 |
| `GET /api/v1/analytics/skills/:id` | 仅向 Skill 作者返回自己的漏斗。 |
| `GET /api/v1/market/stream` | SSE 状态同步，支持 `Last-Event-ID` 与 `catalogVersion` 补偿。 |
| `GET /api/v1/extensions`、`GET /api/v1/extensions/:id` | 浏览 VS Code 插件目录与版本、平台、SHA 构建详情。 |
| `POST /api/v1/extension-publications` | 使用 Web Session、CSRF 和幂等键流式上传 VSIX；单包上限 512 MiB。 |
| `GET /api/v1/extensions/:id/artifacts/:artifactId/download` | 手动下载指定构建；拒绝 Range，仅在完整响应结束后计数。 |
| `GET /api/v1/analytics/extensions/overview` | 返回公开、匿名的插件市场聚合分析。 |
| `GET /`、`/skills`、`/publish`、`/me`、`/analytics`、`/status` | 同源 Web 应用与安全响应头。 |
| `GET /extensions`、`/extensions/:id`、`/extensions/publish`、`/extensions/me`、`/extensions/analytics` | VS Code 插件市场 Web 路由。 |

默认限制包括 50 MiB DOCX、512 KiB Mermaid 源码、50 MiB 总 skill 上传量和 120 秒渲染超时。不要仅靠客户端限制来放宽这些边界；如有必要，应审查 `server.js` 中的对应环境变量和资源风险后再改。

## 本地开发

前置条件：Node.js 24 或更高版本；若要执行实际 Word/Mermaid 渲染，还需安装并能在 `PATH` 中找到 `soffice`（或 `libreoffice`）、`pdftoppm` 和 Chromium/Chrome。

```bash
cd /Users/archer/Work/kilocode/server/chipmate-word-render
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
  "timeoutMs": 120000
}
```

## 构建 Linux x86-64 离线镜像

Docker 镜像是服务的核心可交付物。Dockerfile 第一阶段安装完整 workspace 依赖、检查生成契约并构建 Web；第二阶段只安装运行依赖和系统渲染工具。Web 构建失败会直接终止镜像构建。以下命令从源码生成一个供离线 Linux Docker 主机导入的 `linux/amd64` 镜像归档及 SHA-256 文件：

```bash
cd /Users/archer/Work/kilocode/server/chipmate-word-render

VERSION="$(node -p \"require('./package.json').version\")"
IMAGE="chipmate-word-render:${VERSION}"
ARCHIVE="chipmate-word-render-${VERSION}-linux-amd64.docker.tar.gz"

docker build --platform linux/amd64 -t "$IMAGE" .
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

`build-offline-bundle.mjs` 会把已生成的 Docker 归档、安装脚本，以及 Kilo 仓库 `.kilo/skills/` 中的 `source-backed-detail-design` 和 `documents` 组合到 `out/chipmate-server-offline-<version>-linux-amd64.tar.gz`。执行前必须已经完成上一节的镜像归档构建：

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

安装脚本会先校验同目录 `.sha256`（如存在），再导入镜像并以 `--restart unless-stopped` 启动容器。默认把宿主机 `/home/share/chipmate/packages` 只读挂载为 `/packages`，把 `/home/share/chipmate/data/skill-market` 单独可写挂载为 `/data/skill-market`，避免只读父挂载与可写子挂载互相遮蔽。升级前会把现有 `skills.json`、归档、SQLite、legacy-latest 和整个 `extensions/` 复制到带 UTC 时间戳的备份目录。可按部署环境覆盖服务名、端口和宿主机目录：

```bash
PORT=6001 \
SERVICE_NAME=chipmate-word-render \
PACKAGE_ROOT_ON_HOST=/srv/kilo/packages \
SKILL_MARKET_ROOT_ON_HOST=/srv/kilo/skill-market \
BACKUP_ROOT_ON_HOST=/srv/kilo/backups \
./install-render-server.sh ./chipmate-word-render-<version>-linux-amd64.docker.tar.gz
```

如需启用 New API 身份解析，将配置放入目标机受限权限的环境文件并用 `ENV_FILE=/path/to/render.env` 传入。至少需要 `NEW_API_BASE_URL`；服务优先使用当前用户 key 调用 New API 只读 token usage 接口。旧 New API 不支持该接口时，才使用 `NEW_API_ADMIN_ACCESS_TOKEN` 和 `NEW_API_USER_ID` 进入管理接口兼容回退。安装脚本不会把环境文件复制进镜像或交付包；覆盖升级未显式传 `ENV_FILE` 时，会从旧容器继承 `NEW_API_*`、`EXTENSION_MARKET_*` 和 `EXTENSION_DROP_*`，不会输出这些值。

插件市场在镜像和安装脚本中默认关闭。首次升级保持 `EXTENSION_MARKET_ENABLED=0`，完成 `/health`、`/api/v1/status` 和既有 Skill/渲染回归后，再以 `EXTENSION_MARKET_ENABLED=1 ./install-render-server.sh <同一归档>` 重启启用；默认扫描周期为 `EXTENSION_DROP_SCAN_MS=5000`。安装脚本不会从旧容器继承已启用状态，因此升级不会意外提前开放插件路由。默认宿主机目录如下：

```text
/home/share/chipmate/data/skill-market/extensions/
├── drop/       # 运维人员复制 VSIX；稳定两轮后自动导入
├── artifacts/  # Web 上传的内容寻址产物
└── .tmp/       # 上传临时文件，失败、取消或超限后清理
```

只需把 `.vsix` 复制到 `drop/`。建议先复制为非 `.vsix` 临时文件，完成后原子重命名；删除 `drop/` 中的文件会自动下架该系统导入来源。无效文件保留在原位，具体结构告警可在 `/status` 查看。服务只做 ZIP/manifest/版本/体积等结构校验，不执行扩展，也不进行代码、签名或病毒审计。

## Kilo Code 接入

部署成功后，将 Kilo Code 的如下设置指向服务基础地址，例如 `http://<server-ip>:6001`：

- `kilo.documents.wordRender.remoteEndpoint`
- `kilo.documents.mermaidRender.remoteEndpoint`

内网 VSIX 更新使用 `GET /packages/manifest.json`；把已验证的完整 VSIX 原子放入宿主机包目录即可：先上传为临时文件，再校验并重命名为 `.vsix`。服务每次请求都会扫描目录，不需要重启容器或维护手写 `latest.json`。它只会纳入 `extension/package.json` 中扩展 ID 为固定值 `chipmate.chipmate`、并带有有效 `chipmatePackageTarget` 的内部发行包：`win32-x64-baseline`、`linux-x64-baseline`、`darwin-x64` 或 `darwin-arm64`。

使用仓库的发布辅助脚本可完成临时上传、远端 SHA-256 校验与同目录原子重命名：

```bash
./publish-vsix.sh ./chipmate-<version>-win32-x64-baseline.vsix user@render-host /home/share/chipmate/packages
```

脚本不会改动容器，也不会生成 `latest.json`；发布后仍应访问真实的 `/packages/manifest.json` 确认清单项。

当前扩展 ID 固定为 `chipmate.chipmate`，且不改变 publisher、name、SecretStorage key 或配置命名空间。把已验证的 VSIX 放到只读 packages 卷后，必须以真实 `/packages/manifest.json` 响应确认目标、版本、SHA-256 和下载 URL。

Skill Market 的宿主机目录结构如下：

```text
<package-root>/
└── skill-market/
    ├── skills.json
    └── skills/
        └── <skill-id>.tar.gz
```

`skills.json` 可以是数组或 `{ "items": [...] }`。每个条目至少应有安全的 `id`；`content` 可以是 `skills/<skill-id>.tar.gz`。服务对外会把该字段转换为同源的 `/marketplace/skills/<skill-id>.tar.gz`。

可写 Skill Market 和“New API key 反查用户”在设置 `NEW_API_BASE_URL` 后启用直接 token identity 解析。仅旧 New API 兼容回退需要同时设置 `NEW_API_ADMIN_ACCESS_TOKEN` 和 `NEW_API_USER_ID`。将敏感值通过 Docker secret、受限环境文件或部署系统注入；绝不要把实际地址、管理员令牌或用户 ID 写进本仓库的 README、源码、测试或镜像标签。

## 修改与交付检查清单

1. 修改 `server.js`、`Dockerfile` 或依赖后，更新 `package.json` 中由发布者决定的版本号。
2. 执行 `node --check server.js` 和 `node --check build-offline-bundle.mjs`。
3. 构建新的 `linux/amd64` 镜像，并验证 `.sha256` 与 `gzip -t`。
4. 在真实 Linux Docker 主机执行 `install-render-server.sh`，检查 `/health`、Mermaid 渲染；涉及 Word 时再用真实 DOCX 验证 `/render/word`。
5. 验证 `/api/v1/status`、Web `/`、`/packages/manifest.json`、legacy `/marketplace/manifest.json` 和 aligned `/api/v1/skills` 的实际响应。
6. 仅交付生成的归档；提交代码时排除 `node_modules/`、`out/`、镜像归档、校验文件和运行日志。

## 常见问题

- `/health` 失败：先查看容器日志 `docker logs --tail 100 chipmate-word-render`，确认 Chromium、LibreOffice 和 Poppler 已在镜像中。
- Mermaid 返回 `mermaid-runtime-missing`：检查镜像内的 `npm install --omit=dev` 是否成功，及 `node_modules/mermaid` 是否存在。
- Word 渲染超时：确认 DOCX 大小、`RENDER_TIMEOUT_MS`、LibreOffice 和 `pdftoppm` 可用性；不要无上限提高超时或响应大小。
- `/packages/manifest.json` 未发现包：确认 VSIX 位于挂载的包根目录，且其 `publisher.name` 为 `chipmate.chipmate`，并且包内 `chipmatePackageTarget` 是允许的内部目标。
- Skill Market 为空：检查 `skill-market/skills.json` 的 JSON 格式、归档是否位于 `skill-market/skills/`，再访问 `/marketplace/manifest.json` 查看告警。
- 登录或上传返回 `token-resolver-disabled`：`NEW_API_BASE_URL` 未设置；如果目标 New API 不支持直接 token usage 接口，还需要补齐 admin fallback 的另外两项配置。
- 登录返回 `new-api-rate-limited` 或日志出现 `new-api-http-429`：New API 正在限流。0.1.8 会合并同一 key 的并发解析，不会在 429 后切换分页参数重试；停止重复点击并等待上游 `Retry-After` 后再试。
- 内网 HTTP 打开 Skill Market 后白屏且控制台提示 `crypto.randomUUID is not a function`：这是 0.1.6 Web 在非 localhost HTTP 下的兼容问题；升级到 0.1.7 或更高版本。0.1.7 使用 `crypto.getRandomValues` 安全生成 fallback UUID，不要求为了该问题关闭浏览器安全策略。

身份解析日志使用统一前缀和同一次解析的短 `requestId`：

```bash
docker logs --since 10m chipmate-word-render 2>&1 \
  | grep '\[new-api-token-resolver\]'
```

重点事件依次为 `resolve.start`、`config.ready`、`upstream.request.start/finish`、`direct.identity.result/error`、可选的 `admin.fallback.start` 与 `admin.catalog.*`，最后是 `resolve.failure` 和 `resolve.finish`。日志只包含固定 endpoint 名、层级、状态码、耗时、分页计数、候选序号、Retry-After 和结果码；不会记录用户 API Key、Authorization、admin token、完整 URL/query 或 key hash。
