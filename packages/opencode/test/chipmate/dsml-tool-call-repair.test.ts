import { describe, expect, test } from "bun:test"
import type { LanguageModelV3, LanguageModelV3StreamPart } from "@ai-sdk/provider"
import { jsonSchema, tool, wrapLanguageModel, type ModelMessage, type Tool } from "ai"
import { z } from "zod"
import { DSML } from "@/chipmate/session/dsml"
import type { Config } from "@/config/config"

const command =
  "# Count preprocessor directives properly grep -n '#if|#elif|#else|#endif|#ifdef|#ifndef' /home/caizh/ufs3030_fw/common/compile.h"
const description = "Count all preprocessor directives"
const sample = `Actually, let me just re-read the first 30 lines.\n\n<｜DSML｜tool_calls> <｜DSML｜invoke name="bash"> <｜DSML｜parameter name="command" string="true">${command}</｜DSML｜parameter> <｜DSML｜parameter name="description" string="true">${description}</｜DSML｜parameter> </｜DSML｜invoke> </｜DSML｜tool_calls>`
const raw = sample.slice(sample.indexOf(DSML.START))
const end = "</｜DSML｜tool_calls>"
const invoke = "</｜DSML｜invoke>"
const orphan = `<｜DSML｜parameter name="filePath" string="true">/home/caizh/ufs3030_fw/gcc_build/mpbl/build/mpbl.map</｜DSML｜parameter> <｜DSML｜parameter name="limit" string="false">100</｜DSML｜parameter> </｜DSML｜invoke> </｜DSML｜tool_calls>`
const short = orphan.slice(0, -end.length).trimEnd()
const lead =
  "Now I can see the actual output section layout in the GCC map. Let me read more to find all sections and their sizes, and also the cross-reference (symbol) section at the end.\n\nLet me use a Python script to parse the entire map file efficiently and extract sections and symbols. Given the map is 9585 lines, a script approach is best. "
const truncated = `<｜DSML｜parameter name="filePath" string="true">/home/caizh/ufs3030_fw/gcc_build/mpbl/build/mpbl.map</｜DSML｜parameter> <｜DSML｜parameter name="limit" string="false">500</｜DSML｜parameter> <｜DSML｜parameter name="offset" string="false">5780</｜DSML｜parameter> </｜DSML｜invoke>`
const report = lead + truncated
const retry = "chipmate_dsml_orphan_retry"
const warning = "The model returned an incomplete tool call twice. No tool was executed; automatic DSML repair stopped."

const bash = tool({
  description: "Run a shell command",
  inputSchema: z.object({
    command: z.string(),
    description: z.string().optional(),
  }),
})

const tools = { bash }

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
}

function finish(
  reason: "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other" = "stop",
): LanguageModelV3StreamPart {
  return {
    type: "finish",
    usage,
    finishReason: { unified: reason, raw: reason === "tool-calls" ? "tool_calls" : reason },
  }
}

async function collect(
  parts: LanguageModelV3StreamPart[],
  opts: { messages?: ModelMessage[]; tools?: Record<string, Tool> } = {},
) {
  const base: LanguageModelV3 = {
    specificationVersion: "v3",
    provider: "test",
    modelId: "test",
    supportedUrls: {},
    doGenerate() {
      throw new Error("not used")
    },
    async doStream() {
      return {
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(ctrl) {
            for (const part of parts) ctrl.enqueue(part)
            ctrl.close()
          },
        }),
      }
    },
  }
  const model = wrapLanguageModel({
    model: base,
    middleware: DSML.middleware({ tools: opts.tools ?? tools, messages: opts.messages ?? [] }),
  })
  const result = await model.doStream({ prompt: [] })
  const output: LanguageModelV3StreamPart[] = []
  const reader = result.stream.getReader()
  while (true) {
    const item = await reader.read()
    if (item.done) return output
    output.push(item.value)
  }
}

