# ChipMate Patent Server

ChipMate Patent Server 是独立部署的内网专利语料和只读检索服务。它只保存公开专利数据，不接收 ChipMate 工作区源码、设计文档、候选创新点或人工评审记录。

## 组件边界

- PostgreSQL 保存规范化专利、不可变历史版本、导入批次和 generation 状态。
- OpenSearch 保存当前可检索 generation，提供字段化全文和可选向量检索。
- 可选内网 Rerank 服务对 BM25 与向量融合后的前 100 条结果重排；失败时响应明确降级告警。
- `patent-api` 只提供匿名只读接口，没有导入、删除或索引切换路由。
- `patent-ingest` 仅在容器内部监视宿主机 `drop/`，不暴露端口。
- 原始包按 SHA-256 保存在 `raw/`；发布失败不会切换在线 generation。

## 目录

```text
/srv/chipmate-patent/
├── drop/        # 管理员复制新包
├── raw/         # 按 SHA-256 保存的不可变原始内容
├── processed/   # 已处理的 drop 文件
├── quarantine/  # 未通过完整性门禁的 drop 文件
├── reports/     # 中文导入报告
├── work/        # 临时工作目录
├── postgres/    # PostgreSQL 数据
└── opensearch/  # OpenSearch 数据
```

## 数据包识别

系统支持 XML、JSON、JSONL、NDJSON、Gzip 以及包含这些文件的 ZIP/TAR 系列归档。XML 解析器覆盖 ST.36 常用的 `patent-document`、`exchange-document`，并已适配 CNIPA V2.2.1 实际数据中的 `PatentDocumentAndRelated`、驼峰 reference、`Paragraphs` 和嵌套 `ClaimText`，可读取公开号、申请号、权利要求、说明书、摘要、IPC、申请人和发明人。

文件名包含独立的 `CN`、`JP`、`KR`、`US`、`EP` 或 `RU` 片段时会自动推导地区和批次。官方文件名无法可靠推导时，在数据包旁放置 `<文件名>.manifest.json`；格式见 `examples/`。

自动推导的包一律标记为 `supplemental`，只能补充数据，不能让语料进入 `READY`。每个地区完成历史全量导入后，必须由管理员用 manifest 明确标记一个 `historical-baseline` 批次，并同时提供 `periodStart`、`periodEnd` 和 `declaredRecords`；后续 `incremental` 批次必须提供连续 `sequence`。缺少任一地区历史基线或批次覆盖水位时，服务保持 `DEGRADED` 并默认拒绝检索，防止少量样例数据误开正面结论。

CNIPA 外层周包可能是分卷 ZIP，内部再包含多个最多约 2000 件专利的 ZIP。首版导入器接收已经完成分卷合并后得到的内部 ZIP，不直接接收 `.z01` 等外层分卷；禁止把缺少最终 `.zip` 的未完成分卷集交给导入器。即使真实子包导入成功，也不能在未完成历史全量、增量连续性和法律状态验收时声称中国或六地区语料已经建成。

## 中国单地区试运行

仅验证中国语料和 Patent Radar 链路时，可在 `.env` 中显式配置：

```dotenv
PATENT_JURISDICTIONS=CN
PATENT_ALLOW_INCOMPLETE_CORPUS_SEARCH=1
```

`PATENT_JURISDICTIONS=CN` 只改变完整性门禁的目标地区和 API 可检索地区，不会把样例或局部周包变成历史基线。`PATENT_ALLOW_INCOMPLETE_CORPUS_SEARCH=1` 只允许从 `DEGRADED` generation 返回试运行召回结果；响应水位和警告保持不完整状态，Patent Radar 必须输出 `insufficient-evidence` 并关闭正面结论。正式环境完成语料验收后应把该开关恢复为 `0`。

## 防误删和防覆盖

每个包依次执行：

1. 连续两轮检查大小和修改时间，未复制完成的文件不读取。
2. 计算 SHA-256 并保存不可变原始副本。
3. 相同哈希幂等跳过；相同批次 ID、不同哈希直接隔离。
4. 新内容只写 `patent_document_versions`，不覆盖历史版本。
5. 关键字段、声明记录数、增量序号和记录下降量必须通过检查。
6. 构建独立 OpenSearch generation，并核对索引记录数。
7. 只有全部通过后才切换 PostgreSQL active pointer；失败时旧 generation 继续服务。
8. 官方显式删除保存为软删除版本，原历史仍可重建。

