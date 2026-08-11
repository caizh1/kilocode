// chipmate_change - new file
import { Permission } from "@/permission"
import { NamedError } from "@opencode-ai/core/util/error"
import { Glob } from "@opencode-ai/core/util/glob"
import * as Truncate from "../../tool/truncate"
import { Config } from "../../config/config"
import type { Info as AgentInfo } from "../../agent/agent"
import { Schema } from "effect"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { Flag } from "@opencode-ai/core/flag/flag"
import { applyEdits, modify, parse as parseJsonc } from "jsonc-parser"

import PROMPT_DEBUG from "../../agent/prompt/debug.txt"
import PROMPT_ORCHESTRATOR from "../../agent/prompt/orchestrator.txt"
import PROMPT_ASK from "../../agent/prompt/ask.txt"
import PROMPT_EXPLORE from "../../agent/prompt/explore.txt"
import PROMPT_AGENT_CONSOLE from "./agent-console.txt"
import PROMPT_ULTRA from "./ultra.txt"
import PROMPT_DOCUMENT from "./document.txt"
import { applyInternalIndexingDefaults, isInternalOffline } from "../internal-offline"
import { ProductProfile } from "../product-profile"
import { DocumentAgentScope } from "../document-agent/scope"

export const bash: Record<string, "allow" | "ask" | "deny"> = {
  "*": "ask",
  "cat *": "allow",
  "head *": "allow",
  "tail *": "allow",
  "less *": "allow",
  "ls *": "allow",
  "tree *": "allow",
  "pwd *": "allow",
  "echo *": "allow",
  "wc *": "allow",
  "which *": "allow",
  "type *": "allow",
  "file *": "allow",
  "diff *": "allow",
  "du *": "allow",
  "df *": "allow",
  "date *": "allow",
  "uname *": "allow",
  "whoami *": "allow",
  "printenv *": "allow",
  "man *": "allow",
  "grep *": "allow",
  "rg *": "allow",
  "ag *": "allow",
  "sort *": "allow",
  "uniq *": "allow",
  "cut *": "allow",
  "tr *": "allow",
  "jq *": "allow",
  "touch *": "allow",
  "mkdir *": "allow",
  "cp *": "allow",
  "mv *": "allow",
  "tsc *": "allow",
  "tsgo *": "allow",
  "tar *": "allow",
  "unzip *": "allow",
  "gzip *": "allow",
  "gunzip *": "allow",
}

