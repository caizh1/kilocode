# ChipMate full real-user regression

This QA-only suite combines the 286 historical plugin assertions with public ChipMate Service user actions. It never uses a local service as a substitute for the configured remote target.

```bash
cd packages/kilo-vscode
node qa/full-real/service-generate.mjs
node qa/full-real/run.mjs \
  --base http://127.0.0.1:6002 \
  --macos ../../chipmate-0.0.88-darwin-arm64.vsix \
  --windows ../../chipmate-0.0.88-win32-x64-baseline.vsix \
  --output ../../qa-results-0.0.88-full-real-20260718
```

The read-only probe stores response metadata and hashes, not bodies or credentials. Authentication and mutation cases remain `BLOCKED` until owner and non-owner QA identities are entered interactively. Permanent remote deletion still requires action-time confirmation.
