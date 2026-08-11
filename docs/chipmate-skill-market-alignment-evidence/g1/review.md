# G1 共享契约与项目骨架 Review

时间：2026-07-12（Asia/Shanghai）

Status: `COMPLETE`

## Changed Files

- `server/chipmate-word-render/package.json`
- `server/chipmate-word-render/package-lock.json`
- `server/chipmate-word-render/tsconfig.base.json`
- `server/chipmate-word-render/eslint.config.mjs`
- `server/chipmate-word-render/apps/api/**`
- `server/chipmate-word-render/apps/web/**`
- `server/chipmate-word-render/packages/contracts/**`
- `server/chipmate-word-render/packages/skill-spec/**`
- `server/chipmate-word-render/packages/market-db/**`
- `server/chipmate-word-render/scripts/generate-contracts.ts`
- `packages/chipmate-vscode/src/services/marketplace/generated/market-api.ts`
- `packages/chipmate-vscode/src/services/marketplace/generated/market-client.ts`
- `packages/chipmate-vscode/tests/unit/marketplace-generated-contract.test.ts`
- `docs/chipmate-skill-market-alignment-evidence/g1/review.md`
- `docs/chipmate-skill-market-chipmate-alignment-plan.md`

## Design Summary

- Render Service 现在是独立 npm workspace，包含 TypeScript + Fastify API 骨架、React + Vite Web 骨架、共享 contracts、skill-spec 和 market-db package。
- TypeBox schema 是公共类型、发布状态、中文状态显示和错误码的单一来源。
- 同一 schema 构建 OpenAPI 3.1；同一生成脚本输出 Web 与 ChipMate 的 TypeScript API 类型和无外部运行时依赖的 fetch client。
- 生成客户端拆分为 `market-api.ts` 和 `market-client.ts`，避免 ChipMate 的 3,000 行 lint 上限，同时保持 Web/ChipMate 字节一致。
- G1 只建立骨架和契约：Fastify 尚未接管 legacy 路由，React 尚未渲染用户界面，market-db schema version 保持 0。

## Contract Coverage

- OpenAPI：3.1.0。
- paths：27。
- operations：30。
- component schemas：17。
- 公共类型：MarketCapabilities、MarketUser、SkillSummary、SkillDetail、SkillRelease、SkillFile、SkillArtwork、FavoriteState、InstallationState、PublicationRun、ValidationReport、ValidationIssue、RepairPatch、AnalyticsEvent、AnalyticsSeries。
- 发布状态：9 个。
- 中文状态显示：9 个。
- 统一错误码：19 个。

## Commands Run

- `npm install`
  - Result: PASS。
  - Evidence: 331 个 package audited，0 vulnerabilities。
- `npm run generate`
  - Result: PASS。
  - Evidence: 生成 OpenAPI 和 4 个客户端文件，共 5 个 artifact。
- `npm run generate:check`
  - Result: PASS。
  - Evidence: `Generated contract artifacts are current.`
- `npm run check`
  - Result: PASS。
  - Evidence: 5 个 workspace TypeScript、ESLint 和 7 个测试全部通过。
- `npm run build`
  - Result: PASS。
  - Evidence: API/contracts/skill-spec/market-db TypeScript 通过；Vite production build 通过，首个空壳 bundle 59.98 KiB gzip。
- `bun run typecheck`（`packages/chipmate-vscode`）
  - Result: PASS。
  - Evidence: extension 和 webview TypeScript 均通过。
- `bun test tests/unit/marketplace-generated-contract.test.ts`
  - Result: PASS。
  - Evidence: 1 pass，验证 ChipMate 生成客户端可调用 capabilities endpoint。
- `bunx eslint <generated clients and test>`
  - Result: PASS。
  - Evidence: 无 lint error；拆分后没有超过 max-lines。
- `cmp -s <web generated> <chipmate generated>`
  - Result: PASS。
  - Evidence: Web 与 ChipMate 的 API 类型和 client 均字节一致。
- `node --check server.js && node -e 'require("./server.js")'`
  - Result: PASS。
  - Evidence: `legacy-commonjs-load-ok`。
- `shasum -a 256 server.js`
  - Result: PASS。
  - Evidence: `cd801aa2593d1facad065ae90c4917479f515d336adfec6846ab590ba22e73aa`，与 G0 完全一致。

## Test Results

- API skeleton：1 pass。
- Web generated client：1 pass。
- contracts：3 pass。
- market-db skeleton：1 pass。
- skill-spec：1 pass。
- ChipMate generated client：1 pass。
- TypeScript、ESLint、Vite production build、generate drift：全部 PASS。

## Runtime Evidence

- Environment：macOS，Node 26.0.0，npm 11.12.1，Bun 1.3.14。
- Artifacts：`packages/contracts/openapi/market-v1.json`、Web/ChipMate generated clients、Vite `dist/`（ignored build output）。
- Result：本地生成、编译和单元测试 PASS；Docker、Linux、真实 VS Code profile 仍为 NOT_RUN。

## Known Limitations

- Fastify 没有接管任何 legacy route；这是 G2 范围。
- Node Docker 基础镜像仍是 Node 20；升级 Node 24 是 G2 范围。
- market-db 只有 port 和 schema version 0；SQLite schema、migration、repository 和 Worker 是 G3 范围。
- Web 只验证 React/Vite 空骨架，不包含可见 UI；选定视觉系统在 G4 实现。
- 生成 ChipMate client 尚未接入现有 Marketplace runtime；capability detection 和 legacy fallback 在 G7 前完成。

## Next Recommended Gate

- G2：Fastify 与渲染兼容层。先用 G0 legacy 冻结清单建立黑盒测试，再迁移 HTTP 路由和 Node 24 镜像；不得同时开始 SQLite 或 Web 页面实现。