async function controlled() {
  let upstream: ReadableStreamDefaultController<LanguageModelV3StreamPart> | undefined
  const base: LanguageModelV3 = {
    specificationVersion: "v3",
    provider: "test",
    modelId: "test",
    supportedUrls: {},
    doGenerate() {
      throw new Error("not used")
    },
    async doStream() {
      return {
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(ctrl) {
            upstream = ctrl
          },
        }),
      }
    },
  }
  const model = wrapLanguageModel({ model: base, middleware: DSML.middleware({ tools, messages: [] }) })
  const result = await model.doStream({ prompt: [] })
  if (!upstream) throw new Error("missing upstream controller")
  return { upstream, reader: result.stream.getReader() }
}

function text(parts: LanguageModelV3StreamPart[]) {
  return parts
    .filter((part): part is Extract<LanguageModelV3StreamPart, { type: "text-delta" }> => part.type === "text-delta")
    .map((part) => part.delta)
    .join("")
}

function calls(parts: LanguageModelV3StreamPart[]) {
  return parts.filter(
    (part): part is Extract<LanguageModelV3StreamPart, { type: "tool-call" }> => part.type === "tool-call",
  )
}

function history(marker = retry): ModelMessage[] {
  return [
    { role: "user", content: "inspect the map" },
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "call-retry",
          toolName: "invalid",
          input: { tool: marker, error: "retry" },
        },
      ],
    },
  ]
}

function streamed(chunks: string[]) {
  return [
    { type: "text-start" as const, id: "text-0" },
    ...chunks.map((delta) => ({ type: "text-delta" as const, id: "text-0", delta })),
    { type: "text-end" as const, id: "text-0" },
    finish(),
  ]
}

