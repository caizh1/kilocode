# G9 Linux VSIX Addendum Review

Date: 2026-07-12

Disposition: `PASS`

## Skill Service Freshness

- `chipmate-server-offline-0.1.6-linux-amd64.tar.gz` 已包含 `documents.tar.gz` 与 `source-backed-detail-design.tar.gz`。
- 没有 Render Service 运行源码或上述 Skill 源文件晚于现有镜像/离线归档；本 addendum 不重复生成内容相同的 0.1.6 服务包。

## Packaging

- 扩展版本按本地升级规则从 0.0.41 更新到 0.0.42。
- 从源码新鲜构建 `@kilocode/cli-darwin-arm64`、`@kilocode/cli-windows-x64-baseline` 与 `@kilocode/cli-linux-x64`。
- 内部 Linux x64 打包为显式目标；不带 `--targets` 的 `--internal-offline` 仍默认只构建 Windows baseline。
- Linux 内部包为 no-audio，包含 `kilo`、`rg`、models snapshot、Tree-sitter、CodeGraph worker、LanceDB JS runtime、`lancedb-linux-x64-gnu` 原生模块和全部扩展运行 bundles，不含 FFmpeg 或 `dist/*.map`。

## Native Linux Evidence

- Environment: Colima/QEMU x86_64 Linux VM。
- `kilo --version`: PASS，输出 `0.0.0-codex-v7-3-42-dev-202607120831`；全系统模拟冷启动 26.575 秒。
- `rg --version`: PASS，`ripgrep 15.1.0`。
- LanceDB native dependency resolution: PASS；`ldd` 解析到 x86_64 glibc、libgcc、pthread、dl 与 math runtime。
- macOS 构建阶段缺少 `patchelf` 的警告未影响产物；原生 x86_64 Linux 执行证明 ELF interpreter 与 glibc 依赖可用。

## Artifacts

- `chipmate-0.0.42-darwin-arm64.vsix`: `bcb2264f148bc39f392469341971d5757ef6ab7450200bdaf902d1945ea8c60b`
- `chipmate-0.0.42-linux-x64.vsix`: `b44fc5aede44c779d192c4c7cf2bc670ae7261795dbf7527de0e66e8a0ffeb46`
- `chipmate-0.0.42-win32-x64-baseline.vsix`: `d58eee48ffbe0c004f4708ffecfdde357090f15f9196d6df2185acf2d3ac9faf`
- `chipmate-0.0.42-win32-x64-baseline.vsix.tar.gz`: `e2a3f00f403f45d4287527e4d66c9ccdf19a11ef8c9df82c255745313b225732`

## Verification

- 三个 VSIX manifest 均为 `chipmate.chipmate@0.0.42`。
- Windows transfer archive 只包含 Windows VSIX 与 `latest.json`。
- 三个 VSIX 均无 `__MACOSX` 或 AppleDouble ZIP 条目；Windows transfer archive 无 Apple xattr marker。
- VSIX 构建过程执行 extension typecheck 与 lint：PASS。
- Linux 和 Windows internal VSIX 内容门禁：PASS。
