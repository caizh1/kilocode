export * from "./client.js"
export * from "./server.js"

import { createChipMateClient } from "./client.js"
import { createChipMateServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export async function createChipMate(options?: ServerOptions) {
  const server = await createChipMateServer({
    ...options,
  })

  const client = createChipMateClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
