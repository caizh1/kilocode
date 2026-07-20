import { permissionSeverity, type PermissionSeverity } from "../../../../src/shared/command-risk"
export type { PermissionSeverity }
import type { PermissionRequest } from "../../types/messages"

export function permissionCommand(request: PermissionRequest): string | undefined {
  const command = request.args?.command
  return typeof command === "string" && command.trim() ? command : undefined
}

export function permissionPresentation(request: PermissionRequest): PermissionSeverity {
  return request.toolName === "bash" ? permissionSeverity(permissionCommand(request)) : "standard"
}

export function permissionEditPrompt(request: PermissionRequest): string | undefined {
  return permissionCommand(request)?.trim()
}

export function editPermission(
  request: PermissionRequest,
  responding: boolean,
  reject: () => void,
  prefill: (command: string) => void,
): boolean {
  if (responding) return false
  const command = permissionEditPrompt(request)
  if (!command) return false
  reject()
  prefill(command)
  return true
}
