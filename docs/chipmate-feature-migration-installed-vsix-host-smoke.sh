#!/usr/bin/env bash

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUN_STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_ID="${RUN_STAMP}-${BASHPID:-$$}-${RANDOM}"
RUN_DIR="${VALIDATION_RUN_DIR:-${REPO_ROOT}/docs/chipmate-feature-migration-validation-runs/${RUN_ID}-installed-vsix-host-smoke}"
SHORT_ROOT="${SHORT_ROOT:-/tmp/chipmate-installed-smoke-${RUN_ID}}"
WORKSPACE_DIR="${WORKSPACE_DIR:-${SHORT_ROOT}/workspace}"
VSCODE_TEST_ROOT="${VSCODE_TEST_ROOT:-${REPO_ROOT}/packages/chipmate-vscode/.vscode-test/vscode-darwin-arm64-1.127.0/Visual Studio Code.app}"
CODE_BIN="${CODE_BIN:-${VSCODE_TEST_ROOT}/Contents/Resources/app/bin/code}"
CODE_EXE="${CODE_EXE:-${VSCODE_TEST_ROOT}/Contents/MacOS/Electron}"
NODE_MODULES_DIR="${NODE_MODULES_DIR:-${REPO_ROOT}/packages/chipmate-vscode/node_modules}"

