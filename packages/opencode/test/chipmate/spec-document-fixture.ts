import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js"

// 固定 OOXML 夹具：保留域可见结果、合并表格、修订与真实设计缺口。
// 仅验证原生读取链路，不用脚本化模型证明语义理解。
export async function specDocument() {
  const writer = new ZipWriter(new Uint8ArrayWriter())
  const parts = {
    "[Content_Types].xml":
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/styles.xml": '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
    "word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
      <w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>TOC \\o "1-3"</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>目录：请求处理 1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>
      <w:p><w:bookmarkStart w:id="1" w:name="请求回收"/><w:r><w:t>超时后回收请求；本节未规定 DMA 停止条件。</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>
      <w:p><w:r><w:t>参见：</w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>REF 请求回收</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>请求回收章节</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>
      <w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>请求资源表</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>资源</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>停止条件</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      <w:p><w:del w:id="2" w:author="评审员"><w:r><w:delText>旧回收约定</w:delText></w:r></w:del><w:ins w:id="3" w:author="评审员"><w:r><w:t>修订后的回收约定待核对</w:t></w:r></w:ins></w:p>
      <w:sectPr/>
    </w:body></w:document>`,
  }
  for (const [name, value] of Object.entries(parts)) await writer.add(name, new TextReader(value))
  return writer.close()
}
