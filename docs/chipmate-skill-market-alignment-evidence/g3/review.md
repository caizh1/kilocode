# G3 SQLite 市场核心 Review

时间：2026-07-12（Asia/Shanghai）

Status: `COMPLETE`

## Changed Files

- `server/chipmate-word-render/packages/market-db/src/model.ts`
- `server/chipmate-word-render/packages/market-db/src/migrations.ts`
- `server/chipmate-word-render/packages/market-db/src/repo.ts`
- `server/chipmate-word-render/packages/market-db/src/protocol.ts`
- `server/chipmate-word-render/packages/market-db/src/worker.ts`
- `server/chipmate-word-render/packages/market-db/src/client.ts`
- `server/chipmate-word-render/packages/market-db/src/index.ts`
- `server/chipmate-word-render/packages/market-db/test/index.test.ts`
- `server/chipmate-word-render/apps/api/src/market.ts`
- `server/chipmate-word-render/apps/api/src/start.ts`
- `server/chipmate-word-render/apps/api/test/sqlite-legacy.test.ts`
- `server/chipmate-word-render/apps/api/package.json`
- `server/chipmate-word-render/package-lock.json`
- `server/chipmate-word-render/Dockerfile`
- `docs/chipmate-skill-market-alignment-evidence/g3/review.md`
- `docs/chipmate-skill-market-chipmate-alignment-plan.md`

## Design Summary

- 市场数据库使用 Node 24 内置 `node:sqlite`，所有 SQLite、legacy 导入、latest 导出和聚合工作都在 Worker 线程内执行；Fastify 主线程只通过 typed request/response protocol 调用。
- 三个有序 migration 建立核心 schema、FTS5/触发器/不可变 release 门禁和 legacy lossless metadata 字段。
- 首次导入读取原有 `skills.json` 与归档，复制到 managed immutable release store；同哈希重试返回 unchanged，不创建重复 revision。
- metadata 和未知 legacy 字段原样保存在 `legacy_json`/`metadata_json`；测试证明 `githubUrl` 与未知 `legacyOnly` 字段导入导出不丢失。
- 每个 Skill 使用递增 revision 和 latest pointer；release 通过 trigger 禁止 update/delete。
- `legacy-latest` 使用 staging + rename 原子生成，原始 legacy 目录和归档不删除。
- Docker 启动时异步导入原始目录并生成 latest；数据库损坏或不可用时记录降级错误，但 Fastify health、Word/Mermaid 和 packages 仍启动。

## Schema Coverage

- `users`
- `sessions`
- `skills`
- `releases`
- `assets`
- `favorites`
- `installations`
- `publication_runs`
- `validation_issues`
- `events`
- `daily_metrics`
- `audit_events`
- `imports`
- `skill_search`（FTS5）

启动 PRAGMA：`journal_mode=WAL`、`foreign_keys=ON`、`busy_timeout=5000`。

## Commands Run

- `npm run check && npm run build`
  - Result: PASS。
  - Evidence: generate drift、5 个 workspace TypeScript、ESLint、14 个测试和 Vite build 通过。
- `npx -y -p node@24 node --import tsx --test apps/api/test/*.test.ts packages/market-db/test/*.test.ts`
  - Result: PASS。
  - Evidence: Node 24.18.0 下 8 pass。
- `bun run typecheck`（`packages/chipmate-vscode`）
  - Result: PASS。
  - Evidence: extension 和 webview TypeScript 通过。
- `bun test tests/unit/marketplace-installer.test.ts`
  - Result: PASS。
  - Evidence: 真实 ChipMate `MarketplaceInstaller` 9 pass。
- `node --input-type=module -e '<migration and Worker operation check>'`
  - Result: PASS。
  - Evidence: migrations `[1,2,3]`，8 个核心 Worker operation 全部存在。

## Test Results

- schema migrations、WAL、foreign keys、busy timeout：PASS。
- legacy import、相同 SHA 去重、revision 1→2、latest pointer：PASS。
- legacy metadata/未知字段无损保留、原始 v1 归档仍存在：PASS。
- FTS query、category filter、favorite count、installation upsert、PublicationRun：PASS。
- events 幂等写入、daily_metrics 重建：PASS。
- release update 被 immutable trigger 拒绝：PASS。
- Worker `legacy-latest` 原子导出：PASS。
- Fastify production bootstrap 导入/导出：PASS。
- 实际 ChipMate `MarketplaceInstaller` 从生成目录读取 catalog、下载归档、tar staging 安装并找到根 `SKILL.md`：PASS。
- market DB 启动失败时 health 和 render endpoints 继续可用：PASS。

## Runtime Evidence

- Environment：macOS，Node 24.18.0，真实 SQLite/FTS5/Worker/文件系统/tar/Fastify。
- Fixtures：G0 `source-backed-detail-design.tar.gz`，测试内生成有效 revision 2 归档。
- Artifact：临时 `market.sqlite`、WAL、managed releases 和 `legacy-latest`；测试结束后清理。
- Result：本机 runtime PASS；Docker/Linux container NOT_RUN。

## Known Limitations

- aligned-v1 catalog HTTP routes 尚未接入 repository；G4 实现 Web 发现 API 时接入。
- fuzzy matching、10,000 Skill/200 并发性能与保留清理在 G8 完成。
- sessions、assets、validation_issues 和 audit_events 已建表，但业务写路径分别在 G4/G5/G6/G8 实现。
- Docker daemon 仍不可用，尚无容器内 WAL/Worker 证据。

## Next Recommended Gate

- G4：接入只读 catalog/status/capabilities/SSE API，并按已选方向 1 实现 Web 首页、目录、详情、版本、文件预览和状态页；完成真实浏览器、视觉差异、无障碍和性能门禁。
