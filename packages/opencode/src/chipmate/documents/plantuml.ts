const MAX_SOURCE_BYTES = 128 * 1024
const MAX_PNG_BYTES = 16 * 1024 * 1024
const MAX_DIMENSION = 4096
const DEFAULT_TIMEOUT = 60_000
const MIN_TIMEOUT = 5_000

export type PlantUmlIssue = {
  severity: "error" | "warning"
  code: string
  message: string
}

export type PlantUmlRenderer = {
  kind?: string
  diagramToPng?: string
  plantumlVersion?: string
}

export type PlantUmlRenderResult =
  | {
      ok: true
      source: string
      png: Buffer
      width: number
      height: number
      issues: PlantUmlIssue[]
      elapsedMs?: number
      renderer?: PlantUmlRenderer
    }
  | {
      ok: false
      source: string
      code: string
      issues: PlantUmlIssue[]
    }

export function normalizePlantUml(source: string) {
  return source
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .trim()
}

export function preflightPlantUml(
  input: string,
): { ok: true; source: string } | { ok: false; source: string; issue: PlantUmlIssue } {
  const source = normalizePlantUml(input)
  if (!source) return invalid(source, "plantuml-source-empty", "PlantUML source is required.")
  if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) {
    return invalid(source, "plantuml-source-too-large", `PlantUML source exceeds ${MAX_SOURCE_BYTES} bytes.`)
  }

  const starts = [...source.matchAll(/@startuml\b/gi)]
  const ends = [...source.matchAll(/@enduml\b/gi)]
  if (starts.length !== 1 || ends.length !== 1) {
    return invalid(
      source,
      "plantuml-source-invalid",
      "PlantUML source must contain exactly one @startuml/@enduml document.",
    )
  }
  if (starts[0]!.index !== 0 || starts[0]!.index! >= ends[0]!.index!) {
    return invalid(source, "plantuml-source-invalid", "PlantUML markers are incomplete or out of order.")
  }
  const finish = ends[0]!.index! + ends[0]![0].length
  if (source.slice(finish).trim()) {
    return invalid(source, "plantuml-source-invalid", "PlantUML source must end after @enduml.")
  }
  return { ok: true, source }
}

export async function renderPlantUml(input: {
  source: string
  endpoint?: string
  timeoutMs?: number
  signal?: AbortSignal
}): Promise<PlantUmlRenderResult> {
  const checked = preflightPlantUml(input.source)
  if (!checked.ok) return failure(checked.source, checked.issue.code, [checked.issue])

  const endpoint = input.endpoint?.trim()
  if (!endpoint) {
    return failure(checked.source, "plantuml-endpoint-missing", [
      issue(
        "plantuml-endpoint-missing",
        "ChipMate PlantUML renderer is unavailable. Configure CHIPMATE_PLANTUML_RENDER_ENDPOINT.",
      ),
    ])
  }

  const timeoutMs = timeout(input.timeoutMs)
  const controller = new AbortController()
  const relay = () => controller.abort()
  if (input.signal?.aborted) controller.abort()
  input.signal?.addEventListener("abort", relay, { once: true })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: checked.source, filename: "diagram.puml", timeoutMs }),
    signal: controller.signal,
  }).catch((err: unknown) => (err instanceof Error ? err : new Error(String(err))))

  if (response instanceof Error) {
    clearTimeout(timer)
    input.signal?.removeEventListener("abort", relay)
    const code = timedOut
      ? "plantuml-render-timeout"
      : input.signal?.aborted
        ? "plantuml-render-aborted"
        : "plantuml-network-error"
    const message = timedOut
      ? `PlantUML rendering timed out after ${timeoutMs}ms.`
      : input.signal?.aborted
        ? "PlantUML rendering was cancelled."
        : response.message
    return failure(checked.source, code, [issue(code, message)])
  }

  const body = await response.json().catch((err: unknown) => (err instanceof Error ? err : new Error(String(err))))
  clearTimeout(timer)
  input.signal?.removeEventListener("abort", relay)
  if (body instanceof Error || !record(body)) {
    if (timedOut) {
      return failure(checked.source, "plantuml-render-timeout", [
        issue("plantuml-render-timeout", `PlantUML rendering timed out after ${timeoutMs}ms.`),
      ])
    }
    if (input.signal?.aborted) {
      return failure(checked.source, "plantuml-render-aborted", [
        issue("plantuml-render-aborted", "PlantUML rendering was cancelled."),
      ])
    }
    return failure(checked.source, "plantuml-response-invalid", [
      issue(
        "plantuml-response-invalid",
        body instanceof Error ? body.message : `PlantUML renderer returned invalid JSON (HTTP ${response.status}).`,
      ),
    ])
  }

  const issues = parseIssues(body.issues)
  if (!response.ok || body.ok !== true) {
    const first = issues[0]
    const code = first?.code ?? `plantuml-http-${response.status}`
    return failure(
      checked.source,
      code,
      issues.length ? issues : [issue(code, `PlantUML renderer rejected the request (HTTP ${response.status}).`)],
    )
  }

  if (!record(body.metadata) || body.metadata.verified !== true) {
    return failure(checked.source, "plantuml-metadata-unverified", [
      issue("plantuml-metadata-unverified", "PlantUML renderer did not verify the source embedded in the PNG."),
    ])
  }
  if (!record(body.png) || body.png.contentType !== "image/png" || typeof body.png.base64 !== "string") {
    return failure(checked.source, "plantuml-png-missing", [
      issue("plantuml-png-missing", "PlantUML renderer returned no verified PNG payload."),
    ])
  }

  const png = decodePng(body.png.base64)
  if (png instanceof Error) {
    return failure(checked.source, "plantuml-png-invalid", [issue("plantuml-png-invalid", png.message)])
  }
  const size = dimensions(png)
  if (!size) {
    return failure(checked.source, "plantuml-png-invalid", [
      issue("plantuml-png-invalid", "PlantUML renderer returned an invalid PNG."),
    ])
  }
  if (size.width > MAX_DIMENSION || size.height > MAX_DIMENSION) {
    return failure(checked.source, "plantuml-dimensions-invalid", [
      issue(
        "plantuml-dimensions-invalid",
        `PlantUML PNG dimensions ${size.width}x${size.height} exceed ${MAX_DIMENSION}.`,
      ),
    ])
  }
  if (number(body.width) !== size.width || number(body.height) !== size.height) {
    return failure(checked.source, "plantuml-dimensions-mismatch", [
      issue("plantuml-dimensions-mismatch", "PlantUML renderer dimensions do not match the PNG payload."),
    ])
  }

  return {
    ok: true,
    source: checked.source,
    png,
    width: size.width,
    height: size.height,
    issues,
    elapsedMs: number(body.elapsedMs),
    renderer: renderer(body.renderer),
  }
}

