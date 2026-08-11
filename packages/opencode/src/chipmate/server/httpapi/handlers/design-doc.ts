import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { DesignDocManager, DesignDocManagerError } from "@/chipmate/design-doc/manager"
import { JobStoreError } from "@/chipmate/design-doc/store"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import { DesignDocBadRequestError, DesignDocConflictError, DesignDocNotFoundError } from "../groups/design-doc"

export const designDocHandlers = HttpApiBuilder.group(InstanceHttpApi, "design-doc", (handlers) =>
  Effect.succeed(
    handlers
      .handle("create", (ctx) => {
        const { artifactTypes, modelFallbacks, outputFormats, referenceInputs, moduleHints, ...payload } = ctx.payload
        return DesignDocManager.start({
          ...payload,
          ...(artifactTypes ? { artifactTypes: [...artifactTypes] } : {}),
          ...(outputFormats ? { outputFormats: [...outputFormats] } : {}),
          ...(referenceInputs ? { referenceInputs: referenceInputs.map((input) => ({ ...input })) } : {}),
          ...(moduleHints
            ? { moduleHints: moduleHints.map((hint) => ({ name: hint.name, includePaths: [...hint.includePaths] })) }
            : {}),
          ...(modelFallbacks
            ? {
                modelFallbacks: modelFallbacks.map((fallback) => ({
                  fromAttempt: fallback.fromAttempt,
                  model: { ...fallback.model },
                })),
              }
            : {}),
        }).pipe(Effect.catch(mapError))
      })
      .handle("list", () => DesignDocManager.list().pipe(Effect.catch(mapError)))
      .handle("get", (ctx) => DesignDocManager.get(ctx.params.jobID).pipe(Effect.catch(mapError)))
      .handle("artifacts", (ctx) => DesignDocManager.artifacts(ctx.params.jobID).pipe(Effect.catch(mapError)))
      .handle("artifact", (ctx) =>
        DesignDocManager.readArtifact(ctx.params.jobID, ctx.params.artifactID).pipe(Effect.catch(mapError)),
      )
      .handle("pause", (ctx) => DesignDocManager.pause(ctx.params.jobID).pipe(Effect.catch(mapError)))
      .handle("resume", (ctx) => DesignDocManager.resume(ctx.params.jobID).pipe(Effect.catch(mapError)))
      .handle("cancel", (ctx) => DesignDocManager.cancel(ctx.params.jobID).pipe(Effect.catch(mapError)))
      .handle("retry", (ctx) =>
        DesignDocManager.retry(
          ctx.params.jobID,
          ctx.params.workItemID,
          ctx.payload.model ? { model: { ...ctx.payload.model } } : {},
        ).pipe(Effect.catch(mapError)),
      ),
  ),
)

function mapError(error: unknown) {
  if (error instanceof DesignDocManagerError) {
    if (error.code === "JOB_NOT_FOUND" || error.code === "WORK_ITEM_NOT_FOUND" || error.code === "INVALID_ARTIFACT") {
      return Effect.fail(new DesignDocNotFoundError({ code: error.code, message: error.message }))
    }
    if (error.code === "UNSUPPORTED_CONFIG") {
      return Effect.fail(new DesignDocBadRequestError({ code: error.code, message: error.message }))
    }
    return Effect.fail(new DesignDocConflictError({ code: error.code, message: error.message }))
  }
  if (error instanceof JobStoreError) {
    if (error.code === "JOB_NOT_FOUND" || error.code === "INVALID_ARTIFACT") {
      return Effect.fail(new DesignDocNotFoundError({ code: error.code, message: error.message }))
    }
    return Effect.fail(new DesignDocConflictError({ code: error.code, message: error.message }))
  }
  if (error instanceof Error) {
    return Effect.fail(new DesignDocBadRequestError({ code: "DESIGN_DOC_REQUEST_FAILED", message: error.message }))
  }
  return Effect.fail(new DesignDocBadRequestError({ code: "DESIGN_DOC_REQUEST_FAILED", message: String(error) }))
}
