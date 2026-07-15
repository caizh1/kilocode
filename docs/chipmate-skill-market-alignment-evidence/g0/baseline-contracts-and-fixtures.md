# G0 基线、兼容契约与真实夹具

记录时间：2026-07-12（Asia/Shanghai）

## Git 基线

- Branch：`codex/v7.3.42-dev`
- HEAD：`d567827207018deef65cf0af450cd9ecd7325835`
- 上游：`origin/codex/v7.3.42-dev`
- tracked unstaged changes：88 个文件
- staged changes：0 个文件
- untracked entries：25 个
- 完整 `git status --porcelain=v1 -uall` 快照：`git-status-20260712.txt`
- 快照 SHA-256：`a4af3db64dc41155b52ac53bae93a9f51ae7e2e533636f0ebb97dc2c66c0b22a`

实施约束：上述改动均视为实施前既有工作。后续 Gate 只修改本计划明确列出的目标路径；提交、打包和最终签收前重新按路径审计，不覆盖、不清理、不混入无关改动。

## Render Service 源码冻结清单

目标目录：`server/chipmate-word-render`

| 文件 | G0 SHA-256 | 作用 |
|---|---|---|
| `.gitignore` | 未纳入源码哈希门禁 | 忽略本地依赖和生成物 |
| `Dockerfile` | `5a572dde7ab3c5cd1a359ea8ce757641b4b4b69cbd5c570ab9f47c13173b0d95` | Node 20、Chromium、LibreOffice、Poppler 运行镜像 |
| `README.md` | `cf1ef3c64f87f781728f34ee49c9a6735208d4b195fff869c8b298cbe00b70d4` | 当前部署、兼容 API 和离线交付说明 |
| `build-offline-bundle.mjs` | `11350fd6b7fe852cd67319ff1b4041c4922500614e07be566ec66ccc39ef09d6` | 离线包生成 |
| `install-render-server.sh` | `6dbe5aa6a29e9c832c0affd834fbfd5e44adaac0161250c62cab1f03fd75d459` | Linux Docker 安装 |
| `package.json` | `1b5a315acc0c6d3404721cc20438d9df6b10760a9543cc6861df4abc33851cc9` | 0.1.6 依赖清单 |
| `server.js` | `cd801aa2593d1facad065ae90c4917479f515d336adfec6846ab590ba22e73aa` | 1,755 行单体 HTTP、渲染、包和市场实现 |

`packages/` 在 G0 时只是空目录，不是已实现的 workspace package。G1 必须从显式 npm workspace 骨架开始，不能把空目录当作已有实现。

## Legacy API 冻结清单

除非后续 Gate 在兼容测试中证明可选追加字段不破坏旧客户端，下列方法、路径、关键请求字段、成功状态码和关键响应字段不得删除、重命名或改变语义。

| 方法与路径 | 请求契约 | 成功响应契约 | 兼容要求 |
|---|---|---|---|
| `GET /` | 无 | 与 `/health` 相同 | 保留现有健康探测别名 |
| `GET /health` | 无 | `ok`、`service`、`platform`、`arch`、`node`、`endpoints`、`capabilities`、`tools` | 工具缺失可降级报告，不改变路由 |
| `POST /render/word` | JSON：`filename`、`docxBase64`、可选 `timeoutMs` | 200；`ok`、`pageCount`、`pdf`、`pages`、`issues`、`renderer` | 保持 DOCX→PDF→PNG 行为、字段和错误边界 |
| `POST /render/mermaid` | JSON：`source`、可选 `filename`、`scale`、`timeoutMs` | 200；`ok`、`filename`、`contentType`、`base64`、`width`、`height`、`issues`、`renderer` | 保持裁剪 PNG、scale 1–4 和错误边界 |
| `POST /auth/new-api/resolve-user` | JSON：`apiKey` | 200 `{ok:true,user}`；失败 `{ok:false,code}` | 只返回解析后的用户，不回传原始 key |
| `GET /packages/manifest.json` | 无 | VSIX manifest，含版本、SHA-256、大小和下载 URL | 继续扫描 `/packages`；扩展 ID 可由环境变量覆盖 |
| `GET /packages/<file>` | 同源相对文件名 | 文件流 | 拒绝路径越界，保留 403/404 语义 |
| `GET /marketplace/skills` | 无 | Kilo 兼容 Skill 数组或 `{items}` 目录；只包含 latest | 新服务端的 legacy 适配层始终只返回 latest |
| `POST /marketplace/skills` | Bearer key；Skill 文件清单 | 201 新建或 200 更新；`ok`、`item`、`generatedSkillJson` | 保留旧上传入口和 key 解析 |
| `GET /marketplace/skills/<archive>` | `<id>.tar.gz` | 归档文件流 | 同源归档下载、路径安全和下载计数语义不回归 |
| `GET /marketplace/skills/<id>/files` | Skill ID | 200；`ok`、`id`、`files` | 供旧安装器检查文件清单 |
| `POST /marketplace/skills/<id>/stars` | Bearer key | 200；`ok`、`id`、`stars`、`starred` | 保留旧点赞接口；新版收藏另走 v1 API |
| `GET /marketplace/manifest.json` | 无 | `ok`、`service`、`root`、`catalogFile`、`archiveRoot`、`itemCount`、`warningCount`、`warnings` | 保留目录诊断能力 |

