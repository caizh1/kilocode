"use strict"

const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const { spawn } = require("node:child_process")
const JSZip = require("jszip")
const { PNG } = require("pngjs")

function failure(status, code, message) {
  return Object.assign(new Error(message), { status, code })
}

function integer(value, fallback, maximum, name) {
  const result = value === undefined ? fallback : value
  if (!Number.isInteger(result) || result < 1 || result > maximum)
    throw failure(400, "invalid-argument", `${name} 必须是 1 到 ${maximum} 的整数`)
  return result
}

// 独立进程组只属于本次请求；必须等待退出后才能删除临时目录。
function run(command, args, env, signal) {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    })
    let output = ""
    let error
    const stop = () => {
      if (!child.pid) return
      try {
        if (process.platform === "win32") child.kill("SIGKILL")
        else process.kill(-child.pid, "SIGKILL")
      } catch (err) {
        if (err.code !== "ESRCH") error = err
      }
    }
    signal.addEventListener("abort", stop, { once: true })
    if (signal.aborted) stop()
    child.stdout.on("data", (data) => {
      output = (output + data).slice(-65536)
    })
    child.stderr.on("data", (data) => {
      output = (output + data).slice(-65536)
    })
    child.once("error", (err) => {
      error = err
    })
    child.once("close", (code) => {
      signal.removeEventListener("abort", stop)
      if (signal.aborted) reject(signal.reason)
      else if (error || code !== 0)
        reject(failure(500, "conversion-failed", `${command} 转换失败：${error?.message || output || code}`))
      else resolve(output)
    })
  })
}

async function validate(bytes) {
  let zip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch {
    throw failure(400, "invalid-docx", "文件不是有效的 DOCX 归档")
  }
  if (!zip.file("word/document.xml") || !zip.file("[Content_Types].xml"))
    throw failure(400, "invalid-docx", "DOCX 缺少正文或内容类型")
  let total = 0
  for (const entry of Object.values(zip.files)) {
    total += entry._data?.uncompressedSize || 0
    if (total > 256 * 1024 * 1024) throw failure(413, "docx-too-large", "DOCX 解压体积超限")
    if (entry.unsafeOriginalName && entry.unsafeOriginalName !== entry.name)
      throw failure(400, "invalid-docx", "DOCX 包含不安全的条目路径")
  }
}