describe("DSML tool call repair", () => {
  test("parses the reported bash call without changing its parameters", async () => {
    const result = await DSML.parse(raw, tools)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.calls).toHaveLength(1)
    expect(result.calls[0]).toMatchObject({
      name: "bash",
      input: { command, description },
    })
  })

  test("repairs a terminal DSML block and preserves leading text", async () => {
    const output = await collect(streamed([sample]))
    expect(output.filter((part) => part.type === "text-delta")).toEqual([
      {
        type: "text-delta",
        id: "text-0",
        delta: "Actually, let me just re-read the first 30 lines.\n\n",
      },
    ])
    expect(output.find((part) => part.type === "tool-call")).toMatchObject({
      type: "tool-call",
      toolName: "bash",
      input: JSON.stringify({ command, description }),
    })
    expect(output.at(-1)).toMatchObject({ type: "finish", finishReason: { unified: "tool-calls" } })

    const leaked = streamed([raw])
    leaked[leaked.length - 1] = finish("tool-calls")
    expect((await collect(leaked)).filter((part) => part.type === "tool-call")).toHaveLength(1)
  })

  test("turns the reported orphan into one invalid retry without guessing a business tool", async () => {
    const output = await collect(streamed([orphan]))
    expect(text(output)).toBe("")
    expect(calls(output)).toHaveLength(1)
    expect(calls(output)[0]).toMatchObject({ type: "tool-call", toolName: "invalid" })
    expect(JSON.parse(calls(output)[0].input)).toMatchObject({ tool: retry })
    expect(calls(output)[0].input).not.toContain("filePath")
    expect(calls(output)[0].input).not.toContain("/home/caizh")
    expect(calls(output).some((part) => part.toolName === "read" || part.toolName === "bash")).toBe(false)
    expect(output.at(-1)).toMatchObject({ type: "finish", finishReason: { unified: "tool-calls" } })
  })

  test("retries the exact orphan that ends after a complete invoke", async () => {
    for (const reason of ["stop", "tool-calls"] as const) {
      const parts = streamed([report])
      parts[parts.length - 1] = finish(reason)
      const output = await collect(parts)
      expect(text(output)).toBe(lead)
      expect(calls(output)).toHaveLength(1)
      expect(calls(output)[0].toolName).toBe("invalid")
      expect(JSON.parse(calls(output)[0].input)).toMatchObject({ tool: retry })
      expect(calls(output)[0].input).not.toContain("filePath")
      expect(calls(output)[0].input).not.toContain("/home/caizh")
      expect(calls(output).some((part) => ["read", "bash", "write"].includes(part.toolName))).toBe(false)
      expect(output.at(-1)).toMatchObject({ type: "finish", finishReason: { unified: "tool-calls" } })
    }
  })

  test("stops after a second orphan and scopes the retry marker to the latest user turn", async () => {
    for (const value of [orphan, short]) {
      const stopped = await collect(streamed([value]), { messages: history() })
      expect(calls(stopped)).toEqual([])
      expect(text(stopped)).toBe(warning)
      expect(stopped.at(-1)).toMatchObject({ type: "finish", finishReason: { unified: "stop" } })
    }

    const next = [...history(), { role: "user", content: "inspect another map" } satisfies ModelMessage]
    const fresh = await collect(streamed([short]), { messages: next })
    expect(calls(fresh)).toHaveLength(1)
    expect(calls(fresh)[0].toolName).toBe("invalid")

    const unrelated = await collect(streamed([short]), { messages: history("other-marker") })
    expect(calls(unrelated)).toHaveLength(1)
    expect(calls(unrelated)[0].toolName).toBe("invalid")
  })

  test("keeps explicit full DSML repair enabled after an orphan retry marker", async () => {
    const output = await collect(streamed([raw]), { messages: history() })
    expect(calls(output)).toHaveLength(1)
    expect(calls(output)[0].toolName).toBe("bash")
  })

  test("handles the orphan across every chunk boundary", async () => {
    for (const value of [orphan, short]) {
      for (let index = 0; index <= value.length; index++) {
        const output = await collect(streamed([value.slice(0, index), value.slice(index)]))
        if (calls(output).length !== 1) throw new Error(`orphan chunk boundary failed at ${index}`)
        expect(calls(output)[0].toolName).toBe("invalid")
        expect(text(output)).toBe("")
      }
    }

    const spaced = await collect(streamed([short, " \n\t "]))
    expect(calls(spaced)).toHaveLength(1)
    expect(text(spaced)).toBe("")
  })

  test("requires a complete invoke and rejects partial closing tag prefixes", async () => {
    const body = short.slice(0, -invoke.length)
    for (let index = 0; index < invoke.length; index++) {
      const value = body + invoke.slice(0, index)
      const parts = streamed([value])
      expect(await collect(parts)).toEqual(parts)
    }

    for (let index = 1; index < end.length; index++) {
      const value = `${short} ${end.slice(0, index)}`
      const parts = streamed([value])
      expect(await collect(parts)).toEqual(parts)
    }
  })

  test("repairs the start marker across every chunk boundary", async () => {
    const prefix = "Actually.\n\n"
    for (let index = 0; index <= DSML.START.length; index++) {
      const output = await collect(streamed([prefix + raw.slice(0, index), raw.slice(index)]))
      expect(output.filter((part) => part.type === "tool-call")).toHaveLength(1)
      expect(
        output
          .filter(
            (part): part is Extract<LanguageModelV3StreamPart, { type: "text-delta" }> => part.type === "text-delta",
          )
          .map((part) => part.delta)
          .join(""),
      ).toBe(prefix)
    }
  })

  test("handles the complete DSML grammar across every chunk boundary", async () => {
    for (let index = 0; index <= raw.length; index++) {
      const output = await collect(streamed([raw.slice(0, index), raw.slice(index)]))
      if (calls(output).length !== 1) throw new Error(`full chunk boundary failed at ${index}`)
      expect(calls(output)[0].toolName).toBe("bash")
      expect(text(output)).toBe("")
    }
  })

  test("keeps explicit multi-call DSML support", async () => {
    const body = raw.slice(DSML.START.length, -end.length)
    const output = await collect(streamed([`${DSML.START}${body}${body}${end}`]))
    expect(calls(output)).toHaveLength(2)
    expect(calls(output).map((part) => part.toolName)).toEqual(["bash", "bash"])
  })

  test("passes ordinary and structured responses through unchanged", async () => {
    const text: LanguageModelV3StreamPart[] = [
      { type: "stream-start", warnings: [] },
      { type: "response-metadata", id: "response-1", modelId: "deepseek-v4" },
      { type: "reasoning-start", id: "reasoning-0" },
      { type: "reasoning-delta", id: "reasoning-0", delta: "checking" },
      { type: "reasoning-end", id: "reasoning-0" },
      ...streamed(["normal < response"]),
    ]
    expect(await collect(text)).toEqual(text)

    const structured: LanguageModelV3StreamPart[] = [
      { type: "tool-input-start", id: "call-1", toolName: "bash" },
      { type: "tool-input-delta", id: "call-1", delta: '{"command":"pwd"}' },
      { type: "tool-input-end", id: "call-1" },
      { type: "tool-call", toolCallId: "call_1", toolName: "bash", input: '{"command":"pwd"}' },
      finish("tool-calls"),
    ]
    expect(await collect(structured)).toEqual(structured)
  })

  test("does not repair DSML inside a markdown fence", async () => {
    const cases = [`\`\`\`text\n${raw}\n\`\`\``, `> \`\`\`text\n> ${raw}\n> \`\`\``, `    ${raw}`]

    for (const value of cases) {
      const fenced = streamed([value])
      expect(await collect(fenced)).toEqual(fenced)

      for (let index = 0; index <= value.length; index++) {
        const output = await collect(streamed([value.slice(0, index), value.slice(index)]))
        expect(output.some((part) => part.type === "tool-call")).toBe(false)
        expect(
          output
            .filter(
              (part): part is Extract<LanguageModelV3StreamPart, { type: "text-delta" }> => part.type === "text-delta",
            )
            .map((part) => part.delta)
            .join(""),
        ).toBe(value)
      }
    }
  })

  test("does not repair orphan DSML in fences, quotes, indentation, or inline code", async () => {
    const cases = [
      `\`\`\`text\n${orphan}\n\`\`\``,
      `> ${orphan}`,
      `    ${orphan}`,
      `\`${orphan}\``,
      `\`\`${orphan}\`\``,
      `\`${orphan}`,
      `\`\`\`text\n${short}\n\`\`\``,
      `> ${short}`,
      `    ${short}`,
      `\`${short}\``,
    ]

    for (const value of cases) {
      const protectedParts = streamed([value])
      expect(await collect(protectedParts)).toEqual(protectedParts)

      for (let index = 0; index <= value.length; index++) {
        const output = await collect(streamed([value.slice(0, index), value.slice(index)]))
        expect(calls(output)).toEqual([])
        expect(text(output)).toBe(value)
      }
    }

    const mixed = await collect(streamed([`\`${orphan}\` then ${orphan}`]))
    expect(calls(mixed)).toHaveLength(1)
    expect(calls(mixed)[0].toolName).toBe("invalid")
    expect(text(mixed)).toBe(`\`${orphan}\` then `)
  })

  test("fails closed for malformed, duplicate, nested, multi-call, and oversized orphans", async () => {
    const cases = [
      orphan.replace("</｜DSML｜parameter>", ""),
      `${orphan} trailing`,
      `${short} trailing`,
      `${short} ${end.slice(0, -1)}`,
      `${short} ${end.slice(0, -1)}x`,
      `${short} </｜DSML｜tool_callz>`,
      `${short} </｜DSML｜invoke>`,
      orphan.replace('name="limit"', 'name="filePath"'),
      orphan.replace("/home/caizh/ufs3030_fw/gcc_build/mpbl/build/mpbl.map", '<｜DSML｜invoke name="read">'),
      orphan.replace("/home/caizh/ufs3030_fw/gcc_build/mpbl/build/mpbl.map", "</｜DSML｜invoke>"),
      orphan.replace("</｜DSML｜tool_calls>", orphan),
      orphan.replace("</｜DSML｜tool_calls>", "</｜DSML｜invoke> </｜DSML｜tool_calls>"),
      `${short}${" ".repeat(256 * 1024)}`,
    ]

    for (const value of cases) {
      const parts = streamed([value])
      const output = await collect(parts)
      expect(calls(output)).toEqual([])
      expect(text(output)).toBe(value)
      expect(output.at(-1)).toEqual(parts.at(-1))
    }
  })

  test("enforces the 4096 captured event limit", async () => {
    const accepted = await collect(streamed([short, ...Array.from({ length: 4094 }, () => " ")]))
    expect(calls(accepted)).toHaveLength(1)
    expect(calls(accepted)[0].toolName).toBe("invalid")

    const chunks = [short, ...Array.from({ length: 4095 }, () => " ")]
    const rejected = await collect(streamed(chunks))
    expect(calls(rejected)).toEqual([])
    expect(text(rejected)).toBe(chunks.join(""))
    expect(rejected.at(-1)).toMatchObject({ type: "finish", finishReason: { unified: "stop" } })
  })

  test("replays orphan DSML for non-terminal finishes and streams without finish", async () => {
    for (const value of [orphan, short]) {
      for (const reason of ["length", "content-filter", "error", "other"] as const) {
        const parts = streamed([value])
        parts[parts.length - 1] = finish(reason)
        expect(await collect(parts)).toEqual(parts)
      }

      const unfinished = streamed([value]).slice(0, -1)
      expect(await collect(unfinished)).toEqual(unfinished)
    }
  })

  test("does not use production-style JSON schemas to infer an orphan tool", async () => {
    const production = {
      read: tool({
        description: "Read a file",
        inputSchema: jsonSchema({
          type: "object",
          required: ["filePath"],
          properties: { filePath: { type: "string" }, limit: { type: "number" } },
        }),
      }),
      write: tool({
        description: "Write a file",
        inputSchema: jsonSchema({ type: "object", properties: {} }),
      }),
      bash: tool({
        description: "Run a command",
        inputSchema: jsonSchema({ type: "object", properties: { command: { type: "string" } } }),
      }),
    }

    for (const value of [orphan, short]) {
      const output = await collect(streamed([value]), { tools: production })
      expect(calls(output)).toHaveLength(1)
      expect(calls(output)[0].toolName).toBe("invalid")
      expect(Object.keys(production)).not.toContain(calls(output)[0].toolName)
    }
  })

  test("immediately replays a capture when a structured tool event arrives", async () => {
    const stream = await controlled()

    const start = { type: "text-start" as const, id: "text-0" }
    const delta = { type: "text-delta" as const, id: "text-0", delta: orphan }
    const call = { type: "tool-call" as const, toolCallId: "call-real", toolName: "bash", input: '{"command":"pwd"}' }
    stream.upstream.enqueue(start)
    expect((await stream.reader.read()).value).toEqual(start)
    stream.upstream.enqueue(delta)
    stream.upstream.enqueue(call)

    expect((await stream.reader.read()).value).toEqual(delta)
    expect((await stream.reader.read()).value).toEqual(call)

    const end = finish("tool-calls")
    stream.upstream.enqueue(end)
    stream.upstream.close()
    expect((await stream.reader.read()).value).toEqual(end)
    expect((await stream.reader.read()).done).toBe(true)
  })

  test("immediately replays full and orphan text once syntax becomes invalid", async () => {
    for (const delta of [
      `${short} trailing`,
      `${short} ${end.slice(0, -1)}x`,
      `${DSML.START} definitely-not-an-invoke`,
    ]) {
      const stream = await controlled()
      const start = { type: "text-start" as const, id: "text-0" }
      const malformed = { type: "text-delta" as const, id: "text-0", delta }
      stream.upstream.enqueue(start)
      expect((await stream.reader.read()).value).toEqual(start)
      stream.upstream.enqueue(malformed)
      expect((await stream.reader.read()).value).toEqual(malformed)
      stream.upstream.close()
      expect((await stream.reader.read()).done).toBe(true)
    }
  })

  test("replays interrupted captures in order without duplicate execution", async () => {
    const interruptions: LanguageModelV3StreamPart[] = [
      { type: "text-delta", id: "text-other", delta: "other" },
      { type: "reasoning-start", id: "reasoning-0" },
      { type: "error", error: new Error("provider failed") },
      { type: "tool-input-start", id: "call-real", toolName: "bash" },
    ]

    for (const value of [orphan, short]) {
      for (const interruption of interruptions) {
        const parts: LanguageModelV3StreamPart[] = [
          { type: "text-start", id: "text-0" },
          { type: "text-delta", id: "text-0", delta: value },
          interruption,
          finish(),
        ]
        const output = await collect(parts)
        expect(output).toEqual(parts)
        expect(calls(output).filter((part) => part.toolName === "invalid")).toEqual([])
      }
    }
  })

  test("preserves raw and response metadata around an orphan correction", async () => {
    const parts: LanguageModelV3StreamPart[] = [
      { type: "text-start", id: "text-0" },
      { type: "text-delta", id: "text-0", delta: short },
      { type: "raw", rawValue: { chunk: 1 } },
      { type: "response-metadata", id: "response-1", modelId: "deepseek-v4" },
      { type: "text-end", id: "text-0" },
      finish(),
    ]
    const output = await collect(parts)
    expect(output.map((part) => part.type)).toEqual([
      "text-start",
      "raw",
      "response-metadata",
      "text-end",
      "tool-call",
      "finish",
    ])
    expect(calls(output)[0].toolName).toBe("invalid")
  })

  test("fails closed for malformed, trailing, unknown, and invalid-schema calls", async () => {
    const cases = [
      raw.replace("</｜DSML｜tool_calls>", ""),
      `${raw}\ntrailing`,
      `${DSML.START} is the marker used by DeepSeek`,
      raw.replace('name="bash"', 'name="unknown"'),
      raw.replace('name="description"', 'name="command"'),
      raw.replace(`string="true">${command}`, 'string="false">not-json'),
      raw.replace(`string="true">${description}`, 'string="false">42'),
      `${raw}${"x".repeat(256 * 1024)}`,
    ]

    for (const value of cases) {
      const result = await DSML.parse(value, tools)
      expect(result.ok).toBe(false)
      const parts = streamed([value])
      expect(await collect(parts)).toEqual(parts)
    }
  })

  test("enables only for the exact configured provider and model", () => {
    const cfg = {
      experimental: {
        dsml_tool_call_repair: { enabled: true, model: "internal/deepseek-v4" },
      },
    } as Config.Info
    const model = {
      providerID: "internal",
      id: "deepseek-v4",
      api: { npm: "@ai-sdk/openai-compatible" },
    }
    const input = { cfg, model, tools }
    const alternative = { ...model, api: { npm: "@ai-sdk/openai" } }

    expect(DSML.enabled(input)).toBe(true)
    expect(typeof DSML.invalid.execute).toBe("function")
    expect(DSML.enabled({ ...input, model: { ...model, id: "other" } })).toBe(false)
    expect(DSML.enabled({ ...input, model: { ...model, providerID: "other" } })).toBe(false)
    expect(DSML.enabled({ ...input, model: alternative })).toBe(true)
    expect(DSML.enabled({ ...input, cfg: {} as Config.Info })).toBe(false)
    expect(
      DSML.enabled({
        ...input,
        cfg: { experimental: { dsml_tool_call_repair: { enabled: true } } } as Config.Info,
      }),
    ).toBe(false)
    expect(DSML.enabled({ ...input, toolChoice: "none" })).toBe(false)
  })
})