export const readOnlyBash: Record<string, "allow" | "ask" | "deny"> = {
  "*": "deny",
  "cat *": "allow",
  "head *": "allow",
  "tail *": "allow",
  "less *": "allow",
  "ls *": "allow",
  "tree *": "allow",
  "pwd *": "allow",
  "echo *": "allow",
  "wc *": "allow",
  "which *": "allow",
  "type *": "allow",
  "file *": "allow",
  "diff *": "allow",
  "du *": "allow",
  "df *": "allow",
  "date *": "allow",
  "uname *": "allow",
  "whoami *": "allow",
  "printenv *": "allow",
  "man *": "allow",
  "grep *": "allow",
  "rg *": "allow",
  "ag *": "allow",
  "sort *": "allow",
  "uniq *": "allow",
  "cut *": "allow",
  "tr *": "allow",
  "jq *": "allow",
  "git *": "deny",
  "git log *": "allow",
  "git show *": "allow",
  "git diff *": "allow",
  "git status *": "allow",
  "git blame *": "allow",
  "git rev-parse *": "allow",
  "git rev-list *": "allow",
  "git ls-files *": "allow",
  "git ls-tree *": "allow",
  "git ls-remote *": "allow",
  "git shortlog *": "allow",
  "git describe *": "allow",
  "git cat-file *": "allow",
  "git name-rev *": "allow",
  "git stash list *": "allow",
  "git tag -l *": "allow",
  "git branch --list *": "allow",
  "git branch -a *": "allow",
  "git branch -r *": "allow",
  "git remote -v *": "allow",
  "gh *": "ask",
  // Everything below is a blocklist layered on the allowlist above: it catches ways
  // an "allowed" read-only command can still write files, chain commands, or exec an
  // arbitrary program. This is defense-in-depth, not a sandbox — the durable fix is
  // OS-level sandboxing, not command-line string matching.
  // `*` matches any run of characters (including spaces and empty), so each rule
  // catches its operator anywhere. Broad forms subsume narrow ones: `*&*` covers
  // `&&`, and `*>*` covers `>`, `>>`, `>|`, and `>(` in any spacing.
  "*\n*": "deny",
  "*<(*": "deny",
  "*|*": "deny",
  "*;*": "deny",
  "*&*": "deny",
  "*$(*": "deny",
  "*`*": "deny",
  "*>*": "deny",
  // Short -o is space-anchored (two forms) so it never matches filenames like
  // `foo-o bar`; long flags use `*--flag*`, which is specific enough to bridge both
  // "flag first" and "flag after args" positions in one rule.
  "sort -o *": "deny",
  "sort * -o *": "deny",
  "sort *--output*": "deny",
  // Flags that make otherwise "read-only" commands exec an arbitrary program.
  "sort *--compress-program*": "deny",
  "sort *--files0-from*": "deny",
  "rg *--pre *": "deny",
  "rg *--pre=*": "deny",
  "rg *--hostname-bin*": "deny",
  "ag *--pager*": "deny",
  "man *-P*": "deny",
  "man *--pager*": "deny",
  "man *-H*": "deny",
}

function askGuard(mcp: Record<string, "allow" | "ask" | "deny"> = {}) {
  return Permission.fromConfig({
    "*": "deny",
    bash: readOnlyBash,
    read: {
      "*": "allow",
      "*.env": "ask",
      "*.env.*": "ask",
      "*.env.example": "allow",
    },
    grep: "allow",
    glob: "allow",
    list: "allow",
    skill: "allow",
    question: "allow",
    webfetch: "allow",
    websearch: "allow",
    codebase_search: "allow",
    codebase_analysis: "allow",
    semantic_search: "allow",
    render_plantuml_diagram: "allow",
    ...(isInternalOffline() ? { document_search: "allow" as const } : {}),
    external_directory: {
      [Truncate.GLOB]: "allow",
    },
    ...mcp,
  })
}

function denies(user: Permission.Ruleset) {
  return user.filter((rule) => rule.action === "deny")
}

function editRestrictions(rules: Permission.Ruleset) {
  const edit = rules.filter((rule) => rule.permission === "edit")
  return edit.filter((rule, index) => {
    if (rule.action !== "deny") return false
    if (rule.pattern !== "*") return true
    // A wildcard before a later edit exception is an allowlist baseline. The
    // plan guard supplies the source catch-all, so do not append it alone.
    return !edit.slice(index + 1).some((next) => next.action !== "deny")
  })
}

function restrictions(user: Permission.Ruleset) {
  return [...user.filter((rule) => rule.action === "deny" && rule.permission !== "edit"), ...editRestrictions(user)]
}

function askEditGuard() {
  return Permission.fromConfig({ edit: "deny" })
}

// Upstream v1.14.33 builds Agent state outside the Instance ALS, so reading
// Instance.worktree here would crash. Thread worktree through from patchAgents
// instead.
function planEditRules(worktree: string) {
  return {
    "*": "deny" as const,
    [path.join(ProductProfile.label(), "plans", "*.md")]: "allow" as const,
    [path.join("plans", "*.md")]: "allow" as const,
    [path.join(".plans", "*.md")]: "allow" as const,
    [path.join(".opencode", "plans", "*.md")]: "allow" as const,
    [path.relative(worktree, path.join(Global.Path.data, path.join("plans", "*.md")))]: "allow" as const,
  }
}

function planEditGuard(worktree: string) {
  return Permission.fromConfig({ edit: planEditRules(worktree) })
}

