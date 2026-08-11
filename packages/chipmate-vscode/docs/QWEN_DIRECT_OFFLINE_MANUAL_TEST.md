# Qwen Direct Offline Manual Test

This guide is for testing qwen-direct autocomplete in an offline Linux VS Code environment where Bun and the benchmark CLI are not available. The workflow is VSIX-only: build the VSIX on a development machine, install it on Linux, manually exercise autocomplete, then export redacted diagnostics.

Do not upload API keys, full source files, full prompts, full completions, or screenshots that reveal private code.

## Install The VSIX

1. Build or obtain a Linux-target VSIX on the development machine.

If the development machine has a prepared `packages/opencode/dist` containing Linux CLI artifacts, run:

```bash
cd packages/chipmate-vscode
bun script/build.ts --internal-offline --targets=linux-x64-baseline
```

Then copy `packages/chipmate-vscode/out/chipmate-vscode-linux-x64-baseline.vsix`.

For a local packaging smoke test on the current development machine only, run:

```bash
cd packages/chipmate-vscode
bun run snapshot:build
```

The snapshot command packages the current-machine CLI binary and should not be treated as the Linux target package.

2. Copy the Linux-target `.vsix` file to the offline Linux machine.
3. In VS Code on Linux, run `Extensions: Install from VSIX...`.
4. Select the copied VSIX.
5. Reload VS Code when prompted.

Do not install Bun on the offline Linux machine for this manual test.

## Configure The Qwen Provider

ChipMate does not bundle a provider-free Qwen service. Qwen autocomplete requires a real custom provider that is connected in the current workspace and exposes the exact model ID `qwen-coder-30b0`.

Configure a connected custom provider in ChipMate with all of the following properties:

- provider type: `openai-compatible`
- model ID: `qwen-coder-30b0`
- a valid API key stored by ChipMate
- a base URL whose non-streaming completion endpoint is `/completions`

The Provider UI only needs to save the normal `options.baseURL` field. Do not add a hidden root-level `api` field or a model-level `provider.api` field to `opencode.json`. The Qwen FIM gateway resolves `options.baseURL` and appends `/completions` exactly once.

Chat and autocomplete exercise different upstream routes. A successful `/chat/completions` conversation does not prove that the provider supports the non-streaming `/completions` contract required by Qwen FIM.

ChipMate discovers the connected provider and stores its ID and model under the unified autocomplete settings. To inspect the effective selection, open VS Code settings JSON and confirm:

```json
{
  "chipmate-code.new.autocomplete.provider": "your-connected-provider-id",
  "chipmate-code.new.autocomplete.model": "qwen-coder-30b0",
  "chipmate-code.new.autocomplete.enableAutoTrigger": true,
  "chipmate.autocomplete.qwen.trace": true,
  "chipmate.autocomplete.qwen.logLevel": "debug",
  "chipmate.autocomplete.qwen.logPromptPreview": false,
  "chipmate.autocomplete.qwen.logCompletionPreview": true
}
```

Do not put the API key or endpoint into `chipmate.autocomplete.*`. Qwen requests go through the bundled local CLI and reuse the connected provider configuration and SecretStorage authentication.

## Choose Automatic Or An Explicit Provider

The first row in autocomplete settings is a mode, not a provider model:

```text
Automatic — Prefer Qwen
```

Automatic mode discovers a connected OpenAI-compatible provider containing the exact Qwen model. The real model appears under that provider's own group as:

```text
Qwen Coder FIM
```

Selecting the grouped row is an explicit provider/model selection. Selecting the top Automatic row lets ChipMate resolve the target. Internal offline builds do not silently start Codestral when no compatible Qwen provider exists; the settings and logs instead report that Qwen is unavailable. Public builds may use Codestral only when usable ChipMate Gateway authentication is present.

For lower-volume logs, use:

```json
{
  "chipmate.autocomplete.qwen.trace": true,
  "chipmate.autocomplete.qwen.logLevel": "info"
}
```

`info` logs lifecycle summaries without prompt or completion previews. `debug` logs the full diagnostic field set, still redacted. `trace=false` or `logLevel=off` disables lifecycle diagnostics.

## Open The Output Channel

Run:

```text
ChipMate: Show qwen-direct Autocomplete Logs
```

This opens the `ChipMate qwen-direct autocomplete` Output Channel. Each line is a JSON object.

To test only the CLI/provider transport, run:

```text
ChipMate: Test qwen-direct Transport
```

A successful transport probe confirms that the selected provider can answer `/chipmate/qwen-fim`; it does not prove that the ordinary editor inline provider is registered. Complete at least one editor ghost-text case below and confirm `requestSource=editor` before signing off. The smoke request is marked `requestSource=smoke`.

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
| QD-09 | Python | Inside an indented function body in a `.py` file | Ghost text preserves Python indentation and does not add C-style syntax. |
| QD-10 | Shell | Inside a function or conditional in a `.sh` file | Ghost text uses shell syntax and respects `#` comments. |
| QD-11 | Gitea Workflow | Inside `jobs.<job>.steps` in `.gitea/workflows/*.yml` or `.yaml` | Ghost text produces valid YAML indentation and workflow keys. |
| QD-12 | Ordinary YAML | Open a YAML file outside `.gitea/workflows` | No Qwen request is sent; diagnostics report `workflow-outside-gitea`. |

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

The export must not contain the API key, Authorization header, provider endpoint, full prompt, full source, or full absolute file paths.

## Share Logs For Debugging

Before sending diagnostics to Codex or another reviewer:

1. Search the exported `.jsonl` for the API key and remove the file if it appears.
2. Search for `Authorization` and remove the file if it appears.
3. Confirm prompt previews are absent unless you intentionally enabled `chipmate.autocomplete.qwen.logPromptPreview`.
4. Attach the reproduction template entries for failed cases and include the matching `requestId`.

Never upload an API key, provider URL or host, source text, a full prompt, an Authorization header, or an absolute path. Use the redacted Show Logs and Export Diagnostics commands instead.

The diagnostics are for observing current qwen-direct behavior only. A passing manual test does not prove model quality improved, and a failing case should be used to plan a later phase rather than changing runtime behavior during this observability phase.
