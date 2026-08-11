import { afterEach, describe, expect, it } from "bun:test"
import { FetchModelsError, fetchOpenAIModels } from "../../src/shared/fetch-models"

const servers: Bun.Server<unknown>[] = []

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
})

function serve(fetch: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ port: 0, fetch })
  servers.push(server)
  return `http://127.0.0.1:${server.port}`
}

describe("fetchOpenAIModels", () => {
  it("requests /models with the bearer key and normalizes the catalog", async () => {
    const baseURL = serve((request) => {
      expect(new URL(request.url).pathname).toBe("/v1/models")
      expect(request.headers.get("authorization")).toBe("Bearer sk-test")
      return Response.json({
        data: [
          { id: " z-model ", name: " Z " },
          { id: "a-model" },
          { id: "a-model", name: "duplicate" },
          { name: "missing id" },
        ],
      })
    })

    await expect(fetchOpenAIModels({ baseURL: `${baseURL}/v1/`, apiKey: "sk-test" })).resolves.toEqual([
      { id: "a-model", name: "a-model" },
      { id: "z-model", name: "Z" },
    ])
  })

  it("marks 401 and 403 responses as authentication failures", async () => {
    const baseURL = serve(() => new Response("denied", { status: 401 }))

    const error = await fetchOpenAIModels({ baseURL }).catch((err: unknown) => err)
    expect(error).toBeInstanceOf(FetchModelsError)
    expect((error as FetchModelsError).auth).toBe(true)
    expect((error as FetchModelsError).status).toBe(401)
  })

  it("aborts a stalled model request at the configured timeout", async () => {
    const baseURL = serve(async () => {
      await Bun.sleep(100)
      return Response.json({ data: [] })
    })

    await expect(fetchOpenAIModels({ baseURL, timeout: 10 })).rejects.toThrow()
  })
})
