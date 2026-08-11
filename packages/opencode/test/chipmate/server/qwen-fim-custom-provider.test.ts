import { afterEach, describe, expect, test } from "bun:test"
import { createChipMateClient } from "@chipmate/sdk/v2"
import { Server } from "../../../src/server/server"
import { disposeAllInstances, tmpdir } from "../../fixture/fixture"

const auth = process.env.CHIPMATE_AUTH_CONTENT

afterEach(async () => {
  if (auth === undefined) delete process.env.CHIPMATE_AUTH_CONTENT
  else process.env.CHIPMATE_AUTH_CONTENT = auth
  await disposeAllInstances()
})

async function fetcher(request: RequestInfo | URL, init?: RequestInit) {
  const req = request instanceof Request ? request : new Request(request, init)
  return await Server.Default().app.fetch(req)
}

describe("Qwen FIM custom Provider integration", () => {
  test("loads the UI-shaped Provider and proxies /chipmate/qwen-fim without a redundant suffix field", async () => {
    const stop = ["<|endoftext|>", "<|fim_prefix|>", "<|fim_middle|>"]
    const requests: Array<{ body: Record<string, unknown>; headers: Headers; path: string }> = []
    const upstream = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        requests.push({
          body: (await request.json()) as Record<string, unknown>,
          headers: request.headers,
          path: new URL(request.url).pathname,
        })
        return Response.json({ choices: [{ text: "return integration_ok;" }] })
      },
    })

    try {
      await using tmp = await tmpdir({
        config: {
          formatter: false,
          lsp: false,
          provider: {
            "custom-qwen": {
              name: "Custom Qwen",
              npm: "@ai-sdk/openai-compatible",
              options: {
                baseURL: `${upstream.url.origin}/v1`,
                headers: { "X-Layer": "provider", "X-Provider": "preserved" },
              },
              models: {
                "qwen-coder-30b0": {
                  name: "Qwen Coder 30B",
                  headers: { "X-Layer": "model" },
                  limit: { context: 32_768, output: 4_096 },
                },
              },
            },
          },
        },
      })
      process.env.CHIPMATE_AUTH_CONTENT = JSON.stringify({
        "custom-qwen": { type: "api", key: "integration-secret" },
      })

      const sdk = createChipMateClient({
        baseUrl: "http://localhost",
        directory: tmp.path,
        fetch: Object.assign(fetcher, { preconnect: globalThis.fetch.preconnect }),
      })
      const listed = await sdk.provider.list({ directory: tmp.path })
      const provider = listed.data?.all.find((item) => item.id === "custom-qwen")
      expect(listed.response.status).toBe(200)
      expect(provider).toBeDefined()
      expect(provider?.models["qwen-coder-30b0"]?.api.npm).toBe("@ai-sdk/openai-compatible")
      expect(listed.data?.connected).toContain("custom-qwen")

      const result = await sdk.chipmate.qwenFim({
        providerID: "custom-qwen",
        modelID: "qwen-coder-30b0",
        prefix: "int main(void) {",
        suffix: "}",
        stop,
      })

      if (result.response.status !== 200)
        throw new Error(
          JSON.stringify({
            error: result.error,
            phase: result.response.headers.get("X-ChipMate-Qwen-Fim-Phase"),
            requests: requests.length,
          }),
        )
      expect(result.response.status).toBe(200)
      expect(result.data).toEqual({ text: "return integration_ok;" })
      expect(requests).toHaveLength(1)
      expect(requests[0]?.path).toBe("/v1/completions")
      expect(requests[0]?.body).toEqual({
        model: "qwen-coder-30b0",
        prompt: "int main(void) {",
        max_tokens: 128,
        temperature: 0.01,
        stop,
        stream: false,
      })
      expect(requests[0]?.body).not.toHaveProperty("suffix")
      expect(requests[0]?.headers.get("Authorization")).toBe("Bearer integration-secret")
      expect(requests[0]?.headers.get("X-Provider")).toBe("preserved")
      expect(requests[0]?.headers.get("X-Layer")).toBe("model")
    } finally {
      upstream.stop(true)
    }
  }, 30_000)
})
