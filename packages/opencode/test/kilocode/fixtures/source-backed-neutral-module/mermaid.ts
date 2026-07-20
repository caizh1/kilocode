// @unit DU-MERMAID | N/A | SRC-ACTUAL-MERMAID-FSM-AUDIT
// @complexity SIG-007 | DU-MERMAID | code | fallback-detail | renderMermaidDiagram
// @complexity SIG-008 | DU-MERMAID | data | crop-lifecycle-detail | contentCropRatio

export async function renderMermaidDiagram(source: string, remote: boolean) {
  if (remote) return { source, renderer: "remote" }
  return { source, renderer: "local" }
}

export function contentCropRatio(content: number, canvas: number) {
  if (canvas <= 0) throw new Error("invalid canvas")
  return content / canvas
}
