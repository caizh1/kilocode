import type { Message, Part } from "../types/messages"
import { sameParts } from "./session-parts"

function sameJSON(current: unknown, incoming: unknown): boolean {
  return JSON.stringify(current) === JSON.stringify(incoming)
}

function messageState(message: Message) {
  return {
    id: message.id,
    sessionID: message.sessionID,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    time: message.time,
    agent: message.agent,
    model: message.model,
    providerID: message.providerID,
    modelID: message.modelID,
    mode: message.mode,
    parentID: message.parentID,
    path: message.path,
    error: message.error,
    summary: message.summary,
    cost: message.cost,
    tokens: message.tokens,
    finish: message.finish,
  }
}

function sameMessageState(current: Message, incoming: Message): boolean {
  return sameJSON(messageState(current), messageState(incoming))
}

/**
 * Returns true only when a reconcile snapshot cannot visibly change the
 * current tail. SSE may have delivered text parts while missing a terminal
 * message update, so message metadata is compared alongside hydrated parts.
 */
export function sameReconcileShape(
  current: Message[],
  incoming: Message[],
  partsFor: (message: Message) => Part[] | undefined,
): boolean {
  if (current.length !== incoming.length) return false
  for (const [index, snapshot] of incoming.entries()) {
    const hydrated = current[index]!
    if (!sameMessageState(hydrated, snapshot)) return false
    if (!sameParts(partsFor(hydrated), snapshot.parts)) return false
  }
  return true
}