function invalid(source: string, code: string, message: string) {
  return { ok: false as const, source, issue: issue(code, message) }
}

function issue(code: string, message: string, severity: "error" | "warning" = "error"): PlantUmlIssue {
  return { severity, code, message }
}

function failure(source: string, code: string, issues: PlantUmlIssue[]): PlantUmlRenderResult {
  return { ok: false, source, code, issues }
}

function timeout(value: number | undefined) {
  if (!Number.isFinite(value)) return DEFAULT_TIMEOUT
  return Math.min(DEFAULT_TIMEOUT, Math.max(MIN_TIMEOUT, Math.trunc(value!)))
}

function decodePng(value: string) {
  const base64 = value.trim()
  const max = Math.ceil(MAX_PNG_BYTES / 3) * 4
  if (!base64 || base64.length > max || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    return new Error("PlantUML PNG payload is malformed or exceeds the size limit.")
  }
  const png = Buffer.from(base64, "base64")
  if (!png.length || png.length > MAX_PNG_BYTES) {
    return new Error("PlantUML PNG payload is empty or exceeds the size limit.")
  }
  return png
}

function dimensions(png: Buffer) {
  if (
    png.length < 24 ||
    png[0] !== 0x89 ||
    png[1] !== 0x50 ||
    png[2] !== 0x4e ||
    png[3] !== 0x47 ||
    png[4] !== 0x0d ||
    png[5] !== 0x0a ||
    png[6] !== 0x1a ||
    png[7] !== 0x0a ||
    png.subarray(12, 16).toString("ascii") !== "IHDR"
  ) {
    return
  }
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  if (!width || !height) return
  return { width, height }
}

function parseIssues(value: unknown): PlantUmlIssue[] {
  if (!Array.isArray(value)) return []
  return value
    .flatMap((item) => {
      if (typeof item === "string") return [issue("plantuml-render-failed", item)]
      if (!record(item) || typeof item.message !== "string") return []
      return [
        issue(
          typeof item.code === "string" ? item.code : "plantuml-render-failed",
          item.message,
          item.severity === "warning" ? "warning" : "error",
        ),
      ]
    })
    .slice(0, 16)
}

function renderer(value: unknown): PlantUmlRenderer | undefined {
  if (!record(value)) return
  return {
    ...(typeof value.kind === "string" ? { kind: value.kind } : {}),
    ...(typeof value.diagramToPng === "string" ? { diagramToPng: value.diagramToPng } : {}),
    ...(typeof value.plantumlVersion === "string" ? { plantumlVersion: value.plantumlVersion } : {}),
  }
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
