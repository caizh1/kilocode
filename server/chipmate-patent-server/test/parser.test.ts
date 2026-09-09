import assert from "node:assert/strict"
import { Readable } from "node:stream"
import test from "node:test"
import { parsePatentStream } from "../src/parser.js"

test("流式解析 ST.36 常用专利字段并生成派生专利族", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <exchange-documents>
    <exchange-document country="CN" doc-number="123456789" kind="A" lang="zh">
      <bibliographic-data>
        <publication-reference><document-id><country>CN</country><doc-number>123456789</doc-number><kind>A</kind><date>20260102</date></document-id></publication-reference>
        <application-reference><document-id><country>CN</country><doc-number>202510000001</doc-number><date>20250103</date></document-id></application-reference>
        <priority-claims><priority-claim><document-id><doc-number>CN202410000001</doc-number><date>20240104</date></document-id></priority-claim></priority-claims>
        <classification-ipc><main-classification>G06F 9/00</main-classification></classification-ipc>
        <parties><applicants><applicant><addressbook><name>示例公司</name></addressbook></applicant></applicants></parties>
        <invention-title>一种确定性任务恢复方法</invention-title>
      </bibliographic-data>
      <abstract><p>在掉电后恢复嵌入式任务状态。</p></abstract>
      <description><p>使用双缓冲事务日志和单调序号恢复。</p></description>
      <claims><claim num="1" independent="true">一种任务恢复方法，包括写入双缓冲日志并校验单调序号。</claim></claims>
    </exchange-document>
  </exchange-documents>`
  const records = []
  for await (const record of parsePatentStream("CN-sample.xml", Readable.from([xml]), "CN")) records.push(record)
  assert.equal(records.length, 1)
  assert.equal(records[0]?.publicationNumber, "CN123456789A")
  assert.equal(records[0]?.publicationDate, "2026-01-02")
  assert.equal(records[0]?.priorityDate, "2024-01-04")
  assert.equal(records[0]?.claims[0]?.independent, true)
  assert.deepEqual(records[0]?.classifications, ["G06F9/00"])
  assert.match(records[0]?.familyId ?? "", /^DERIVED-/)
})

test("JSONL 删除事件被保留为软删除版本", async () => {
  const line = JSON.stringify({
    jurisdiction: "US",
    publicationNumber: "US2026000001A1",
    publicationDate: "2026-02-03",
    operation: "delete",
  })
  const records = []
  for await (const record of parsePatentStream("US-delete.jsonl", Readable.from([`${line}\n`]), "US"))
    records.push(record)
  assert.equal(records[0]?.deleted, true)
  assert.equal(records[0]?.publicationNumber, "US2026000001A1")
})

test("UTF-8 中文跨流分块时不会产生替换字符", async () => {
  const xml = `<exchange-documents><exchange-document country="CN"><publication-reference><document-id><doc-number>9988</doc-number><kind>A</kind><date>20260101</date></document-id></publication-reference><invention-title>低功耗控制方法</invention-title><claims><claim num="1">依据缓冲区水位切换采样状态</claim></claims></exchange-document></exchange-documents>`
  const bytes = Buffer.from(xml)
  const chinese = bytes.indexOf(Buffer.from("低"))
  const chunks = [bytes.subarray(0, chinese + 1), bytes.subarray(chinese + 1, chinese + 2), bytes.subarray(chinese + 2)]
  const records = []
  for await (const record of parsePatentStream("CN-split.xml", Readable.from(chunks), "CN")) records.push(record)
  assert.equal(records[0]?.title, "低功耗控制方法")
  assert.doesNotMatch(records[0]?.claims[0]?.text ?? "", /�/)
})

test("解析 CNIPA PatentDocumentAndRelated 驼峰标签和嵌套权利要求", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <business:PatentDocumentAndRelated xmlns:business="urn:cnipa:business" xmlns:base="urn:cnipa:base"
    country="CN" docNumber="105353263" kind="A" datePublication="20160224" lang="zh">
    <business:BibliographicData>
      <business:PublicationReference><base:WIPOST3Code>CN</base:WIPOST3Code><base:DocNumber>105353263</base:DocNumber><base:Kind>A</base:Kind><base:Date>20160224</base:Date></business:PublicationReference>
      <business:ApplicationReference><base:WIPOST3Code>CN</base:WIPOST3Code><base:DocNumber>201510822092</base:DocNumber><base:Date>20151124</base:Date></business:ApplicationReference>
      <business:ClassificationIPCR><base:Text>H02H 3/00</base:Text></business:ClassificationIPCR>
      <business:InventionTitle>具有直流拉弧检测功能的接线盒</business:InventionTitle>
      <business:Applicants><business:Applicant><base:AddressBook><base:Name>示例申请人</base:Name></base:AddressBook></business:Applicant></business:Applicants>
      <business:Inventors><business:Inventor><base:AddressBook><base:Name>示例发明人</base:Name></base:AddressBook></business:Inventor></business:Inventors>
    </business:BibliographicData>
    <business:Abstract><base:Paragraphs num="0001">对直流拉弧信号进行实时检测。</base:Paragraphs></business:Abstract>
    <business:Description><base:Paragraphs num="0001">通过高通滤波和比较锁定电路检测拉弧。</base:Paragraphs></business:Description>
    <business:Claims><business:Claim num="1"><business:ClaimText>一种接线盒，包括高通滤波电路和控制开关。</business:ClaimText></business:Claim></business:Claims>
  </business:PatentDocumentAndRelated>`
  const records = []
  for await (const record of parsePatentStream("CN105353263A.XML", Readable.from([xml]), "CN")) records.push(record)
  assert.equal(records.length, 1)
  assert.equal(records[0]?.publicationNumber, "CN105353263A")
  assert.equal(records[0]?.applicationNumber, "CN201510822092")
  assert.equal(records[0]?.publicationDate, "2016-02-24")
  assert.equal(records[0]?.filingDate, "2015-11-24")
  assert.equal(records[0]?.title, "具有直流拉弧检测功能的接线盒")
  assert.equal(records[0]?.abstract, "对直流拉弧信号进行实时检测。")
  assert.equal(records[0]?.description, "通过高通滤波和比较锁定电路检测拉弧。")
  assert.equal(records[0]?.claims[0]?.text, "一种接线盒，包括高通滤波电路和控制开关。")
  assert.deepEqual(records[0]?.classifications, ["H02H3/00"])
  assert.deepEqual(records[0]?.applicants, ["示例申请人"])
  assert.deepEqual(records[0]?.inventors, ["示例发明人"])
})
