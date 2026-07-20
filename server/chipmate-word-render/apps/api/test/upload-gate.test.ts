import assert from "node:assert/strict"
import test from "node:test"
import {
  UPLOAD_MAX_BYTES,
  UPLOAD_MIN_FREE_BYTES,
  UploadAdmissionError,
  UploadGate,
} from "../src/upload-gate.ts"

test("upload admission serializes slots and byte reservations", async () => {
  const gate = new UploadGate({
    root: "/tmp",
    active: 2,
    stat: async () => ({ bavail: UPLOAD_MIN_FREE_BYTES + UPLOAD_MAX_BYTES * 2, bsize: 1 }),
  })
  const first = await gate.claim(100)
  const second = await gate.claim(0)
  assert.deepEqual(gate.health(), {
    activeUploads: 2,
    maxActiveUploads: 2,
    reservedBytes: 100 + UPLOAD_MAX_BYTES,
    freeBytes: UPLOAD_MIN_FREE_BYTES + UPLOAD_MAX_BYTES * 2,
    minimumFreeBytes: UPLOAD_MIN_FREE_BYTES,
    storagePressure: false,
  })
  await assert.rejects(gate.claim(1), (err: unknown) => err instanceof UploadAdmissionError && err.code === "PUBLICATION_BUSY")
  await first.release()
  await first.release()
  assert.equal(gate.health().activeUploads, 1)
  await second.release()
})

test("upload admission reserves the maximum for invalid lengths and rejects storage pressure", async () => {
  const gate = new UploadGate({
    root: "/tmp",
    stat: async () => ({ bavail: UPLOAD_MIN_FREE_BYTES + UPLOAD_MAX_BYTES - 1, bsize: 1 }),
  })
  await assert.rejects(gate.claim(Number.NaN), (err: unknown) => err instanceof UploadAdmissionError && err.code === "STORAGE_PRESSURE")
  assert.equal(gate.health().activeUploads, 0)
  assert.equal(gate.health().reservedBytes, 0)
  assert.equal(gate.health().storagePressure, true)
})

test("upload admission treats an unreadable filesystem as storage pressure", async () => {
  const gate = new UploadGate({ root: "/missing", stat: async () => { throw new Error("unavailable") } })
  await assert.rejects(gate.claim(1), (err: unknown) => err instanceof UploadAdmissionError && err.code === "STORAGE_PRESSURE")
  assert.equal(gate.health().storagePressure, true)
})