通用错误继续返回结构化 `ok:false`、`code` 和/或 `issues[]`；未知路由继续返回 404。

## Kilo Marketplace 当前契约

- 配置名冻结：`kilo.marketplace.baseUrl`、`kilo.marketplace.skillsOnly`。
- 扩展身份冻结：`publisher=chipmate`、`name=chipmate`、扩展 ID `chipmate.chipmate`。
- `MarketplaceApiClient` 当前从 `<baseUrl>/skills` 读取 JSON/YAML 目录；`skillsOnly` 模式不请求 Agent/MCP。
- 当前写接口为 `POST <baseUrl>/skills`、`POST <baseUrl>/skills/:id/stars`，身份解析为 `POST <serverBaseUrl>/auth/new-api/resolve-user`。
- 当前安装器把归档下载到临时文件，在目标 scope 下建立 staging，解压后检查逃逸路径和根 `SKILL.md`，再通过同文件系统 `rename` 安装。
- 当前安装器没有 revision、服务端 SHA-256、install intent 或 globalStorage 市场元数据；这些是 G5 的明确新增范围。
- 当前 URI handler 只支持 `vscode://chipmate.chipmate/kilocode/s/<sessionId>`；尚不存在 Marketplace install 或 AI repair handler。
- 当前 remote catalog 失败不得用本地 discovered skills 冒充远端条目；本地 Skill 只允许按 `localOnly/uploadable` 语义作为明确的本地候选展示。

## 真实夹具清单

| 类型 | 路径或内容 | SHA-256 / 状态 | 计划用途 |
|---|---|---|---|
| DOCX | `ufs-query-module-interface-edited.docx` | `bbd6493242a68af7ab3aafec08bc16b8f08257b6beeb0562ddcd058caaf933e8` | 多页 Word 黑盒渲染 |
| DOCX | `ufs-query-module-interface.docx` | `ac47f5ceb5cdade7b7ffa34e25a171b952b14ccb7c6211ca42f0742a26c2ff6d` | Word 基线对比 |
| DOCX | `ufs-task-module-interface.docx` | `5b17dee9267c237ee5abc6cbfbd27969a48cfe3f02595bd36af661c79cb0dad3` | 小文件 Word smoke |
| Mermaid | `flowchart TD\nA[开始] --> B{校验}\nB -->|通过| C[发布]\nB -->|失败| D[修复]` | 内联确定性源 | Mermaid PNG smoke 和并发隔离 |
| VSIX | `packages/kilo-vscode/out/kilo-vscode-linux-x64-baseline.vsix` | `927b8575a392a87775d69fc4cbdbf9989a23b6f7ac3b5effaaf8eb4846f049b7` | legacy package manifest 与下载 |
| VSIX | `packages/kilo-vscode/out/kilo-vscode-win32-x64-baseline.vsix` | `59235913884c50167fb64b619e1769aa8e0c1314d1a3a869b481a038d4e3c2f5` | legacy package manifest 与下载 |
| Skill archive | `source-backed-detail-design.tar.gz` | `46074240d4ef0a299557d8f05564df13b7b6843d4610de0a8e56c2c3b88ec36c` | 真实 catalog、下载、安装、发布和安全测试 |

Skill 归档大小 23,519 bytes，包含单一根目录及根 `SKILL.md`。它由仓库现有 `.kilo/skills/source-backed-detail-design` 确定性生成，uid/gid/mtime 已归一化；`gzip -t`、`tar -tzf` 和 Apple xattr 字符串检查通过。

## G0 静态验证

- `node --check server.js`：PASS。
- `node --check build-offline-bundle.mjs`：PASS。
- `bun run script/check-md-table-padding.ts docs/chipmate-skill-market-kilo-alignment-plan.md`：PASS。
- Docker client 可见，但 daemon socket `/Users/archer/.colima/default/docker.sock` 不存在；Docker、Linux 和真实容器运行证据仍为 NOT_RUN。
