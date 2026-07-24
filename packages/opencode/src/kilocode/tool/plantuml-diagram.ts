import fs from "node:fs/promises"
import path from "node:path"
import { Effect, Schema } from "effect"
import { Instance } from "@/kilocode/instance"
import {
  preflightPlantUml,
  renderPlantUml,
  type PlantUmlIssue,
  type PlantUmlRenderer,
} from "@/kilocode/documents/plantuml"
import * as Tool from "@/tool/tool"

const Parameters = Schema.Struct({
  source: Schema.String.annotate({ description: "One complete PlantUML document, including @startuml and @enduml." }),
  outputMode: Schema.Union([Schema.Literal("chat"), Schema.Literal("file")]).annotate({
    description: "Use chat to attach the rendered PNG, or file to save explicitly requested workspace files.",
  }),
  title: Schema.optional(Schema.String).annotate({ description: "Optional diagram title." }),
  timeoutMs: Schema.optional(Schema.Number).annotate({
    description: "Optional ChipMate Server timeout in milliseconds, clamped to 5000-60000.",
  }),
  sourcePath: Schema.optional(Schema.String).annotate({
    description: "File mode only: workspace-relative .puml destination requested by the user.",
  }),
  pngPath: Schema.optional(Schema.String).annotate({
    description: "File mode only: workspace-relative .png destination requested by the user.",
  }),
})

type Meta = {
  outputMode: "chat" | "file"
  rendered: boolean
  validated: boolean
  valid?: boolean
  sourcePath?: string
  pngPath?: string
  width?: number
  height?: number
  issues: PlantUmlIssue[]
  renderer?: PlantUmlRenderer
  quality: "ok" | "failed"
  failed?: boolean
  error?: string
  nextAction?: "switch-to-code"
}

export const RenderPlantUmlDiagramTool = Tool.define(
  "render_plantuml_diagram",
  Effect.succeed({
    description:
      "Render and validate PlantUML only when the user explicitly requests UML or PlantUML. outputMode is required: if the user has not said whether to display the result in chat or save it locally, ask that question before calling this tool. Use chat to return a PNG attachment without creating workspace files. Use file only in the Code agent and provide at least one user-requested workspace-relative sourcePath (.puml) or pngPath (.png); Ask and Plan must direct file requests to Code. If the user requests only PlantUML source without validation or rendering, use the normal file-writing tool in Code instead. Never probe local PlantUML, Java, or Graphviz, never use a local renderer, and never fall back to Mermaid.",
    parameters: Parameters,
    execute: (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ): Effect.Effect<Tool.ExecuteResult<Meta>> =>
      Effect.gen(function* () {
        const checked = preflightPlantUml(params.source)
        if (!checked.ok) return failed(params.outputMode, checked.issue.message, [checked.issue])

        if (params.outputMode === "chat" && (params.sourcePath !== undefined || params.pngPath !== undefined)) {
          return failed("chat", "chat outputMode cannot include sourcePath or pngPath.")
        }
        if (params.outputMode === "file" && ctx.agent !== "code") {
          return failed(
            "file",
            "Saving PlantUML files is available only in the Code agent. Switch to Code and retry with the requested paths.",
            [],
            { nextAction: "switch-to-code" },
          )
        }

        const paths =
          params.outputMode === "file"
            ? yield* settle(
                Effect.try({
                  try: () => destinations(params.sourcePath, params.pngPath),
                  catch: (err) => (err instanceof Error ? err : new Error(String(err))),
                }),
              )
            : undefined
        if (paths && !paths.ok) return failed("file", paths.error.message)
        const files = paths?.ok ? paths.value : undefined

        yield* ctx.ask({
          permission: "render_plantuml_diagram",
          patterns: [params.title?.trim() || "plantuml"],
          always: ["*"],
          metadata: { outputMode: params.outputMode, timeoutMs: params.timeoutMs },
        })

        if (files) {
          const patterns = [files.source?.absolute, files.png?.absolute]
            .filter((item): item is string => item !== undefined)
            .map((item) => path.relative(Instance.worktree, item))
          yield* ctx.ask({
            permission: "write",
            patterns,
            always: ["*"],
            metadata: { filepaths: patterns },
          })
          if (files.source) {
            const saved = yield* settle(write(files.source.absolute, checked.source))
            if (!saved.ok) {
              return failed("file", saved.error.message, [], { sourcePath: files.source.relative })
            }
          }
        }

        const result = yield* Effect.promise(() =>
          renderPlantUml({
            source: checked.source,
            endpoint: process.env["KILO_PLANTUML_RENDER_ENDPOINT"],
            timeoutMs: params.timeoutMs,
            signal: ctx.abort,
          }),
        )
        if (!result.ok) {
          return failed(params.outputMode, result.issues[0]?.message ?? result.code, result.issues, {
            sourcePath: files?.source?.relative,
          })
        }

        if (files?.png) {
          const saved = yield* settle(write(files.png.absolute, result.png))
          if (!saved.ok) {
            return failed("file", saved.error.message, [], {
              sourcePath: files.source?.relative,
              pngPath: files.png.relative,
            })
          }
        }

        const metadata: Meta = {
          outputMode: params.outputMode,
          rendered: true,
          validated: true,
          valid: true,
          sourcePath: files?.source?.relative,
          pngPath: files?.png?.relative,
          width: result.width,
          height: result.height,
          issues: result.issues,
          renderer: result.renderer,
          quality: "ok",
        }
        const output = JSON.stringify(
          {
            ok: true,
            outputMode: params.outputMode,
            rendered: true,
            validated: true,
            width: result.width,
            height: result.height,
            sourcePath: files?.source?.relative,
            pngPath: files?.png?.relative,
            issues: result.issues,
            renderer: result.renderer,
          },
          null,
          2,
        )
        if (params.outputMode === "file") {
          return { title: params.title?.trim() || "PlantUML Diagram Rendered", metadata, output }
        }
        return {
          title: params.title?.trim() || "PlantUML Diagram Rendered",
          metadata,
          output,
          attachments: [
            {
              type: "file" as const,
              mime: "image/png",
              filename: filename(params.title),
              url: `data:image/png;base64,${result.png.toString("base64")}`,
            },
          ],
        }
      }),
  }),
)

