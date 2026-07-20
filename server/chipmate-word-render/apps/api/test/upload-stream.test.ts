import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PassThrough } from "node:stream"
import test from "node:test"
import { saveExtensionUpload } from "../src/extensions.ts"

test("extension upload aborts an idle stream", async () => {
  const dir = await mkdtemp(join(tmpdir(), "chipmate-upload-timeout-"))
  const stream = new PassThrough()
  try {
    await assert.rejects(saveExtensionUpload(stream, join(dir, "idle.part"), 10, 1_000), /idle/i)
  } finally {
    stream.destroy()
    await rm(dir, { recursive: true, force: true })
  }
})

test("extension upload enforces its absolute deadline even while data arrives", async () => {
  const dir = await mkdtemp(join(tmpdir(), "chipmate-upload-deadline-"))
  const stream = new PassThrough()
  const timer = setInterval(() => stream.write(Buffer.alloc(1)), 5)
  try {
    await assert.rejects(saveExtensionUpload(stream, join(dir, "deadline.part"), 100, 20), /two hour/i)
  } finally {
    clearInterval(timer)
    stream.destroy()
    await rm(dir, { recursive: true, force: true })
  }
})
