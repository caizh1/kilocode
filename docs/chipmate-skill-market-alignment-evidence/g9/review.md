# G9 Final Review

Date: 2026-07-12

Disposition: `PASS_WITH_RECORDED_BASELINE_LIMITATIONS`

Edge: `USER_WAIVED / NOT_RUN`

## Changed Files

- `server/chipmate-word-render/Dockerfile`
- `server/chipmate-word-render/install-render-server.sh`
- `server/chipmate-word-render/scripts/build-offline-bundle.mjs`
- `server/chipmate-word-render/scripts/generate-contracts.ts`
- `server/chipmate-word-render/apps/api/src/index.ts`
- `server/chipmate-word-render/apps/api/src/legacy.ts`
- `server/chipmate-word-render/apps/api/src/web.ts`
- `server/chipmate-word-render/apps/api/test/legacy-compat.test.ts`
- `server/chipmate-word-render/README.md`
- `packages/chipmate-vscode/script/build.ts`
- `packages/chipmate-vscode/package.json`
- `latest.json`
- `.changeset/marketplace-analytics-hardening.md`

## Design Summary

- Docker 使用多阶段构建，在构建阶段生成并校验 aligned-v1 contracts 与 React/Vite Web，运行阶段同容器、同端口提供 Web、市场 API、legacy API、packages、Word 和 Mermaid。
- `/packages` 保持只读，市场 SQLite、legacy 导出和 Skill 数据迁到 `/data/skill-market` 可写卷；安装脚本在覆盖启动前备份现有目录。
- Web 静态资源使用 CSP、安全响应头、哈希资源长期缓存和 SPA fallback。
- 新服务继续保留冻结的 `/marketplace` legacy 合同；新插件使用 capabilities 自动选择 aligned-v1 或 legacy。
- Windows 内部包使用 `win32-x64-baseline`、无音频、中文优先、离线 LanceDB/ripgrep；macOS 包使用新鲜构建的 darwin-arm64 CLI。

## Runtime Evidence

- 原生验证环境：Colima/QEMU guest `x86_64`，Docker Server `x86_64 linux 29.5.2`。
- `install-render-server.sh` 在 x86_64 Linux guest 中校验归档 SHA-256、加载镜像、创建数据卷并启动 `chipmate-native-g9`。
- 原生容器端口 `6005`：`/health`、`/api/v1/status`、`/` 和 `/packages/manifest.json` 可用。
- Word 真实渲染：HTTP 200、`ok=true`、1 页。
- Mermaid 真实渲染：HTTP 200、`ok=true`、177x222 PNG。
- 负向 Docker 门禁：删除构建上下文中的 `apps/web` 后，镜像构建在 `COPY apps/web/package.json` 处按预期失败，未生成交付镜像。
- 真实 VS Code profile：0.0.41 aligned-v1 与 legacy fallback 均验证；0.0.40 旧插件连接新服务浏览成功，随后以 `--force` 覆盖升级回 0.0.41，未卸载。
- 截图：`aligned-v1-real-profile.png`、`legacy-real-profile.png`、`old-client-new-server.png`。

## Deliverables

- `chipmate-0.0.41-darwin-arm64.vsix`: `6ac0ff483a65ec6989fb068f99c6bcd006408aadbbdae6250235e38ccfdff90f`
- `chipmate-0.0.41-win32-x64-baseline.vsix`: `44bc305d411150876353582a01c89bb927332bc8c96544dda8d8a60a176a456f`
- `chipmate-0.0.41-win32-x64-baseline.vsix.tar.gz`: `857c528aa1b6e86c839b216bcb416b631a58a4d4803f2929ea9f7c69adb4c715`
- `chipmate-word-render-0.1.6-linux-amd64.docker.tar.gz`: `1a7c1d4796ee77b863bc0b5796ca0990cc0aa26b3c5d943e0b5c474a66046093`
- `chipmate-server-offline-0.1.6-linux-amd64.tar.gz`: `549b859439bd5e70a3af5bcb001377060838b715a77c15334c4d937541da5d32`
- Windows transfer archive only contains VSIX and `latest.json`。
- Docker、offline bundle、Windows transfer archive及嵌套 Skill 归档均通过 Apple xattr 字符串扫描。
- 回退材料保留：0.0.40 双平台 VSIX、Docker 镜像 `chipmate-word-render:0.1.5`，以及新版服务的 legacy API。

## Commands Run and Results

- `npm run check && npm run build`: PASS；API 15/15、Web 3/3、contracts 4/4、market-db 3/3、skill-spec 6/6。
- `bun run typecheck`: PASS。
- `bun run lint`: PASS。
- `bun test tests/unit/marketplace-*.test.ts`: PASS，51/51。
- `bun run check-chipmate-change`: PASS。
- `bun run script/check-md-table-padding.ts`: PASS，399 files。
- `bun run script/extract-source-links.ts`: PASS，104 URLs。
- `bun run test:unit`: EXECUTED，2819 pass、77 fail、2 runner errors；失败集中于既有 Qwen inline completion、worktree、branding/i18n 等非 Marketplace 范围。
- `bun run knip`: EXECUTED，报告 1 个既有未使用文件、2 个既有未使用导出、3 个既有未使用导出类型和 1 组既有重复导出。

## Known Limitations

- Microsoft Edge 品牌运行按用户指令跳过，状态固定为 `USER_WAIVED / NOT_RUN`，不得解释为 PASS。
- 仓库全量 unit 与 knip 仍有上述既有失败；本次未修改 inline completion，也未用越界改动掩盖这些基线问题。G9 no-regression 以本计划服务端全量检查、ChipMate Marketplace 专项 51/51、真实 Docker、真实渲染和真实 VS Code profile 为签收范围。
- `check-opencode-annotations` 仍会报告工作区中其他既有共享 OpenCode 修改；本次 G9 产生的 `packages/opencode/script/build.ts` 纯格式差异已恢复。

## Final Status

- G9 scope: COMPLETE。
- Completion allowed: yes。
- Next gate: none；后续仅为独立的仓库基线治理工作。