usage() {
  cat <<'USAGE'
Installed VSIX extension-host smoke for ChipMate/ChipMate migration validation.

Usage:
  bash docs/chipmate-feature-migration-installed-vsix-host-smoke.sh <vsix-path>

Environment:
  VALIDATION_RUN_DIR  Optional output directory.
  WORKSPACE_DIR       Workspace opened by VS Code. Defaults to a temporary workspace under SHORT_ROOT.
  VSCODE_TEST_ROOT    Existing VS Code test .app root.
  CODE_BIN            Existing VS Code CLI path.
  CODE_EXE            Existing VS Code executable path.
  NODE_MODULES_DIR    Node modules containing vscode-test.
  SHORT_ROOT          Short temp root for user-data and extensions dirs.
  SKIP_SIDECAR_SMOKE  Set to 1 when validating only installation, activation, and contributions.

Notes:
  - This smoke installs the VSIX into an isolated short-path extensions-dir.
  - It activates installed chipmate.chipmate through a temporary harness extension.
  - It verifies installed extension activation plus key native and sidecar contributions.
  - It does not run installed chat prompts S1-S16 or target OS GUI/runtime smoke.
USAGE
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if [[ "$#" -lt 1 ]]; then
  usage >&2
  exit 2
fi

VSIX_INPUT="$1"
if [[ "$VSIX_INPUT" = /* ]]; then
  VSIX_PATH="$VSIX_INPUT"
else
  VSIX_PATH="${REPO_ROOT}/${VSIX_INPUT}"
fi

if [[ ! -f "$VSIX_PATH" ]]; then
  echo "VSIX not found: ${VSIX_PATH}" >&2
  exit 2
fi

if [[ ! -x "$CODE_BIN" ]]; then
  echo "VS Code CLI not executable: ${CODE_BIN}" >&2
  exit 2
fi

if [[ ! -x "$CODE_EXE" ]]; then
  echo "VS Code executable not executable: ${CODE_EXE}" >&2
  exit 2
fi

mkdir -p "$RUN_DIR" "$SHORT_ROOT" "$WORKSPACE_DIR"
if [[ ! -f "${WORKSPACE_DIR}/smoke.c" ]]; then
  cat >"${WORKSPACE_DIR}/smoke.c" <<'C'
int smoke_add(int a, int b) {
  return a + b;
}
C
fi

HARNESS="${SHORT_ROOT}/harness"
EXT_DIR="${SHORT_ROOT}/ext"
USER_DIR="${SHORT_ROOT}/user"
mkdir -p "$HARNESS/test" "$EXT_DIR" "$USER_DIR"

"$CODE_BIN" --install-extension "$VSIX_PATH" --force --extensions-dir "$EXT_DIR" --user-data-dir "$USER_DIR" >"${RUN_DIR}/install.log" 2>&1
install_rc=$?

cat >"${HARNESS}/package.json" <<'JSON'
{
  "name": "chipmate-installed-vsix-smoke-harness",
  "displayName": "ChipMate Installed VSIX Smoke Harness",
  "publisher": "chipmate-test",
  "version": "0.0.1",
  "engines": { "vscode": "^1.93.0" },
  "activationEvents": ["*"],
  "main": "./extension.js"
}
JSON

cat >"${HARNESS}/extension.js" <<'JS'
function activate() {}
function deactivate() {}
module.exports = { activate, deactivate }
JS

ln -sfn "$NODE_MODULES_DIR" "${HARNESS}/node_modules"

cat >"${HARNESS}/.vscode-test.mjs" <<EOF
export default {
  files: "test/**/*.test.js",
  extensionDevelopmentPath: ".",
  workspaceFolder: "${WORKSPACE_DIR}",
  useInstallation: { fromPath: "${CODE_EXE}" },
  launchArgs: [
    "--extensions-dir", "${EXT_DIR}",
    "--user-data-dir", "${USER_DIR}",
    "--disable-workspace-trust",
    "--skip-welcome",
    "--skip-release-notes"
  ],
}
EOF

cat >"${HARNESS}/test/installed-smoke.test.js" <<'JS'
const assert = require("assert")
const path = require("path")
const vscode = require("vscode")

suite("Installed ChipMate VSIX smoke", () => {
  test("activates installed chipmate.chipmate and keeps native plus sidecar contributions", async function () {
    this.timeout(30000)

    const extension = vscode.extensions.getExtension("chipmate.chipmate")
    assert.ok(extension, "installed chipmate.chipmate extension must be discoverable")
    assert.ok(
      extension.extensionPath.includes(`${path.sep}ext${path.sep}`),
      `subject extension must come from isolated installed extensions dir, got ${extension.extensionPath}`,
    )

    await extension.activate()
    assert.strictEqual(extension.isActive, true, "installed chipmate.chipmate extension must activate")

    const commands = await vscode.commands.getCommands(true)
    for (const command of [
      "chipmate-code.new.agentManagerOpen",
      "chipmate-code.new.settingsButtonClicked",
      "chipmate-code.new.generateTerminalCommand",
      "chipmate-code.new.documents.openArtifact",
      "chipmate-code.new.documents.exportDiagnostics",
      "chipmate-code.new.agentTerminal.open",
      "chipmate-code.new.qwenAutocomplete.showLogs",
      "chipmate-code.new.qwenAutocomplete.exportDiagnostics",
      "chipmate-code.new.qwenAutocomplete.smokeDiagnostics",
      "chipmate-code.new.autocomplete.generateSuggestions",
      "chipmate-code.new.terminalFixCommand",
    ]) {
      assert.ok(commands.includes(command), `${command} must be registered by installed extension`)
    }

    const config = vscode.workspace.getConfiguration()
    assert.strictEqual(config.get("chipmate.documents.artifacts.root"), ".chipmate/artifacts")
    assert.strictEqual(config.get("chipmate.documents.tools.enabled"), true)
    assert.strictEqual(config.get("chipmate.agentTerminal.enabled"), false)
    assert.strictEqual(config.get("chipmate.autocomplete.enabled"), false)
    assert.strictEqual(config.get("chipmate.autocomplete.provider"), "none")
    assert.ok(config.has("chipmate.autocomplete.qwen.model"))
    assert.strictEqual(config.get("chipmate.autocomplete.qwen.model"), "qwen-coder-30b0")
    assert.strictEqual(config.has("chipmate.autocomplete.qwen.endpoint"), false)
    assert.strictEqual(config.has("chipmate.autocomplete.qwen.apiKey"), false)
    assert.ok(config.has("chipmate-code.new.autocomplete.provider"))
    assert.ok(config.has("chipmate-code.new.autocomplete.model"))

    const contributes = extension.packageJSON.contributes
    assert.ok((contributes.terminal?.profiles ?? []).some((profile) => profile.id === "chipmate.agentTerminal"))
    assert.ok((contributes.views?.["chipmate-code-ActivityBar"] ?? []).some((view) => view.id === "chipmate-code.SidebarProvider"))
  })

  const sidecar = process.env.SKIP_SIDECAR_SMOKE === "1" ? test.skip : test
  sidecar("executes safe installed sidecar commands without replacing native commands", async function () {
    this.timeout(30000)

    const fs = require("fs/promises")
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    assert.ok(workspace, "workspace folder is required")

    const artifactRoot = path.join(workspace, ".chipmate", "artifacts")
    const artifactName = `installed-host-smoke-${Date.now()}`
    const artifactDir = path.join(artifactRoot, artifactName)
    await fs.mkdir(artifactDir, { recursive: true })
    await fs.writeFile(path.join(artifactDir, "report.md"), "# Installed host smoke\n", "utf8")
    await fs.writeFile(
      path.join(artifactDir, "artifact.json"),
      `${JSON.stringify(
        {
          kind: "installed-host-smoke",
          title: "Installed host smoke",
          primaryFile: "report.md",
          derivedFiles: [],
          warnings: [],
          quality: { status: "unknown" },
        },
        null,
        2,
      )}\n`,
      "utf8",
    )

    const beforeDiagnostics = new Set((await fs.readdir(artifactRoot)).filter((item) => /^artifact-diagnostics-.*\.json$/.test(item)))
    await vscode.commands.executeCommand("chipmate-code.new.documents.openArtifact", `.chipmate/artifacts/${artifactName}/report.md`)
    await vscode.commands.executeCommand("chipmate-code.new.documents.exportDiagnostics")
    const afterDiagnostics = (await fs.readdir(artifactRoot)).filter((item) => /^artifact-diagnostics-.*\.json$/.test(item))
    assert.ok(afterDiagnostics.some((item) => !beforeDiagnostics.has(item)), "document artifact diagnostics command must write a diagnostics JSON file")

    await vscode.workspace.getConfiguration().update("chipmate.agentTerminal.enabled", true, vscode.ConfigurationTarget.Workspace)
    await vscode.commands.executeCommand("chipmate-code.new.agentTerminal.open")
    await new Promise((resolve) => setTimeout(resolve, 250))
    await fs.stat(path.join(workspace, ".chipmate", "agent-terminal", "agent-terminal.sh"))
    await fs.stat(path.join(workspace, ".chipmate", "agent-terminal", "context.md"))

    await vscode.commands.executeCommand("chipmate-code.new.qwenAutocomplete.showLogs")
  })
})
JS

{
  echo "# Installed VSIX extension-host smoke"
  echo
  echo "VSIX: \`${VSIX_PATH}\`"
  echo "VS Code executable: \`${CODE_EXE}\`"
  echo "Workspace: \`${WORKSPACE_DIR}\`"
  echo "Short root: \`${SHORT_ROOT}\`"
  echo "Extensions dir: \`${EXT_DIR}\`"
  echo "User data dir: \`${USER_DIR}\`"
  echo
  echo "Install exit code: ${install_rc}"
  echo
  echo "## Install log tail"
  echo
  echo '```text'
  tail -40 "${RUN_DIR}/install.log"
  echo '```'
  echo
} >"${RUN_DIR}/summary.md"

if [[ "$install_rc" -ne 0 ]]; then
  rc="$install_rc"
else
  (
    cd "$HARNESS" && "${NODE_MODULES_DIR}/.bin/vscode-test" --fail-zero --timeout 30000
  ) >"${RUN_DIR}/command.log" 2>&1
  rc=$?
fi

{
  echo "Test exit code: ${rc}"
  echo
  echo "## Test log tail"
  echo
  echo '```text'
  if [[ -f "${RUN_DIR}/command.log" ]]; then
    tail -180 "${RUN_DIR}/command.log"
  else
    echo "test not run"
  fi
  echo '```'
} >>"${RUN_DIR}/summary.md"

echo "RUN_DIR=${RUN_DIR}"
echo "EXIT_CODE=${rc}"
exit "$rc"
