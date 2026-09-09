import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import * as ChipMateAgent from "@/chipmate/agent"
import { CommandFiles } from "@/chipmate/command-files"
import { Agent } from "@/agent/agent"
import { Command } from "@/command"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { HeapSnapshot } from "@/chipmate/cli/heap-snapshot"
import type { RequestID as AgentManagerRequestID } from "@/chipmate/agent-manager/protocol"
import { AgentManager } from "@/chipmate/agent-manager/service"
import type { RequestID as NotebookRequestID } from "@/chipmate/notebook/protocol"
import { Notebook } from "@/chipmate/notebook/service"
import type { RequestID as SkillMarketRequestID } from "@/chipmate/skill-market/protocol"
import { SkillMarket } from "@/chipmate/skill-market/service"
import { ModelUsage } from "@/chipmate/session/model-usage"
import { NewAPIBillingReconcile } from "@/chipmate/session/new-api-billing-reconcile"
import { SessionAuditExport } from "@/chipmate/session/audit-export"
import { HistoryMigrationMaintenance } from "@/chipmate/history/maintenance"
import { InstanceStore } from "@/project/instance-store"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import { Skill } from "@/skill"
import type { SessionID } from "@/session/schema"
import {
  AgentManagerRejectPayload,
  AgentManagerReplyPayload,
  NotebookRejectPayload,
  NotebookReplyPayload,
  RefreshSkillsPayload,
  RemoveAgentPayload,
  RemoveCommandPayload,
  RemoveSkillPayload,
  SessionExportBusyError,
  HistoryMigrationReleasePayload,
  SkillMarketRejectPayload,
  SkillMarketReplyPayload,
} from "../groups/chipmate"

