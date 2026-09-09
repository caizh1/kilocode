# ChipMate Patent Server 0.1.2 内网部署顺序

本目录包含 Patent Server 0.1.2 Linux amd64 离线包和一份 2000 件中国发明专利申请全文试运行数据。该数据只用于跑通 Patent Radar 链路，不是中国历史全量库，也不包含完整法律状态。

## 1. 校验 U 盘文件

```bash
cd /U盘挂载路径/ChipMate-Patent-0.1.2
sha256sum -c chipmate-patent-server-offline-0.1.2-linux-amd64.tar.gz.sha256
sha256sum -c chipmate-cn-patent-data-20231003-1-001.tar.gz.sha256
```

## 2. 部署 Patent Server

```bash
sudo mkdir -p /opt/chipmate-patent
sudo tar -xzf chipmate-patent-server-offline-0.1.2-linux-amd64.tar.gz -C /opt/chipmate-patent
cd /opt/chipmate-patent/chipmate-patent-server-offline-0.1.2-linux-amd64
sha256sum -c MANIFEST.sha256
sudo cp .env.example .env
sudo chmod 600 .env
sudo editor .env
```

至少修改 `.env` 中的数据库密码、数据盘路径、公司网段和内网模型端点。试运行数据必须设置：

```dotenv
PATENT_JURISDICTIONS=CN
PATENT_ALLOW_INCOMPLETE_CORPUS_SEARCH=1
```

随后启动：

```bash
sudo sysctl -w vm.max_map_count=262144
echo 'vm.max_map_count=262144' | sudo tee /etc/sysctl.d/99-chipmate-patent.conf
sudo ./script/install-linux.sh
curl -fsS http://127.0.0.1:6020/health
```

生产内网跨机器访问应按包内 `DEPLOYMENT.md` 配置公司 HTTPS 证书；不要用明文 HTTP 跨主机传输检索请求。

## 3. 一键导入 2000 件试运行专利

```bash
cd /U盘挂载路径/ChipMate-Patent-0.1.2
sudo tar -xzf chipmate-cn-patent-data-20231003-1-001.tar.gz -C /opt/chipmate-patent
cd /opt/chipmate-patent/chipmate-cn-patent-data-20231003-1-001
sha256sum -c MANIFEST.sha256
sudo ./import-patents.sh /opt/chipmate-patent/chipmate-patent-server-offline-0.1.2-linux-amd64
```

脚本会暂停常驻导入器、双重校验数据、原子入队、要求 2000 条全部接受并恢复服务。成功后检查：

```bash
curl -fsS http://127.0.0.1:6020/api/v1/corpus/status
```

局部语料显示 `DEGRADED` 属于预期结果，Patent Radar 必须给出 `insufficient-evidence`，不能据此声称没有现有专利冲突。

## 4. 接入 ChipMate 1.2.7

打开 ChipMate 的“设置 → 专利中心”，填写：

```text
https://内网Patent-Server域名:6020
```

保存并执行连接检查。只有服务器本机临时验证可以使用 `http://127.0.0.1:6020`。