async function handleWordToImages(request, response, helpers) {
  const controller = new AbortController()
  const disconnect = () => {
    if (!response.writableEnded) controller.abort(failure(499, "cancelled", "转换请求已取消"))
  }
  request.once("aborted", disconnect)
  response.once("close", disconnect)
  let directory
  let timer
  try {
    const payload = JSON.parse(await helpers.readBody(request, helpers.maxDocxBytes * 2))
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      throw failure(400, "invalid-argument", "请求必须是 JSON 对象")
    const start = integer(payload.startPage, 1, Number.MAX_SAFE_INTEGER, "startPage")
    const count = integer(payload.maxPages, 10, 100, "maxPages")
    const timeout = integer(payload.timeoutMs, helpers.timeoutMs, helpers.timeoutMs, "timeoutMs")
    if (typeof payload.filename !== "string" || !/\.docx$/i.test(payload.filename))
      throw failure(400, "invalid-docx", "filename 必须以 .docx 结尾")
    if (
      typeof payload.docxBase64 !== "string" ||
      payload.docxBase64.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(payload.docxBase64)
    )
      throw failure(400, "invalid-docx", "docxBase64 无效")
    const bytes = Buffer.from(payload.docxBase64, "base64")
    if (!bytes.length || bytes.length > helpers.maxDocxBytes)
      throw failure(413, "docx-too-large", "Word 文件为空或超出体积上限")
    await validate(bytes)
    controller.signal.throwIfAborted()
    timer = setTimeout(() => controller.abort(failure(504, "conversion-timeout", "Word 转图片超时")), timeout)
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "chipmate-word-images-"))
    const env = await helpers.environment(directory, directory)
    const source = path.join(directory, "source.docx")
    await fs.writeFile(source, bytes)
    const signal = controller.signal
    // 只做格式转换，不加载 UNO 目录刷新脚本，不回写 DOCX。
    await run(
      helpers.command("soffice") || helpers.command("libreoffice") || "soffice",
      [
        "--headless",
        "--nologo",
        "--nofirststartwizard",
        `-env:UserInstallation=file://${directory}/profile`,
        "--convert-to",
        "pdf",
        "--outdir",
        directory,
        source,
      ],
      env,
      signal,
    )
    const pdf = path.join(directory, "source.pdf")
    const stat = await fs.stat(pdf)
    if (!stat.size || stat.size > helpers.maxPdfBytes)
      throw failure(413, "pdf-too-large", "转换后的 PDF 为空或超出上限")
    const info = await run(helpers.command("pdfinfo") || "pdfinfo", [pdf], { ...env, LC_ALL: "C" }, signal)
    const total = Number(info.match(/^Pages:\s+(\d+)\s*$/m)?.[1])
    if (!Number.isSafeInteger(total) || total < 1) throw failure(500, "page-count-unavailable", "无法核对 PDF 实际页数")
    if (start > total) throw failure(422, "page-range-invalid", `起始页 ${start} 超过总页数 ${total}`)
    const end = Math.min(total, start + count - 1)
    await run(
      helpers.command("pdftoppm") || "pdftoppm",
      ["-png", "-r", "144", "-f", String(start), "-l", String(end), pdf, path.join(directory, "page")],
      env,
      signal,
    )
    const files = (await fs.readdir(directory))
      .filter((file) => /^page-\d+\.png$/.test(file))
      .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
    if (files.length !== end - start + 1) throw failure(500, "page-images-missing", "实际图片数量与请求页码范围不一致")
    const pages = []
    const issues = []
    let size = 0
    for (const [index, file] of files.entries()) {
      signal.throwIfAborted()
      const page = Number(file.match(/\d+/)[0])
      if (page !== start + index) throw failure(500, "page-sequence-invalid", "图片页码不连续")
      const filePath = path.join(directory, file)
      const stat = await fs.stat(filePath)
      size += stat.size
      if (stat.size > helpers.maxPageBytes || size > helpers.maxTotalBytes)
        throw failure(413, "page-images-too-large", "页面图片超过体积上限")
      const image = await fs.readFile(filePath)
      if (image.length < 24 || image.readUInt32BE(16) * image.readUInt32BE(20) > 40_000_000)
        throw failure(500, "invalid-page-image", "页面尺寸无效或超限")
      const decoded = PNG.sync.read(image)
      if (!decoded.width || !decoded.height) throw failure(500, "invalid-page-image", "页面图片无法解码")
      if (decoded.data.every((value, index) => index % 4 === 3 || value >= 250))
        issues.push({ severity: "warning", code: "blank-page", message: `第 ${page} 页为空白页，已保留` })
      pages.push({
        page,
        contentType: "image/png",
        width: decoded.width,
        height: decoded.height,
        base64: image.toString("base64"),
      })
    }
    const result = {
      ok: true,
      pageCount: total,
      returnedPageCount: pages.length,
      startPage: start,
      nextPage: end < total ? end + 1 : null,
      pages,
      issues,
      renderer: { kind: "word-to-images", docxToPdf: "libreoffice", pdfToPng: "pdftoppm" },
    }
    if (Buffer.byteLength(JSON.stringify(result)) > helpers.maxResponseBytes)
      throw failure(413, "response-too-large", "图片响应超过体积上限")
    signal.throwIfAborted()
    helpers.send(response, 200, result)
  } catch (error) {
    if (!response.destroyed && !response.writableEnded)
      helpers.send(response, error.status || (error instanceof SyntaxError ? 400 : 500), {
        ok: false,
        code: error.code || "conversion-failed",
        issues: [{ severity: "error", code: error.code || "conversion-failed", message: error.message }],
      })
  } finally {
    clearTimeout(timer)
    request.removeListener("aborted", disconnect)
    response.removeListener("close", disconnect)
    if (directory) await fs.rm(directory, { recursive: true, force: true })
  }
}

module.exports = { handleWordToImages }
