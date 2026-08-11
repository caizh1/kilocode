import { Permission } from "@/permission"
import { Session } from "@/session/session"
import type { SessionID } from "@/session/schema"
import { Effect } from "effect"

export namespace DocumentAgentScope {
  export const AGENT = "document"
  export const TOOL = "document_scope"
  export const APPROVAL = "document_code_exploration"
  export const METADATA_KEY = "chipmate.documentAgent.scope"

  export type Scope = "documents" | "documents_and_code"

  const codeTools = {
    read: "allow" as const,
    grep: "allow" as const,
    glob: "allow" as const,
    list: "allow" as const,
    codebase_search: "allow" as const,
    codebase_analysis: "allow" as const,
    semantic_search: "allow" as const,
  }

  export function current(metadata?: Record<string, unknown>): Scope {
    return metadata?.[METADATA_KEY] === "documents_and_code" ? "documents_and_code" : "documents"
  }

  export function enabled(metadata?: Record<string, unknown>): boolean {
    return current(metadata) === "documents_and_code"
  }

  export function repairUnavailableTool(input: {
    agent: string
    toolName: string
    available: ReadonlySet<string>
  }): { toolName: string; input: string } | undefined {
    if (input.agent !== AGENT || input.available.has(input.toolName) || !input.available.has(TOOL)) return undefined
    return {
      toolName: TOOL,
      input: JSON.stringify({ action: "document_only" }),
    }
  }

  export function rules(metadata?: Record<string, unknown>): Permission.Ruleset {
    return Permission.fromConfig({
      "*": "deny",
      document_search: "allow",
      [TOOL]: "allow",
      [APPROVAL]: "allow",
      question: "allow",
      external_directory: "deny",
      ...(enabled(metadata) ? codeTools : {}),
    })
  }

  export function forkMetadata(metadata?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!metadata || !(METADATA_KEY in metadata)) return metadata ? { ...metadata } : undefined
    const copy = { ...metadata }
    delete copy[METADATA_KEY]
    return copy
  }

  export const set = Effect.fn("DocumentAgentScope.set")(function* (input: {
    sessions: Pick<Session.Interface, "get" | "setMetadata">
    sessionID: SessionID
    scope: Scope
  }) {
    const session = yield* input.sessions.get(input.sessionID)
    const metadata = { ...session.metadata }
    if (input.scope === "documents_and_code") metadata[METADATA_KEY] = input.scope
    else delete metadata[METADATA_KEY]
    yield* input.sessions.setMetadata({ sessionID: input.sessionID, metadata })
  })
}