export function hardenPlan(
  key: string,
  item: { permission: Permission.Ruleset },
  worktree: string,
  ...explicit: Permission.Ruleset[]
) {
  if (key !== "plan" && key !== "architect") return
  const edit = explicit.map(editRestrictions)
  item.permission = Permission.merge(item.permission, planEditGuard(worktree), ...edit)
}

function planGuard(worktree: string, mcp: Record<string, "allow" | "ask" | "deny"> = {}) {
  return Permission.fromConfig({
    "*": "deny",
    question: "allow",
    suggest: "allow",
    skill: "allow",
    plan_exit: "allow",
    task: {
      "*": "allow",
      general: "deny",
    },
    bash: readOnlyBash,
    read: {
      "*": "allow",
      "*.env": "ask",
      "*.env.*": "ask",
      "*.env.example": "allow",
    },
    grep: "allow",
    glob: "allow",
    list: "allow",
    webfetch: "allow",
    websearch: "allow",
    codebase_search: "allow",
    codebase_analysis: "allow",
    semantic_search: "allow",
    render_plantuml_diagram: "allow",
    ...(isInternalOffline() ? { document_search: "allow" as const } : {}),
    external_directory: {
      [Truncate.GLOB]: "allow",
      [path.join(Global.Path.data, "plans", "*")]: "allow",
    },
    edit: planEditRules(worktree),
    ...mcp,
  })
}

// Generate per-server MCP wildcard rules that allow MCP tools with user approval.
export function getMcpRules(cfg: Config.Info): Record<string, "allow" | "ask" | "deny"> {
  const rules: Record<string, "allow" | "ask" | "deny"> = {}
  for (const key of Object.keys(cfg.mcp ?? {})) {
    const sanitized = key.replace(/[^a-zA-Z0-9_-]/g, "_")
    rules[sanitized + "_*"] = "ask"
  }
  return rules
}

export interface ChipMateData {
  mcpRules: Record<string, "allow" | "ask" | "deny">
  defaultsPatch: Permission.Ruleset
}

// Prepare chipmate-specific data derived from config. Call once per state initialization.
export function prepare(cfg: Config.Info): ChipMateData {
  const mcpRules = getMcpRules(cfg)
  const defaultsPatch = Permission.fromConfig({
    bash,
    recall: "ask",
    ...(Flag.CHIPMATE_CLIENT === "vscode" && cfg.experimental?.native_notebook_tools === true
      ? { notebook_read: "ask" as const, notebook_edit: "ask" as const, notebook_execute: "ask" as const }
      : {}),
    chipmate_memory_recall: "ask",
    chipmate_memory_save: "ask",
  })
  return { mcpRules, defaultsPatch }
}

export function cacheKey(cfg: Config.Info) {
  return JSON.stringify({
    agent: cfg.agent,
    default_agent: cfg.default_agent,
    mcp: cfg.mcp,
    mode: cfg.mode,
    permission: cfg.permission,
    native_notebook_tools: cfg.experimental?.native_notebook_tools,
    references: cfg.references,
    reference: cfg.reference,
  })
}

// Map "build" config key to "code" for backward compatibility.
export function resolveKey(name: string): string {
  return name === "build" ? "code" : name
}

// Remap "build" → "code" in agent config entries for backward compat in the config loop.
export function preprocessConfig<T>(agentConfig: Record<string, T>): Record<string, T> {
  const result: Record<string, T> = {}
  for (const [key, value] of Object.entries(agentConfig)) {
    result[key === "build" ? "code" : key] = value
  }
  return result
}

