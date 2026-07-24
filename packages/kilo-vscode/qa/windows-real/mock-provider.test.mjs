import assert from "node:assert/strict"
import test from "node:test"

import { createMockProvider } from "./mock-provider.mjs"

test("serves deterministic OpenAI-compatible chat, completion, embedding and rerank routes", async () => {
  const mock = createMockProvider()
  const port = await mock.listen()
  const root = `http://127.0.0.1:${port}`
  try {
    const models = await get(`${root}/v1/models`)
    assert.equal(models.data[0].id, "qa-chat-model")

    const chat = await post(`${root}/v1/chat/completions`, {
      model: "qa-chat-model",
      messages: [{ role: "user", content: "hello" }],
    })
    assert.equal(chat.choices[0].message.content, "固定回复。")

    const completion = await post(`${root}/v1/completions`, { model: "qa-qwen-fim", prompt: "int f() {" })
    assert.equal(completion.choices[0].text, "return qa_value;")

    const embeddings = await post(`${root}/v1/embeddings`, { model: "qa-embedding-model", input: ["alpha", "beta"] })
    assert.equal(embeddings.data.length, 2)
    assert.equal(embeddings.data[0].embedding.length, 2048)

    const rerank = await post(`${root}/v1/rerank`, { query: "alpha", documents: ["alpha", "beta"] })
    assert.deepEqual(
      rerank.results.map((item) => item.index),
      [0, 1],
    )
  } finally {
    await mock.close()
  }
})

test("supports streaming, tool calls and controlled failures without recording secrets", async () => {
  const mock = createMockProvider()
  const port = await mock.listen()
  const root = `http://127.0.0.1:${port}`
  try {
    const stream = await fetch(`${root}/v1/completions`, {
      method: "POST",
      headers: { authorization: "Bearer test-secret", "content-type": "application/json" },
      body: JSON.stringify({ stream: true, prompt: "x" }),
    })
    const text = await stream.text()
    assert.match(text, /qa_value/)
    assert.match(text, /\[DONE\]/)

    const tool = await post(`${root}/v1/chat/completions`, { messages: [{ role: "user", content: "[QA:TOOL-CALL]" }] })
    assert.equal(tool.choices[0].message.tool_calls[0].function.name, "read")

    const shell = await post(`${root}/v1/chat/completions`, {
      messages: [{ role: "user", content: [{ type: "text", text: "[QA:TOOL-CALL]" }] }],
      tools: [{ type: "function", function: { name: "agent_console_shell" } }],
    })
    assert.equal(shell.choices[0].message.tool_calls[0].function.name, "agent_console_shell")

    const resumed = await post(`${root}/v1/chat/completions`, {
      messages: [
        { role: "user", content: "[QA:TOOL-CALL]" },
        { role: "assistant", content: null, tool_calls: shell.choices[0].message.tool_calls },
        { role: "tool", content: "approved" },
      ],
      tools: [{ type: "function", function: { name: "agent_console_shell" } }],
    })
    assert.equal(resumed.choices[0].message.content, "固定回复。")

    await post(`${root}/__qa/scenario`, { scenario: "tool-call" })
    const forced = await post(`${root}/v1/chat/completions`, {
      messages: [
        { role: "assistant", content: "普通回复", tool_calls: [] },
        { role: "user", content: "请提出一个安全命令" },
      ],
      tools: [{ type: "function", function: { name: "agent_console_shell" } }],
    })
    assert.equal(forced.choices[0].message.tool_calls[0].function.name, "agent_console_shell")
    const forcedResume = await post(`${root}/v1/chat/completions`, {
      messages: [
        { role: "user", content: "请提出一个安全命令" },
        { role: "assistant", content: null, tool_calls: forced.choices[0].message.tool_calls },
        { role: "tool", content: "approved" },
      ],
      tools: [{ type: "function", function: { name: "agent_console_shell" } }],
    })
    assert.equal(forcedResume.choices[0].message.content, "固定回复。")
    const repeated = await post(`${root}/v1/chat/completions`, {
      messages: [
        { role: "user", content: "请提出一个安全命令" },
        { role: "assistant", content: null, tool_calls: forced.choices[0].message.tool_calls },
        { role: "tool", content: "rejected" },
        { role: "assistant", content: "已拒绝", tool_calls: [] },
        { role: "user", content: "请再次提出同一个安全命令" },
      ],
      tools: [{ type: "function", function: { name: "agent_console_shell" } }],
    })
    assert.equal(repeated.choices[0].message.tool_calls[0].function.name, "agent_console_shell")

    const failure = await fetch(`${root}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "[QA:HTTP-403]" }] }),
    })
    assert.equal(failure.status, 403)

    const requests = await get(`${root}/__qa/requests`)
    assert.equal(JSON.stringify(requests).includes("test-secret"), false)
    assert.equal(
      requests.requests.some((item) => item.hasAuthorization),
      true,
    )
  } finally {
    await mock.close()
  }
})

async function get(url) {
  const res = await fetch(url)
  assert.equal(res.ok, true)
  return res.json()
}

async function post(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  assert.equal(res.ok, true)
  return res.json()
}
