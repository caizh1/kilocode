/**
 * Architecture test: package.json ↔ source command sync
 *
 * Every command declared in package.json contributes.commands must have a
 * matching registerCommand() call somewhere in src/. A declaration without
 * an implementation causes a silent "command not found" error at runtime
 * that is hard to diagnose — VS Code shows no warning at activation time.
 */

import { describe, it, expect } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "../..")
const PKG_JSON_FILE = path.join(ROOT, "package.json")
const SRC_DIR = path.join(ROOT, "src")
const EXTENSION_FILE = path.join(ROOT, "src/extension.ts")
const CHIPMATE_PROVIDER_FILE = path.join(ROOT, "src/ChipMateProvider.ts")
const VSCODE_HOST_FILE = path.join(ROOT, "src/agent-manager/vscode-host.ts")

function sliceBlock(source: string, start: number): string {
  const open = source.indexOf("{", start)
  expect(open, "block opening brace must exist").toBeGreaterThan(-1)

  const state = { depth: 0, end: -1 }
  Array.from(source.slice(open)).some((ch, i) => {
    if (ch === "{") state.depth++
    if (ch === "}") state.depth--
    if (state.depth !== 0) return false
    state.end = open + i
    return true
  })

  if (state.end > -1) return source.slice(start, state.end + 1)

  throw new Error("block closing brace not found")
}

function readSrcFiles(dir: string): string {
  const parts: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      parts.push(readSrcFiles(full))
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".spec.ts")) {
      parts.push(fs.readFileSync(full, "utf-8"))
    }
  }
  return parts.join("\n")
}