// Lift ChipMate-internal metadata onto typed agent fields and remove it from `options`.
// Older org modes and marketplace agents stored `displayName`/`source` inside the
// `options` record, which is otherwise forwarded verbatim to the provider as request
// parameters. Promoting then deleting them keeps `options` provider-clean at the source
// (the request boundary still strips as a safety net).
export function processConfigItem(item: {
  options: Record<string, unknown>
  displayName?: string
  source?: string
  deprecated?: boolean
}) {
  if (!item.displayName && typeof item.options?.displayName === "string") {
    item.displayName = item.options.displayName
  }
  if (!item.source && typeof item.options?.source === "string") {
    item.source = item.options.source
  }
  if (item.options) {
    delete item.options.displayName
    delete item.options.source
  }
}

export const DESIGN_DOC_WORKER = "design-doc-worker"
export const DESIGN_DOC_STRUCTURED_OUTPUT_TOOL = "StructuredOutput"
const locked = new Set(["compaction", "title", "summary", DESIGN_DOC_WORKER])
export const ULTRA_BASELINE = "ultra-code-baseline"
export const ULTRA_SYNTH = "ultra-synthesizer"

function hardRules() {
  return Permission.fromConfig({
    "*": "deny",
  })
}

export function designDocWorkerRules() {
  return Permission.fromConfig({
    "*": "deny",
    [DESIGN_DOC_STRUCTURED_OUTPUT_TOOL]: "allow",
  })
}

function lockedRules(name: string) {
  if (name === DocumentAgentScope.AGENT) return DocumentAgentScope.rules()
  return name === DESIGN_DOC_WORKER ? designDocWorkerRules() : hardRules()
}

function documentAgentEnabled() {
  return ProductProfile.chipmate && isInternalOffline()
}

function documentAgent(): AgentInfo {
  return {
    name: DocumentAgentScope.AGENT,
    displayName: "Document RAG",
    description: "只基于 Document RAG 作答，并在用户确认后按会话临时开放只读源码探索。",
    prompt: PROMPT_DOCUMENT,
    options: { id: DocumentAgentScope.AGENT },
    permission: [...DocumentAgentScope.rules()],
    mode: "primary",
    native: true,
  }
}

function agentConsole(): AgentInfo {
  return {
    name: "agent-console",
    description: "Terminal-native assistant for the persistent ChipMate Agent Console shell.",
    prompt: PROMPT_AGENT_CONSOLE,
    options: {},
    permission: Permission.fromConfig({
      "*": "deny",
      agent_console_shell: "ask",
    }),
    mode: "primary",
    native: true,
    hidden: true,
  }
}

function designDocWorker(): AgentInfo {
  return {
    name: DESIGN_DOC_WORKER,
    description: "Hidden worker that converts a bounded source evidence pack into one atomic DesignDoc IR.",
    prompt: [
      "你只处理一个模块的一种原子设计产物。",
      "只能使用输入 Evidence Pack 中的事实；没有证据时必须写入 unknowns，禁止补写或猜测源码行为。",
      "不得规划其他任务、创建子 Agent、搜索或修改源码、渲染图、发布文档或判断整个 Job 完成。",
      "最终只调用 StructuredOutput 一次并返回符合当前 Schema 的 IR。",
    ].join("\n"),
    options: { id: DESIGN_DOC_WORKER },
    permission: designDocWorkerRules(),
    mode: "subagent",
    native: true,
    hidden: true,
  }
}

export function harden(item?: { name: string; permission: Permission.Ruleset }) {
  if (!item) return
  if (!locked.has(item.name) && !(item.name === DocumentAgentScope.AGENT && documentAgentEnabled())) return
  item.permission = [...lockedRules(item.name)]
}

