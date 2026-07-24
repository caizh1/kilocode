# 待开发事项

本文件是当前项目跨 session 的统一待开发事项台账。后续 session 发现明确、可执行且决定延期的开发项时，必须在此新增或更新记录；重复事项更新原记录，不重复创建。

状态统一使用：`待开发`、`进行中`、`已完成`、`取消`。事项完成或取消后保留历史记录，只更新状态和结果。

普通代码 TODO、当前 session 内的临时步骤、推测性风险和证据不足的问题不进入本台账。

## DEV-001：ChipMate Server 自签名或私有 CA 的插件级证书信任

- 状态：`待开发`
- 记录日期：2026-07-22
- 模块：`packages/kilo-vscode`、`packages/opencode/src/kilocode`
- 背景：ChipMate Server 切换 HTTPS 后，如果服务器使用自签名证书或企业私有 CA，用户目前需要在实际运行扩展宿主的 Windows、macOS、Linux 或 Remote-SSH 环境中预先配置证书信任。期望允许用户在插件内确认指定远端证书，同时不降低其他 HTTPS 连接的安全性。
- 目标：为 ChipMate Server 提供按精确 `https://host:port` 隔离的证书探测、用户确认、持久信任和撤销能力，使用户无需全局关闭 TLS 校验即可使用受信任的自签名或私有 CA 服务。

### 验收标准

- 常规受公共 CA 信任的 HTTPS 服务保持现有行为，不出现额外弹窗。
- 仅在 ChipMate Server 因证书不受信任而连接失败时执行证书探测；探测阶段不得发送 API Key、文档、更新请求或其他业务数据。
- 弹窗展示精确服务器地址、证书主体、颁发者、有效期和 SHA-256 指纹，并提供“仅本次信任”“永久信任”“取消”。
- 永久信任按精确 `host:port` 保存为当前机器专属状态，不跨机器同步，也不扩展到其他服务器。
- 域名或 IP 与证书 SAN 不匹配、证书已过期或尚未生效时必须阻断，不得提供绕过选项。
- 已信任证书的指纹发生变化时必须阻断连接并重新确认，不能静默更新信任记录。
- 不得使用 `NODE_TLS_REJECT_UNAUTHORIZED=0` 或其他进程级、系统级全局关闭证书校验的方案。
- 信任策略覆盖 ChipMate Server 健康检查、Marketplace 普通请求与 SSE、自动更新 Manifest 与 VSIX 下载、Word/Mermaid 独立 CLI 请求，避免出现部分功能成功、部分功能仍报证书错误。
- 提供查看和撤销已信任证书的入口；撤销后下一次连接必须重新执行标准证书校验。
- 自动更新路径仍需执行现有同源 URL、扩展身份、大小和 SHA-256 校验，证书信任不能绕过任何更新包验证。
- Windows、macOS、Linux 和 Remote-SSH 至少覆盖相关单元测试；发布前必须在目标 Windows 安装态完成真实连接验证。

### 风险与约束

- 首次信任属于 TOFU 模型；弹窗必须提示用户通过管理员提供的可信渠道核对 SHA-256 指纹。
- 扩展宿主和独立 CLI 是两个请求运行时，必须共用同一份受限信任决策，不能只修复“测试连接”路径。
- 自动更新、Marketplace API Key 和文档渲染内容属于高敏感路径，任何未经指纹确认的连接都不得发送这些数据。
- 私有 CA 签发的服务器通常不会发送根 CA；实现需要明确区分服务器叶子证书固定与用户导入 CA PEM，不能假设可以从远端自动取得可信根证书。

### 完成记录

待开发。完成时在此补充实现摘要、验证环境、执行命令和已知限制。

## DEV-002：部署 ChipMate 插件一键发布闭环到当前 Server

- 状态：`待开发`
- 记录日期：2026-07-22
- 模块：`server/chipmate-word-render`
- 背景：一键上传、owner 绑定、动态 schema v2 manifest、下架回退和客户端自动安装已在当前工作区与隔离 VS Code Profile 验证。当前本机 `6001` 服务运行自只读参考仓库 `/Users/archer/Work/opencode`，本工作区没有目标 Linux/Docker 主机或获授权的部署入口，因此本次未替换该进程。
- 目标：获得明确部署目标后，按离线镜像安装流程升级当前 ChipMate Server，并完成旧 `chipmate.chipmate` owner 的一次性绑定。

### 验收标准

- 目标主机完成数据库备份和 schema 9 迁移，现有 Skill、插件产物、收藏与下载数据保持可用。
- 设置 `EXTENSION_MARKET_ENABLED=1`，并仅在迁移阶段配置一次 `EXTENSION_OWNER_BINDINGS_JSON`。
- 真实服务的 `/health`、`/api/v1/status`、`/packages/manifest.json`、Mermaid 与既有 Skill 市场回归通过。
- 使用发布者账号上传各平台 VSIX 后，动态 manifest 立即出现相应 target；下载内容与 SHA-256 一致，无需复制文件、维护 `latest.json` 或重启服务。
- 使用非 owner 账号验证上传、重复上传和下架均被拒绝；owner 下架后 manifest 回退到剩余最高版本。

### 完成记录

待部署。需要明确目标 Linux/Docker 主机与部署入口后执行。
