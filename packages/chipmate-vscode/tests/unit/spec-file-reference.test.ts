import { expect, test } from "bun:test"
import { buildFileAttachments } from "../../webview-ui/src/hooks/file-mention-utils"

test("Spec 与普通 QA 的 Word 引用使用同一原生读取契约", () => {
  const name = "已评审 详设.docx"
  for (const prefix of ["/spec", "请解释"]) {
    const [part] = buildFileAttachments(`${prefix} @${name}`, new Set([name]), "/工作区")
    expect(part.mime).toBe("text/plain")
    expect(new URL(part.url).protocol).toBe("file:")
    expect(decodeURIComponent(new URL(part.url).pathname)).toBe(`/工作区/${name}`)
    expect(part.source?.text.value).toBe(`@${name}`)
  }
})
