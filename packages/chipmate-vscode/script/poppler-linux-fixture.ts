// 使用预定义中文 CMap 且不提供 ToUnicode，确保预检确实依赖包内编码数据。
export const linuxPdfMarker = "CHIPMATE_PDF_LINUX_OK"
export const linuxPdfChinese = "中文提取验证"

export function linuxPdfFixture(): Buffer {
  const hex = [...linuxPdfChinese].map((character) => character.charCodeAt(0).toString(16).padStart(4, "0")).join("")
  const latin = `BT /F1 12 Tf 72 720 Td (${linuxPdfMarker}) Tj ET\n`
  const chinese = `BT /F2 12 Tf 72 720 Td <${hex}> Tj ET\n`
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 8 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F2 6 0 R >> >> /Contents 9 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [7 0 R] >>",
    "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> >>",
    `<< /Length ${Buffer.byteLength(latin)} >>\nstream\n${latin}endstream`,
    `<< /Length ${Buffer.byteLength(chinese)} >>\nstream\n${chinese}endstream`,
  ]
  let value = "%PDF-1.4\n"
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(value))
    value += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(value)
  value += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  value += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")
  return Buffer.from(`${value}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
}
