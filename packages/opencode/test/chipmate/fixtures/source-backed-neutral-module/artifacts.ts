// @unit DU-ARTIFACTS | N/A | SRC-0410
// @complexity SIG-009 | DU-ARTIFACTS | data | manifest-lifecycle-detail | declareArtifact
// @complexity SIG-010 | DU-ARTIFACTS | business | artifact-operations-detail | resolveOpenArtifact
// @complexity SIG-011 | DU-ARTIFACTS | business | artifact-operations-detail | exportArtifactDiagnostics

export function declareArtifact(path: string) {
  return { path, state: "declared" as const }
}

export function resolveOpenArtifact(path: string, allowed: Set<string>) {
  if (!allowed.has(path)) throw new Error("artifact is outside the declared set")
  return path
}

export function exportArtifactDiagnostics(path: string, issues: string[]) {
  return { path, issues: [...issues] }
}
