# ChipMate Windows installed-VSIX regression kit

This kit validates deterministic regressions against a formally installed Windows VSIX. It does not grade model answer quality and does not require a real model API key.

## What runs automatically

- changeset and dirty-runtime-path coverage gate;
- 84 个历史 changeset 到原子布尔断言的完整映射；
- 源码测试、macOS 安装态和 Windows 冒烟三层执行器就绪度；
- VSIX identity, target, required payload, and forbidden payload inspection;
- isolated `--extensions-dir` and `--user-data-dir` installation;
- activation and contribution probe against the installed `chipmate.chipmate` extension;
- local deterministic OpenAI-compatible mock routes for models, chat, completions, embeddings, rerank, streaming, tool calls, errors, timeouts, and malformed responses;
- real character-by-character Windows `SendInput` for the indexing model and dimension fields;
- installed-window screenshots and UI Automation tree capture;
- JSON and HTML results, evidence secret scanning, and ZIP packaging.

The subject extension remains installed from the frozen VSIX. The small probe extension is loaded in development mode only to inspect and activate the installed subject; the probe rejects the run if the subject itself is in development mode.

Cases not yet backed by a target-specific action script remain `BLOCKED`. The runner never converts a screenshot, source test, or generic smoke into a functional PASS.

## Atomic regression ledger

`atomic-cases.json` is generated from the curated catalog in `atomic-generate.mjs`. Every assertion has one boolean oracle, explicit evidence types, and separate source/macOS/Windows executor states. `atomic-matrix.md` is the human-readable view.

```bash
cd packages/kilo-vscode
node qa/windows-real/atomic-generate.mjs
bun run qa:windows:coverage
```

Coverage `PASS` means every changeset and runtime path has a structurally valid mapping. It does not mean execution passed. `atomic.automationStatus` remains `BLOCKED` until every required macOS assertion and every required Windows smoke assertion has an implemented executor. A parent case cannot make an unreported atomic assertion pass.

## Windows prerequisites

- Windows 11 with an interactive desktop;
- Visual Studio Code Stable, or pass `-CodePath`;
- Node.js 20 or newer available as `node.exe`, or VS Code Stable's Electron Node runtime;
- a frozen `chipmate-<version>-win32-x64-baseline.vsix`;
- optional `1.0.8` and Kilo VSIX files for upgrade and coexistence lanes.

