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