export function hardenSystemAgents(agents: Record<string, AgentInfo>) {
  for (const [key, item] of Object.entries(agents)) {
    if (locked.has(key) || (key === DocumentAgentScope.AGENT && documentAgentEnabled())) {
      item.permission = [...lockedRules(key)]
      continue
    }
    harden(item)
  }
  agents["agent-console"] = agentConsole()
  agents[DESIGN_DOC_WORKER] = designDocWorker()
  if (documentAgentEnabled()) agents[DocumentAgentScope.AGENT] = documentAgent()
  delete agents[ULTRA_BASELINE]
  delete agents[ULTRA_SYNTH]
  if (!ProductProfile.chipmate || !agents.ultra || !agents.code || !agents.ask) {
    if (!agents.code) delete agents.ultra
    return
  }
  agents[ULTRA_BASELINE] = {
    ...agents.code,
    name: ULTRA_BASELINE,
    description: "Hidden read-only Code author used only by the native ChipMate Ultra evidence pipeline.",
    permission: Permission.merge(
      agents.code.permission,
      Permission.fromConfig({
        edit: "deny",
        bash: "deny",
        notebook_edit: "deny",
        notebook_execute: "deny",
        question: "deny",
        interactive_terminal: "deny",
        suggest: "deny",
        plan_enter: "deny",
        plan_exit: "deny",
      }),
    ),
    options: {
      ...agents.code.options,
      id: ULTRA_BASELINE,
    },
    mode: "subagent",
    native: true,
    hidden: true,
  }
  agents[ULTRA_SYNTH] = {
    ...agents.ask,
    name: ULTRA_SYNTH,
    description: "Hidden read-only Ask author used only to synthesize native ChipMate Ultra verification results.",
    options: {
      ...agents.ask.options,
      id: ULTRA_SYNTH,
    },
    mode: "subagent",
    native: true,
    hidden: true,
  }
}

// Returns experimental_telemetry config for generate calls.
// AI SDK span recording (ai.* / gen_ai.*) is disabled.
export function telemetryOptions(_cfg: Config.Info) {
  return { isEnabled: false as const }
}

