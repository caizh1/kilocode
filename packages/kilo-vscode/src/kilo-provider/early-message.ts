import { routeSuggestionWebviewMessage } from "./handlers/suggestion"
import * as ModelState from "./model-state"
import { renderPlantUml } from "./render-plantuml"
import { routeInputToolMessage } from "../services/input-tools"
import type { KiloConnectionService } from "../services/cli-backend/connection-service"
import type { SuggestionContext } from "./handlers/suggestion"
import type { KiloClient } from "@kilocode/sdk/v2/client"
import type * as vscode from "vscode"

type Ctx = {
  question: SuggestionContext
  client: KiloClient | null
  connection: KiloConnectionService
  dir: string
  post: (msg: unknown) => void
  exportTranscript: (sessionID: string) => Promise<void>
  context?: vscode.ExtensionContext
  openSessions: (ids: string[]) => void
}

export async function routeEarlyMessage(message: { type: string }, ctx: Ctx): Promise<boolean> {
  await routeSuggestionWebviewMessage(ctx.question, message)
  if (message.type === "renderPlantUml") {
    const input = message as { requestId?: unknown; source?: unknown }
    if (typeof input.requestId === "string" && typeof input.source === "string") {
      await renderPlantUml({ requestId: input.requestId, source: input.source }, ctx.post)
    }
    return true
  }
  const model =
    message.type === "persistModelSelection" ||
    message.type === "clearModelSelection" ||
    message.type === "requestModelSelections"
  const client =
    ctx.client ??
    (model
      ? await ctx.connection.getClientAsync(ctx.dir).catch((err: unknown) => {
          console.warn("[Kilo New] Failed to connect while loading model selections:", err)
          return null
        })
      : null)
  if (await ModelState.handleMessage(message.type, message, client, ctx.post)) return true
  if (message.type === "exportSessionTranscript") {
    const input = message as { sessionID?: unknown }
    if (typeof input.sessionID === "string") await ctx.exportTranscript(input.sessionID)
    return true
  }
  if (message.type === "sidebar.openSessions") {
    const input = message as { sessionIDs?: unknown }
    const ids = Array.isArray(input.sessionIDs)
      ? input.sessionIDs.filter((id): id is string => typeof id === "string")
      : []
    ctx.openSessions(ids)
    return true
  }
  return await routeInputToolMessage(message, {
    connection: ctx.connection,
    dir: ctx.dir,
    post: ctx.post,
    context: ctx.context,
  })
}
