export type DiagnosticMode = "submit" | "export"
export type DiagnosticPhase = "collecting" | "packaging" | "login" | "uploading" | "verifying" | "submitted" | "saved" | "failed" | "cancelled"
export interface DiagnosticOptions { requestId: string; mode: DiagnosticMode; hours: 1 | 24 | 168; description: string; includeSession: boolean }
export interface DiagnosticState {
  requestId: string
  phase: DiagnosticPhase
  message: string
  id?: string
  partial?: boolean
  progress?: number
  canSave?: boolean
}
export type DiagnosticRequest =
  | { type: "diagnostics.start"; options: DiagnosticOptions }
  | { type: "diagnostics.cancel" | "diagnostics.retry" | "diagnostics.save" | "diagnostics.open" | "diagnostics.copy"; requestId: string }
  | { type: "diagnostics.context"; requestId: string }
  | { type: "diagnostics.event"; event: "error" | "rejection" | "message-error"; message: string; stack?: string }
export type DiagnosticResponse =
  | { type: "diagnostics.state"; state: DiagnosticState }
  | { type: "diagnostics.context"; requestId: string; server: string; hasSession: boolean }
