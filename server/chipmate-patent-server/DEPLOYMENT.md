# ChipMate Patent Server 内网部署手册

本离线包适用于 Linux x86-64（amd64）专用主机。包内包含固定版本的 Patent Server、PostgreSQL、OpenSearch、Nginx 镜像和官方 Docker Compose 客户端，但不包含任何专利语料。

## 部署前提

- 已安装并启动 Docker Engine。
- 主机至少 8 核、32 GiB 内存；数据盘容量必须按真实样本测算。
- 数据盘应容纳全部原始包、规范化数据库、两代检索索引和 30% 余量。
- 管理员已取得相应地区专利数据的合法使用授权。
- HTTPS 证书和私钥由公司 PKI 签发并保存在目标主机。

先配置 OpenSearch 所需内核参数：

```bash
sudo sysctl -w vm.max_map_count=262144
echo 'vm.max_map_count=262144' | sudo tee /etc/sysctl.d/99-chipmate-patent.conf
```

## 校验和配置

解压后先校验整个部署目录：

```bash
tar -xzf chipmate-patent-server-offline-0.1.2-linux-amd64.tar.gz
cd chipmate-patent-server-offline-0.1.2-linux-amd64
sha256sum -c MANIFEST.sha256
cp .env.example .env
chmod 600 .env
```

必须修改 `.env` 中以下配置：

- `POSTGRES_PASSWORD`：高强度随机密码。
- `OPENSEARCH_INITIAL_ADMIN_PASSWORD`：高强度随机密码；即使当前关闭 OpenSearch 安全插件也不要保留示例值。
- `PATENT_DATA_ROOT_HOST`：专利数据盘的绝对路径。
- `PATENT_ALLOWED_CIDRS`：批准访问的公司网段。
- `PATENT_EMBEDDING_ENDPOINT` 和对应 API Key：内网 OpenAI-compatible embedding 服务。
- `PATENT_RERANK_MODE` 固定为 `off`：当前版本以 RRF 混合召回分数作为唯一排序真源，不配置也不调用 rerank 服务。

中国单地区局部语料试运行还需要：

```dotenv
PATENT_JURISDICTIONS=CN
PATENT_ALLOW_INCOMPLETE_CORPUS_SEARCH=1
```

该开关只允许检索不完整语料，服务状态仍为 `DEGRADED`，Patent Radar 会关闭正面结论。完成中国历史全量、法律状态、向量与重排验收后再恢复正式门禁配置。

生产环境建议启用 HTTPS：

```dotenv
PATENT_BIND_ADDRESS=0.0.0.0
PATENT_ENABLE_HTTPS=1
PATENT_HTTPS_PORT=6020
PATENT_TLS_CERT=/etc/chipmate-patent/tls/server.crt
PATENT_TLS_KEY=/etc/chipmate-patent/tls/server.key
```

证书和私钥路径必须是宿主机绝对路径；主机防火墙仍应只允许批准网段访问 6020。

## 安装和验证

安装脚本会验证包内清单、镜像归档、主机架构、内核参数及镜像架构，再创建数据目录并启动服务：

```bash
sudo ./script/install-linux.sh
```

HTTP 本机部署验证：

```bash
curl -fsS http://127.0.0.1:6020/health
curl -fsS http://127.0.0.1:6020/api/v1/corpus/status
```

HTTPS 部署验证：

```bash
curl --cacert /公司CA证书路径/ca.crt https://服务器域名:6020/health
curl --cacert /公司CA证书路径/ca.crt https://服务器域名:6020/api/v1/corpus/status
```

首次部署后语料状态应为 `EMPTY` 或 `DEGRADED`，不能据此开展正面新颖性判断。只有六地区真实历史基线、连续增量和完整性门禁均通过后，服务才会进入可检索状态。

## 导入授权语料

把官方数据包及其 manifest 复制到 `.env` 中 `PATENT_DATA_ROOT_HOST` 指向目录的 `drop/`。复制完成后，常驻导入进程会等待文件连续两轮稳定再开始处理。

```bash
sudo cp /受控介质/CN-fulltext-2026-01.zip /srv/chipmate-patent/drop/
sudo cp /受控介质/CN-fulltext-2026-01.zip.manifest.json /srv/chipmate-patent/drop/
```

检查导入状态和完整性：

```bash
./tools/docker-compose --env-file .env -f compose.yaml exec -T patent-ingest node dist/src/cli.js verify
curl -fsS http://127.0.0.1:6020/api/v1/corpus/status
```

不要执行 `docker compose down -v`，也不要手工删除 `raw/`、PostgreSQL 或当前 generation。失败批次会进入 `quarantine/`，旧在线 generation 保持不变。

## 接入 ChipMate 1.2.7

Patent Server 健康检查和语料导入完成后，在 ChipMate 1.2.7 打开“设置 → 专利中心”，填写只读 API 地址：

```text
https://内网Patent-Server域名:6020
```

本机回环测试可以使用 `http://127.0.0.1:6020`；跨机器访问必须使用公司 HTTPS 证书，并让客户端地址属于 `PATENT_ALLOWED_CIDRS`。保存后先执行连接检查，再运行 Patent Radar。局部周包只用于链路验证，结果应保持 `insufficient-evidence`。
