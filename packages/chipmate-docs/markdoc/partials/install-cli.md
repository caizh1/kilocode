Use ChipMate directly from your terminal for maximum flexibility.

### Install via npm

```bash
npm install -g @chipmate/cli
```

### Older CPUs (No AVX Support)

If you're running on an older CPU without AVX support (e.g., Intel Xeon Nehalem, AMD Bulldozer, or older), the CLI may crash with "Illegal instruction". In that case, download the **baseline** variant from GitHub releases:

1. Go to [ChipMate Releases](https://github.com/ChipMate-Org/chipmate/releases)
2. Download the `-baseline` variant for your platform:
   - Linux x64: `chipmate-linux-x64-baseline.tar.gz`
   - macOS x64: `chipmate-darwin-x64-baseline.zip`
   - Windows x64: `chipmate-windows-x64-baseline.zip`
3. Extract and run the `chipmate` binary directly

### Verify Installation

```bash
chipmate --version
```
