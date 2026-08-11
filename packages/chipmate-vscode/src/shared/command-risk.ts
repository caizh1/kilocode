export type CommandRisk = {
  level: "safe" | "review" | "danger"
  reason: string
  requiresConfirmation: boolean
}

export type PermissionSeverity = "standard" | "high"

const dangerous = [
  /\brm\s+-[^\n;|&]*r[^\n;|&]*f\b/,
  /\bsudo\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-[^\n;|&]*[fx]/,
  /\bmkfs\b/,
  /\bdd\s+.*\bof=/,
  /:\(\)\s*\{\s*:\|:\s*&\s*\}/,
  />\s*\/dev\/(sd|disk|nvme)/,
]

const review = [
  /\bgit\s+push\b/,
  /\bgit\s+commit\b/,
  /\bnpm\s+(install|update|audit\s+fix)\b/,
  /\bbun\s+(install|update)\b/,
  /\bpnpm\s+(install|update)\b/,
  /\byarn\s+(install|upgrade)\b/,
  /\bdocker\s+(rm|rmi|system\s+prune)\b/,
  /\bchmod\s+-R\b/,
  /\bchown\s+-R\b/,
]

export function classifyCommand(command: string): CommandRisk {
  const text = command.trim()
  if (!text) return { level: "review", reason: "empty command", requiresConfirmation: true }
  if (dangerous.some((pattern) => pattern.test(text))) {
    return {
      level: "danger",
      reason: "command can delete, overwrite, escalate privileges, or rewrite history",
      requiresConfirmation: true,
    }
  }
  if (review.some((pattern) => pattern.test(text))) {
    return {
      level: "review",
      reason: "command changes repository, dependencies, containers, or permissions",
      requiresConfirmation: true,
    }
  }
  return { level: "safe", reason: "read-only or local inspection command", requiresConfirmation: false }
}

export function permissionSeverity(command: unknown): PermissionSeverity {
  if (typeof command !== "string") return "standard"
  return classifyCommand(command).level === "danger" ? "high" : "standard"
}
