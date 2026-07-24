import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { deflateSync } from "node:zlib"
import test from "node:test"

const require = createRequire(import.meta.url)
const plantuml = require("../../../server.js") as {
  assertSinglePlantUml(source: string): void
  extractPlantUmlMetadata(bytes: Buffer, max: number): { source: string; version?: string } | undefined
  normalizePlantUmlSource(source: string): string
  plantUmlEnv(): NodeJS.ProcessEnv
  withPlantUmlSlot<T>(timeout: number, task: (remaining: number) => Promise<T>): Promise<T>
}

const source = "@startuml\nAlice -> Bob: 你好\n@enduml"

function png(text: string) {
  const data = Buffer.concat([
    Buffer.from("plantuml\0", "latin1"),
    Buffer.from([1, 0, 0, 0]),
    deflateSync(Buffer.from(text)),
  ])
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  chunk.write("iTXt", 4, "ascii")
  data.copy(chunk, 8)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk])
}

function pause(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

test("PlantUML source validation accepts exactly one complete diagram", () => {
  assert.doesNotThrow(() => plantuml.assertSinglePlantUml(source))
  assert.throws(
    () => plantuml.assertSinglePlantUml(`${source}\n${source}`),
    (err: unknown) => err instanceof Error && Reflect.get(err, "code") === "plantuml-source-invalid",
  )
  assert.throws(
    () => plantuml.assertSinglePlantUml(`${source}\nextra`),
    (err: unknown) => err instanceof Error && Reflect.get(err, "code") === "plantuml-source-invalid",
  )
})

test("PlantUML metadata restores compressed UTF-8 source and version", () => {
  const actual = plantuml.extractPlantUmlMetadata(png(`${source}\nPlantUML version 1.2026.6`), 128 * 1024)
  assert.deepEqual(actual, { source, version: "PlantUML version 1.2026.6" })
  assert.equal(plantuml.normalizePlantUmlSource(`\r\n${source.replaceAll("\n", "\r\n")}\r\n`), source)
})

test("PlantUML child environment does not inherit server secrets", () => {
  process.env.CHIPMATE_TEST_SECRET = "must-not-leak"
  const env = plantuml.plantUmlEnv()
  delete process.env.CHIPMATE_TEST_SECRET

  assert.equal(env.CHIPMATE_TEST_SECRET, undefined)
  assert.equal(env.PLANTUML_SECURITY_PROFILE, "SANDBOX")
  assert.equal(env.PLANTUML_LIMIT_SIZE, "4096")
})

test("PlantUML scheduling caps concurrency, queue size, and queue wait", { timeout: 5_000 }, async () => {
  const state = { active: 0, max: 0 }
  const jobs = Array.from({ length: 18 }, () =>
    plantuml.withPlantUmlSlot(2_000, async () => {
      state.active += 1
      state.max = Math.max(state.max, state.active)
      await pause(80)
      state.active -= 1
    }),
  )

  await assert.rejects(
    plantuml.withPlantUmlSlot(2_000, async () => undefined),
    (err: unknown) => err instanceof Error && Reflect.get(err, "code") === "plantuml-render-busy",
  )
  await Promise.all(jobs)
  assert.equal(state.max, 2)

  const blockers = Array.from({ length: 2 }, () =>
    plantuml.withPlantUmlSlot(1_000, async () => pause(80)),
  )
  await assert.rejects(
    plantuml.withPlantUmlSlot(10, async () => undefined),
    (err: unknown) => err instanceof Error && Reflect.get(err, "code") === "plantuml-render-timeout",
  )
  await Promise.all(blockers)
})
