import { randomUUID } from "node:crypto"
import type { ServerResponse } from "node:http"

export class MarketEvents {
  private readonly streams = new Set<ServerResponse>()

  publish(name: string, payload: unknown): void {
    const message = `id: ${randomUUID()}\nevent: ${name}\ndata: ${JSON.stringify(payload)}\n\n`
    for (const stream of this.streams) stream.write(message)
  }

  add(stream: ServerResponse): () => void {
    this.streams.add(stream)
    return () => this.streams.delete(stream)
  }
}
