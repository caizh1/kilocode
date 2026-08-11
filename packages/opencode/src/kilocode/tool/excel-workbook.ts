import { Effect, Schema } from "effect"
import * as Tool from "@/tool/tool"
import { createExcelWorkbook } from "@/kilocode/documents/excel"

const ExcelCell = Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Null])

const Parameters = Schema.Struct({
  title: Schema.String.annotate({ description: "Workbook title used for the artifact and default filename." }),
  outputFile: Schema.optional(Schema.String).annotate({
    description: "Optional .xlsx filename. Pass a filename only, without a directory.",
  }),
  sheets: Schema.Array(
    Schema.Struct({
      name: Schema.String.annotate({ description: "Worksheet name." }),
      headers: Schema.Array(Schema.String).annotate({ description: "Non-empty column headers in display order." }),
      rows: Schema.Array(Schema.Array(ExcelCell)).annotate({
        description:
          "Rows in header order. Every row must contain exactly the same number of cells as headers; use null for an empty cell.",
      }),
    }),
  ).annotate({ description: "One or more worksheets to include in the workbook." }),
})

type ExcelMeta = {
  path?: string
  artifactDir?: string
  manifestPath?: string
  sheetCount?: number
  rowCount?: number
  cellCount?: number
  sizeBytes?: number
  sha256?: string
  warnings?: string[]
  verified?: boolean
  failed?: boolean
  error?: string
}

type ExcelResult = {
  title: string
  metadata: ExcelMeta
  output: string
}

function failure(err: unknown): ExcelResult {
  const message = errorMessage(err)
  return {
    title: "Excel 工作簿生成失败",
    metadata: { failed: true, verified: false, error: message },
    output: `Excel 工作簿生成失败：${message}\n请修正工具参数后重试，不要伪造成功路径。`,
  }
}

export const CreateExcelWorkbookTool = Tool.define(
  "create_excel_workbook",
  Effect.succeed({
    description:
      "Create a professionally formatted Excel .xlsx workbook from structured headers and rows. Use this tool only when the user explicitly asks to create, generate, output, save, or export an Excel/XLSX spreadsheet. Do not use it for ordinary QA, questions about Excel capabilities, reading existing spreadsheets, or answers that only need a Markdown table. After success, report the exact workspace-relative path returned by the tool.",
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context): Effect.Effect<ExcelResult> =>
      Effect.gen(function* () {
        yield* ctx.ask({
          permission: "create_excel_workbook",
          patterns: [params.outputFile ?? params.title],
          always: ["*"],
          metadata: { title: params.title, outputFile: params.outputFile, sheetCount: params.sheets.length },
        })
        return yield* Effect.tryPromise({
          try: () => createExcelWorkbook(params),
          catch: (err) => err,
        }).pipe(
          Effect.match({
            onFailure: failure,
            onSuccess: (created): ExcelResult => ({
              title: "Excel 工作簿已生成",
              metadata: {
                path: created.path,
                artifactDir: created.artifactDir,
                manifestPath: created.manifestPath,
                sheetCount: created.sheetCount,
                rowCount: created.rowCount,
                cellCount: created.cellCount,
                sizeBytes: created.sizeBytes,
                sha256: created.sha256,
                warnings: created.warnings,
                verified: true,
              },
              output: [
                `已生成并校验 Excel 工作簿：${created.path}`,
                `工作表：${created.sheetCount}；数据行：${created.rowCount}；单元格：${created.cellCount}`,
                `文件大小：${created.sizeBytes} 字节`,
                `SHA-256：${created.sha256}`,
                created.warnings.length ? `提示：${created.warnings.join("；")}` : "格式与数据回读校验：通过",
                "请在最终回答中向用户提供上述工作区相对路径。",
              ].join("\n"),
            }),
          }),
        )
      }).pipe(Effect.orDie),
  }),
)

export const ExcelWorkbookTools = Effect.all({
  create: CreateExcelWorkbookTool,
})

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === "string") return err
  return JSON.stringify(err) ?? String(err)
}
