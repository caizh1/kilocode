import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { EffectBridge } from "@/effect/bridge"
import { Instance } from "@/chipmate/instance"
import { PatentRadarService } from "@/chipmate/patent-radar"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import { InvalidRequestError } from "@/server/routes/instance/httpapi/errors"

export const patentRadarHandlers = HttpApiBuilder.group(InstanceHttpApi, "patent-radar", (handlers) =>
  Effect.succeed(
    handlers
      .handle("scan", (ctx) =>
        bridge(() =>
          PatentRadarService.scan({
            directory: Instance.directory,
            cutoffDate: ctx.payload.cutoffDate,
            serverBaseUrl: ctx.payload.serverBaseUrl,
            analysisModel: ctx.payload.analysisModel,
            scope:
              ctx.payload.scope?.kind === "module"
                ? { ...ctx.payload.scope, corePaths: [...ctx.payload.scope.corePaths] }
                : ctx.payload.scope,
            confirmLargeClosure: ctx.payload.confirmLargeClosure,
          }),
        ),
      )
      .handle("list", () => bridge(() => PatentRadarService.list(Instance.directory)))
      .handle("previewScope", (ctx) =>
        bridge(() =>
          PatentRadarService.previewScope(
            Instance.directory,
            ctx.payload.kind === "module" ? { ...ctx.payload, corePaths: [...ctx.payload.corePaths] } : ctx.payload,
          ),
        ),
      )
      .handle("listModules", () => bridge(() => PatentRadarService.listModules(Instance.directory)))
      .handle("saveModule", (ctx) =>
        bridge(() => PatentRadarService.saveModule(Instance.directory, { ...ctx.payload, corePaths: [...ctx.payload.corePaths] })),
      )
      .handle("deleteModule", (ctx) => bridge(() => PatentRadarService.deleteModule(Instance.directory, ctx.params.moduleID)))
      .handle("get", (ctx) => bridge(() => PatentRadarService.get(Instance.directory, ctx.params.runID)))
      .handle("evidence", (ctx) => bridge(() => PatentRadarService.evidence(Instance.directory, ctx.params.runID, [...ctx.payload.evidenceIds])))
      .handle("cancel", (ctx) => bridge(() => PatentRadarService.cancel(Instance.directory, ctx.params.runID)))
      .handle("resume", (ctx) => bridge(() => PatentRadarService.resume(Instance.directory, ctx.params.runID)))
      .handle("research", (ctx) =>
        bridge(() => PatentRadarService.research(Instance.directory, ctx.params.runID, ctx.payload.serverBaseUrl, undefined, ctx.payload.candidateId)),
      )
      .handle("review", (ctx) =>
        bridge(() =>
          PatentRadarService.review(Instance.directory, ctx.params.runID, ctx.payload.candidateId, {
            reviewer: ctx.payload.reviewer,
            decision: ctx.payload.decision,
            note: ctx.payload.note,
          }),
        ),
      )
      .handle("importReviews", (ctx) =>
        bridge(() => PatentRadarService.importReviews(Instance.directory, ctx.params.runID, ctx.payload)),
      )
      .handle("export", (ctx) => bridge(() => PatentRadarService.exportRun(Instance.directory, ctx.params.runID))),
  ),
)

function bridge<T>(callback: () => Promise<T>) {
  return EffectBridge.fromPromise(() =>
    callback().then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    ),
  ).pipe(
    Effect.flatMap((result) =>
      result.ok
        ? Effect.succeed(result.value)
        : Effect.fail(
            new InvalidRequestError({
              kind: "patent-radar",
              message: errorMessage(result.error),
            }),
          ),
    ),
  )
}

export function errorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === "string" && error.trim()) return error
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message
  }
  return "Patent Radar 请求失败，请查看 ChipMate 输出日志。"
}
