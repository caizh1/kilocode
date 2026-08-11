import { SessionV1 } from "@opencode-ai/core/v1/session"

export namespace KiloSessionMessageInfo {
  export function hydrate(info: SessionV1.Info): SessionV1.Info {
    if (info.role !== "user" || info.format?.type !== "json_schema") return info
    if (info.format instanceof SessionV1.OutputFormatJsonSchema) return info
    return {
      ...info,
      format: new SessionV1.OutputFormatJsonSchema({
        type: "json_schema",
        schema: info.format.schema,
        retryCount: info.format.retryCount,
      }),
    }
  }
}
