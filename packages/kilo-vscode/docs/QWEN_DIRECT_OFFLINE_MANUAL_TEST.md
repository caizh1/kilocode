# Qwen Direct Offline Manual Test

This guide is for testing qwen-direct autocomplete in an offline Linux VS Code environment where Bun and the benchmark CLI are not available. The workflow is VSIX-only: build the VSIX on a development machine, install it on Linux, manually exercise autocomplete, then export redacted diagnostics.

Do not upload API keys, full source files, full prompts, full completions, or screenshots that reveal private code.

## Install The VSIX

1. Build or obtain a Linux-target VSIX on the development machine.

If the development machine has a prepared `packages/opencode/dist` containing Linux CLI artifacts, run:

```bash
cd packages/kilo-vscode
bun script/build.ts
```

Then copy the matching file from `packages/kilo-vscode/out/`, such as `kilo-vscode-linux-x64.vsix` or `kilo-vscode-linux-arm64.vsix`.

For a local packaging smoke test on the current development machine only, run:

```bash
cd packages/kilo-vscode
bun run snapshot:build
```

The snapshot command packages the current-machine CLI binary and should not be treated as the Linux target package.

2. Copy the Linux-target `.vsix` file to the offline Linux machine.
3. In VS Code on Linux, run `Extensions: Install from VSIX...`.
4. Select the copied VSIX.
5. Reload VS Code when prompted.

Do not install Bun on the offline Linux machine for this manual test.

## Configure Qwen Direct

Open VS Code settings JSON and set the qwen-direct autocomplete values:

```json
{
  "kilo.autocomplete.enabled": true,
  "kilo.autocomplete.provider": "qwen-direct",
  "kilo.autocomplete.qwen.endpoint": "http://internal-host/v1/completions",
  "kilo.autocomplete.qwen.model": "qwen-coder-30b0",
  "kilo.autocomplete.qwen.apiKey": "replace-with-secret",
  "kilo.autocomplete.qwen.trace": true,
  "kilo.autocomplete.qwen.logLevel": "debug",
  "kilo.autocomplete.qwen.logPromptPreview": false,
  "kilo.autocomplete.qwen.logCompletionPreview": true
}
```

The endpoint must be the complete `/v1/completions` URL. Do not use a base URL and do not use `/v1/chat/completions`.

For lower-volume logs, use:

```json
{
  "kilo.autocomplete.qwen.trace": true,
  "kilo.autocomplete.qwen.logLevel": "info"
}
```

`info` logs lifecycle summaries without prompt or completion previews. `debug` logs the full diagnostic field set, still redacted. `trace=false` or `logLevel=off` disables lifecycle diagnostics.

## Open The Output Channel

Run:

```text
ChipMate: Show qwen-direct Autocomplete Logs
```

This opens the `ChipMate qwen-direct autocomplete` Output Channel. Each line is a JSON object.

## Manual Test Scenarios

Use small local scratch files when possible. Avoid copying proprietary code into screenshots or notes.

| Case | File type | Cursor setup | Expected observation |
|---|---|---|---|
| QD-01 | C | Empty function body after indentation | Ghost text suggests a plausible statement or block. |
| QD-02 | C++ | Method body after accessing an existing class field | Suggestion uses nearby symbol names when the model can infer them. |
| QD-03 | C | Cursor after a partially typed token, such as `ret` | Suggestion should not duplicate the already typed prefix. |
| QD-04 | C | Cursor before existing suffix text on the same line | Suggestion should not overlap the suffix. |
| QD-05 | C++ | Inside a short `if` or loop body | Multiline behavior should match what VS Code shows as ghost text. |
| QD-06 | C | In a comment or string literal | Confirm whether the ignore guard blocks or allows the request. |
| QD-07 | C/C++ | With selected completion info active after typing several chars | Record selected completion fields and whether the replacement range is sane. |
| QD-08 | C/C++ | Rapid typing/backspace near the same cursor | Check cancellation, stale response, and debounce lifecycle events. |

For each case:

1. Place the cursor at the described location.
2. Pause until ghost text appears or no suggestion is returned.
3. Press `Tab` only if ghost text appears and the suggestion is acceptable.
4. Record the `requestId` from the Output Channel.

## Reproduction Template

```text
caseId:
file type:
cursor position:
expected:
actual:
did ghost text show:
did Tab accept:
requestId:
screenshot optional:
```

## Export Diagnostics

Run:

```text
ChipMate: Export qwen-direct Autocomplete Diagnostics
```

Save the `.jsonl` file. The export contains:

- qwen-direct autocomplete logs
- extension version
- VS Code version when available
- OS and platform
- qwen autocomplete settings snapshot with secrets redacted

The export must not contain the API key, Authorization header, full endpoint host, full prompt, full source, or full absolute file paths.

## Share Logs For Debugging

Before sending diagnostics to Codex or another reviewer:

1. Search the exported `.jsonl` for the API key and remove the file if it appears.
2. Search for `Authorization` and remove the file if it appears.
3. Check that endpoint values show only paths such as `/v1/completions`.
4. Confirm prompt previews are absent unless you intentionally enabled `kilo.autocomplete.qwen.logPromptPreview`.
5. Attach the reproduction template entries for failed cases and include the matching `requestId`.

The diagnostics are for observing current qwen-direct behavior only. A passing manual test does not prove model quality improved, and a failing case should be used to plan a later phase rather than changing runtime behavior during this observability phase.