原始区按 `raw/<哈希前两位>/<完整 SHA-256>/` 保存 `payload.<格式>` 与不可变 `manifest.json`。灾难恢复到空 PostgreSQL/OpenSearch 后，可把全部原始包重新排入 `drop/`：

```bash
docker compose exec patent-ingest node dist/src/cli.js requeue-raw
# 也可以只重排一个包：requeue-raw <完整 SHA-256>
```

该命令使用排他创建，不覆盖 `drop/` 中已有文件；执行前应保证目标数据库是本次计划恢复的正确实例。

## 本地开发

```bash
cd /Users/archer/Work/kilocode/server/chipmate-patent-server
npm install
npm run check
```

启动完整依赖：

```bash
cp .env.example .env
# 修改 .env 中的密码、公司网段和内网模型端点
docker compose up -d --build
curl -fsS http://127.0.0.1:6020/health
curl -fsS http://127.0.0.1:6020/api/v1/corpus/status
```

Linux 主机需要先设置 `vm.max_map_count=262144`。生产环境固定使用 PostgreSQL `17.11` 和 OpenSearch `3.8.0`，不得改用 `latest`。

## 导入

复制文件后，常驻 `patent-ingest` 会自动发现：

```bash
cp /受控介质/CN-fulltext-2026-01.zip /srv/chipmate-patent/drop/
```

也可以在服务目录手动执行：

```bash
docker compose exec patent-ingest node dist/src/cli.js scan
docker compose exec patent-ingest node dist/src/cli.js verify
```

不要使用 `docker compose down -v`，该命令会删除持久卷。服务没有数据清理命令；容量治理必须先确认原始包和 PostgreSQL 可重建性。

## 只读 API

- `GET /health`
- `GET /api/v1/capabilities`
- `GET /api/v1/corpus/status`
- `POST /api/v1/search`
- `POST /api/v1/documents/batch`
- `GET /api/v1/documents/:publicationNumber`
- `GET /api/v1/families/:familyId`

检索请求正文不会写入访问日志。API 默认只绑定 `127.0.0.1`；内网开放时显式设置公司网段、`PATENT_BIND_ADDRESS`，并用 `compose.https.yaml` 和公司证书启用 HTTPS：

```bash
docker compose --env-file .env -f compose.yaml -f compose.https.yaml up -d
```

OpenSearch 和 PostgreSQL 不映射宿主机端口，只存在于内部 Docker 网络中。HTTPS 代理启动时会校验 `PATENT_ALLOWED_CIDRS`，并据此生成唯一的客户端 allowlist；不再存在需要手工同步的固定网段副本。主机防火墙仍应只允许批准网段访问 6020。
`patent-api` 与 `patent-ingest` 额外挂接受控出站 bridge，用于访问环境变量配置的内网 embedding/rerank 服务；PostgreSQL 与 OpenSearch 不挂该网络。生产主机仍应通过防火墙把出站目标限制为已批准的内网模型地址。

## 离线交付

联网构建机执行：

```bash
./script/build-offline-bundle.sh
```

脚本会先运行源码检查，再把 Patent Server、PostgreSQL、OpenSearch 和 Nginx 固定版本的 Linux x86-64 镜像、官方 Compose 客户端、配置、安装脚本和中文部署手册写入同一离线部署包。包内文件与 Docker 镜像归档分别带 SHA-256 门禁。目标 Linux 主机按 `DEPLOYMENT.md` 配置 `.env` 后，使用 `sudo ./script/install-linux.sh` 安装。

目标机可在执行安装脚本前设置 `PATENT_MIN_FREE_BYTES`，把样本测算后的最低可用字节数变成硬门禁；设置 `PATENT_ENABLE_HTTPS=1` 时安装脚本同时启用 `compose.https.yaml`。安装脚本会拒绝 `vm.max_map_count < 262144` 的主机，并根据 `.env` 中的 `PATENT_DATA_ROOT_HOST` 设置各容器数据目录所有权。
