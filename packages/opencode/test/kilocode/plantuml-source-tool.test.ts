import { afterAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { deflateSync } from "node:zlib"
import type { ModelMessage } from "ai"
import { Effect, Layer, ManagedRuntime } from "effect"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Agent } from "../../src/agent/agent"
import { KiloToolRegistry } from "../../src/kilocode/tool/registry"
import { ExtractPlantUmlSourceTool } from "../../src/kilocode/tool/plantuml-source"
import type { Provider } from "../../src/provider/provider"
import { ProviderTransform } from "../../src/provider/transform"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import * as Tool from "../../src/tool/tool"
import { Truncate } from "../../src/tool/truncate"
import { provideTestInstance, tmpdir } from "../fixture/fixture"

const sessionID = SessionID.make("ses_plantuml_source")
const source = "@startuml\nAlice -> Bob: 认证请求\n@enduml"
const rt = ManagedRuntime.make(Layer.mergeAll(Truncate.defaultLayer, Agent.defaultLayer))

afterAll(async () => {
  await rt.dispose()
})

function chunk(kind: string, data: Uint8Array) {
  const out = Buffer.alloc(12 + data.byteLength)
  out.writeUInt32BE(data.byteLength, 0)
  out.write(kind, 4, 4, "ascii")
  Buffer.from(data).copy(out, 8)
  return out
}

function image(input: { source?: string; compressed?: boolean; keyword?: string; version?: string } = {}) {
  const text = `${input.source ?? source}\n\n${input.version ?? "1.2026.6"}`
  const compressed = input.compressed ?? true
  const payload = Buffer.concat([
    Buffer.from(`${input.keyword ?? "plantuml"}\0`, "latin1"),
    Buffer.from([compressed ? 1 : 0, 0, 0, 0]),
    compressed ? deflateSync(Buffer.from(text, "utf8")) : Buffer.from(text, "utf8"),
  ])
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("iTXt", payload),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

function user(id: string, created: number, parts: MessageV2.FilePart[]): Tool.Context["messages"][number] {
  return {
    info: {
      id: MessageID.make(id),
      sessionID,
      role: "user",
      time: { created },
      agent: "ask",
      model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
      tools: {},
    },
    parts,
  }
}

function file(
  id: string,
  name: string | undefined,
  data: Buffer,
  mime = "image/png",
  url = `data:${mime};base64,${data.toString("base64")}`,
): MessageV2.FilePart {
  return {
    id: PartID.make(`prt_${id}`),
    messageID: MessageID.make(id),
    sessionID,
    type: "file",
    mime,
    filename: name,
    url,
  }
}

function context(
  messages: MessageV2.WithParts[],
  asks: Parameters<Tool.Context["ask"]>[0][] = [],
  agent = "ask",
): Tool.Context {
  return {
    sessionID,
    messageID: MessageID.make("msg_assistant"),
    agent,
    abort: new AbortController().signal,
    messages,
    metadata: () => Effect.void,
    ask: (input) => Effect.sync(() => asks.push(input)),
  }
}

async function tool() {
  return rt.runPromise(ExtractPlantUmlSourceTool.pipe(Effect.flatMap(Tool.init)))
}

async function run(params: Tool.InferParameters<typeof ExtractPlantUmlSourceTool>, ctx: Tool.Context) {
  await using temp = await tmpdir()
  return provideTestInstance({
    directory: temp.path,
    fn: async () => {
      const def = await tool()
      return rt.runPromise(def.execute(params, ctx))
    },
  })
}

function model(image: boolean): Provider.Model {
  return {
    id: ModelV2.ID.make(image ? "vision" : "text"),
    providerID: ProviderV2.ID.make("test"),
    api: { id: "test", url: "https://example.invalid", npm: "@ai-sdk/openai-compatible" },
    name: image ? "Vision" : "Text",
    release_date: "2026-01-01",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 128_000, output: 16_000 },
    status: "active",
    options: {},
    headers: {},
  }
}

