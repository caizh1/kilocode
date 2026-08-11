#!/usr/bin/env node

import { createServer } from "node:http"
import { pathToFileURL } from "node:url"

const model = "qa-chat-model"
const embedding = "qa-embedding-model"

export function createMockProvider(opts = {}) {
  const state = {
    scenario: "success",
    delayMs: 65_000,
    requests: [],
  }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`)
    const body = await read(req)
    state.requests.push({
      at: new Date().toISOString(),
      method: req.method,
      path: url.pathname,
      stream: body?.stream === true,
      model: typeof body?.model === "string" ? body.model : undefined,
      dimensions: Number.isSafeInteger(body?.dimensions) ? body.dimensions : undefined,
      hasAuthorization: typeof req.headers.authorization === "string",
    })

    if (url.pathname === "/__qa/health") return json(res, 200, { status: "ok", scenario: state.scenario })
    if (url.pathname === "/__qa/requests") return json(res, 200, { requests: state.requests })
    if (url.pathname === "/__qa/reset" && req.method === "POST") {
      state.scenario = "success"
      state.requests.length = 0
      return json(res, 200, { status: "reset" })
    }
    if (url.pathname === "/__qa/scenario" && req.method === "POST") {
      if (!body || typeof body.scenario !== "string")
        return json(res, 400, { error: { message: "scenario is required" } })
      state.scenario = body.scenario
      if (Number.isFinite(body.delayMs)) state.delayMs = Math.max(0, Number(body.delayMs))
      return json(res, 200, { status: "ok", scenario: state.scenario, delayMs: state.delayMs })
    }

    const scenario = scenarioFor(body, state.scenario)
    if (scenario === "timeout") {
      await new Promise((resolve) => setTimeout(resolve, state.delayMs))
    }
    if (/^http-(401|403|503)$/.test(scenario)) {
      const status = Number(scenario.slice(5))
      return json(res, status, { error: { type: "qa_error", code: scenario, message: `deterministic ${status}` } })
    }
    if (scenario === "malformed") {
      res.writeHead(200, { "content-type": "application/json" })
      res.end("{not-json")
      return
    }

    if (url.pathname === "/v1/models" || url.pathname === "/models") {
      return json(res, 200, {
        object: "list",
        data: [
          { id: model, object: "model", owned_by: "chipmate-qa" },
          { id: embedding, object: "model", owned_by: "chipmate-qa" },
          { id: "qa-qwen-fim", object: "model", owned_by: "chipmate-qa" },
        ],
      })
    }
    if (url.pathname === "/v1/chat/completions" || url.pathname === "/chat/completions") {
      return chat(res, body, scenario)
    }
    if (url.pathname === "/v1/completions" || url.pathname === "/completions") {
      return completion(res, body)
    }
    if (url.pathname === "/v1/embeddings" || url.pathname === "/embeddings") {
      const input = Array.isArray(body?.input) ? body.input : [body?.input ?? ""]
      const dimensions = Number.isSafeInteger(body?.dimensions) && body.dimensions > 0 ? body.dimensions : 2048
      return json(res, 200, {
        object: "list",
        model: body?.model ?? embedding,
        data: input.map((value, index) => ({
          object: "embedding",
          index,
          embedding: vector(String(value), dimensions),
        })),
        usage: { prompt_tokens: input.length, total_tokens: input.length },
      })
    }
    if (url.pathname === "/v1/rerank" || url.pathname === "/rerank") {
      const docs = Array.isArray(body?.documents) ? body.documents : []
      const results = docs.map((_, index) => ({
        index,
        relevance_score: Number((1 - index / Math.max(docs.length, 1)).toFixed(6)),
      }))
      return json(res, 200, { id: "qa-rerank", model: body?.model ?? "qa-rerank-model", results })
    }
    json(res, 404, { error: { message: `unknown QA route ${url.pathname}` } })
  })

  return {
    state,
    server,
    async listen(port = opts.port ?? 0, host = opts.host ?? "127.0.0.1") {
      await new Promise((resolve, reject) => {
        server.once("error", reject)
        server.listen(port, host, resolve)
      })
      const address = server.address()
      return typeof address === "object" && address ? address.port : port
    },
    async close() {
      if (!server.listening) return
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
    },
  }
}

function chat(res, body, scenario) {
  if (scenario === "tool-call") {
    const tools = Array.isArray(body?.tools) ? body.tools : []
    const shell = tools.some((item) => item?.function?.name === "agent_console_shell")
    const call = {
      id: "call_qa_fixed",
      type: "function",
      function: shell
        ? {
            name: "agent_console_shell",
            arguments:
              '{"command":"Add-Content -LiteralPath .chipmate-qa-agent.txt -Value approved","description":"QA approval probe"}',
          }
        : { name: "read", arguments: '{"filePath":"fixture/main.c"}' },
    }
    if (body?.stream) {
      return sse(res, [
        { id: "chatcmpl-qa", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" } }] },
        {
          id: "chatcmpl-qa",
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: { tool_calls: [{ index: 0, ...call }] } }],
        },
        {
          id: "chatcmpl-qa",
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
        },
      ])
    }
    return json(res, 200, {
      id: "chatcmpl-qa",
      object: "chat.completion",
      model: body?.model ?? model,
      choices: [
        { index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [call] } },
      ],
      usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
    })
  }
  if (body?.stream) {
    return sse(res, [
      {
        id: "chatcmpl-qa",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta: { role: "assistant", reasoning_content: "固定推理。" } }],
      },
      { id: "chatcmpl-qa", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "固定" } }] },
      { id: "chatcmpl-qa", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "回复。" } }] },
      { id: "chatcmpl-qa", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ])
  }
  return json(res, 200, {
    id: "chatcmpl-qa",
    object: "chat.completion",
    model: body?.model ?? model,
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: { role: "assistant", reasoning_content: "固定推理。", content: "固定回复。" },
      },
    ],
    usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
  })
}

function completion(res, body) {
  const text = "return qa_value;"
  if (body?.stream) {
    return sse(res, [
      { id: "cmpl-qa", object: "text_completion", choices: [{ index: 0, text: "return ", finish_reason: null }] },
      { id: "cmpl-qa", object: "text_completion", choices: [{ index: 0, text: "qa_value;", finish_reason: null }] },
      { id: "cmpl-qa", object: "text_completion", choices: [{ index: 0, text: "", finish_reason: "stop" }] },
    ])
  }
  return json(res, 200, {
    id: "cmpl-qa",
    object: "text_completion",
    model: body?.model ?? "qa-qwen-fim",
    choices: [{ index: 0, text, finish_reason: "stop", logprobs: null }],
    usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
  })
}

function scenarioFor(body, fallback) {
  const messages = Array.isArray(body?.messages) ? body.messages : []
  const text = [
    body?.prompt,
    ...messages.flatMap((item) => {
      const content = item?.content
      if (typeof content === "string") return [content]
      if (!Array.isArray(content)) return []
      return content
        .map((part) => (typeof part === "string" ? part : typeof part?.text === "string" ? part.text : ""))
        .filter(Boolean)
    }),
  ]
    .filter((item) => typeof item === "string")
    .join("\n")
  const latest = messages.findLast(
    (item) =>
      item?.role === "user" ||
      item?.role === "tool" ||
      (item?.role === "assistant" && Array.isArray(item?.tool_calls) && item.tool_calls.length > 0),
  )
  const done =
    latest?.role === "tool" ||
    (latest?.role === "assistant" && Array.isArray(latest.tool_calls) && latest.tool_calls.length > 0)
  const match = text.match(/\[QA:(SUCCESS|TOOL-CALL|HTTP-401|HTTP-403|HTTP-503|TIMEOUT|MALFORMED)\]/i)
  if (!match) return fallback === "tool-call" && done ? "success" : fallback
  const scenario = match[1].toLowerCase()
  if (scenario !== "tool-call") return scenario
  return done ? "success" : scenario
}

function vector(value, dimensions = 2048) {
  const out = Array.from({ length: dimensions }, () => 0)
  const bytes = Buffer.from(value || "qa")
  for (let index = 0; index < bytes.length; index += 1) {
    const slot = (bytes[index] * 31 + index * 17) % out.length
    out[slot] = Number((((bytes[index] + 1) / 256) * (index % 2 ? -1 : 1)).toFixed(8))
  }
  return out
}

function json(res, status, data) {
  const text = JSON.stringify(data)
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
  })
  res.end(text)
}

function sse(res, chunks) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  })
  for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`)
  res.end("data: [DONE]\n\n")
}

async function read(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (!chunks.length) return undefined
  const text = Buffer.concat(chunks).toString("utf8")
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

async function main() {
  const portArg = process.argv.find((arg) => arg.startsWith("--port="))
  const port = portArg ? Number(portArg.slice("--port=".length)) : 43119
  const mock = createMockProvider({ port })
  const actual = await mock.listen(port)
  process.stdout.write(
    `${JSON.stringify({ status: "ready", baseUrl: `http://127.0.0.1:${actual}/v1`, controlUrl: `http://127.0.0.1:${actual}/__qa` })}\n`,
  )
  const stop = async () => {
    await mock.close()
    process.exit(0)
  }
  process.on("SIGINT", stop)
  process.on("SIGTERM", stop)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main()
