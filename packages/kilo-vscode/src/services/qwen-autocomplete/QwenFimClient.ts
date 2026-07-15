import type { KiloConnectionService } from "../cli-backend"
import type { QwenFimCompleteInput } from "./types"

export class QwenFimRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly endpointSource?: "provider-options" | "model-api" | "missing",
    readonly serverPhase?: string,
  ) {
    super(message)
    this.name = "QwenFimRequestError"
  }
}

export class QwenFimClient {
  constructor(private readonly connection?: KiloConnectionService) {}

  async complete(input: QwenFimCompleteInput): Promise<string> {
    if (!this.connection) throw new QwenFimRequestError(0, "Qwen autocomplete requires a CLI connection.")
    const client = await this.connection.getClientAsync()
    const result = await client.kilo.qwenFim(
      {
        directory: input.directory,
        providerID: input.providerID,
        modelID: input.modelID,
        prefix: input.prompt,
        suffix: "",
        maxTokens: input.maxTokens,
        temperature: input.temperature,
        stop: input.stop,
      },
      { signal: input.signal, throwOnError: false },
    )
    const source = endpointSource(result.response.headers.get("x-chipmate-qwen-endpoint-source"))
    const phase = result.response.headers.get("x-chipmate-qwen-fim-phase") ?? phaseForStatus(result.response.status)
    try {
      input.onResponse?.({ status: result.response.status, endpointSource: source, serverPhase: phase })
    } catch (err) {
      void err
    }
    if (!result.response.ok || !result.data?.text) {
      throw new QwenFimRequestError(
        result.response.status,
        `Qwen FIM request failed: ${result.response.status}`,
        source,
        phase,
      )
    }
    return result.data.text
  }
}

function endpointSource(value: string | null): "provider-options" | "model-api" | "missing" | undefined {
  if (value === "provider-options" || value === "model-api" || value === "missing") return value
  return undefined
}

function phaseForStatus(status: number): string {
  if (status === 200) return "success"
  if (status === 401) return "auth-missing"
  if (status >= 500) return "upstream-or-server"
  if (status > 0) return "request-rejected"
  return "connection-unavailable"
}