// Patch the base agents map in-place with all chipmate-specific changes:
// - Rename build → code
// - Patch plan with readOnlyBash, mcpRules, .chipmate paths
// - Patch explore with codebase_search and conditional prompt
// - Patch appropriate agents with semantic_search and codebase_analysis
// - Add ChipMate ultra and the debug, orchestrator, ask agents
export function patchAgents(
  agents: Record<string, AgentInfo>,
  defaults: Permission.Ruleset,
  user: Permission.Ruleset,
  cfg: Config.Info,
  chipmate: ChipMateData,
  worktree: string,
  whitelistedDirs: string[],
) {
  const internal = isInternalOffline()

  agents["agent-console"] = agentConsole()
  agents[DESIGN_DOC_WORKER] = designDocWorker()
  if (documentAgentEnabled()) agents[DocumentAgentScope.AGENT] = documentAgent()

  // Rename "build" → "code" for backward compatibility
  if (agents.build) {
    const retrieval = Permission.fromConfig({
      codebase_analysis: "allow",
      semantic_search: "allow",
      ...(internal ? { document_search: "allow" as const } : {}),
    })
    agents.code = {
      ...agents.build,
      name: "code",
      permission: internal
        ? Permission.merge(defaults, agents.build.permission, retrieval, user)
        : Permission.merge(defaults, agents.build.permission, user, retrieval),
    }
    delete agents.build
  }

  if (ProductProfile.chipmate && agents.code) {
    agents.ultra = {
      ...agents.code,
      name: "ultra",
      description: "Code agent with mandatory parallel Explore investigations before every response.",
      prompt: PROMPT_ULTRA,
      options: {
        ...agents.code.options,
        id: "ultra",
      },
      mode: "primary",
      native: true,
    }
  }

  // Patch plan mode
  if (agents.plan) {
    agents.plan = {
      ...agents.plan,
      description: "Plan mode. Can only edit plan files; all other filesystem mutations are denied.",
      permission: Permission.merge(
        defaults,
        planGuard(worktree, chipmate.mcpRules),
        user,
        planEditGuard(worktree),
        restrictions(user),
      ),
    }
  }

  // Patch explore with codebase_search and conditional prompt
  if (agents.explore) {
    const prompt = cfg.experimental?.codebase_search
      ? `Prefer using the codebase_search tool for codebase searches — it performs intelligent multi-step code search and returns the most relevant code spans.\n\n${PROMPT_EXPLORE}`
      : PROMPT_EXPLORE
    const indexing = applyInternalIndexingDefaults(cfg.indexing, internal)
    const retrieval = [
      "Use the retrieval route that best matches the question before broad manual exploration:",
      indexing?.enabled === true
        ? "- Use semantic_search first for unfamiliar concepts when you do not know the exact identifier."
        : undefined,
      indexing?.documents?.enabled === true
        ? "- Use document_search first for questions grounded in indexed documents, including approved external documents. If the user explicitly asks to consult indexed or external documents, call it before answering; omit path to search every configured document root."
        : undefined,
      "- Use Grep for exact identifiers or text, Glob for filenames, and Read to verify evidence.",
      "- If an index is not ready, fall back to Grep, Glob, and Read for this request; do not repeatedly retry the retrieval tool.",
    ]
      .filter((item): item is string => item !== undefined)
      .join("\n")
    agents.explore = {
      ...agents.explore,
      permission: Permission.merge(
        defaults,
        Permission.fromConfig({
          "*": "deny",
          grep: "allow",
          glob: "allow",
          list: "allow",
          bash: "allow",
          skill: "allow",
          webfetch: "allow",
          websearch: "allow",
          codebase_search: "allow",
          codebase_analysis: "allow",
          semantic_search: "allow",
          ...(internal ? { document_search: "allow" as const } : {}),
          read: "allow",
          external_directory: {
            // Mirror upstream explore's shape: the outer "*": "deny" above wins
            // over defaults' external_directory rules via findLast, so re-apply
            // the full whitelist (Truncate.GLOB, tmp, skill, config, globalDirs)
            // here. Upstream adds these inline in agent.ts; we do the same from
            // within the patch.
            "*": "ask",
            ...Object.fromEntries(whitelistedDirs.map((dir) => [dir, "allow"])),
          },
        }),
        user,
      ),
      prompt: internal ? `${retrieval}\n\n${prompt}` : prompt,
    }
  }

  // Add debug agent
  agents.debug = {
    name: "debug",
    description: "Diagnose and fix software issues with systematic debugging methodology.",
    prompt: PROMPT_DEBUG,
    options: {},
    permission: Permission.merge(
      defaults,
      Permission.fromConfig({
        question: "allow",
        suggest: "allow", // chipmate_change
        plan_enter: "allow",
        codebase_analysis: "allow",
        semantic_search: "allow",
        ...(internal ? { document_search: "allow" as const } : {}),
      }),
      user,
    ),
    mode: "primary",
    native: true,
  }

  // Add orchestrator agent
  agents.orchestrator = {
    name: "orchestrator",
    description: "Coordinate complex tasks by delegating to specialized agents in parallel.",
    prompt: PROMPT_ORCHESTRATOR,
    options: {},
    permission: Permission.merge(
      defaults,
      Permission.fromConfig({
        "*": "deny",
        read: "allow",
        grep: "allow",
        glob: "allow",
        list: "allow",
        question: "allow",
        skill: "allow",
        suggest: "allow", // chipmate_change
        task: "allow",
        todoread: "allow",
        todowrite: "allow",
        webfetch: "allow",
        websearch: "allow",
        codebase_search: "allow",
        external_directory: {
          [Truncate.GLOB]: "allow",
        },
      }),
      user,
      // Enforce bash deny after user so user config cannot re-enable shell
      Permission.fromConfig({
        bash: "deny",
      }),
    ),
    mode: "primary",
    native: true,
    deprecated: true,
    hidden: true,
  }

  // Add ask agent
  agents.ask = {
    name: "ask",
    description: "Get answers and explanations without making changes to the codebase.",
    prompt: PROMPT_ASK,
    options: {},
    permission: Permission.merge(defaults, askGuard(chipmate.mcpRules), user, askEditGuard(), denies(user)),
    mode: "primary",
    native: true,
  }

  hardenSystemAgents(agents)
}

