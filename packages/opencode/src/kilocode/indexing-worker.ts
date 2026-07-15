import { createIndexingHost } from "./indexing-host"
import type { Request } from "./indexing-worker-protocol"

const host = createIndexingHost((message) => postMessage(message))

onmessage = async (event: MessageEvent<Request>) => {
  await host.handle(event.data)
}