describe("Extension — package.json command sync", () => {
  const pkg = JSON.parse(fs.readFileSync(PKG_JSON_FILE, "utf-8"))
  const declared: string[] = pkg.contributes?.commands?.map((c: { command: string }) => c.command) ?? []
  const source = readSrcFiles(SRC_DIR)

  // Extract command IDs that appear in registerCommand() calls specifically.
  // This avoids false positives from executeCommand() or other string references.
  const registered = new Set([...source.matchAll(/registerCommand\s*\(\s*["']([^"']+)["']/g)].map((m) => m[1]))

  /**
   * Every command declared in package.json must be registered via registerCommand()
   * somewhere in src/. A bare string match would accept executeCommand() references,
   * which don't actually register a handler.
   *
   * Commands registered via template literals (e.g. jumpTo${i}) are detected by
   * checking the dynamic registerCommand pattern in source instead.
   */
  it("every contributes.commands entry has a registerCommand() call", () => {
    // Commands generated via template literals can't be extracted by regex,
    // so verify the dynamic registration pattern exists in source instead.
    const dynamic: Record<string, string> = {
      "chipmate.v2.agentManager.jumpTo": "registerCommand(`chipmate.v2.agentManager.jumpTo${",
    }

    const missing: string[] = []
    for (const cmd of declared) {
      const entry = Object.entries(dynamic).find(([prefix]) => cmd.startsWith(prefix))
      if (entry) {
        const [, pattern] = entry
        if (!source.includes(pattern)) missing.push(`${cmd} (dynamic pattern not found)`)
        continue
      }
      if (!registered.has(cmd)) missing.push(cmd)
    }

    expect(
      missing,
      `Commands declared in package.json but not registered via registerCommand().\n` +
        `Add registerCommand("...", ...) or remove the declaration:\n` +
        missing.map((m) => `  - ${m}`).join("\n"),
    ).toEqual([])
  })

  /**
   * All declared commands must use the chipmate.v2. prefix.
   * The legacy chipmate-code.* namespace (without .new.) belongs to the old
   * extension and must not be reintroduced.
   */
  it("all declared commands use the chipmate.v2. prefix", () => {
    const bad = declared.filter((cmd) => !cmd.startsWith("chipmate.v2."))
    expect(
      bad,
      `Commands without "chipmate.v2." prefix — use the namespaced form:\n` + bad.map((b) => `  - ${b}`).join("\n"),
    ).toEqual([])
  })

  it("scopes Agent Manager search to the panel and leaves the integrated terminal alone", () => {
    const binding = pkg.contributes?.keybindings?.find(
      (item: { command: string }) => item.command === "chipmate.v2.agentManager.search",
    )
    expect(binding).toMatchObject({
      key: "ctrl+f",
      mac: "cmd+f",
      when: "activeWebviewPanelId == 'chipmate.v2.AgentManagerPanel' && !terminalFocus",
    })
  })

  it("scopes the open PR shortcut to Agent Manager", () => {
    const binding = pkg.contributes?.keybindings?.find(
      (item: { command: string }) => item.command === "chipmate.v2.agentManager.openPR",
    )
    expect(binding).toMatchObject({
      key: "ctrl+shift+r",
      mac: "cmd+shift+r",
      when: "activeWebviewPanelId == 'chipmate.v2.AgentManagerPanel'",
    })
  })
})

// ---------------------------------------------------------------------------
// ChipMateProvider handler wiring — every new ChipMateProvider() must get
// setContinueInWorktreeHandler() called before resolving its webview.
//
// Regression: tab panels created via openChipMateInNewTab() and the TabPanel
// deserializer were missing the handler, causing "Capturing changes..." to
// spin forever because the webview message was silently dropped.
// ---------------------------------------------------------------------------

describe("Extension — ChipMateProvider handler wiring", () => {
  const ext = fs.readFileSync(EXTENSION_FILE, "utf-8")

  /**
   * Every `new ChipMateProvider(` in extension.ts must be followed (before the
   * next `new ChipMateProvider(`) by a `setContinueInWorktreeHandler` call.
   * This prevents future tab/panel additions from silently missing the handler.
   */
  it("every ChipMateProvider instance gets setContinueInWorktreeHandler wired", () => {
    const pattern = /new ChipMateProvider\(/g
    const instances: number[] = []
    let match
    while ((match = pattern.exec(ext)) !== null) {
      instances.push(match.index)
    }

    expect(
      instances.length,
      "expected at least 3 ChipMateProvider instances (sidebar, tab, deserializer)",
    ).toBeGreaterThanOrEqual(3)

    const missing: string[] = []
    for (let i = 0; i < instances.length; i++) {
      const start = instances[i]
      const end = instances[i + 1] ?? ext.length
      const region = ext.slice(start, end)

      if (!region.includes("setContinueInWorktreeHandler")) {
        const line = ext.slice(0, start).split("\n").length
        missing.push(`ChipMateProvider at line ${line}`)
      }
    }

    expect(
      missing,
      `These ChipMateProvider instances are missing setContinueInWorktreeHandler.\n` +
        `Without it, "Continue in Worktree" silently no-ops and the spinner\n` +
        `stays stuck on "Capturing changes..." forever.\n\n` +
        missing.map((m) => `  - ${m}`).join("\n"),
    ).toEqual([])
  })

  it("openChipMateInNewTab wires setContinueInWorktreeHandler before resolveWebviewPanel", () => {
    const fn = ext.indexOf("function openChipMateInNewTab")
    expect(fn, "openChipMateInNewTab must exist").toBeGreaterThan(-1)
    const body = sliceBlock(ext, fn)
    const handler = body.indexOf("setContinueInWorktreeHandler")
    const resolve = body.indexOf("resolveWebviewPanel")
    expect(handler, "setContinueInWorktreeHandler must be called").toBeGreaterThan(-1)
    expect(resolve, "resolveWebviewPanel must be called").toBeGreaterThan(-1)
    expect(handler, "handler must be wired before resolving the panel").toBeLessThan(resolve)
  })

  it("TabPanel deserializer wires setContinueInWorktreeHandler before resolveWebviewPanel", () => {
    const serializer = ext.indexOf('"chipmate.v2.TabPanel"')
    expect(serializer, "TabPanel serializer must exist").toBeGreaterThan(-1)
    const body = sliceBlock(ext, serializer)
    const handler = body.indexOf("setContinueInWorktreeHandler")
    const resolve = body.indexOf("resolveWebviewPanel")
    expect(handler, "setContinueInWorktreeHandler must be called in deserializer").toBeGreaterThan(-1)
    expect(resolve, "resolveWebviewPanel must be called in deserializer").toBeGreaterThan(-1)
    expect(handler, "handler must be wired before resolving the panel").toBeLessThan(resolve)
  })
})

// ---------------------------------------------------------------------------
// ChipMateProvider — continueInWorktree error fallback
//
// Regression: when continueInWorktreeHandler is null, the message handler
// must send an error back to the webview so the spinner resets. Previously
// it silently no-op'd, leaving the UI stuck.
// ---------------------------------------------------------------------------

describe("Extension — Agent Manager remote wiring", () => {
  const ext = fs.readFileSync(EXTENSION_FILE, "utf-8")
  const host = fs.readFileSync(VSCODE_HOST_FILE, "utf-8")

  it("passes the shared remote service to Agent Manager", () => {
    expect(ext).toMatch(
      /new VscodeHost\([\s\S]*?context\.extensionUri,[\s\S]*?connectionService,[\s\S]*?context,[\s\S]*?remoteService,[\s\S]*?sessionForks,[\s\S]*?\)/,
    )
  })

  it("wires the remote service before attaching the Agent Manager webview", () => {
    const remote = host.indexOf("provider.setRemoteService(this.remoteService)")
    const attach = host.indexOf("provider.attachToWebview")
    expect(remote).toBeGreaterThan(-1)
    expect(attach).toBeGreaterThan(-1)
    expect(remote).toBeLessThan(attach)
  })

  it("uses a reload-stable fork owner for restored main-editor panels", () => {
    expect(ext).toContain("forkOwnerID: `main-editor:${sessionSurfaceKey(input.key)}`")
  })
})

describe("ChipMateProvider — remote focus lifecycle", () => {
  const provider = fs.readFileSync(CHIPMATE_PROVIDER_FILE, "utf-8")

  it("registers newly created sessions and uses the synchronous session ID", () => {
    const create = sliceBlock(provider, provider.indexOf("private async handleCreateSession"))
    const resolve = sliceBlock(provider, provider.indexOf("private async resolveSession"))
    expect(create).toContain("this.focusSession(session.id)")
    expect(resolve).toContain("this.focusSession(session.id)")
    expect(provider).toContain("this.focusSession(webviewView.visible ? this.contextSessionID : undefined)")
  })
})

describe("ChipMateProvider — continueInWorktree error fallback", () => {
  const helper = fs.readFileSync(path.join(ROOT, "src/chipmate-provider/continue-worktree.ts"), "utf-8")

  it("sends error progress when handler is missing", () => {
    expect(helper, "must send error status back to webview").toContain('"error"')
    expect(helper, "must use continueInWorktreeProgress message type").toContain("continueInWorktreeProgress")
    expect(helper, "must handle missing handler case").toContain("no handler registered")
  })
})
