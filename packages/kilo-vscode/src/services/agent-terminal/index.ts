import fs from "fs/promises"
import path from "path"
import * as vscode from "vscode"
import { projectContextSummary } from "./runtime"

const CONFIG_ENABLED = "kilo.agentTerminal.enabled"
const PROFILE_ID = "kilo.agentTerminal"

export function registerAgentTerminal(context: vscode.ExtensionContext, openConsole: () => void): void {
  const service = new AgentTerminalService(openConsole)
  context.subscriptions.push(
    vscode.commands.registerCommand("kilo-code.new.agentTerminal.open", async () => service.openFromCommand()),
    vscode.window.registerTerminalProfileProvider(PROFILE_ID, {
      provideTerminalProfile: async () => service.profile(),
    }),
  )
}

class AgentTerminalService {
  constructor(private readonly openConsole: () => void) {}

  async openFromCommand(): Promise<void> {
    this.openConsole()
  }

  async profile(): Promise<vscode.TerminalProfile | undefined> {
    if (!(await ensureEnabled())) return undefined
    const workspace = workspaceRoot()
    const helper = await ensureHelperFiles(workspace)
    return new vscode.TerminalProfile({
      name: "Kilo Agent Terminal (Legacy)",
      cwd: workspace,
      env: {
        KILO_AGENT_TERMINAL: "1",
        KILO_AGENT_TERMINAL_HELPER: helper.shell,
        KILO_AGENT_TERMINAL_CONTEXT: helper.context,
      },
    })
  }
}

async function ensureEnabled(): Promise<boolean> {
  const enabled = vscode.workspace.getConfiguration().get<boolean>(CONFIG_ENABLED, false)
  if (enabled) return true
  const choice = await vscode.window.showWarningMessage(
    "Kilo Agent Terminal is disabled by default. Enable it for this workspace?",
    "Enable for Workspace",
    "Cancel",
  )
  if (choice !== "Enable for Workspace") return false
  await vscode.workspace.getConfiguration().update(CONFIG_ENABLED, true, vscode.ConfigurationTarget.Workspace)
  return true
}

async function ensureHelperFiles(workspace: string): Promise<{ shell: string; context: string }> {
  const root = path.join(workspace, ".kilo", "agent-terminal")
  await fs.mkdir(root, { recursive: true })
  const shell = path.join(root, "agent-terminal.sh")
  const context = path.join(root, "context.md")
  await fs.writeFile(shell, shellHelper(), { mode: 0o755 })
  await fs.writeFile(context, await projectContextSummary(workspace), "utf8")
  return { shell, context }
}