export const chipmateHandlers = HttpApiBuilder.group(InstanceHttpApi, "chipmate", (handlers) =>
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    const commands = yield* Command.Service
    const skills = yield* Skill.Service
    const config = yield* Config.Service
    const store = yield* InstanceStore.Service
    const manager = yield* AgentManager.Service
    const notebook = yield* Notebook.Service
    const market = yield* SkillMarket.Service

    const heapSnapshot = Effect.fn("ChipMateHttpApi.heapSnapshot")(function* () {
      return yield* Effect.promise(() => HeapSnapshot.write())
    })

    const agentRequirements = Effect.fn("ChipMateHttpApi.agentRequirements")(function* (ctx: {
      query: { agent: string }
    }) {
      return yield* agents.requirementStatus(ctx.query.agent)
    })

    const commandFiles = Effect.fn("ChipMateHttpApi.commandFiles")(function* () {
      const instance = yield* InstanceState.context
      const dirs = yield* config.directories()
      const items = yield* commands.list()
      return yield* Effect.tryPromise({
        try: () => CommandFiles.discover({ commands: items, directories: dirs, directory: instance.directory }),
        catch: (err) => err,
      }).pipe(Effect.catch((err) => Effect.die(err)))
    })

    const removeCommand = Effect.fn("ChipMateHttpApi.removeCommand")(function* (ctx: {
      payload: typeof RemoveCommandPayload.Type
    }) {
      const instance = yield* InstanceState.context
      const dirs = yield* config.directories()
      const items = yield* commands.list()
      const entries = yield* Effect.tryPromise({
        try: () => CommandFiles.discover({ commands: items, directories: dirs, directory: instance.directory }),
        catch: (err) => err,
      }).pipe(Effect.catch((err) => Effect.die(err)))
      yield* Effect.tryPromise({
        try: () => CommandFiles.remove(ctx.payload.location, entries),
        catch: () => new HttpApiError.BadRequest({}),
      })
      yield* store.dispose(instance)
      return true
    })

    const removeSkill = Effect.fn("ChipMateHttpApi.removeSkill")(function* (ctx: {
      payload: typeof RemoveSkillPayload.Type
    }) {
      yield* skills
        .remove(ctx.payload.location, ctx.payload.scope ?? "project")
        .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      return true
    })

    const refreshSkills = Effect.fn("ChipMateHttpApi.refreshSkills")(function* (ctx: {
      payload: typeof RefreshSkillsPayload.Type
    }) {
      yield* skills.refresh(ctx.payload.scope)
      return true
    })

    const removeAgent = Effect.fn("ChipMateHttpApi.removeAgent")(function* (ctx: {
      payload: typeof RemoveAgentPayload.Type
    }) {
      const instance = yield* InstanceState.context
      const agent = yield* agents.get(ctx.payload.name)
      const dirs = yield* config.directories()
      yield* Effect.tryPromise({
        try: () => ChipMateAgent.remove({ name: ctx.payload.name, agent, dirs, directory: instance.directory }),
        catch: (err) => err,
      }).pipe(
        Effect.catch((err) => {
          if (ChipMateAgent.RemoveError.isInstance(err)) return Effect.fail(new HttpApiError.BadRequest({}))
          return Effect.die(err)
        }),
      )
      yield* store.dispose(instance)
      return true
    })

    const notebookList = Effect.fn("ChipMateHttpApi.notebookList")(function* () {
      return yield* notebook.list()
    })

    const notebookReply = Effect.fn("ChipMateHttpApi.notebookReply")(function* (ctx: {
      params: { requestID: NotebookRequestID }
      payload: typeof NotebookReplyPayload.Type
    }) {
      yield* notebook.reply({ requestID: ctx.params.requestID, result: ctx.payload.result }).pipe(
        Effect.catchTag("Notebook.NotFoundError", () => Effect.fail(new HttpApiError.NotFound({}))),
        Effect.catchTag("Notebook.InvalidReplyError", () => Effect.fail(new HttpApiError.BadRequest({}))),
      )
      return true
    })

    const notebookReject = Effect.fn("ChipMateHttpApi.notebookReject")(function* (ctx: {
      params: { requestID: NotebookRequestID }
      payload: typeof NotebookRejectPayload.Type
    }) {
      yield* notebook
        .reject({ requestID: ctx.params.requestID, error: ctx.payload.error })
        .pipe(Effect.catchTag("Notebook.NotFoundError", () => Effect.fail(new HttpApiError.NotFound({}))))
      return true
    })

    const agentManagerList = Effect.fn("ChipMateHttpApi.agentManagerList")(function* () {
      return yield* manager.list()
    })

    const agentManagerReply = Effect.fn("ChipMateHttpApi.agentManagerReply")(function* (ctx: {
      params: { requestID: AgentManagerRequestID }
      payload: typeof AgentManagerReplyPayload.Type
    }) {
      yield* manager.reply({ requestID: ctx.params.requestID, result: ctx.payload.result }).pipe(
        Effect.catchTag("AgentManager.NotFoundError", () => Effect.fail(new HttpApiError.NotFound({}))),
        Effect.catchTag("AgentManager.InvalidReplyError", () => Effect.fail(new HttpApiError.BadRequest({}))),
      )
      return true
    })

    const agentManagerReject = Effect.fn("ChipMateHttpApi.agentManagerReject")(function* (ctx: {
      params: { requestID: AgentManagerRequestID }
      payload: typeof AgentManagerRejectPayload.Type
    }) {
      yield* manager
        .reject({ requestID: ctx.params.requestID, error: ctx.payload.error })
        .pipe(Effect.catchTag("AgentManager.NotFoundError", () => Effect.fail(new HttpApiError.NotFound({}))))
      return true
    })

    const skillMarketList = Effect.fn("ChipMateHttpApi.skillMarketList")(function* () {
      return yield* market.list()
    })

    const skillMarketReply = Effect.fn("ChipMateHttpApi.skillMarketReply")(function* (ctx: {
      params: { requestID: SkillMarketRequestID }
      payload: typeof SkillMarketReplyPayload.Type
    }) {
      yield* market
        .reply({ requestID: ctx.params.requestID, result: ctx.payload.result })
        .pipe(Effect.catchTag("SkillMarket.NotFoundError", () => Effect.fail(new HttpApiError.NotFound({}))))
      return true
    })

    const skillMarketReject = Effect.fn("ChipMateHttpApi.skillMarketReject")(function* (ctx: {
      params: { requestID: SkillMarketRequestID }
      payload: typeof SkillMarketRejectPayload.Type
    }) {
      yield* market
        .reject({ requestID: ctx.params.requestID, error: ctx.payload.error })
        .pipe(Effect.catchTag("SkillMarket.NotFoundError", () => Effect.fail(new HttpApiError.NotFound({}))))
      return true
    })

    const sessionModelUsage = Effect.fn("ChipMateHttpApi.sessionModelUsage")(function* (ctx: {
      params: { sessionID: SessionID }
    }) {
      const usage = yield* ModelUsage.get(ctx.params.sessionID)
      if (!usage) return yield* new HttpApiError.NotFound({})
      yield* NewAPIBillingReconcile.pending(usage.sessionIDs).pipe(Effect.ignore)
      return usage
    })

    const sessionExport = Effect.fn("ChipMateHttpApi.sessionExport")(function* (ctx: {
      params: { sessionID: SessionID }
    }) {
      const result = yield* SessionAuditExport.get(ctx.params.sessionID)
      if (result.type === "not-found") return yield* new HttpApiError.NotFound({})
      if (result.type === "busy") return yield* new SessionExportBusyError({ sessionIDs: result.sessionIDs })
      return result.markdown
    })

    const historyMigrationPrepare = Effect.fn("ChipMateHttpApi.historyMigrationPrepare")(function* () {
      return yield* HistoryMigrationMaintenance.prepare()
    })

    const historyMigrationRelease = Effect.fn("ChipMateHttpApi.historyMigrationRelease")(function* (ctx: {
      payload: typeof HistoryMigrationReleasePayload.Type
    }) {
      return HistoryMigrationMaintenance.release(ctx.payload.token)
    })

    return handlers
      .handle("heapSnapshot", heapSnapshot)
      .handle("agentRequirements", agentRequirements)
      .handle("commandFiles", commandFiles)
      .handle("removeCommand", removeCommand)
      .handle("removeSkill", removeSkill)
      .handle("refreshSkills", refreshSkills)
      .handle("removeAgent", removeAgent)
      .handle("notebookList", notebookList)
      .handle("notebookReply", notebookReply)
      .handle("notebookReject", notebookReject)
      .handle("agentManagerList", agentManagerList)
      .handle("agentManagerReply", agentManagerReply)
      .handle("agentManagerReject", agentManagerReject)
      .handle("skillMarketList", skillMarketList)
      .handle("skillMarketReply", skillMarketReply)
      .handle("skillMarketReject", skillMarketReject)
      .handle("sessionModelUsage", sessionModelUsage)
      .handle("sessionExport", sessionExport)
      .handle("historyMigrationPrepare", historyMigrationPrepare)
      .handle("historyMigrationRelease", historyMigrationRelease)
  }),
)
