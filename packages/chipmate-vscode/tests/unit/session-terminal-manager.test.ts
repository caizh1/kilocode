/**
 * SessionTerminalManager tests.
 *
 * Structural tests use ts-morph to protect ordering and cleanup invariants.
 * Command behavior tests exercise the narrow TerminalHost interface directly.
 */

import { describe, it, expect } from "bun:test"
import path from "node:path"
import { Project, SyntaxKind } from "ts-morph"

const ROOT = path.resolve(import.meta.dir, "../..")
const FILE = path.join(ROOT, "src/agent-manager/SessionTerminalManager.ts")
function getClass() {
  const project = new Project({ compilerOptions: { allowJs: true } })
  const source = project.addSourceFileAtPath(FILE)
  return source.getFirstDescendantByKind(SyntaxKind.ClassDeclaration)!
}

function body(name: string): string {
  const cls = getClass()
  const method = cls.getMethod(name)
  expect(method, `method ${name} not found in SessionTerminalManager`).toBeTruthy()
  return method!.getText()
}

describe("SessionTerminalManager structure", () => {
  it("constructor registers both terminal lifecycle listeners", () => {
    const cls = getClass()
    const ctor = cls.getConstructors()[0]
    expect(ctor).toBeTruthy()
    const text = ctor!.getText()
    // Both listeners are required: close (cleanup) and active-change (context key)
    expect(text).toContain("onTerminalClosed")
    expect(text).toContain("onActiveTerminalChanged")
  })

  it("dispose clears the context key, disposes terminals, and clears the map", () => {
    const text = body("dispose")
    // All three are required for clean shutdown — missing any would leak resources
    expect(text).toContain("chipmate.v2.agentTerminalFocus")
    expect(text).toContain("terminal.dispose()")
    expect(text).toContain("terminals.clear()")
  })

  it("showTerminal resolves CWD from worktree with repo fallback", () => {
    const text = body("showTerminal")
    // The fallback chain must be worktreePath ?? repoPath, not the reverse.
    // Getting this wrong would run agents in the wrong directory.
    expect(text).toContain("worktreePath ?? repoPath")
  })

  /**
   * Regression: showOrCreate must check exitStatus before checking CWD changes.
   * If reversed, a stale exited terminal with a different CWD would hit the
   * dispose path instead of the cleanup path, potentially leaving ghost entries.
   */
  it("showOrCreate checks exit status before CWD mismatch", () => {
    const text = body("showOrCreate")
    const exitIdx = text.indexOf("exitStatus")
    const cwdIdx = text.indexOf("entry.cwd !== cwd")
    expect(exitIdx).toBeGreaterThan(-1)
    expect(cwdIdx).toBeGreaterThan(-1)
    expect(exitIdx, "exit check must come before cwd check").toBeLessThan(cwdIdx)
  })

  it("showOrCreate updates context key after showing terminal", () => {
    const text = body("showOrCreate")
    const showIdx = text.lastIndexOf("entry.terminal.show")
    const contextIdx = text.lastIndexOf("this.updateContextKey()")
    expect(showIdx).toBeGreaterThan(-1)
    expect(contextIdx).toBeGreaterThan(-1)
    expect(showIdx, "show must precede updateContextKey").toBeLessThan(contextIdx)
  })

  it("does not track panel visibility or auto-switch terminals", () => {
    const text = getClass().getText()
    expect(text).not.toContain("panelOpen")
    expect(text).not.toContain("syncOnSessionSwitch")
    expect(text).not.toContain("syncLocalOnSessionSwitch")
  })

  it("does not wrap built-in VS Code panel commands", () => {
    const text = getClass().getText()
    expect(text).not.toContain("registerCommand")
    expect(text).not.toContain("workbench.action.togglePanel")
  })

  it("exposes active terminal state for terminal context routing", () => {
    const text = body("hasActiveTerminal")
    expect(text).toContain("this.host.activeTerminal()")
  })

  it("resolves the session that owns the active managed terminal", () => {
    const text = body("activeSession")
    expect(text).toContain("this.host.activeTerminal()")
    expect(text).toContain("entry.terminal === active")
  })

  it("rejects context capture from another managed session", () => {
    const text = body("prepareContext")
    expect(text).toContain("this.showExisting(sessionId)")
    expect(text).toContain("this.activeSession()")
  })
})
