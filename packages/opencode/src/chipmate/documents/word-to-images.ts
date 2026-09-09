import fs from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import { z } from "zod"
import { Instance } from "@/chipmate/instance"
import { declareArtifact } from "./artifacts"
import { assertValidWordDocumentBytes } from "./word-validation"
import { summarizePagePng } from "./word"

const Response = z.object({
  ok: z.literal(true),
  pageCount: z.number().int().positive(),
  returnedPageCount: z.number().int().positive(),
  startPage: z.number().int().positive(),
  nextPage: z.number().int().positive().nullable(),
  pages: z
    .array(
      z.object({
        page: z.number().int().positive(),
        contentType: z.literal("image/png"),
        base64: z.string().min(1),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      }),
    )
    .min(1)
    .max(100),
  issues: z.array(z.object({ severity: z.string(), code: z.string(), message: z.string() })),
  renderer: z.object({ kind: z.literal("word-to-images") }).passthrough(),
})

export async function wordToImages(
  input: { sourcePath: string; startPage?: number; maxPages?: number; timeoutMs?: number },
  abort: AbortSignal,
) {
  const endpoint = process.env.CHIPMATE_WORD_TO_IMAGES_ENDPOINT?.trim()
  if (!endpoint) throw new Error("尚未配置 Word 转图片服务，请配置 ChipMate Server 并重载窗口")
  const url = new URL(endpoint)
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("Word 转图片服务地址无效")
  const workspace = await fs.realpath(Instance.directory)
  const source = await fs.realpath(path.resolve(workspace, input.sourcePath))
  const relative = path.relative(workspace, source)
  if (relative.startsWith("..") || path.isAbsolute(relative) || !/\.docx$/i.test(source))
    throw new Error("请选择当前工作区内的 .docx 文件")
  if ((await fs.stat(source)).size > 50 * 1024 * 1024) throw new Error("Word 文件超过 50 MiB 上限")
  const bytes = await fs.readFile(source)
  await assertValidWordDocumentBytes(bytes, "Word 转图片输入")
  const start = input.startPage ?? 1
  const count = input.maxPages ?? 10
  const timeout = input.timeoutMs ?? 120000
  if (
    !Number.isSafeInteger(start) ||
    start < 1 ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 100 ||
    !Number.isInteger(timeout) ||
    timeout < 1 ||
    timeout > 120000
  )
    throw new Error("页码、批次大小或超时参数无效")
  const signal = AbortSignal.any([abort, AbortSignal.timeout(timeout)])
  const response = await fetch(url, {
    method: "POST",
    redirect: "error",
    signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      filename: path.basename(source),
      docxBase64: bytes.toString("base64"),
      startPage: start,
      maxPages: count,
      timeoutMs: timeout,
    }),
  })
  if ([404, 405, 501].includes(response.status)) {
    await response.body?.cancel()
    throw new Error("当前 ChipMate Server 不支持独立 Word 转图片接口，请升级 Server 并检查服务地址；不会调用旧渲染接口")
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error("Word 转图片服务未返回内容")
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const item = await reader.read()
      if (item.done) break
      size += item.value.byteLength
      if (size > 384 * 1024 * 1024) throw new Error("Word 转图片响应超过体积上限")
      chunks.push(item.value)
    }
  } finally {
    await reader.cancel()
  }
  const text = Buffer.concat(chunks).toString("utf8")
  if (!response.ok) throw new Error(`Word 转图片失败（HTTP ${response.status}）：${text.slice(0, 2000)}`)
  const result = Response.parse(JSON.parse(text))
  const end = Math.min(result.pageCount, start + count - 1)
  if (
    result.startPage !== start ||
    result.returnedPageCount !== result.pages.length ||
    result.pages.length !== end - start + 1 ||
    result.nextPage !== (end < result.pageCount ? end + 1 : null) ||
    result.pages.some((page, index) => page.page !== start + index)
  )
    throw new Error("Word 转图片返回的页码或数量与请求不一致")
  const images = []
  for (const page of result.pages) {
    signal.throwIfAborted()
    if (page.base64.length > 24 * 1024 * 1024) throw new Error("单页图片超过体积上限")
    const data = Buffer.from(page.base64, "base64")
    if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
      throw new Error("页面不是有效的 PNG")
    if (data.length < 24 || data.readUInt32BE(16) * data.readUInt32BE(20) > 40_000_000)
      throw new Error("页面图片尺寸无效或超限")
    const decoded = await summarizePagePng(data)
    if (decoded.error || decoded.summary?.width !== page.width || decoded.summary?.height !== page.height)
      throw new Error("页面图片无法解码或尺寸不一致")
    images.push({ page: page.page, data, name: `page-${String(page.page).padStart(4, "0")}.png` })
  }
  signal.throwIfAborted()
  const warnings = result.issues.map((issue) => issue.message)
  if (result.issues.some((issue) => issue.severity === "error")) throw new Error(warnings.join("；"))
  const artifact = await declareArtifact({
    kind: "word-images",
    title: "Word 页面图片",
    sourceFiles: [relative],
    derivedFiles: [...images.map((image) => image.name), "转换记录.json"],
    warnings,
    qualityStatus: warnings.length ? "warning" : "ok",
  })
  const directory = path.join(workspace, artifact.artifactDir)
  try {
    const output = {
      artifactDir: artifact.artifactDir,
      manifestPath: artifact.manifestPath,
      sourcePath: relative,
      sourceSha256: createHash("sha256").update(bytes).digest("hex"),
      pageCount: result.pageCount,
      returnedPageCount: images.length,
      pageNumbers: images.map((image) => image.page),
      nextPage: result.nextPage,
      pagePngPaths: images.map((image) => path.join(artifact.artifactDir, image.name)),
      diagnosticsPath: path.join(artifact.artifactDir, "转换记录.json"),
      warnings,
      quality: warnings.length ? "warning" : "ok",
    }
    for (const image of images) {
      signal.throwIfAborted()
      await fs.writeFile(path.join(directory, image.name), image.data)
    }
    await fs.writeFile(
      path.join(directory, "转换记录.json"),
      JSON.stringify(
        {
          说明: "仅完成页面转换，尚未证明模型已理解内容",
          来源: relative,
          来源哈希: output.sourceSha256,
          总页数: result.pageCount,
          本批页码: output.pageNumbers,
          下一批: output.nextPage,
          诊断: result.issues,
        },
        null,
        2,
      ) + "\n",
    )
    signal.throwIfAborted()
    return output
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true })
    throw error
  }
}
