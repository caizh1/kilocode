import { describe, expect, mock, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ChipMateClient } from "@chipmate/sdk/v2"
import { resolveDeepSeekHarnessCredential } from "../../src/chipmate-provider/deepseek-harness-config"
import {
  chooseDeepSeekHarnessSelection,
  inspectDeepSeekHarnessProviders,
} from "../../src/chipmate-provider/deepseek-harness-provider-selection"
import { DeepSeekHarnessRuntime } from "../../src/services/deepseek-harness/runtime"
import { DeepSeekHarnessService } from "../../src/services/deepseek-harness/service"
import type { DeepSeekHarnessSnapshot } from "../../src/shared/deepseek-harness"

function client(data: unknown) {
  const get = mock(async () => ({ data }))
  return {
    get,
    value: { auth: { get } } as unknown as ChipMateClient,
  }
}

describe("ChipMate DeepSeek Harness Provider 凭据解析", () => {
  test("首个 Provider 不可用时选择后续可用 Provider，且每个 Provider 只读取一次凭据", async () => {
    const calls = new Map<string, number>()
    const result = await inspectDeepSeekHarnessProviders(
      {
        unavailable: {
          id: "unavailable",
          name: "A 不可用",
          models: { deepseek: { id: "deepseek-a", name: "DeepSeek A" } },
        },
        available: {
          id: "available",
          name: "B 可用",
          models: { deepseek: { id: "deepseek-b", name: "DeepSeek B" } },
        },
      },
      async (providerID) => {
        calls.set(providerID, (calls.get(providerID) ?? 0) + 1)
        if (providerID === "unavailable") throw new Error("authorization=Bearer should-not-leak")
        return { baseURL: "https://available.example/v1", apiKey: "secret" }
      },
    )

    expect(result.options).toEqual([
      {
        providerID: "unavailable",
        providerName: "A 不可用",
        available: false,
        reason: "auth-read-failed",
        models: [{ providerID: "unavailable", modelID: "deepseek-a", name: "DeepSeek A" }],
      },
      {
        providerID: "available",
        providerName: "B 可用",
        available: true,
        models: [{ providerID: "available", modelID: "deepseek-b", name: "DeepSeek B" }],
      },
    ])
    expect(chooseDeepSeekHarnessSelection(result.options)?.providerID).toBe("available")
    expect(calls).toEqual(new Map([["unavailable", 1], ["available", 1]]))
    expect(JSON.stringify(result.options)).not.toContain("secret")
    expect(JSON.stringify(result.options)).not.toContain("available.example")
    expect(JSON.stringify(result.options)).not.toContain("should-not-leak")
  })

  test("默认选择遵循最近成功、普通 QA 偏好和稳定首项的优先级", () => {
    const options = [
      {
        providerID: "alpha",
        providerName: "Alpha",
        available: true,
        models: [{ providerID: "alpha", modelID: "deepseek-a", name: "A" }],
      },
      {
        providerID: "beta",
        providerName: "Beta",
        available: true,
        models: [{ providerID: "beta", modelID: "deepseek-b", name: "B" }],
      },
    ]
    expect(
      chooseDeepSeekHarnessSelection(
        options,
        { providerID: "beta", modelID: "deepseek-b" },
        { providerID: "alpha", modelID: "deepseek-a" },
      )?.providerID,
    ).toBe("beta")
    expect(
      chooseDeepSeekHarnessSelection(
        options,
        { providerID: "missing", modelID: "missing" },
        { providerID: "beta", modelID: "deepseek-b" },
      )?.providerID,
    ).toBe("beta")
    expect(chooseDeepSeekHarnessSelection(options)?.providerID).toBe("alpha")
  })

  test("provider.list 不含 key 时从受保护 Auth API 读取直接 NewAPI 凭据", async () => {
    const auth = client({ type: "api", key: "secret-from-auth" })

    await expect(
      resolveDeepSeekHarnessCredential(
        auth.value,
        "chipmate",
        { options: { baseURL: " https://newapi.example/v1/ " } },
        undefined,
      ),
    ).resolves.toEqual({ baseURL: "https://newapi.example/v1", apiKey: "secret-from-auth" })
    expect(auth.get).toHaveBeenCalledTimes(1)
    expect(auth.get).toHaveBeenCalledWith({ providerID: "chipmate" }, { throwOnError: true })
  })

  test("Provider 地址优先于 Auth metadata 和环境变量缓存", async () => {
    const auth = client({ type: "api", key: "secret", metadata: { baseURL: "https://metadata.example/v1" } })

    await expect(
      resolveDeepSeekHarnessCredential(
        auth.value,
        "custom-deepseek",
        { options: { baseURL: "https://provider.example/v1/" } },
        { key: "environment-secret", baseURL: "https://environment.example/v1" },
      ),
    ).resolves.toEqual({ baseURL: "https://provider.example/v1", apiKey: "secret" })
  })

  test("Provider 地址无效时依次使用 Auth metadata 和环境变量地址", async () => {
    const metadata = client({ type: "api", key: "secret", metadata: { baseURL: "https://metadata.example/v1/" } })
    await expect(
      resolveDeepSeekHarnessCredential(
        metadata.value,
        "custom-deepseek",
        { options: { baseURL: "file:///tmp/not-newapi" } },
        { key: "environment-secret", baseURL: "https://environment.example/v1" },
      ),
    ).resolves.toEqual({ baseURL: "https://metadata.example/v1", apiKey: "secret" })

    const environment = client({ type: "api", key: "secret" })
    await expect(
      resolveDeepSeekHarnessCredential(
        environment.value,
        "custom-deepseek",
        { options: { baseURL: "not-a-url" } },
        { key: "environment-secret", baseURL: "http://10.0.0.8:3000/v1/" },
      ),
    ).resolves.toEqual({ baseURL: "http://10.0.0.8:3000/v1", apiKey: "secret" })
  })

  test("没有 Auth 记录时兼容环境变量型 Provider", async () => {
    const auth = client(null)

    await expect(
      resolveDeepSeekHarnessCredential(
        auth.value,
        "environment-deepseek",
        { options: { baseURL: "https://newapi.example/v1" } },
        { key: "environment-secret", baseURL: "https://newapi.example/v1" },
      ),
    ).resolves.toEqual({ baseURL: "https://newapi.example/v1", apiKey: "environment-secret" })
  })

  test.each(["oauth", "wellknown"] as const)("拒绝 %s 间接认证且不使用缓存凭据", async (type) => {
    const auth = client({ type, key: "indirect-secret" })

    await expect(
      resolveDeepSeekHarnessCredential(
        auth.value,
        "chipmate",
        { options: { baseURL: "https://newapi.example/v1" } },
        { key: "stale-secret", baseURL: "https://newapi.example/v1" },
      ),
    ).rejects.toThrow("ChipMate Gateway/OAuth 登录不能直接用于官方 DSH")
  })

  test("区分缺少地址和缺少直接 API Key", async () => {
    const missingURL = client({ type: "api", key: "secret" })
    await expect(
      resolveDeepSeekHarnessCredential(missingURL.value, "chipmate", { options: {} }, undefined),
    ).rejects.toThrow("所选 Provider 未配置可用的 NewAPI 地址")

    const missingKey = client({ type: "api", key: "" })
    await expect(
      resolveDeepSeekHarnessCredential(
        missingKey.value,
        "chipmate",
        { options: { baseURL: "https://newapi.example/v1" } },
        undefined,
      ),
    ).rejects.toThrow("所选 Provider 未保存直接 NewAPI API Key")
  })

  test("Auth API 失败时不回退缓存且不泄露底层错误中的凭据", async () => {
    const get = mock(async () => {
      throw new Error("authorization=Bearer leaked-secret")
    })
    const value = { auth: { get } } as unknown as ChipMateClient

    const result = resolveDeepSeekHarnessCredential(
      value,
      "chipmate",
      { options: { baseURL: "https://newapi.example/v1" } },
      { key: "stale-secret", baseURL: "https://newapi.example/v1" },
    )
    await expect(result).rejects.toThrow("无法读取所选 Provider 的受保护凭据")
    await expect(result).rejects.not.toThrow("leaked-secret")
  })

  test("未知 Auth 结构失败关闭且不使用环境缓存", async () => {
    const auth = client({ type: "future-auth", key: "unknown-secret" })

    await expect(
      resolveDeepSeekHarnessCredential(
        auth.value,
        "chipmate",
        { options: { baseURL: "https://newapi.example/v1" } },
        { key: "environment-secret", baseURL: "https://newapi.example/v1" },
      ),
    ).rejects.toThrow("无法读取所选 Provider 的受保护凭据")
  })

  test("运行中的直接凭据变化进入 restart-required 而不热改官方 DSH", () => {
    const context = {
      extensionUri: { fsPath: "/tmp/chipmate-extension" },
      globalStorageUri: { fsPath: "/tmp/chipmate-storage" },
    } as never
    const service = new DeepSeekHarnessService(context, "linux-x64-baseline")
    const model = { providerID: "chipmate", modelID: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }
    Object.assign(service as unknown as Record<string, unknown>, {
      protocol: {},
      config: {
        baseURL: "https://example.test/v1",
        apiKey: "old-secret",
        models: [{ id: model.modelID, name: model.name }],
      },
      models: [model],
      selectedModel: model,
      connectedFingerprint: DeepSeekHarnessRuntime.fingerprint({
        baseURL: "https://example.test/v1",
        apiKey: "old-secret",
        models: [{ id: model.modelID, name: model.name }],
      }, "linux-x64-baseline"),
      state: "ready",
    })
    let snapshot: DeepSeekHarnessSnapshot | undefined
    const subscription = service.subscribe((value) => {
      snapshot = value
    })
    try {
      service.noteConfiguration(
        {
          baseURL: "https://example.test/v1",
          apiKey: "new-secret",
          models: [{ id: model.modelID, name: model.name }],
        },
        [model],
      )
      expect(snapshot?.state).toBe("restart-required")
      expect(snapshot?.error).toContain("需要重启官方 DSH")
      expect(JSON.stringify(snapshot)).not.toContain("old-secret")
      expect(JSON.stringify(snapshot)).not.toContain("new-secret")
    } finally {
      subscription.dispose()
    }
  })

  test("同 Provider 切模不重启进程并只调用官方 session.selectModel", async () => {
    const storage = mkdtempSync(join(tmpdir(), "chipmate-dsh-provider-"))
    const context = {
      extensionUri: { fsPath: "/tmp/chipmate-extension" },
      globalStorageUri: { fsPath: storage },
    } as never
    const service = new DeepSeekHarnessService(context, "linux-x64-baseline")
    const first = { providerID: "newapi", modelID: "deepseek-a", name: "DeepSeek A" }
    const second = { providerID: "newapi", modelID: "deepseek-b", name: "DeepSeek B" }
    const call = mock(async () => ({}))
    Object.assign(service as unknown as Record<string, unknown>, {
      protocol: { connected: true, call },
      state: "ready",
      sessionId: "session-1",
      models: [first, second],
      selectedModel: first,
      desiredSelection: first,
      runningSelection: first,
    })
    try {
      await service.requestSelection(
        "task-1",
        "/repo",
        {
          baseURL: "https://example.test/v1",
          apiKey: "secret",
          models: [first, second].map((model) => ({ id: model.modelID, name: model.name })),
        },
        [first, second],
        second,
      )
      expect(call).toHaveBeenCalledTimes(1)
      expect(call).toHaveBeenCalledWith("session.selectModel", {
        sessionId: "session-1",
        provider: "deepseek-official",
        model: "deepseek-b",
      })
      const snapshot = capture(service)
      expect(snapshot.runningSelection).toEqual(second)
      expect(snapshot.desiredSelection).toEqual(second)
      const preference = readFileSync(
        join(storage, "deepseek-harness", "supervisor", "provider-preference.json"),
        "utf8",
      )
      expect(preference).toContain('"providerID":"newapi"')
      expect(preference).not.toContain("secret")
      expect(preference).not.toContain("example.test")
    } finally {
      rmSync(storage, { recursive: true, force: true })
    }
  })

  test("跨 Provider 有活动任务时等待确认，取消后保留原选择", async () => {
    const service = new DeepSeekHarnessService(
      {
        extensionUri: { fsPath: "/tmp/chipmate-extension" },
        globalStorageUri: { fsPath: "/tmp/chipmate-storage-provider-confirm" },
      } as never,
      "linux-x64-baseline",
    )
    const current = { providerID: "provider-a", modelID: "deepseek-a", name: "DeepSeek A" }
    const target = { providerID: "provider-b", modelID: "deepseek-b", name: "DeepSeek B" }
    Object.assign(service as unknown as Record<string, unknown>, {
      protocol: { connected: true },
      state: "ready",
      running: true,
      runningSelection: current,
      desiredSelection: current,
      selectedModel: current,
    })
    await service.requestSelection(
      "task-1",
      "/repo",
      { baseURL: "https://b.example/v1", apiKey: "secret-b", models: [{ id: target.modelID, name: target.name }] },
      [target],
      target,
    )
    expect(capture(service).state).toBe("provider-switch-confirmation-required")
    expect(capture(service).desiredSelection).toEqual(target)
    expect(JSON.stringify((service as unknown as Record<string, unknown>).pendingProviderSwitch)).not.toContain("secret-b")
    expect(JSON.stringify((service as unknown as Record<string, unknown>).pendingProviderSwitch)).not.toContain("b.example")
    service.cancelProviderSwitch()
    expect(capture(service).state).toBe("ready")
    expect(capture(service).desiredSelection).toEqual(current)
    expect(capture(service).runningSelection).toEqual(current)
  })

  test("同 Provider 凭据变化时拒绝热切模并进入 restart-required", async () => {
    const service = new DeepSeekHarnessService(
      {
        extensionUri: { fsPath: "/tmp/chipmate-extension" },
        globalStorageUri: { fsPath: "/tmp/chipmate-storage-provider-fingerprint" },
      } as never,
      "linux-x64-baseline",
    )
    const model = { providerID: "provider-a", modelID: "deepseek-a", name: "DeepSeek A" }
    const original = {
      baseURL: "https://a.example/v1",
      apiKey: "old-secret",
      models: [{ id: model.modelID, name: model.name }],
    }
    const call = mock(async () => ({}))
    Object.assign(service as unknown as Record<string, unknown>, {
      protocol: { connected: true, call },
      state: "ready",
      sessionId: "session-1",
      runningSelection: model,
      desiredSelection: model,
      selectedModel: model,
      connectedFingerprint: DeepSeekHarnessRuntime.fingerprint(original, "linux-x64-baseline"),
    })
    await service.requestSelection(
      "task-1",
      "/repo",
      { ...original, apiKey: "new-secret" },
      [model],
      model,
    )
    expect(call).not.toHaveBeenCalled()
    expect(capture(service).state).toBe("restart-required")
    expect(capture(service).selectionState).toBe("restart-required")
    expect(JSON.stringify(capture(service))).not.toContain("new-secret")
  })

  test("快速连续切模只允许最后一次官方响应更新权威选择", async () => {
    const storage = mkdtempSync(join(tmpdir(), "chipmate-dsh-provider-race-"))
    const service = new DeepSeekHarnessService(
      {
        extensionUri: { fsPath: "/tmp/chipmate-extension" },
        globalStorageUri: { fsPath: storage },
      } as never,
      "linux-x64-baseline",
    )
    const original = { providerID: "newapi", modelID: "deepseek-a", name: "DeepSeek A" }
    const first = { providerID: "newapi", modelID: "deepseek-b", name: "DeepSeek B" }
    const last = { providerID: "newapi", modelID: "deepseek-c", name: "DeepSeek C" }
    let resolveFirst!: () => void
    let resolveLast!: () => void
    const call = mock(async (_method: string, payload: { model?: string }) => {
      await new Promise<void>((resolve) => {
        if (payload.model === first.modelID) resolveFirst = resolve
        else resolveLast = resolve
      })
      return {}
    })
    Object.assign(service as unknown as Record<string, unknown>, {
      protocol: { connected: true, call },
      state: "ready",
      sessionId: "session-1",
      runningSelection: original,
      desiredSelection: original,
      selectedModel: original,
    })
    const models = [original, first, last]
    const config = {
      baseURL: "https://example.test/v1",
      apiKey: "secret",
      models: models.map((model) => ({ id: model.modelID, name: model.name })),
    }
    try {
      const earlier = service.requestSelection("task-1", "/repo", config, models, first)
      await eventually(() => Boolean(resolveFirst))
      const later = service.requestSelection("task-1", "/repo", config, models, last)
      await eventually(() => Boolean(resolveLast))
      resolveLast()
      await later
      resolveFirst()
      await earlier
      expect(capture(service).selectedModel).toEqual(last)
      expect(capture(service).runningSelection).toEqual(last)
    } finally {
      rmSync(storage, { recursive: true, force: true })
    }
  })

  test("跨 Provider 空闲切换只执行一次正常停止和一次目标启动", async () => {
    const service = new DeepSeekHarnessService(
      {
        extensionUri: { fsPath: "/tmp/chipmate-extension" },
        globalStorageUri: { fsPath: "/tmp/chipmate-storage-provider-idle" },
      } as never,
      "linux-x64-baseline",
    )
    const current = { providerID: "provider-a", modelID: "deepseek-a", name: "DeepSeek A" }
    const target = { providerID: "provider-b", modelID: "deepseek-b", name: "DeepSeek B" }
    const stop = mock(async () => {
      Object.assign(service as unknown as Record<string, unknown>, {
        state: "stopped",
        protocol: undefined,
        runningSelection: undefined,
      })
    })
    const activate = mock(async () => undefined)
    Object.assign(service as unknown as Record<string, unknown>, {
      protocol: { connected: true },
      state: "ready",
      running: false,
      runningSelection: current,
      desiredSelection: current,
      selectedModel: current,
      stop,
      activate,
    })
    Object.assign((service as unknown as { runtime: object }).runtime, {
      hasActiveWork: async () => false,
    })
    const config = {
      baseURL: "https://b.example/v1",
      apiKey: "secret-b",
      models: [{ id: target.modelID, name: target.name }],
    }
    await service.requestSelection("task-1", "/repo", config, [target], target)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledWith(false)
    expect(activate).toHaveBeenCalledTimes(1)
    expect(activate).toHaveBeenCalledWith("task-1", "/repo", config, [target], target)
  })

  test("其他窗口仍持有租约时阻止跨 Provider 切换且不停止共享进程", async () => {
    const service = new DeepSeekHarnessService(
      {
        extensionUri: { fsPath: "/tmp/chipmate-extension" },
        globalStorageUri: { fsPath: "/tmp/chipmate-storage-provider-shared" },
      } as never,
      "linux-x64-baseline",
    )
    const current = { providerID: "provider-a", modelID: "deepseek-a", name: "DeepSeek A" }
    const target = { providerID: "provider-b", modelID: "deepseek-b", name: "DeepSeek B" }
    const stop = mock(async () => undefined)
    const activate = mock(async () => undefined)
    Object.assign(service as unknown as Record<string, unknown>, {
      protocol: { connected: true },
      state: "ready",
      running: false,
      runningSelection: current,
      desiredSelection: current,
      selectedModel: current,
      stop,
      activate,
    })
    Object.assign((service as unknown as { runtime: object }).runtime, {
      hasOtherLeases: () => true,
      hasActiveWork: async () => false,
    })

    await service.requestSelection(
      "task-1",
      "/repo",
      {
        baseURL: "https://b.example/v1",
        apiKey: "secret-b",
        models: [{ id: target.modelID, name: target.name }],
      },
      [target],
      target,
    )

    expect(stop).not.toHaveBeenCalled()
    expect(activate).not.toHaveBeenCalled()
    expect(capture(service).state).toBe("restart-required")
    expect(capture(service).runningSelection).toEqual(current)
    expect(capture(service).error).toContain("另一个 VS Code 窗口")
  })
})

function capture(service: DeepSeekHarnessService): DeepSeekHarnessSnapshot {
  let snapshot!: DeepSeekHarnessSnapshot
  const subscription = service.subscribe((value) => {
    snapshot = value
  })
  subscription.dispose()
  return snapshot
}

async function eventually(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  throw new Error("等待异步选择状态超时")
}
