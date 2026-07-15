# G9.1 Trusted HTTP Web Hotfix Review

Date: 2026-07-12

Disposition: `PASS`

Edge: `USER_WAIVED / NOT_RUN`

## Root Cause

- Chrome 在非 localhost 的 HTTP 页面中不提供 `crypto.randomUUID()`。
- 0.1.6 Web 的分析模块在 import 阶段立即调用该 API，React 首屏尚未挂载便抛出 `TypeError`。
- 发布页还存在第二处直接调用，首屏修复后仍会在提交时失败。

## Implementation

- 新增统一 UUID 工具：优先原生 `randomUUID`，否则使用 `getRandomValues` 生成 RFC 4122 v4 UUID；没有使用 `Math.random`。
- 分析 client ID 改为首次上报时惰性生成；localStorage 失败时使用页面生命周期内的临时 ID；分析失败不再阻塞产品页面。
- 发布幂等键使用同一 UUID 工具，生成失败由既有发布错误状态处理。
- 服务端 API、事件 schema、clientId 长度规则、幂等语义和已有 localStorage 数据均未改变。

## Tests

- `npm run check && npm run build`: PASS。
- API: 15/15 PASS，包括真实 Word/Mermaid compatibility core。
- Web unit: 6/6 PASS，包括原生 UUID、trusted-HTTP fallback、version/variant bits 和无安全随机源错误。
- contracts: 4/4 PASS；market-db: 3/3 PASS；skill-spec: 6/6 PASS。
- Chrome Playwright: 8/8 PASS；覆盖 `randomUUID` 缺失、发布幂等键、localStorage `SecurityError` 和无 page error。
- Microsoft Edge: `USER_WAIVED / NOT_RUN`，不得解释为 PASS。

## Native Runtime

- Environment: Colima/QEMU x86_64 Linux，Docker Server `x86_64 linux 29.5.2`。
- Image: `sha256:b621ae59f61d9373bb377dd4aa1d37c161d5f809498e3929ca0e81eb8d3fbf9e`，architecture `amd64`。
- Installer verified archive checksum, backed up existing market data to `/var/lib/chipmate-native/data/backups/skill-market-20260712T135157Z`, and started 0.1.7 successfully。
- Real non-loopback Chrome origin: `http://192.168.3.172:6005`。
- Browser evidence: `isSecureContext=false`、`typeof crypto.randomUUID === "undefined"`、首页标题与主 heading 可见、发布页和登录 dialog 可见、page/console errors 为 0。
- Loaded Web asset: `assets/index-C4Dq36Ue.js`，替换了发生崩溃的 0.1.6 hash。
- `/health`、`/api/v1/status`、`/api/v1/capabilities`、`/api/v1/skills`、legacy `/marketplace/manifest.json` 和 `/packages/manifest.json`: PASS。
- Packages manifest returned `chipmate-0.0.42-linux-x64.vsix` as version 0.0.42。
- Word: HTTP 200、`ok=true`、1 page；Mermaid: HTTP 200、`ok=true`、224x222 PNG。

## Artifacts

- `chipmate-word-render-0.1.7-linux-amd64.docker.tar.gz`: `4c2d06c630fb488574cd1d74c4f4c68de0ce24c52d00f42b4ec40fa4208c8f62`
- `chipmate-server-offline-0.1.7-linux-amd64.tar.gz`: `c7e84454227e1ee34bd75111528d0c6e3587d9f589991415662fcdafee74d474`
- Image archive、outer offline bundle、`documents.tar.gz` 和 `source-backed-detail-design.tar.gz` 均通过 Apple xattr marker 扫描，归档无 AppleDouble 或 `__MACOSX` 条目。
- 0.1.6 image archive、offline bundle 和 checksum 全部保留，作为一个发布周期的回滚材料。

## Final Status

- G9.1 scope: COMPLETE。
- Completion allowed: yes。
- VSIX 0.0.42 不需要重打或重新安装；修复位于服务端提供的 Web 资产。
