import { TextReader, Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js"
import { PhotonImage, gaussian_blur } from "@silvia-odwyer/photon-node"

// 合成的三十页验收设计，不是 UFS 规范，也不冒充已评审的真实项目。
// 预期在验证说明中独立列出，执行被测模型时只复制生成的 DOCX，不提供评分答案。
export async function specImageDocument() {
  const writer = new ZipWriter(new Uint8ArrayWriter())
  const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`
  const notes = [
    "术语：ACK 表示 DMA 已停止且所有在途写入已排空。STOP_REQ 只是请求。RESET_DONE 也保证停止并排空。N=4，T_cycle=25 us。本文为合成验收设计，不作为 UFS 规范。",
    "图一：超时请求回收。图中 ACK 的定义在前章；分支 X 的续接在第六页。不得只读取主路径。",
    "寄存器 R0：偏移 0x20，位 0 名为 DONE，默认值 0，访问语义见第五页脚注一。不得把未找到的脚注省略。",
    "公式：T_total=N×T_cycle。符号与单位见第一页；计算结果必须保留单位和适用前提。",
    "脚注一：R0.DONE 是 W1C，写 1 清除，写 0 不改变；读寄存器不清除。仅在控制器完成初始化后适用。",
    "连接 X：等待 RESET_DONE；未完成则保持缓冲区占用，完成后释放。此连接属于第二页同一阅读单元，不是独立完成的新设计。",
    "待评审接口：另一模块规定发送 STOP_REQ 后立即回收，未定义 ACK 或 RESET_DONE 的等待条件。请指出缺失依据，而不是套用其他模块的结论。",
    "冲突资料：本页正文规定超时后无需停止确认即可释放，但附图仍要求 ACK；二者均未标注被废弃，需要设计决议。",
    "图像质量样本：附图数值区域故意模糊。无法辨认时记录缺口，不从前文推断为 25 或其他数值。",
  ]
  const flow = `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="400" viewBox="0 0 760 400">
  <defs><marker id="箭头" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#222"/></marker></defs>
  <rect width="760" height="400" fill="white"/>
  <g fill="none" stroke="#222" stroke-width="2"><rect x="25" y="30" width="190" height="60"/><rect x="25" y="135" width="190" height="60"/><path d="M120,235 L220,285 L120,335 L20,285 Z"/><rect x="360" y="255" width="170" height="60"/><rect x="25" y="360" width="240" height="35"/>
  <g marker-end="url(#箭头)"><path d="M120,90 L120,135"/><path d="M120,195 L120,235"/><path d="M220,285 L360,285"/><path d="M120,335 L120,360"/></g></g>
  <g font-family="sans-serif" font-size="22" fill="#111"><text x="55" y="68">请求超时</text><text x="40" y="173">发送 STOP_REQ</text><text x="67" y="293">ACK？</text><text x="265" y="270">是</text><text x="135" y="353">否</text><text x="378" y="293">释放缓冲区</text><text x="40" y="386">保持占用 → 连接 X</text></g></svg>`
  // 使用栅格模糊，LibreOffice 会忽略 SVG 滤镜，不能据此声称覆盖了模糊图样本。
  const pixels = new Uint8Array(760 * 400 * 4).fill(255)
  const glyphs = ["111101111101111", "111001111001111", "000000000000010", "111001001001001"]
  for (const [index, glyph] of glyphs.entries())
    for (let row = 0; row < 5; row++)
      for (let column = 0; column < 3; column++) {
        if (glyph[row * 3 + column] !== "1") continue
        for (let y = 0; y < 10; y++)
          for (let x = 0; x < 10; x++) {
            const offset = ((150 + row * 10 + y) * 760 + 90 + index * 55 + column * 10 + x) * 4
            pixels.fill(0, offset, offset + 3)
          }
      }
  const picture = new PhotonImage(pixels, 760, 400)
  gaussian_blur(picture, 24)
  const blurred = picture.get_bytes()
  picture.free()
  const image = (id: string, index: number) =>
    `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="5486400" cy="2880000"/><wp:docPr id="${index}" name="验收图${index}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${index}" name="验收图"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="5486400" cy="2880000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
  const pages = Array.from({ length: 30 }, (_, index) => {
    const number = index + 1
    const heading = `<w:p><w:pPr><w:pStyle w:val="Heading1"/>${index ? "<w:pageBreakBefore/>" : ""}</w:pPr><w:r><w:t>验收第 ${number} 页</w:t></w:r></w:p>`
    const text =
      notes[index] ??
      `批次 ${number}：本页再次引用图一，用于长文档隔离检查。引用不改变第一页术语与第六页连接定义。额外约束：请求编号 ${number} 不得与其他请求共享仍被 DMA 使用的缓冲区。`
    return (
      heading +
      paragraph(text) +
      ([1, 7, 8].includes(index) || index >= 9 ? image(index === 8 ? "模糊" : "流程", number) : "")
    )
  }).join("")
  const parts = {
    "[Content_Types].xml":
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="svg" ContentType="image/svg+xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    "_rels/.rels":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="正文" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/_rels/document.xml.rels":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="样式" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="流程" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/流程.svg"/><Relationship Id="模糊" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/模糊.png"/></Relationships>',
    "word/styles.xml":
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Noto Sans CJK SC" w:eastAsia="Noto Sans CJK SC"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>',
    "word/media/流程.svg": flow,
    "word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${pages}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:bottom="1000" w:left="1000" w:right="1000"/></w:sectPr></w:body></w:document>`,
  }
  for (const [name, value] of Object.entries(parts)) await writer.add(name, new TextReader(value))
  await writer.add("word/media/模糊.png", new Uint8ArrayReader(blurred))
  return writer.close()
}
