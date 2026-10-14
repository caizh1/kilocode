import { StringDecoder } from "node:string_decoder"
import { diagnostic } from "./record"

/** 先拼成完整文本行，再判断是否属于运行错误；不把传输块当成独立日志。 */
export class DiagnosticStderr {
  private readonly decoder = new StringDecoder("utf8")
  private pending = ""
  private skipping = false
  private credentialQuote = ""
  constructor(
    private readonly runId: string,
    private readonly write = diagnostic,
  ) {}
  append(chunk: Buffer) {
    this.consume(this.decoder.write(chunk))
  }
  finish() {
    this.consume(this.decoder.end())
    if (this.pending && !this.skipping) this.line(this.pending)
    this.pending = ""
  }
  private consume(text: string) {
    for (const part of text.split(/(?<=\n)/)) {
      if (!this.skipping) this.pending += part
      if (this.pending.length > 65536) {
        this.pending = ""
        this.skipping = true
        this.write("CLI 错误行超过预算，已排除", { runId: this.runId, truncated: true }, "WARN", "cli.stderr")
      }
      if (part.endsWith("\n")) {
        if (!this.skipping) this.line(this.pending)
        this.pending = ""
        this.skipping = false
      }
    }
  }
  private line(text: string) {
    // ANSI 颜色码不属于诊断内容。
    const line = text.replace(new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g"), "").trimEnd()
    if (this.credentialQuote) {
      if (line.includes(this.credentialQuote)) this.credentialQuote = ""
      return
    }
    const credential = line.match(/(?:api[_-]?key|authorization|cookie|password|passwd|secret|access[_-]?token|refresh[_-]?token)["']?\s*[:=]\s*(["'])(.*)$/i)
    if (credential && !credential[2]!.includes(credential[1]!)) this.credentialQuote = credential[1]!
    if (/^(?:ERROR\b|WARN\b|error:|panic\b|fatal\b|segmentation\b|\s+at\s)/i.test(line)) {
      this.write(
        "CLI 错误与堆栈",
        { message: line, runId: this.runId },
        /^WARN\b/i.test(line) ? "WARN" : "ERROR",
        "cli.stderr",
      )
      return
    }
    if (!line.startsWith("{")) return
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      return /* 非结构化正文不采集。 */
    }
    if (
      !value ||
      typeof value !== "object" ||
      !("level" in value) ||
      !["WARN", "ERROR", "warn", "error"].includes(String(value.level))
    )
      return
    this.write(
      "CLI 结构化错误",
      { runId: this.runId, data: value },
      /error/i.test(String(value.level)) ? "ERROR" : "WARN",
      "cli.stderr",
    )
  }
}
