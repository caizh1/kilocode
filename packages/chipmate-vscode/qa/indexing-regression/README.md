# ChipMate 索引历史缺陷回归用例库

这个目录把已经发生过的高风险索引缺陷登记成可重复执行的测试。目标不是代替完整索引矩阵，而是让后续会话在修改索引状态机、进度、配置热更新或 LanceDB 写入后，用一条命令先确认历史故障没有复发。

## 本次登记的核心故障

`IDX-REG-001` 至 `IDX-REG-004` 覆盖 ChipMate 1.0.10 在真实离线 Windows 环境出现的完整故障链：

1. `onProgress` 与 `onFilesIndexed` 对同一文件重复增加进度。
2. Code RAG 实际只完成约一半时页面已经显示 100%，但状态仍为运行态，所以图标继续旋转。
3. Document RAG 等待 Code RAG 的真实 Promise，长期显示等待 CodeGraph 和 Code RAG 完成。
4. 修改 embedding 配置后，新一轮扫描仍短暂显示上一轮 100%。

功能预期固定为：

- 每个候选文件最多贡献一次 `processedFiles`。
- 所有运行态最多显示 99%，只有真实 `Complete` 才显示 100%。
- Document RAG 只能在 CodeGraph 与 Code RAG 都真实完成后启动，每轮最多一次。
- 新一轮 RAG 从 `0/0/0%` 开始，不继承旧终态。
- 终态后索引按钮不再是 `aria-busy`，同步图标停止旋转。

同一批用例还登记了不可重试 embedding 错误、RAG 配置不应重建 CodeGraph、HTTP/SSE 状态竞态和真实 LanceDB generation finalize 兼容性。

完整用例、前置条件、步骤和功能预期以 [cases.json](./cases.json) 为真源；[case.schema.json](./case.schema.json) 约束新增用例格式。

## 一键执行

在 `packages/chipmate-vscode` 目录运行：

```bash
bun run qa:indexing:regression
```

默认执行所有源码回归，并在 `qa/artifacts/indexing-regression/<时间>/` 生成中文 Markdown 报告和原始 JSON。
控制台默认只显示执行器、PASS/FAIL 和耗时；失败时自动显示日志末尾。需要完整测试日志时增加 `--verbose`。

列出用例和预期：

```bash
bun run qa:indexing:regression -- --list
```

只运行指定历史缺陷：

```bash
bun run qa:indexing:regression -- --case IDX-REG-001,IDX-REG-002,IDX-REG-003
```

## 验证已安装包或解包 VSIX

`--package-bin` 必须指向与当前机器操作系统和架构匹配的扩展 `bin` 目录。执行器会启动包内真实 `chipmate-indexer`，通过正式 IPC 驱动 CodeGraph、Code RAG、Document RAG、检索、配置更新和 HTTP 404 故障路径。

Windows PowerShell 示例：

```powershell
cd C:\path\to\chipmate\packages\chipmate-vscode
bun run qa:indexing:regression -- --package-bin "$env:USERPROFILE\.vscode\extensions\chipmate.chipmate-1.0.11\bin" --require-package
```

Linux 示例：

```bash
cd /path/to/chipmate/packages/chipmate-vscode
bun run qa:indexing:regression -- --package-bin "$HOME/.vscode/extensions/chipmate.chipmate-1.0.11/bin" --require-package
```

只跑包内 IPC：

```bash
bun run qa:indexing:regression -- --package-only --package-bin /path/to/extension/bin --require-package
```

包内测试使用本机临时 OpenAI-compatible mock，不读取 API Key，不访问外网，也不会把私有 endpoint 写入源码或报告。mock 返回确定性向量，验收代码与文档固定标记 Top-1、图谱证据、状态顺序和失败请求次数。

## 结果解释

- `源码 PASS`：对应状态机、manager、VS Code 状态同步和真实 LanceDB 单测通过。
- `包内 IPC PASS`：目标包内 CLI/indexer、ripgrep、Tree-sitter 和 LanceDB 原生运行库完成真实闭环。
- `WIN-INDEXING-LIFECYCLE PASS`：目标 Windows 已安装扩展的页面、Extension Host、Reload 和进程生命周期通过现场验收。

发布前至少应同时获得源码和目标平台包内 IPC 的 PASS。包内 IPC 不替代 Windows 页面观察；真实 Windows 还要在现有 `qa/windows-real` 的 `WIN-INDEXING-LIFECYCLE` 用例中确认：

- Code RAG 运行态没有 100%。
- Code RAG Complete 后旋转图标停止。
- Document RAG 随后启动并完成。
- 保存 embedding 或 Document RAG 配置不会让已完成 CodeGraph 重建。

## 新增历史缺陷

1. 在 `cases.json` 增加下一个连续 `IDX-REG-NNN`。
2. 写清真实回归表现、可复现前置条件、执行步骤和可机器判断的功能预期。
3. 绑定至少一个源码执行器；涉及发布包时绑定 `formal-indexer-ipc`。
4. 若现有执行器不能证明预期，先增加真实实现测试或扩展 `package-smoke.mjs`，不要只登记人工描述。
5. 运行：

   ```bash
   node --test qa/indexing-regression/contract.test.mjs
   bun run qa:indexing:regression -- --case IDX-REG-NNN
   ```

完整的大范围、增量、worktree、文档格式和恢复矩阵仍使用 `bun run qa:macos:indexing`；这个历史库承担快速且阻塞发布的回归门禁。
