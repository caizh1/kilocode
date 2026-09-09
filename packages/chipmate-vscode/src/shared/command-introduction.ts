export type CommandIntroductionRequest = {
  type: "commandIntroduction"
  action: "claim" | "displayed" | "release"
  introduction: "spec"
  requestID: string
  manual?: boolean
}

export type CommandIntroductionResponse = {
  type: "commandIntroductionResult"
  requestID: string
  granted: boolean
  /** 旧界面兼容字段，不可与客户端时钟比较。 */
  expiresAt?: number
}

export function commandIntroduction(command: { name: string; source?: string; template?: unknown }) {
  if (
    command.name === "spec" &&
    command.source === "command" &&
    typeof command.template === "string" &&
    command.template.startsWith("<chipmate-spec-command>\n")
  )
    return "spec" as const
}
