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
- Node.js 20 or newer available as `node.exe`;
- the frozen `chipmate-0.0.88-win32-x64-baseline.vsix`;
- optional `0.0.86` and Kilo VSIX files for upgrade and coexistence lanes.

Use a dedicated, sanitized fixture. The runner creates its own profile and never reads the normal VS Code user-data or extensions directories.

## Run

```powershell
Set-ExecutionPolicy -Scope Process Bypass
cd packages\kilo-vscode\qa\windows-real

.\run.ps1 `
  -Vsix C:\qa\chipmate-0.0.88-win32-x64-baseline.vsix `
  -CodePath "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe" `
  -FixtureRoot C:\qa\fixtures\chipmate-regression `
  -Output C:\qa\runs\chipmate-0.0.88-smoke `
  -Lane smoke
```

For a standalone handoff ZIP, freeze the current VSIX and ledger on macOS:

```bash
cd packages/kilo-vscode
bun run qa:windows:freeze -- \
  --windows ../../chipmate-0.0.88-win32-x64-baseline.vsix \
  --macos ../../chipmate-0.0.88-darwin-arm64.vsix \
  --previous ../../chipmate-0.0.86-win32-x64-baseline.vsix \
  --output ../../chipmate-proxy-regression-kit-0.0.88.zip
```

After extracting the ZIP on Windows, run `RUN-WINDOWS.ps1`. Add `--kilo <path>` while freezing when the Kilo coexistence artifact is available.

Use `-Lane package` for archive inspection only, or `-Lane core` for package, installed-host, typing, visual, update, and failure-path preparation. `-NoGui` intentionally blocks GUI cases rather than pretending they passed.

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
```

These checks validate the ledger and mock protocol only. They are not Windows execution evidence.
