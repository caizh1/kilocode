import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { TextWriter, Uint8ArrayReader, ZipReader } from "@zip.js/zip.js"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect } from "effect"
import { read, utils } from "xlsx"
import { createExcelWorkbook, type CreateExcelWorkbookSpec } from "../../src/chipmate/documents/excel"
import { Instance } from "../../src/chipmate/instance"
import { provideTmpdirInstance } from "../fixture/fixture"

function within<A>(fn: () => Promise<A>) {
  return Instance.restore(Instance.current, fn)
}

async function zipText(bytes: Uint8Array, filename: string): Promise<string> {
  const reader = new ZipReader(new Uint8ArrayReader(bytes))
  try {
    const entry = (await reader.getEntries()).find((item) => item.filename === filename)
    if (!entry?.getData) throw new Error(`缺少 OOXML 部件：${filename}`)
    return entry.getData(new TextWriter())
  } finally {
    await reader.close()
  }
}

async function expectWorkbookError(spec: CreateExcelWorkbookSpec, message: string): Promise<void> {
  const error = await createExcelWorkbook(spec).then(
    () => undefined,
    (cause) => cause,
  )
  if (!(error instanceof Error)) throw new Error(`预期 Excel 生成失败并包含“${message}”`)
  expect(error.message).toContain(message)
}

describe("chipmate Excel workbook", () => {
  test("生成排版完整的多工作表并保持数据类型和文本安全", async () => {
    await Effect.runPromise(
      provideTmpdirInstance(
        (dir) =>
          Effect.promise(() =>
            within(async () => {
              const created = await createExcelWorkbook({
                title: "季度经营报告",
                outputFile: "季度<>报告.xlsx",
                sheets: [
                  {
                    name: "数据/总览",
                    headers: ["项目", "数值", "启用", "备注"],
                    rows: [
                      ["=SUM(A1:A2)", 42, true, null],
                      ["中文长文本用于验证自动换行与列宽计算", 3.5, false, "第一行\r\n第二行"],
                    ],
                  },
                  {
                    name: "数据:总览",
                    headers: ["名称", "数量"],
                    rows: [["库存", 7]],
                  },
                ],
              })

              expect(created.path).toMatch(/^\.chipmate(?:code)?\/artifacts\/.+\/季度__报告\.xlsx$/)
              expect(created.sheetCount).toBe(2)
              expect(created.rowCount).toBe(3)
              expect(created.cellCount).toBe(16)
              expect(created.warnings).toEqual([
                "工作表名称“数据/总览”已规范为“数据_总览”",
                "工作表名称“数据:总览”已规范为“数据_总览 (2)”",
              ])

              const bytes = new Uint8Array(await fs.readFile(path.join(dir, created.path)))
              expect(createHash("sha256").update(bytes).digest("hex")).toBe(created.sha256)
              expect(bytes.byteLength).toBe(created.sizeBytes)
              const workbook = read(bytes, { type: "array", raw: true })
              expect(workbook.SheetNames).toEqual(["数据_总览", "数据_总览 (2)"])
              expect(
                utils.sheet_to_json(workbook.Sheets["数据_总览"], {
                  header: 1,
                  raw: true,
                  defval: null,
                }),
              ).toEqual([
                ["项目", "数值", "启用", "备注"],
                ["=SUM(A1:A2)", 42, true, null],
                ["中文长文本用于验证自动换行与列宽计算", 3.5, false, "第一行\n第二行"],
              ])

              const worksheet = await zipText(bytes, "xl/worksheets/sheet1.xml")
              const styles = await zipText(bytes, "xl/styles.xml")
              expect(worksheet).toContain('ySplit="1"')
              expect(worksheet).toContain('<autoFilter ref="A1:D3"/>')
              expect(worksheet).toContain('orientation="portrait"')
              expect(worksheet).toContain('fitToWidth="1"')
              expect(worksheet).toContain('s="2"')
              expect(worksheet).toContain('s="3"')
              expect(worksheet).toContain('t="inlineStr"')
              expect(worksheet).not.toContain("<f>")
              expect(styles).toContain('rgb="FF2563EB"')
              expect(styles).toContain('wrapText="1"')

              const manifest = JSON.parse(await fs.readFile(path.join(dir, created.manifestPath), "utf8"))
              expect(manifest).toMatchObject({
                kind: "excel-workbook",
                title: "季度经营报告",
                primaryFile: "季度__报告.xlsx",
                quality: { status: "warning" },
              })
            }),
          ),
        { git: true },
      ).pipe(Effect.scoped, Effect.provide(CrossSpawnSpawner.defaultLayer)),
    )
  })

  test("拒绝错列、非法数字、目录输出和超出边界的输入", async () => {
    await Effect.runPromise(
      provideTmpdirInstance(
        () =>
          Effect.promise(() =>
            within(async () => {
              await expectWorkbookError(
                {
                  title: "错列表",
                  sheets: [{ name: "数据", headers: ["A", "B"], rows: [["only one"]] }],
                },
                "必须与表头 2 列一致",
              )
              await expectWorkbookError(
                {
                  title: "非法数字",
                  sheets: [{ name: "数据", headers: ["值"], rows: [[Number.POSITIVE_INFINITY]] }],
                },
                "必须是有限数字",
              )
              await expectWorkbookError(
                {
                  title: "目录输出",
                  outputFile: "reports/result.xlsx",
                  sheets: [{ name: "数据", headers: ["值"], rows: [[1]] }],
                },
                "只能是文件名",
              )
              await expectWorkbookError(
                {
                  title: "列数超限",
                  sheets: [
                    {
                      name: "数据",
                      headers: Array.from({ length: 51 }, (_, index) => `C${index}`),
                      rows: [],
                    },
                  ],
                },
                "最多支持 50 列",
              )
              await expectWorkbookError(
                {
                  title: "空表头",
                  sheets: [{ name: "数据", headers: [""], rows: [] }],
                },
                "表头不能为空",
              )
              await expectWorkbookError(
                {
                  title: "工作表超限",
                  sheets: Array.from({ length: 11 }, (_, index) => ({
                    name: `数据${index}`,
                    headers: ["值"],
                    rows: [],
                  })),
                },
                "最多支持 10 个工作表",
              )
              await expectWorkbookError(
                {
                  title: "行数超限",
                  sheets: [
                    {
                      name: "数据",
                      headers: ["值"],
                      rows: Array.from({ length: 5_001 }, (_, index) => [index]),
                    },
                  ],
                },
                "最多支持 5000 行数据",
              )
              const headers = Array.from({ length: 50 }, (_, index) => `C${index}`)
              const rows = Array.from({ length: 1_000 }, () => Array.from({ length: 50 }, () => null))
              await expectWorkbookError(
                {
                  title: "总单元格超限",
                  sheets: [
                    { name: "数据一", headers, rows },
                    { name: "数据二", headers, rows },
                  ],
                },
                "最多支持 100000 个单元格",
              )
              await expectWorkbookError(
                {
                  title: "长文本超限",
                  sheets: [{ name: "数据", headers: ["值"], rows: [["长".repeat(32_768)]] }],
                },
                "超过 32767 字符限制",
              )
            }),
          ),
        { git: true },
      ).pipe(Effect.scoped, Effect.provide(CrossSpawnSpawner.defaultLayer)),
    )
  })
})
