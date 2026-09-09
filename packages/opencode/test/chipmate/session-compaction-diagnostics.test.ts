import { describe, expect, test } from "bun:test"
import { ChipMateCompactionDiagnostics } from "@/chipmate/session/compaction-diagnostics"
import type { MessageV2 } from "@/session/message-v2"

const usage = (input = 0, output = 0, reasoning = 0): MessageV2.Assistant["tokens"] => ({
  input,
  output,
  reasoning,
  cache: { read: 0, write: 0 },
})

function serialized(input: Record<string, unknown>) {
  return JSON.stringify(input)
}

describe("ChipMateCompactionDiagnostics", () => {
  test("区分旧模型用量触发与当前模型 preflight 未触发", () => {
    const reported = ChipMateCompactionDiagnostics.reportedUsage({
      sessionID: "session-1",
      messageID: "assistant-glm",
      previousProviderID: "zhipu",
      previousModelID: "glm-5.2",
      currentProviderID: "deepseek",
      currentModelID: "deepseek-v4-flash",
      tokens: usage(190_000, 8_000, 2_000),
      evaluatedTokens: 200_000,
      contextLimit: 262_144,
      inputLimit: 0,
      outputLimit: 8_192,
      usableTokens: 253_952,
      thresholdTokens: 253_952,
      triggered: true,
    })
    const preflight = ChipMateCompactionDiagnostics.preflight({
      sessionID: "session-1",
      providerID: "deepseek",
      modelID: "deepseek-v4-flash",
      messageCount: 12,
      toolCount: 4,
      normalizedTokens: 42_000,
      rawTokens: 42_000,
      continuation: false,
      reportedContextTokens: 200_000,
      contextLimit: 262_144,
      inputLimit: 0,
      outputLimit: 8_192,
      usableTokens: 253_952,
      thresholdTokens: 196_608,
      triggered: false,
    })

    expect(reported).toMatchObject({ crossModel: true, triggered: true })
    expect(preflight).toMatchObject({ normalizedTokens: 42_000, triggered: false })
  })

  test("记录 reasoning-only 且 finish=length 的 worker 预算证据", () => {
    const diagnostic = ChipMateCompactionDiagnostics.worker({
      sessionID: "session-1",
      compactionMessageID: "compaction-1",
      workerMessageID: "worker-1",
      providerID: "deepseek",
      modelID: "deepseek-v4-flash",
      stage: "chunk",
      chunkIndex: 0,
      chunkCount: 2,
      attempt: 1,
      attemptMode: "selected",
      selectedVariant: "high",
      effectiveVariant: "high",
      estimatedInputTokens: 12_000,
      requestedOutputTokenLimit: 32_000,
      effectiveOutputTokenLimit: 24_000,
      capacityKnown: true,
      pipelineRestarted: false,
      result: "continue",
      finish: "length",
      textChars: 0,
      reasoningChars: 6_800,
      tokens: usage(12_000, 0, 2_040),
    })

    expect(diagnostic).toMatchObject({
      finish: "length",
      textChars: 0,
      reasoningChars: 6_800,
      reasoningTokens: 2_040,
      attempt: 1,
      attemptMode: "selected",
      estimatedInputTokens: 12_000,
      requestedOutputTokenLimit: 32_000,
      effectiveOutputTokenLimit: 24_000,
      capacityKnown: true,
    })
  })

  test("区分正常摘要、无输出和 provider 错误", () => {
    const normal = ChipMateCompactionDiagnostics.result({
      sessionID: "session-1",
      compactionMessageID: "compaction-1",
      providerID: "deepseek",
      modelID: "deepseek-v4-flash",
      auto: true,
      initialResult: "continue",
      fallbackUsed: false,
      finalResult: "continue",
      finish: "stop",
      summaryTextChars: 860,
      boundaryEligible: true,
      compactedEvent: true,
      attempt: 1,
      attemptMode: "selected",
      pipelineRestarted: false,
      finalCommitted: true,
      durationMs: 1_200,
    })
    const empty = ChipMateCompactionDiagnostics.result({
      ...normal,
      finalResult: "stop",
      finish: "error",
      summaryTextChars: 0,
      error: { name: "APIError", message: "正文不得记录" },
      boundaryEligible: false,
      compactedEvent: false,
      finalCommitted: false,
    })
    const provider = ChipMateCompactionDiagnostics.result({
      ...normal,
      finalResult: "stop",
      finish: "error",
      summaryTextChars: 0,
      error: {
        name: "APIError",
        statusCode: 503,
        message: "provider secret response",
        responseBody: "sensitive response body",
      },
      boundaryEligible: false,
      compactedEvent: false,
      finalCommitted: false,
    })

    expect(normal).toMatchObject({ summaryTextChars: 860, boundaryEligible: true, compactedEvent: true })
    expect(empty).toMatchObject({ errorName: "APIError", summaryTextChars: 0, compactedEvent: false })
    expect(provider).toMatchObject({ errorName: "APIError", errorStatusCode: 503, compactedEvent: false })
    expect(serialized(empty)).not.toContain("正文不得记录")
    expect(serialized(provider)).not.toContain("provider secret response")
    expect(serialized(provider)).not.toContain("sensitive response body")
  })

  test("失败后的下一请求只记录实际消息数量和当前模型估算", () => {
    const diagnostic = ChipMateCompactionDiagnostics.preflight({
      sessionID: "session-1",
      providerID: "deepseek",
      modelID: "deepseek-v4-flash",
      messageCount: 14,
      toolCount: 3,
      normalizedTokens: 51_200,
      rawTokens: 51_200,
      continuation: false,
      contextLimit: 262_144,
      inputLimit: 0,
      outputLimit: 8_192,
      usableTokens: 253_952,
      thresholdTokens: 196_608,
      triggered: false,
    })

    expect(diagnostic).toMatchObject({
      providerID: "deepseek",
      modelID: "deepseek-v4-flash",
      messageCount: 14,
      normalizedTokens: 51_200,
      triggered: false,
    })
  })

  test("记录完整 worker 请求预检和本地拆分原因", () => {
    const diagnostic = ChipMateCompactionDiagnostics.workerPreflight({
      sessionID: "session-1",
      compactionMessageID: "compaction-1",
      providerID: "provider-b",
      modelID: "model-b",
      stage: "chunk",
      chunkIndex: 0,
      chunkCount: 4,
      splitDepth: 2,
      attempt: 1,
      attemptMode: "selected",
      estimatedInputTokens: 48_101,
      inputBudget: 48_000,
      requestedOutputTokenLimit: 32_000,
      capacityKnown: false,
      requestDispatched: false,
      splitReason: "local_preflight",
      rejectionReason: "unknown_capacity_cap",
    })

    expect(diagnostic).toMatchObject({
      "compaction.phase": "worker_preflight",
      estimatedInputTokens: 48_101,
      inputBudget: 48_000,
      requestDispatched: false,
      splitReason: "local_preflight",
      rejectionReason: "unknown_capacity_cap",
    })
  })

  test("所有诊断对象严格限制为白名单元数据", () => {
    const diagnostics = [
      ChipMateCompactionDiagnostics.reportedUsage({
        sessionID: "session-1",
        messageID: "assistant-1",
        previousProviderID: "provider-a",
        previousModelID: "model-a",
        currentProviderID: "provider-b",
        currentModelID: "model-b",
        tokens: usage(1, 2, 3),
        evaluatedTokens: 6,
        contextLimit: 100,
        inputLimit: 90,
        outputLimit: 10,
        usableTokens: 90,
        thresholdTokens: 75,
        triggered: true,
      }),
      ChipMateCompactionDiagnostics.worker({
        sessionID: "session-1",
        compactionMessageID: "compaction-1",
        workerMessageID: "worker-1",
        providerID: "provider-b",
        modelID: "model-b",
        stage: "reduce",
        depth: 1,
        attempt: 2,
        attemptMode: "none",
        selectedVariant: "high",
        effectiveVariant: "none",
        estimatedInputTokens: 12_000,
        requestedOutputTokenLimit: 32_000,
        effectiveOutputTokenLimit: 24_000,
        capacityKnown: true,
        fallbackReason: "selected_attempt_failed",
        pipelineRestarted: true,
        result: "stop",
        textChars: 0,
        reasoningChars: 0,
        tokens: usage(),
        error: {
          name: "APIError",
          statusCode: 401,
          message: "conversation secret",
          responseBody: "response secret",
          endpoint: "https://secret.invalid",
          headers: { authorization: "Bearer secret" },
        },
      }),
      ChipMateCompactionDiagnostics.workerPreflight({
        sessionID: "session-1",
        compactionMessageID: "compaction-1",
        providerID: "provider-b",
        modelID: "model-b",
        stage: "replay",
        splitDepth: 1,
        attempt: 2,
        attemptMode: "none",
        estimatedInputTokens: 24_000,
        inputBudget: 48_000,
        requestedOutputTokenLimit: 32_000,
        effectiveOutputTokenLimit: 32_000,
        capacityKnown: false,
        requestDispatched: false,
        splitReason: "provider_context_overflow",
      }),
    ]
    const forbiddenKeys = ["message", "responseBody", "endpoint", "headers", "path", "text", "reasoning"]

    for (const diagnostic of diagnostics) {
      for (const key of Object.keys(diagnostic)) expect(forbiddenKeys).not.toContain(key)
      const value = serialized(diagnostic)
      expect(value).not.toContain("conversation secret")
      expect(value).not.toContain("response secret")
      expect(value).not.toContain("secret.invalid")
      expect(value).not.toContain("Bearer secret")
    }
  })
})
