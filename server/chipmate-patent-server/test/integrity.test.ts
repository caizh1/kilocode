import assert from "node:assert/strict"
import test from "node:test"
import type { NormalizedPatentRecord, SourceManifest } from "../src/contracts.js"
import { assertBatchIntegrity, createMetrics, validateRecords } from "../src/integrity.js"

const manifest: SourceManifest = {
  schemaVersion: 1,
  source: "CNIPA",
  jurisdiction: "CN",
  batchId: "CNIPA-CN-1",
  dataType: "legal-status",
  declaredRecords: 1,
}

function record(patch: Partial<NormalizedPatentRecord> = {}): NormalizedPatentRecord {
  return {
    sourceRecordId: "CN1",
    publicationNumber: "CN100000001A",
    applicationNumber: "CN202500000001",
    jurisdiction: "CN",
    kindCode: "A",
    language: "zh",
    title: "一种双缓冲恢复方法",
    abstract: "摘要",
    description: "说明书",
    filingDate: "2025-01-02",
    priorityDate: "2024-01-02",
    publicationDate: "2026-01-02",
    familyId: null,
    familySource: null,
    legalStatus: null,
    legalStatusDate: null,
    applicants: ["示例公司"],
    inventors: ["示例发明人"],
    classifications: ["G06F9/00"],
    priorities: ["CN202400000001"],
    citations: [],
    claims: [{ number: "1", independent: true, language: "zh", text: "一种双缓冲恢复方法。" }],
    deleted: false,
    ...patch,
  }
}

test("法律状态增量缺少全文时沿用当前版本而不清空", () => {
  const metrics = createMetrics()
  const delta = record({
    title: null,
    abstract: null,
    description: null,
    publicationDate: "",
    claims: [],
    legalStatus: "ACTIVE",
    legalStatusDate: "2026-03-01",
  })
  const accepted = validateRecords(manifest, [delta], new Map([[delta.publicationNumber, record()]]), metrics)
  assert.equal(accepted[0]?.title, "一种双缓冲恢复方法")
  assert.equal(accepted[0]?.claims.length, 1)
  assert.equal(accepted[0]?.legalStatus, "ACTIVE")
  assert.equal(metrics.rejectedRecords, 0)
  assert.doesNotThrow(() => assertBatchIntegrity(manifest, metrics))
})

test("地区不一致使整个批次无法发布", () => {
  const metrics = createMetrics()
  validateRecords(manifest, [record({ jurisdiction: "US" })], new Map(), metrics)
  assert.equal(metrics.rejectedRecords, 1)
  assert.throws(() => assertBatchIntegrity(manifest, metrics), /不得发布/)
})

test("声明记录数与解析记录数不一致时失败", () => {
  const metrics = createMetrics()
  validateRecords({ ...manifest, declaredRecords: 2 }, [record()], new Map(), metrics)
  assert.throws(() => assertBatchIntegrity({ ...manifest, declaredRecords: 2 }, metrics), /声明记录数/)
})