For the recurring Mac-hosted lane, install the official [Windows 11 ARM64 ISO](https://learn.microsoft.com/en-us/windows/arm/iso) in a Parallels release that explicitly supports the host Mac and macOS version. Run x64 VS Code so the same x64 baseline artifact is exercised through Windows Prism; Microsoft documents the [x64 compatibility layer on Windows ARM](https://learn.microsoft.com/en-us/windows/arm/apps-on-arm-program-compat-troubleshooter). The artifact contains both baseline x64 and native ARM64 CLI sidecars: Windows ARM selects the native sidecar, while native Windows x64 selects the baseline sidecar. Parallels and Windows licenses are separate prerequisites.

Every run must declare exactly one gate:

- `arm64-vm`: Windows 11 ARM64 in Parallels on the Mac, running x64 VS Code and the x64-targeted baseline VSIX. VS Code remains under Prism while the extension selects the packaged native ARM64 backend. This is the recurring functional and visual regression gate.
- `native-x64`: native Windows 11 x64 with x64 VS Code and hardware acceleration. This is the final release gate and cannot be replaced by an ARM VM result.

Keep both result sets. Any required `FAIL`, `FLAKY`, `REVIEW`, or `BLOCKED` result blocks signoff.

Use a dedicated, sanitized fixture. The runner creates its own profile and never reads the normal VS Code user-data or extensions directories.

## Run

```powershell
Set-ExecutionPolicy -Scope Process Bypass
cd packages\kilo-vscode\qa\windows-real

.\run.ps1 `
  -Vsix C:\qa\chipmate-1.0.9-win32-x64-baseline.vsix `
  -PreviousVsix C:\qa\chipmate-1.0.8-win32-x64-baseline.vsix `
  -CodePath "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe" `
  -FixtureRoot C:\qa\fixtures\chipmate-regression `
  -Output C:\qa\runs\chipmate-1.0.9-arm64-smoke `
  -ExpectedVersion 1.0.9 `
  -Gate arm64-vm `
  -Gpu default `
  -Lane agent-console
```

Repeat the same frozen kit with `-Gpu disabled`, then repeat both GPU lanes with `-Gate native-x64` on the native x64 release machine. Do not merge the four result directories.

Before the installed UI run, verify the selected CLI independently with fresh storage on the target machine:

```powershell
.\cli-startup-matrix.ps1 `
  -Cli C:\qa\installed-extension\bin\kilo-arm64.exe `
  -Root C:\qa\runs\cli-startup-arm64 `
  -Runs 10
```

The matrix records the exact CLI and launcher PID, SHA-256, port readiness, stdout/stderr, signed exit code, hexadecimal exit code, and explicit `0xC0000005` classification. Any run that does not become ready is a failure; retries do not turn a crash into a pass.

For a standalone handoff ZIP, freeze the current VSIX and ledger on macOS:

```bash
cd packages/kilo-vscode
bun run qa:windows:freeze -- \
  --windows ../../chipmate-1.0.9-win32-x64-baseline.vsix \
  --macos ../../chipmate-1.0.9-darwin-arm64.vsix \
  --previous ../../chipmate-1.0.8-win32-x64-baseline.vsix \
  --output ../../chipmate-proxy-regression-kit-1.0.9.zip
```

After extracting the ZIP on Windows, run `RUN-WINDOWS.ps1`. Add `--kilo <path>` while freezing when the Kilo coexistence artifact is available.

Use `-Lane agent-console` for the installed Agent Console, real PowerShell/IME, CLI lifecycle, CDP, scroll, stress, and visual evidence gate without inheriting unrelated unfinished matrix work. Use `-Lane package` for archive inspection only, or `-Lane core` for package, installed-host, typing, visual, update, and failure-path preparation. `-NoGui` intentionally blocks GUI cases rather than pretending they passed.

Use `-Lane settings` for a focused installed-VSIX settings regression. It validates package identity, isolated installation and activation, every visible Settings page, navigation search, the 420px page picker, invalid Server URL handling, Server save/reopen persistence, and indexing model/dimension save/reopen persistence without running QA or Agent Console cases. Omit `-ExpectedVersion` to read the frozen artifact version from its manifest.

### 离线自动更新聚焦通道

`-Lane update` 只裁决 `WIN-UPDATE`，不会把普通安装或 smoke 结果当成自动更新通过。若要验收“首次 Reload 仍启动旧宿主时自动限一次重试”的协议，`-PreviousVsix` 必须是已包含激活回执协议的桥接版，`-Vsix` 必须是版本更高的候选包：

```powershell
.\run.ps1 `
  -PreviousVsix C:\qa\chipmate-<bridge-version>-win32-x64-baseline.vsix `
  -Vsix C:\qa\chipmate-<candidate-version>-win32-x64-baseline.vsix `
  -CodePath "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe" `
  -Output "C:\qa\runs\自动更新 中文路径" `
  -ExpectedVersion <candidate-version> `
  -Gate native-x64 `
  -Lane update
```

通道会使用隔离的中文、空格 `user-data-dir` 与 `extensions-dir`，只通过 VS Code 自带 CLI 预装旧版；启动扩展前从 PATH 移除所有可发现的 `code`。本地离线服务动态提供 schema v2 manifest 和候选 VSIX。验收证据包含更新前后扩展列表、manifest/VSIX 请求、专用更新日志、缓存 SHA-256、Reload 提示截图与 UIA 树、同一 Code 窗口内的新 Extension Host 回执、Webview ready 回执，以及在非 reduced-motion 条件下动态 spinner 的资源与三帧像素变化。

已发布但不含该协议的旧包（例如历史 `1.0.10 → 1.0.11`）不能被候选包反向修复：安装和首次 Reload 仍由旧包代码发起。该历史链只可验证首次 Reload 是否直接成功，若失败需人工再 Reload 一次；协议从桥接版升级到下一版开始才可自动补救。该通道必须在 `native-x64` Windows 上通过后才能作为发布门槛；`arm64-vm` 结果仅作补充。

The runner prints the paths to:

- `results.json`;
- `report.html`, including the visual contact sheet;
- `<run>-evidence.zip`.

## Mock Provider control

The runner starts the mock at `http://127.0.0.1:43119/v1`. A case can select a deterministic response by including one of these markers in a prompt:

- `[QA:SUCCESS]`
- `[QA:TOOL-CALL]`
- `[QA:HTTP-401]`
- `[QA:HTTP-403]`
- `[QA:HTTP-503]`
- `[QA:TIMEOUT]`
- `[QA:MALFORMED]`

The global scenario can also be changed with `POST /__qa/scenario`. Request evidence records route, streaming mode, and whether authorization was present; it never records header values or prompt bodies.

## Local checks on macOS

```bash
cd packages/kilo-vscode
bun run qa:windows:coverage
bun run qa:windows:mock
bun run qa:windows:update-server
```

这些本地检查只验证 ledger 与本地服务协议，不构成 Windows installed-VSIX 运行证据。