export const RemoveError = NamedError.create("AgentRemoveError", {
  name: Schema.String,
  message: Schema.String,
})

/**
 * Remove a custom agent by deleting its markdown source file, removing it from
 * config-backed agent entries, and/or removing it from legacy .chipmatemodes YAML files.
 * Scans all config directories for agent/mode .md files matching the name,
 * then also checks the .chipmatemodes files the ModesMigrator reads.
 */
export async function remove(input: { name: string; agent?: AgentInfo; dirs: string[]; directory: string }) {
  if (!input.agent) throw new RemoveError({ name: input.name, message: "agent not found" })
  if (input.agent.native) throw new RemoveError({ name: input.name, message: "cannot remove native agent" })
  // Prevent removal of organization-managed agents
  if (input.agent.source === "organization" || input.agent.options?.source === "organization")
    throw new RemoveError({
      name: input.name,
      message: "cannot remove organization agent — manage it from the cloud dashboard",
    })

  const { unlink, writeFile } = await import("fs/promises")
  let found = false

  // 1. Delete .md files from config directories
  const patterns = ["{agent,agents}/**/" + input.name + ".md", "{mode,modes}/" + input.name + ".md"]
  for (const dir of input.dirs) {
    for (const pattern of patterns) {
      const matches = await Glob.scan(pattern, { cwd: dir, absolute: true, dot: true })
      for (const file of matches) {
        if (await Bun.file(file).exists()) {
          await unlink(file)
          found = true
        }
      }
    }
  }

  if (await removeConfigAgent(input.name, input.directory)) found = true

  if (ProductProfile.chipmate) {
    if (!found) throw new RemoveError({ name: input.name, message: "no agent file found on disk" })
    return
  }

  // 2. Remove from legacy .chipmatemodes YAML files (read by ModesMigrator)
  const { ModesMigrator } = await import("@/chipmate/modes-migrator")
  const { ChipMatePaths } = await import("@/chipmate/paths")
  const os = await import("os")
  const matter = (await import("gray-matter")).default
  const home = os.default.homedir()
  const modesFiles = [
    path.join(ChipMatePaths.vscodeGlobalStorage(), "settings", "custom_modes.yaml"),
    path.join(home, ".chipmate", "cli", "global", "settings", "custom_modes.yaml"),
    path.join(home, ".chipmatemodes"),
    path.join(input.directory, ".chipmatemodes"),
  ]

  for (const file of modesFiles) {
    const modes = await ModesMigrator.readModesFile(file)
    if (!modes.length) continue

    const filtered = modes.filter((m: { slug: string }) => m.slug !== input.name)
    if (filtered.length === modes.length) continue

    // Rewrite the file without the removed mode
    const yaml = matter
      .stringify("", { customModes: filtered })
      .replace(/^---\n/, "")
      .replace(/\n---\n?$/, "")
    await writeFile(file, yaml)
    found = true
  }

  if (!found) throw new RemoveError({ name: input.name, message: "no agent file found on disk" })
}

async function removeConfigAgent(name: string, directory: string) {
  const { ChipMateConfigOverlay } = await import("@/chipmate/config/overlay")
  const files = [ChipMateConfigOverlay.globalTarget(), await ChipMateConfigOverlay.projectTarget({ directory })]
  let found = false

  for (const file of new Set(files)) {
    const cfg = Bun.file(file)
    if (!(await cfg.exists())) continue

    const text = await cfg.text()
    const root = parseJsonc(text)
    if (!root?.agent || !Object.hasOwn(root.agent, name)) continue

    const opts = { formattingOptions: { insertSpaces: true, tabSize: 2 } }
    const next = applyEdits(text, modify(text, ["agent", name], undefined, opts))
    const parsed = parseJsonc(next)
    const final =
      parsed.default_agent === name ? applyEdits(next, modify(next, ["default_agent"], undefined, opts)) : next
    await Bun.write(file, final)
    found = true
  }

  return found
}
