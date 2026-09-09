import JSZip from "jszip"
import { createRequire } from "node:module"
const { PNG } = createRequire(import.meta.url)("pngjs")

// 固定设计样本：20 个标题、复杂 TOC 域而非 TOC1 段落，正文含公式、合并表格及嵌入流程示意图、交叉引用和修订。
export async function wordImagesFixture() {
  const zip = new JSZip()
  const image = new PNG({ width: 240, height: 60 })
  for (let y = 0; y < 60; y++)
    for (let x = 0; x < 240; x++) {
      const box = y >= 10 && y <= 50 && [10, 90, 170].some((left) => x >= left && x <= left + 60)
      const arrow = y >= 28 && y <= 32 && x >= 70 && x <= 170
      const offset = (y * 240 + x) * 4
      image.data[offset] = box || arrow ? 30 : 255
      image.data[offset + 1] = box || arrow ? 100 : 255
      image.data[offset + 2] = box || arrow ? 180 : 255
      image.data[offset + 3] = 255
    }
  zip.file("word/media/flow.png", PNG.sync.write(image))
  zip.file(
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
  )
  zip.file(
    "_rels/.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  )
  zip.file(
    "word/_rels/document.xml.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="flow" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/flow.png"/></Relationships>',
  )
  zip.file(
    "word/styles.xml",
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>',
  )
  zip.file(
    "word/document.xml",
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>
  <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:bookmarkStart w:id="0" w:name="条款"/><w:r><w:t>请求处理设计</w:t></w:r><w:bookmarkEnd w:id="0"/></w:p>
  <w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>TOC \\o "1-3"</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>设计目录（保留原始显示）</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>
  ${Array.from({ length: 20 }, (_, i) => `<w:p><w:pPr><w:pStyle w:val="Heading1"/>${i === 10 ? "<w:pageBreakBefore/>" : ""}</w:pPr><w:r><w:t>第 ${i + 1} 节 请求回收</w:t></w:r></w:p><w:p><w:r><w:t>停止 DMA 后才允许回收缓冲区。</w:t></w:r></w:p>`).join("")}
  <w:p><m:oMath><m:f><m:num><m:r><m:t>请求数量</m:t></m:r></m:num><m:den><m:r><m:t>处理时间</m:t></m:r></m:den></m:f></m:oMath></w:p>
  <w:p><w:r><w:t>流程图：提交请求 → 停止 DMA → 回收缓冲区</w:t></w:r></w:p>
  <w:p><w:r><w:drawing><wp:inline><wp:extent cx="3657600" cy="914400"/><wp:docPr id="1" name="流程示意图"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="流程"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="flow"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="3657600" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
  <w:p><w:fldSimple w:instr="REF 条款"><w:r><w:t>参见请求回收条件</w:t></w:r></w:fldSimple><w:ins w:id="1" w:author="评审人员"><w:r><w:t>等待 DMA 停止确认</w:t></w:r></w:ins></w:p>
  <w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>资源归属与停止条件</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
  <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/></w:sectPr></w:body></w:document>`,
  )
  return zip.generateAsync({ type: "nodebuffer" })
}