describe("extract_plantuml_source", () => {
  test("extracts the latest current-message attachment without mutating messages", async () => {
    const old = user("msg_old", 1, [file("msg_old", "old.png", image({ source: "@startuml\nclass Old\n@enduml" }))])
    const current = user("msg_current", 2, [
      file("msg_current", "diagram.png", image({ source: source.replaceAll("\n", "\r\n"), compressed: false })),
    ])
    const messages = [current, old]
    const before = structuredClone(messages)
    const result = await run({}, context(messages))

    expect(result.metadata).toMatchObject({
      ok: true,
      origin: "attachment",
      name: "diagram.png",
      version: "1.2026.6",
      sourceBytes: Buffer.byteLength(source, "utf8"),
    })
    expect(result.output).toContain(source)
    expect(result.output).not.toContain("class Old")
    expect(result.output).toContain("untrusted diagram data")
    expect(messages).toEqual(before)
  })

  test("selects by exact filename and reports ambiguous or converted attachments", async () => {
    const current = user("msg_current", 2, [
      file("msg_a", "a.png", image({ source: "@startuml\nclass A\n@enduml" })),
      file("msg_b", "b.png", image({ source: "@startuml\nclass B\n@enduml" })),
    ])

    const ambiguous = await run({}, context([current]))
    expect(ambiguous.metadata.ok).toBe(false)
    expect(ambiguous.output).toContain("a.png")
    expect(ambiguous.output).toContain("b.png")

    const selected = await run({ filename: "b.png" }, context([current]))
    expect(selected.metadata.ok).toBe(true)
    expect(selected.output).toContain("class B")
    expect(selected.output).not.toContain("class A")

    const conflicting = await run({ filename: "b.png", path: "b.png" }, context([current]))
    expect(conflicting.output).toContain("mutually exclusive")
    const empty = await run({ path: " " }, context([current]))
    expect(empty.output).toContain("path cannot be empty")

    const duplicate = user("msg_duplicate", 3, [
      file("msg_dup_a", "same.png", image()),
      file("msg_dup_b", "same.png", image()),
    ])
    const duplicated = await run({ filename: "same.png" }, context([duplicate]))
    expect(duplicated.output).toContain("same filename")
    expect(duplicated.output).toContain("use path")

    const unnamed = user("msg_unnamed", 4, [
      file("msg_named", "named.png", image()),
      file("msg_unnamed_file", undefined, image()),
    ])
    const missing = await run({}, context([unnamed]))
    expect(missing.output).toContain("no filename")
    expect(missing.output).toContain("use path")

    const converted = user("msg_converted", 4, [file("msg_jpeg", "diagram.png", Buffer.from("jpeg"), "image/jpeg")])
    const resized = await run({}, context([converted]))
    expect(resized.output).toContain("image/jpeg")
    expect(resized.output).toContain("original PNG")
    expect(resized.output).toContain("path")
  })

  test("rejects malformed data and does not OCR ordinary PNGs", async () => {
    const ordinary = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IEND", Buffer.alloc(0)),
    ])
    const malformed = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("iTXt", Buffer.from("plantuml\0\u0001\u0000\u0000\u0000broken", "latin1")),
      chunk("IEND", Buffer.alloc(0)),
    ])
    const duplicate = image()
    const metadata = duplicate.subarray(8, duplicate.length - 12)
    const repeated = Buffer.concat([duplicate.subarray(0, 8), metadata, metadata, chunk("IEND", Buffer.alloc(0))])
    const multiple = image({ source: `${source}\n${source}` })
    const trailing = Buffer.concat([ordinary, Buffer.from("trailing")])
    const excessive = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ...Array.from({ length: 4097 }, () => chunk("IDAT", Buffer.alloc(0))),
      chunk("IEND", Buffer.alloc(0)),
    ])
    const cases = [
      { name: "ordinary.png", data: ordinary, text: "does not OCR" },
      { name: "malformed.png", data: malformed, text: "decompression" },
      { name: "duplicate.png", data: repeated, text: "multiple PlantUML metadata" },
      { name: "multiple.png", data: multiple, text: "exactly one UML diagram" },
      { name: "trailing.png", data: trailing, text: "data after IEND" },
      { name: "excessive.png", data: excessive, text: "chunk safety limit" },
    ]

    for (const item of cases) {
      const result = await run(
        {},
        context([user(`msg_${item.name}`, 1, [file(`msg_${item.name}`, item.name, item.data)])]),
      )
      expect(result.metadata.ok).toBe(false)
      expect(result.output).toContain(item.text)
    }

    const invalid = user("msg_invalid", 1, [
      file("msg_invalid", "invalid.png", Buffer.alloc(0), "image/png", "data:image/png;base64,abc"),
    ])
    const result = await run({}, context([invalid]))
    expect(result.output).toContain("invalid base64")
  })

  test("enforces bounded PlantUML metadata", async () => {
    const huge = image({ source: `@startuml\nnote "${"x".repeat(128 * 1024)}"\n@enduml` })
    const result = await run({}, context([user("msg_huge", 1, [file("msg_huge", "huge.png", huge)])]))
    expect(result.metadata.ok).toBe(false)
    expect(result.output).toContain("exceeds")
  })

  test.serial("reads an authorized workspace PNG and blocks escapes before reading", async () => {
    await using temp = await tmpdir()
    await using outside = await tmpdir()
    await fs.mkdir(path.join(temp.path, "docs"))
    const png = image()
    await fs.writeFile(path.join(temp.path, "docs", "diagram.png"), png)
    await fs.writeFile(path.join(outside.path, "outside.png"), png)
    await fs.symlink(path.join(outside.path, "outside.png"), path.join(temp.path, "docs", "link.png"))
    await fs.mkdir(path.join(temp.path, "docs", "folder.png"))
    await fs.writeFile(path.join(temp.path, "docs", "large.png"), Buffer.alloc(16 * 1024 * 1024 + 1))

    await provideTestInstance({
      directory: temp.path,
      fn: async () => {
        const def = await tool()
        const asks: Parameters<Tool.Context["ask"]>[0][] = []
        const result = await rt.runPromise(def.execute({ path: "docs/diagram.png" }, context([], asks, "code")))

        expect(result.metadata).toMatchObject({
          ok: true,
          origin: "workspace",
          name: "docs/diagram.png",
          sha256: createHash("sha256").update(png).digest("hex"),
        })
        expect(asks.map((item) => item.permission)).toEqual(["read"])
        expect(result.output).toContain(source)

        for (const target of [
          path.join(temp.path, "docs", "diagram.png"),
          "../outside.png",
          "docs/../docs/diagram.png",
          "C:\\outside.png",
          "docs/link.png",
          "docs/folder.png",
          "docs/large.png",
          "docs/diagram.jpg",
        ]) {
          const denied: Parameters<Tool.Context["ask"]>[0][] = []
          const failed = await rt.runPromise(def.execute({ path: target }, context([], denied, "code")))
          expect(failed.metadata.ok).toBe(false)
          expect(denied).toEqual([])
        }
      },
    })
  })

  test("uses standard tool truncation for large recovered source", async () => {
    const large = `@startuml\nnote "${"x".repeat(60 * 1024)}"\n@enduml`
    const result = await run(
      {},
      context([user("msg_large", 1, [file("msg_large", "large.png", image({ source: large }))])]),
    )
    const metadata = result.metadata as MetaWithTruncation

    expect(metadata.ok).toBe(true)
    expect(metadata.truncated).toBe(true)
    expect(metadata.outputPath).toBeString()
    expect(result.output).toContain("output was truncated")
    expect(await fs.readFile(metadata.outputPath!, "utf8")).toContain(large)
  })

  test("leaves provider image capability behavior unchanged", () => {
    const url = `data:image/png;base64,${image().toString("base64")}`
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "inspect this image" },
          { type: "image", image: url },
        ],
      },
    ] satisfies ModelMessage[]

    const multimodal = ProviderTransform.message(structuredClone(messages), model(true), {})
    const textOnly = ProviderTransform.message(structuredClone(messages), model(false), {})

    expect(JSON.stringify(multimodal)).toContain(url)
    expect(JSON.stringify(textOnly)).not.toContain(url)
    expect(JSON.stringify(textOnly)).toContain("does not support image input")
  })

  test("is visible only to Ask, Code, and Ultra without changing the render tool scope", async () => {
    const def = await tool()
    const agent = (name: string): Agent.Info => ({ name, mode: "primary", permission: [], options: {} })

    for (const name of ["ask", "code", "ultra"]) expect(KiloToolRegistry.available(def, agent(name))).toBe(true)
    for (const name of ["plan", "debug", "explore", "orchestrator", "agent-console", "compaction", "summary"]) {
      expect(KiloToolRegistry.available(def, agent(name))).toBe(false)
    }
    expect(def.description).toContain("This is not OCR")
    expect(def.description).toContain("Image-capable models should inspect pixels directly")
  })
})

type MetaWithTruncation = {
  ok: boolean
  truncated?: boolean
  outputPath?: string
}
