import { describe, expect, test } from "bun:test"
import { DocumentAgentScope } from "../../src/chipmate/document-agent/scope"
import { ChipMateSessionPrompt } from "../../src/chipmate/session/prompt"
import { Permission } from "../../src/permission"
import { SessionID } from "../../src/session/schema"
import type { Session } from "../../src/session/session"
import { Effect } from "effect"
import { ChipMateToolRegistry } from "../../src/chipmate/tool/registry"

const tools = [
  "document_search",
  "document_scope",
  "question",
  "read",
  "grep",
  "glob",
  "list",
  "codebase_search",
  "codebase_analysis",
  "semantic_search",
  "bash",
  "edit",
  "write",
  "apply_patch",
  "task",
  "webfetch",
  "websearch",
]

function action(permission: string, ruleset: Permission.Ruleset) {
  return Permission.evaluate(permission, "*", ruleset).action
}

describe("DocumentAgentScope", () => {
  test("defaults to document-only tools", () => {
    const ruleset = DocumentAgentScope.rules()

    expect(action("document_search", ruleset)).toBe("allow")
    expect(action("document_scope", ruleset)).toBe("allow")
    expect(action("question", ruleset)).toBe("allow")
    expect(Permission.disabled(tools, ruleset)).toEqual(
      new Set([
        "read",
        "grep",
        "glob",
        "list",
        "codebase_search",
        "codebase_analysis",
        "semantic_search",
        "bash",
        "edit",
        "write",
        "apply_patch",
        "task",
        "webfetch",
        "websearch",
      ]),
    )
  })

  test("enables only read-only code exploration tools", () => {
    const ruleset = DocumentAgentScope.rules({
      [DocumentAgentScope.METADATA_KEY]: "documents_and_code",
    })

    for (const tool of ["read", "grep", "glob", "list", "codebase_search", "codebase_analysis", "semantic_search"]) {
      expect(action(tool, ruleset)).toBe("allow")
    }
    for (const tool of ["bash", "edit", "write", "apply_patch", "task", "webfetch", "websearch"]) {
      expect(action(tool, ruleset)).toBe("deny")
    }
  })

  test("session allows cannot widen the document agent boundary", () => {
    const ruleset = ChipMateSessionPrompt.guardPermissions({
      agent: { name: DocumentAgentScope.AGENT, permission: Permission.fromConfig({ "*": "allow" }) },
      session: {
        permission: Permission.fromConfig({ "*": "allow", bash: "allow", edit: "allow" }),
        metadata: {},
      },
    })

    expect(action("bash", ruleset)).toBe("deny")
    expect(action("edit", ruleset)).toBe("deny")
    expect(action("read", ruleset)).toBe("deny")
  })

  test("scope control is invisible to existing agents", () => {
    const tool = { id: DocumentAgentScope.TOOL }
    const agent = (name: string) => ({ name, mode: "primary" as const, native: true, options: {} })

    expect(ChipMateToolRegistry.available(tool, agent("document"))).toBe(true)
    expect(ChipMateToolRegistry.available(tool, agent("ask"))).toBe(false)
    expect(ChipMateToolRegistry.available(tool, agent("code"))).toBe(false)
    expect(ChipMateToolRegistry.available(tool, agent("ultra"))).toBe(false)
  })

  test("session denies can further restrict document access", () => {
    const ruleset = ChipMateSessionPrompt.guardPermissions({
      agent: { name: DocumentAgentScope.AGENT, permission: [] },
      session: {
        permission: Permission.fromConfig({ document_search: "deny" }),
        metadata: {},
      },
    })

    expect(action("document_search", ruleset)).toBe("deny")
  })

  test("scope metadata does not change existing QA-facing agent permissions", () => {
    const agentRules = Permission.fromConfig({ "*": "deny", read: "allow", grep: "allow", bash: "ask" })
    const sessionRules = Permission.fromConfig({ read: "deny", question: "allow" })

    for (const name of ["ask", "code", "ultra"]) {
      const base = ChipMateSessionPrompt.guardPermissions({
        agent: { name, permission: agentRules },
        session: { permission: sessionRules, metadata: {} },
      })
      const scoped = ChipMateSessionPrompt.guardPermissions({
        agent: { name, permission: agentRules },
        session: {
          permission: sessionRules,
          metadata: { [DocumentAgentScope.METADATA_KEY]: "documents_and_code" },
        },
      })

      expect(scoped).toEqual(base)
      expect(Permission.disabled(tools, scoped)).toEqual(Permission.disabled(tools, base))
    }
  })

  test("forks return to document-only without dropping unrelated metadata", () => {
    expect(
      DocumentAgentScope.forkMetadata({
        [DocumentAgentScope.METADATA_KEY]: "documents_and_code",
        retained: true,
      }),
    ).toEqual({ retained: true })
  })

  test("persists and clears the session-local code scope", async () => {
    let metadata: Record<string, unknown> | undefined = { retained: true }
    const sessions = {
      get: () => Effect.succeed({ metadata } as Session.Info),
      setMetadata: (input: { metadata?: Record<string, unknown> }) =>
        Effect.sync(() => {
          metadata = input.metadata
        }),
    } as Pick<Session.Interface, "get" | "setMetadata">
    const sessionID = SessionID.make("ses_document-agent-scope")

    await Effect.runPromise(DocumentAgentScope.set({ sessions, sessionID, scope: "documents_and_code" }))
    expect(metadata).toEqual({ retained: true, [DocumentAgentScope.METADATA_KEY]: "documents_and_code" })

    await Effect.runPromise(DocumentAgentScope.set({ sessions, sessionID, scope: "documents" }))
    expect(metadata).toEqual({ retained: true })
  })
})
