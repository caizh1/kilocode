# G2 Fastify 与渲染兼容层 Review

时间：2026-07-12（Asia/Shanghai）

Status: `COMPLETE`

## Changed Files

- `server/chipmate-word-render/apps/api/src/index.ts`
- `server/chipmate-word-render/apps/api/src/legacy.ts`
- `server/chipmate-word-render/apps/api/src/start.ts`
- `server/chipmate-word-render/apps/api/test/index.test.ts`
- `server/chipmate-word-render/apps/api/test/legacy-compat.test.ts`
- `server/chipmate-word-render/packages/contracts/src/legacy.ts`
- `server/chipmate-word-render/packages/contracts/src/index.ts`
- `server/chipmate-word-render/packages/contracts/test/schema.test.ts`
- `server/chipmate-word-render/Dockerfile`
- `server/chipmate-word-render/.dockerignore`
- `server/chipmate-word-render/package.json`
- `server/chipmate-word-render/package-lock.json`
- `server/chipmate-word-render/server.js`
- `server/chipmate-word-render/README.md`
- `docs/chipmate-skill-market-alignment-evidence/g2/review.md`
- `docs/chipmate-skill-market-kilo-alignment-plan.md`

## Design Summary

- Fastify 显式注册 G0 冻结的 13 个 legacy route；route schema 从 `@chipmate/market-contracts` 导入。
- 为保持请求体、状态码和响应字段不变，Fastify 在 `onRequest` 阶段 hijack raw request/response，并调用冻结 `server.js` 的同一个 request handler。Fastify 负责路由，旧实现作为兼容 core，不复制渲染或 Marketplace 逻辑。
- 未知路由由 Fastify 返回与旧服务一致的结构化 404。
- Docker 基础镜像升级到 Node 24；容器入口改为 Fastify TypeScript start，使用生产依赖中的 `tsx` 加载源码和共享 contracts。
- `UPDATE_EXTENSION_ID` 默认值对齐为 `chipmate.chipmate`，仍允许环境变量覆盖。
- 旧 `commandPath` 改为参数化 `/bin/sh -c`，消除 Node 24/26 的 `DEP0190` shell-args 警告，不改变命令探测结果。

## Compatibility Coverage

- 旧/新服务真实启动为两个独立 HTTP 进程。
- 对照覆盖：health、VSIX manifest、Skill catalog、market manifest、Skill 文件清单、Skill 归档、缺失归档、未知路由、Word 错误、Mermaid 错误、New API identity 错误、Skill 上传未授权、stars 未授权。
- 动态 `generatedAt`、`elapsedMs` 和 origin 只在测试比较器中规范化；其余状态码、content-type 和 JSON 结构要求一致。
- 真实 VSIX：`kilo-vscode-linux-x64-baseline.vsix`，manifest 必须发现 1 个包；旧/新服务流式下载后的 SHA-256 都必须等于 G0 的 `927b8575a392a87775d69fc4cbdbf9989a23b6f7ac3b5effaaf8eb4846f049b7`。
- 真实 Skill archive：`source-backed-detail-design.tar.gz`，catalog 必须发现 1 个 Skill，归档 SHA-256 必须一致。

## Commands Run

- `npm run check && npm run build`
  - Result: PASS。
  - Evidence: generate drift、5 个 workspace TypeScript、ESLint、11 个测试和 Vite production build 通过。
- `npm --workspace @chipmate/market-api test`
  - Result: PASS。
  - Evidence: 4 pass；包含 HTTP 黑盒、降级、真实 Mermaid 和真实 DOCX。
- `npx -y -p node@24 node --version`
  - Result: PASS。
  - Evidence: `v24.18.0`。
- `npx -y -p node@24 node --import tsx --test apps/api/test/index.test.ts apps/api/test/legacy-compat.test.ts`
  - Result: PASS。
  - Evidence: Node 24 下 4 pass，包含真实渲染。
- `npm ci --omit=dev --dry-run`
  - Result: PASS。
  - Evidence: production dependency graph 可解析。
- `node --check server.js`
  - Result: PASS。
- `node --input-type=module -e '<route and Docker structure check>'`
  - Result: PASS。
  - Evidence: `routes=13`、`node24Docker=true`。
- `docker info --format '{{.ServerVersion}}'`
  - Result: NOT_RUN/BLOCKED。
  - Evidence: `/Users/archer/.colima/default/docker.sock` 不存在，当前机器无法取得容器证据。

## Test Results

- API/Fastify：4 pass。
- Web generated client：1 pass。
- contracts：4 pass。
- market-db skeleton：1 pass。
- skill-spec：1 pass。
- 合计：11 pass，0 fail。
- Node 24 定向 Fastify/legacy/render：4 pass，0 fail。
- 真实 Mermaid：200、`ok=true`、有效 PNG signature、非零尺寸。
- 真实 DOCX：200、`ok=true`、至少 1 页、PDF 和逐页 PNG content-type 正确。
- market storage 缺失：服务仍以 200 提供 health，`catalogExists=false`，render endpoints 保留。
- 真实 VSIX 下载：旧/新服务状态、content-type、size 和 SHA-256 一致。

## Runtime Evidence

- Environment：macOS，Node 24.18.0 定向运行；LibreOffice/Poppler 来自 Codex runtime；Chrome 150 使用真实应用二进制。
- Fixtures：G0 Skill archive、Mermaid 源、`ufs-task-module-interface.docx`、真实 Linux baseline VSIX。
- Result：本机 Fastify/legacy/Word/Mermaid/VSIX/Skill 运行 PASS；Docker/Linux container NOT_RUN。

## Known Limitations

- 当前 Fastify adapter 仍调用单体 `server.js` 的 request core；这是刻意的 G2 低风险兼容边界。后续模块拆分必须继续通过本黑盒门禁。
- Dockerfile 已升级 Node 24，但当前 Docker daemon 不可用，尚无镜像构建或容器内运行证据。
- aligned-v1 API、SQLite、Web 页面和 Kilo capability fallback 均未在 G2 实现。

## Next Recommended Gate

- G3：实现 SQLite WAL schema、迁移、导入、repository、Worker、latest snapshot 和 legacy latest 目录；继续用 G2 黑盒门禁证明旧插件行为不回归。
