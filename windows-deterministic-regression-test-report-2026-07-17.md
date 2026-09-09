# Windows 已修复问题确定性回归测试报告

## 结论

**状态：NOT READY FOR WINDOWS SIGN-OFF**

当前不能签收“Windows 已修复问题确定性回归”：macOS 确定性测试发现 **13 个稳定 FAIL** 和 **1 个 FLAKY**；Windows 11 正式安装态尚未执行，因此所有 Windows GUI、升级、离线依赖、视觉和真实 Profile 用例仍是 `BLOCKED/NOT RUN`。

本轮没有测试模型回答质量，没有使用真实模型 API Key，发现问题后没有修改实现代码。

## 测试对象

- Extension ID：`chipmate.chipmate`
- 版本：`0.0.87`
- Target：`win32-x64-baseline`
- VSIX：`/Users/archer/Work/kilocode/chipmate-0.0.87-win32-x64-baseline.vsix`
- VSIX SHA-256：`c8aef27e82a9d41ccf6a85e4025a93e5175c426644ec30fa16958aac78232342`
- Windows QA kit：`/Users/archer/Work/kilocode/chipmate-windows-regression-kit-0.0.87.zip`
- QA kit SHA-256：`b36e0c4f2689e2b6c2ea6ff7057b1ded040a75b814401c608911fa18e7308924`
- 测试主机：macOS
- Windows 正式安装态：未执行

## 汇总

| 检查项 | 结果 | 统计/证据 |
|---|---|---|
| 修复追踪覆盖 | PASS | 13 个矩阵 case；84/84 changeset；255/255 用户可见运行时路径 |
| Mock Provider 协议 | PASS | 2 PASS，0 FAIL；覆盖 models/chat/completions/embeddings/rerank、SSE、工具调用和失败响应 |
| Windows baseline CLI 构建 | PASS | 新鲜构建 `cli-windows-x64-baseline` 成功 |
| VSIX 构建门禁 | PASS | SDK 生成、TypeScript、ESLint、bundle、内部离线包校验通过 |
| VSIX 内容 | PASS | 必须文件齐全；无 `ffmpeg.exe`；无 `extension/dist/*.map` |
| VS Code extension 完整单测 | PASS | 3718 PASS，0 FAIL，326 files |
| 重点扩展单测 | PASS | 199 PASS，0 FAIL，14 files |
| Kilo indexing 完整单测 | PASS with SKIP | 682 PASS，10 SKIP，0 FAIL，48 files |
| CLI 确定性目标回归 | FAIL | 155 PASS，13 FAIL，22 files |
| 失败复跑第 1 轮 | FAIL | 36 PASS，13 FAIL，5 files |
| 失败复跑第 2 轮 | FAIL/FLAKY | 35 PASS，14 FAIL，1 error；新增 1 个超时型 FLAKY |
| Windows 11 installed-VSIX | BLOCKED | 当前主机不是 Windows，未产生 Windows UIA/截图/Extension Host 日志 |

## 稳定失败清单

以下 13 项在首次运行及两轮复跑中持续失败，状态记为 `FAIL`。

### WIN-INDEXING-LIFECYCLE

1. `indexing-worktree.test.ts` — `shares the primary checkout index with a linked worktree`
   - 预期：索引状态 `Complete`
   - 实际：`In Progress`

2. `indexing-worktree.test.ts` — `does not classify an ordinary directory from its pathname`
   - 预期：索引状态 `Complete`
   - 实际：`In Progress`

3. `indexing-worker.test.ts` — `routes multiple directories through the shared indexing worker`
   - 预期：两个禁用实例均为 `Disabled`
   - 实际：两个实例均为 `In Progress`

4. `indexing-worker.test.ts` — `waits for the primary index instead of scanning a worktree independently`

5. `indexing-worker.test.ts` — `allows same-directory recreation while disposal is pending`

6. `indexing-worker.test.ts` — `releases enabled workers after provider initialization errors`

### WIN-DOCUMENTS

7. `document-artifacts.test.ts` — `declares and lists artifact manifests under .kilo/artifacts`

8. `document-artifacts.test.ts` — `resolves artifact paths and exports diagnostics`

9. `document-artifacts.test.ts` — `rejects paths outside the workspace or artifact root`

共同观测：三项均收到 `No context found for instance`；第三项因此未得到预期的 `artifact file paths must be relative` 错误。

### WIN-IDENTITY-UPGRADE / WIN-FAILURE-SECURITY

10. `project-id.test.ts` — `prefers .kilo/config.json over .kilocode/config.json`
    - 预期：`new-project`
    - 实际：`old-project`

### WIN-RETRIEVAL-EVIDENCE

11. `tool-registry-indexing.test.ts` — `registers semantic search from config even when readiness throws`
    - 预期：工具列表包含 `semantic_search`
    - 实际：缺少 `semantic_search`

12. `tool-registry-indexing.test.ts` — `registers semantic search from config even when readiness rejects`
    - 预期：工具列表包含 `semantic_search`
    - 实际：缺少 `semantic_search`

13. `tool-registry-indexing.test.ts` — `conditionally includes Kilo registry extras`
    - 实际工具列表与预期不一致，缺少预期的重复 `recall`、`background_process`、`semantic_search` 项。

## FLAKY 清单

### WIN-INDEXING-LIFECYCLE

- `indexing-worker.test.ts` — `runs indexing engine requests in its isolated process`
  - 首次目标回归：PASS
  - 失败复跑第 1 轮：PASS
  - 失败复跑第 2 轮：30 秒超时，随后出现 `Indexing process exited with code 0` 的跨测试未处理错误
  - 判定：`FLAKY`，不能用前两次 PASS 覆盖。

## SKIP / BLOCKED

- `packages/kilo-indexing` 有 10 个明确 SKIP，主要为 3M+ 行压力测试和带真实等待的 rate-limit/retry 测试；本轮未将其视为 PASS。
- CLI 整目录测试因进入真实 Alibaba 模型调用而主动终止，退出码 130；该运行不计入通过率。
- Windows 11 正式安装态尚未运行，下列验证仍为 `BLOCKED/NOT RUN`：
  - `0.0.86 → 0.0.87` 覆盖升级和三次 Reload；
  - 与 Kilo 同 Profile 共存；
  - Windows UI Automation 逐字符设置输入；
  - 940/560/420/300px 与 Light/Dark/高对比度截图；
  - 打包 `rg.exe`、LanceDB、Tree-sitter 的 Windows 实际加载和断网行为；
  - Windows Extension Host、Output、globalStorage、索引落盘和进程恢复；
  - Agent Manager、Terminal、Market、Word/Mermaid、更新安装的真实 GUI 操作。

## 已执行命令

```text
bun run qa:windows:coverage
bun run qa:windows:mock
bun script/build.ts --targets=windows-x64-baseline --skip-install
bun script/build.ts --internal-offline
bun run test:unit
bun test --timeout 30000                         # packages/kilo-indexing
bun test <22 个确定性 CLI 测试文件> --timeout 30000
bun test <5 个失败文件> --timeout 30000          # 复跑第 1 轮
bun test <5 个失败文件> --timeout 30000          # 复跑第 2 轮
```

## 签收判定

按既定规则，存在 `FAIL`、`FLAKY` 或未处理的 Windows `BLOCKED` 时禁止签收。因此本轮结论只能表述为：

> 当前修复项的 macOS 确定性测试发现阻塞结果；Windows 正式安装态回归尚未执行，不能证明 Windows 已修复问题没有再次出现。