export const PlantUmlDiagramTools = Effect.gen(function* () {
  return { render: yield* RenderPlantUmlDiagramTool }
})

function failed(
  outputMode: "chat" | "file",
  message: string,
  issues: PlantUmlIssue[] = [],
  extra: Partial<Meta> = {},
): Tool.ExecuteResult<Meta> {
  const list = issues.length ? issues : [{ severity: "error" as const, code: "plantuml-tool-invalid", message }]
  const metadata: Meta = {
    outputMode,
    rendered: false,
    validated: false,
    issues: list,
    quality: "failed",
    failed: true,
    error: message,
    ...extra,
  }
  return {
    title: extra.nextAction === "switch-to-code" ? "PlantUML File Output Requires Code" : "PlantUML Render Failed",
    metadata,
    output: JSON.stringify(
      {
        ok: false,
        outputMode,
        rendered: false,
        validated: false,
        sourcePath: metadata.sourcePath,
        pngPath: metadata.pngPath,
        issues: list,
        error: message,
        nextAction: metadata.nextAction,
      },
      null,
      2,
    ),
  }
}

function destinations(sourcePath: string | undefined, pngPath: string | undefined) {
  if (!sourcePath?.trim() && !pngPath?.trim()) {
    throw new Error("file outputMode requires sourcePath, pngPath, or both.")
  }
  return {
    source: sourcePath?.trim() ? destination(sourcePath, ".puml", "sourcePath") : undefined,
    png: pngPath?.trim() ? destination(pngPath, ".png", "pngPath") : undefined,
  }
}

function destination(input: string, extension: string, label: string) {
  if (path.isAbsolute(input)) throw new Error(`${label} must be workspace-relative.`)
  if (path.extname(input).toLowerCase() !== extension) throw new Error(`${label} must use the ${extension} extension.`)
  const absolute = path.resolve(Instance.directory, input)
  const relative = path.relative(Instance.directory, absolute)
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside the workspace.`)
  }
  return { absolute, relative: relative.split(path.sep).join("/") }
}

function write(file: string, data: string | Buffer) {
  return Effect.tryPromise({
    try: async () => {
      await secure(file)
      await fs.mkdir(path.dirname(file), { recursive: true })
      await secure(file)
      await fs.writeFile(file, data)
    },
    catch: (err) => (err instanceof Error ? err : new Error(String(err))),
  })
}

function settle<A>(effect: Effect.Effect<A, Error>) {
  return effect.pipe(
    Effect.match({
      onFailure: (error) => ({ ok: false as const, error }),
      onSuccess: (value) => ({ ok: true as const, value }),
    }),
  )
}

async function secure(file: string) {
  const root = await fs.realpath(Instance.directory)
  const target = await fs.realpath(file).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return undefined
    throw err
  })
  if (target) {
    inside(root, target)
    return
  }

  let parent = path.dirname(file)
  while (parent !== path.dirname(parent)) {
    const real = await fs.realpath(parent).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return undefined
      throw err
    })
    if (real) {
      inside(root, real)
      return
    }
    parent = path.dirname(parent)
  }
  throw new Error("PlantUML destination has no existing workspace ancestor.")
}

function inside(root: string, target: string) {
  const relative = path.relative(root, target)
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return
  throw new Error("PlantUML destination resolves outside the workspace.")
}

function filename(title: string | undefined) {
  const base =
    title
      ?.trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96) || "diagram"
  return `${base}.png`
}