function startupCommand(shell: string, context: string): string {
  const qShell = shell.replace(/'/g, "'\\''")
  const qContext = context.replace(/'/g, "'\\''")
  return `source '${qShell}' && kilo_agent_intro '${qContext}'`
}

function workspaceRoot(): string {
  const folder = vscode.workspace.workspaceFolders?.[0]
  if (!folder) throw new Error("A workspace folder is required to open Kilo Agent Terminal.")
  return folder.uri.fsPath
}

function shellHelper(): string {
  return String.raw`# Kilo Agent Terminal helper
# This helper is intentionally local and deterministic. It does not replace Kilo's native shell/tool loop.

kilo_agent_intro() {
  local ctx="\${1:-$KILO_AGENT_TERMINAL_CONTEXT}"
  echo "Kilo Agent Terminal"
  echo "Workspace context: \${ctx}"
  echo ""
  echo "Helpers:"
  echo "  kilo_plan_command \"show git status\""
  echo "  kilo_check_command \"rm -rf /tmp/example\""
  echo "  kilo_run_checked \"git status --short\""
  echo "  kilo_summarize_output path/to/log.txt"
  echo "  kilo_suggest_fix 1 path/to/log.txt"
  echo "  kilo_save_log_artifact path/to/log.txt \"Build log\""
  echo ""
}

kilo_plan_command() {
  local prompt="$*"
  local lower
  lower="$(printf "%s" "$prompt" | tr '[:upper:]' '[:lower:]')"
  local command="$prompt"
  case "$lower" in
    *"git status"*|*"status"*) command="git status --short" ;;
    *"current branch"*|*"branch"*) command="git branch --show-current" ;;
    *"list"*|*"files"*|*"目录"*|*"文件"*) command="ls -la" ;;
    *"disk"*|*"space"*|*"磁盘"*) command="df -h ." ;;
    *"large"*|*"big"*|*"大文件"*) command="find . -type f -size +50M -print" ;;
    *"test"*|*"测试"*) command="bun test" ;;
    *"compile"*|*"typecheck"*|*"编译"*) command="bun run compile" ;;
    *"lint"*) command="bun run lint" ;;
  esac
  echo "$command"
  kilo_check_command "$command"
}

kilo_check_command() {
  local command="$*"
  if printf "%s" "$command" | grep -E '(^|[;&|[:space:]])(sudo|mkfs|dd[[:space:]].*of=|git[[:space:]]+reset[[:space:]]+--hard|git[[:space:]]+clean[[:space:]].*-[a-zA-Z]*[fx]|rm[[:space:]]+-[a-zA-Z]*r[a-zA-Z]*f)' >/dev/null; then
    echo "Risk: danger"
    echo "Reason: can delete, overwrite, escalate privileges, or rewrite history"
    return 2
  fi
  if printf "%s" "$command" | grep -E '(^|[;&|[:space:]])(git[[:space:]]+push|git[[:space:]]+commit|bun[[:space:]]+(install|update)|npm[[:space:]]+(install|update|audit[[:space:]]+fix)|pnpm[[:space:]]+(install|update)|yarn[[:space:]]+(install|upgrade)|docker[[:space:]]+(rm|rmi|system[[:space:]]+prune)|chmod[[:space:]]+-R|chown[[:space:]]+-R)' >/dev/null; then
    echo "Risk: review"
    echo "Reason: changes repository, dependencies, containers, or permissions"
    return 1
  fi
  echo "Risk: safe"
  echo "Reason: read-only or local inspection command"
  return 0
}

kilo_run_checked() {
  local command="$*"
  kilo_check_command "$command"
  local risk=$?
  if [ "$risk" -ne 0 ]; then
    printf "Type RUN to execute anyway: "
    read -r answer
    if [ "$answer" != "RUN" ]; then
      echo "Cancelled."
      return 130
    fi
  fi
  eval "$command"
}

kilo_summarize_output() {
  local file="$1"
  local lines="\${2:-80}"
  if [ ! -f "$file" ]; then echo "File not found: $file"; return 1; fi
  local count
  count="$(wc -l < "$file" | tr -d ' ')"
  echo "Lines: $count"
  if [ "$count" -le "$lines" ]; then
    cat "$file"
    return 0
  fi
  local keep=$((lines / 2))
  echo "--- head ---"
  head -n "$keep" "$file"
  echo "--- tail ---"
  tail -n "$keep" "$file"
}

kilo_suggest_fix() {
  local exit_code="$1"
  local file="$2"
  local text=""
  [ -f "$file" ] && text="$(cat "$file")"
  printf "%s" "$text" | grep -Ei 'command not found|not recognized' >/dev/null && echo "- Check whether the executable is installed and available in PATH."
  printf "%s" "$text" | grep -Ei 'permission denied|eacces' >/dev/null && echo "- Check file permissions; avoid sudo unless you explicitly understand the target path."
  printf "%s" "$text" | grep -Ei 'enoent|no such file or directory' >/dev/null && echo "- Verify the current working directory and file path."
  printf "%s" "$text" | grep -Ei 'typescript|tsc|type error|cannot find module' >/dev/null && echo "- Inspect TypeScript/module resolution errors before retrying."
  printf "%s" "$text" | grep -Ei 'network|econnrefused|etimedout|timeout' >/dev/null && echo "- Check network/proxy/service availability and retry with a smaller scoped command."
  [ "$exit_code" != "0" ] && echo "- Command exited with $exit_code; rerun the narrowest failing command after the first error is fixed."
}

kilo_save_log_artifact() {
  local file="$1"
  local title="\${2:-Agent Terminal Log}"
  if [ ! -f "$file" ]; then echo "File not found: $file"; return 1; fi
  local slug
  slug="$(printf "%s" "$title" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g')"
  [ -z "$slug" ] && slug="agent-terminal-log"
  local stamp
  stamp="$(date +%Y%m%d-%H%M%S)"
  local dir=".kilo/artifacts/\${stamp}-\${slug}"
  mkdir -p "$dir"
  cp "$file" "$dir/terminal.log"
  cat > "$dir/artifact.json" <<JSON
{
  "kind": "agent-terminal-log",
  "title": "$title",
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "updatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "primaryFile": "terminal.log",
  "derivedFiles": [],
  "sourceFiles": ["$file"],
  "warnings": [],
  "quality": { "status": "unknown" }
}
JSON
  echo "$dir/terminal.log"
}
`
}
