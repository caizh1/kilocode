// @unit DU-WORD | N/A | SRC-ACTUAL-WORD-FSM-AUDIT
// @complexity SIG-004 | DU-WORD | code | dispatch-detail | applyWordDocumentEdits
// @complexity SIG-005 | DU-WORD | code | toc-detail | materializeWordFields
// @complexity SIG-006 | DU-WORD | data | relationship-lifecycle-detail | inspectImages

type Edit = { kind: "paragraph" | "table"; value: string }

export function applyWordDocumentEdits(edits: Edit[]) {
  return edits.map((edit) => edit.kind === "table" ? `table:${edit.value}` : edit.value)
}

export async function materializeWordFields(headings: string[], timeout: number) {
  const refreshed = await Promise.race([
    Promise.resolve(headings.map((heading, page) => `${heading}:${page + 1}`)),
    new Promise<string[]>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeout)),
  ])
  return refreshed
}

export function inspectImages(images: Array<{ owner: string; hash: string }>) {
  return new Map(images.map((image) => [image.owner, image.hash]))
}
