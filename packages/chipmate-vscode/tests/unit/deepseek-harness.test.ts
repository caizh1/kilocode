import { afterEach, describe, expect, test } from "bun:test"
import { createServer, type Server } from "node:http"
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WebSocketServer } from "ws"
import { spawn } from "../../src/util/process"
import { isDeepSeekModel } from "../../src/shared/deepseek-harness"
import { DeepSeekHarnessProtocol } from "../../src/services/deepseek-harness/protocol"
import {
  cleanDeepSeekHarnessEnvironment,
  deepSeekHarnessPresetRequiresBashProbe,
  deepSeekHarnessCapacityMatches,
  deepSeekHarnessCapacityPatch,
  DeepSeekHarnessRuntime,
  deepSeekHarnessListenPort,
  ensureDeepSeekHarnessCapacity,
  ensureDeepSeekHarnessPreset,
  type DeepSeekHarnessConfig,
  validateOfficialWebHome,
  waitForDeepSeekHarnessAddress,
  writeDeepSeekHarnessLease,
} from "../../src/services/deepseek-harness/runtime"
import { DeepSeekHarnessService } from "../../src/services/deepseek-harness/service"
import {
  deepSeekHarnessProcessStartIdentity,
  DeepSeekHarnessLeaseCoordinator,
} from "../../src/services/deepseek-harness/lease"
import { validateDeepSeekHarnessArchivePath } from "../../src/services/deepseek-harness/installer"
import {
  deepSeekHarnessHostTarget,
  deepSeekHarnessPresetForTarget,
  isAllowedDeepSeekHarnessRuntimeBase,
  parseDeepSeekHarnessRuntimeCatalog,
} from "../../src/shared/deepseek-harness-runtime"
import type { DeepSeekHarnessModel, DeepSeekHarnessSnapshot } from "../../src/shared/deepseek-harness"
import {
  linuxBuilderRootfs,
  verifyGlibcVersions,
  verifyRuntime,
} from "../../script/dsh-runtime-helper"

let server: Server | undefined

afterEach(
  () =>
    new Promise<void>((resolve) => {
      if (!server) return resolve()
      server.closeAllConnections()
      server.close(() => resolve())
      server = undefined
    }),
)

describe("DeepSeek Harness 原样性门禁", () => {
  test("监听地址在等待函数启动前写入时仍可从本次日志区间读取", async () => {
    const root = mkdtempSync(join(tmpdir(), "chipmate-dsh-address-"))
    const log = join(root, "dsh.log")
    try {
      writeFileSync(log, "dsh web: http://127.0.0.1:41000\n")
      const offset = readFileSync(log, "utf8").length
      appendFileSync(log, "\u001b[36mdsh web: http://127.0.0.1:42000\u001b[0m\n")
      expect(deepSeekHarnessListenPort(readFileSync(log, "utf8").slice(offset))).toBe(42_000)
      await expect(
        waitForDeepSeekHarnessAddress(log, process.pid, 1_000, () => undefined, offset),
      ).resolves.toBe(42_000)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("生命周期租约使用同目录临时文件原子替换", () => {
    const root = mkdtempSync(join(tmpdir(), "chipmate-dsh-lease-"))
    const lease = join(root, "window.json")
    try {
      const initial = {
        schemaVersion: 2 as const,
        ownerId: "window",
        ownerPid: 10,
        ownerStartIdentity: "identity",
        createdAt: 50,
        updatedAt: 100,
      }
      writeDeepSeekHarnessLease(lease, initial)
      writeDeepSeekHarnessLease(lease, { ...initial, updatedAt: 200 })
      expect(JSON.parse(readFileSync(lease, "utf8"))).toEqual({ ...initial, updatedAt: 200 })
      expect(existsSync(`${lease}.${process.pid}.tmp`)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("同一 Extension Host 的多个客户端共享一份窗口租约", async () => {
    const root = mkdtempSync(join(tmpdir(), "chipmate-dsh-window-lease-"))
    const coordinator = new DeepSeekHarnessLeaseCoordinator(root)
    try {
      await Promise.all([coordinator.acquire("sidebar"), coordinator.acquire("tab")])
      expect(coordinator.hasClients()).toBe(true)
      expect(readdirSync(join(root, "leases")).filter((name) => name.endsWith(".json"))).toHaveLength(1)
      expect(coordinator.release("sidebar")).toBe(false)
      expect(coordinator.hasClients()).toBe(true)
      expect(readdirSync(join(root, "leases")).filter((name) => name.endsWith(".json"))).toHaveLength(1)
      expect(coordinator.release("tab")).toBe(true)
      expect(coordinator.hasClients()).toBe(false)
      expect(readdirSync(join(root, "leases")).filter((name) => name.endsWith(".json"))).toHaveLength(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("只识别带有 DeepSeek 身份的模型", () => {
    expect(isDeepSeekModel("newapi", "内部 NewAPI", "deepseek-v4-flash", "DeepSeek V4 Flash")).toBe(true)
    expect(isDeepSeekModel("newapi", "内部 NewAPI", "qwen3.6-27b", "Qwen 3.6")).toBe(false)
  })

  test("配置指纹不保存明文密钥且对模型顺序稳定", () => {
    const first = DeepSeekHarnessRuntime.fingerprint({
      baseURL: "https://example.test/v1",
      apiKey: "secret",
      models: [{ id: "b", name: "B" }, { id: "a", name: "A" }],
    }, "linux-x64-baseline")
    const second = DeepSeekHarnessRuntime.fingerprint({
      baseURL: "https://example.test/v1",
      apiKey: "secret",
      models: [{ id: "a", name: "A" }, { id: "b", name: "B" }],
    }, "linux-x64-baseline")
    const changed = DeepSeekHarnessRuntime.fingerprint({
      baseURL: "https://example.test/v1",
      apiKey: "changed",
      models: [{ id: "a", name: "A" }, { id: "b", name: "B" }],
    }, "linux-x64-baseline")
    expect(first).toBe(second)
    expect(first).not.toContain("secret")
    expect(changed).not.toBe(first)
    expect(DeepSeekHarnessRuntime.fingerprint({
      baseURL: "https://example.test/v1",
      apiKey: "secret",
      models: [{ id: "a", name: "A" }, { id: "b", name: "B" }],
    }, "win32-x64-baseline")).not.toBe(first)
  })

  test("平台目标固定选择官方 preset，其他平台保持不支持", () => {
    expect(deepSeekHarnessHostTarget("win32", "x64")).toBe("win32-x64-baseline")
    expect(deepSeekHarnessPresetForTarget("win32-x64-baseline")).toBe("standard")
    expect(deepSeekHarnessHostTarget("linux", "x64")).toBe("linux-x64-baseline")
    expect(deepSeekHarnessPresetForTarget("linux-x64-baseline")).toBe("minimal")
    expect(deepSeekHarnessHostTarget("darwin", "arm64")).toBeUndefined()
    expect(deepSeekHarnessPresetRequiresBashProbe("standard")).toBe(false)
    expect(deepSeekHarnessPresetRequiresBashProbe("minimal")).toBe(true)
  })

  test("运行时只复用健康协议并在替换时恰好关闭旧实例一次", () => {
    const runtime = new DeepSeekHarnessRuntime(
      {
        extensionUri: { fsPath: "/tmp/chipmate-extension" },
        globalStorageUri: { fsPath: "/tmp/chipmate-storage" },
      } as never,
      () => undefined,
      () => undefined,
      () => undefined,
      () => undefined,
      () => undefined,
    )
    const config = {
      baseURL: "https://example.test/v1",
      apiKey: "secret",
      models: [{ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }],
    }
    let firstCloses = 0
    let secondCloses = 0
    const first = { connected: true, close: () => (firstCloses += 1) }
    const second = { connected: true, close: () => (secondCloses += 1) }
    Object.assign(runtime as unknown as Record<string, unknown>, {
      record: {
        configFingerprint: DeepSeekHarnessRuntime.fingerprint(config, "linux-x64-baseline"),
        runtimeTarget: "linux-x64-baseline",
      },
      protocol: first,
    })
    const replace = (
      runtime as unknown as { replaceProtocol: (protocol?: unknown) => void }
    ).replaceProtocol.bind(runtime)

    expect(runtime.reusableProtocol(config)).toBe(first as never)
    replace(first)
    expect(firstCloses).toBe(0)
    replace(second)
    expect(firstCloses).toBe(1)
    replace(second)
    expect(secondCloses).toBe(0)
    replace()
    expect(secondCloses).toBe(1)
  })

  test("通过官方设置固定 262144 上下文和 32768 输出预算", async () => {
    const config = {
      baseURL: "https://example.test/v1",
      apiKey: "secret",
      models: [{ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }],
    }
    const patch = deepSeekHarnessCapacityPatch(config)
    expect(patch).toEqual({
      defaultContextWindow: 262_144,
      maxTokens: 32_768,
      models: [
        {
          id: "deepseek-v4-flash",
          name: "DeepSeek V4 Flash",
          contextWindow: 262_144,
          maxTokens: 32_768,
        },
      ],
    })
    expect(JSON.stringify(patch)).not.toContain(config.apiKey)
    expect(JSON.stringify(patch)).not.toContain(config.baseURL)

    let value: unknown = { defaultContextWindow: 1_000_000, maxTokens: 256_000, models: [] }
    const calls: Array<{ method: string; payload: unknown }> = []
    const protocol = {
      call: async (method: string, payload: unknown) => {
        calls.push({ method, payload })
        if (method === "settings.describe")
          return { writable: true, namespaces: [{ ns: "llm-deepseek", value, revision: calls.length }] }
        if (method === "settings.update") {
          value = (payload as { patch: unknown }).patch
          return {}
        }
        throw new Error("unexpected method")
      },
    }
    await ensureDeepSeekHarnessCapacity(protocol, config, true)
    expect(deepSeekHarnessCapacityMatches(value, config)).toBe(true)
    expect(calls.filter((call) => call.method === "settings.update")).toHaveLength(1)
    expect(calls.find((call) => call.method === "settings.update")?.payload).toMatchObject({
      ns: "llm-deepseek",
      expectedRevision: 1,
    })
  })

  test("连接已有官方进程时容量不一致只要求重启而不热写", async () => {
    let writes = 0
    await expect(
      ensureDeepSeekHarnessCapacity(
        {
          call: async (method: string) => {
            if (method === "settings.update") writes += 1
            return {
              writable: true,
              namespaces: [
                { ns: "llm-deepseek", value: { defaultContextWindow: 1_000_000 }, revision: 7 },
              ],
            }
          },
        },
        {
          baseURL: "https://example.test/v1",
          apiKey: "secret",
          models: [{ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }],
        },
        false,
      ),
    ).rejects.toThrow("需要重启")
    expect(writes).toBe(0)
  })

  test("只接受官方 system minimal preset 并写入默认设置后回读验证", async () => {
    let value: unknown = { default: "standard" }
    const calls: Array<{ method: string; payload: unknown }> = []
    await ensureDeepSeekHarnessPreset(
      {
        call: async (method: string, payload: unknown) => {
          calls.push({ method, payload })
          if (method === "agentPreset.list")
            return { presets: [{ id: "minimal", trust: "system", isDefault: false }] }
          if (method === "settings.describe")
            return { writable: true, namespaces: [{ ns: "agent-presets", value, revision: 4 }] }
          if (method === "settings.update") {
            value = (payload as { patch: unknown }).patch
            return {}
          }
          throw new Error(`unexpected method: ${method}`)
        },
      },
      "minimal",
      true,
    )
    expect(calls.filter((call) => call.method === "settings.update")).toHaveLength(1)
    expect(calls.find((call) => call.method === "settings.update")?.payload).toEqual({
      ns: "agent-presets",
      patch: { default: "minimal" },
      expectedRevision: 4,
    })
  })

  test("Windows 策略验证官方 system standard preset 且不改为 minimal", async () => {
    let value: unknown = { default: "minimal" }
    const calls: Array<{ method: string; payload: unknown }> = []
    await ensureDeepSeekHarnessPreset(
      {
        call: async (method: string, payload: unknown) => {
          calls.push({ method, payload })
          if (method === "agentPreset.list") return { presets: [{ id: "standard", trust: "system" }] }
          if (method === "settings.describe")
            return { writable: true, namespaces: [{ ns: "agent-presets", value, revision: 8 }] }
          if (method === "settings.update") {
            value = (payload as { patch: unknown }).patch
            return {}
          }
          throw new Error(`unexpected method: ${method}`)
        },
      },
      "standard",
      true,
    )
    expect(calls.find((call) => call.method === "settings.update")?.payload).toEqual({
      ns: "agent-presets",
      patch: { default: "standard" },
      expectedRevision: 8,
    })
  })

  test("拒绝损坏、非 system 或连接后不一致的 minimal preset", async () => {
    for (const preset of [
      { id: "minimal", trust: "user" },
      { id: "minimal", trust: "system", broken: "missing bundle" },
    ]) {
      await expect(
        ensureDeepSeekHarnessPreset(
          {
            call: async () => ({ presets: [preset] }),
          },
          "minimal",
          true,
        ),
      ).rejects.toThrow()
    }
    await expect(
      ensureDeepSeekHarnessPreset(
        {
          call: async (method: string) =>
            method === "agentPreset.list"
              ? { presets: [{ id: "minimal", trust: "system" }] }
              : { writable: true, namespaces: [{ ns: "agent-presets", value: { default: "standard" }, revision: 2 }] },
        },
        "minimal",
        false,
      ),
    ).rejects.toThrow("需要重启")
  })

  test("Preset revision 冲突只接受另一窗口已写入相同 minimal 策略", async () => {
    let reads = 0
    await ensureDeepSeekHarnessPreset(
      {
        call: async (method: string) => {
          if (method === "agentPreset.list")
            return { presets: [{ id: "minimal", trust: "system" }] }
          if (method === "settings.update") throw new Error("revision conflict")
          reads += 1
          return {
            writable: true,
            namespaces: [
              { ns: "agent-presets", value: { default: reads === 1 ? "standard" : "minimal" }, revision: reads },
            ],
          }
        },
      },
      "minimal",
      true,
    )
    expect(reads).toBe(2)

    await expect(
      ensureDeepSeekHarnessPreset(
        {
          call: async (method: string) => {
            if (method === "agentPreset.list")
              return { presets: [{ id: "minimal", trust: "system" }] }
            if (method === "settings.update") throw new Error("revision conflict")
            return {
              writable: true,
              namespaces: [{ ns: "agent-presets", value: { default: "standard" }, revision: 9 }],
            }
          },
        },
        "minimal",
        true,
      ),
    ).rejects.toThrow("需要重启")
  })

  test("官方设置 revision 冲突时只接受另一窗口写入的完全相同策略", async () => {
    const config = {
      baseURL: "https://example.test/v1",
      apiKey: "secret",
      models: [{ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }],
    }
    let reads = 0
    await ensureDeepSeekHarnessCapacity(
      {
        call: async (method: string) => {
          if (method === "settings.update") throw new Error("settings-conflict: revision changed")
          reads += 1
          return {
            writable: true,
            namespaces: [
              {
                ns: "llm-deepseek",
                value:
                  reads === 1
                    ? { defaultContextWindow: 1_000_000, maxTokens: 256_000, models: [] }
                    : deepSeekHarnessCapacityPatch(config),
                revision: reads,
              },
            ],
          }
        },
      },
      config,
      true,
    )
    expect(reads).toBe(2)

    await expect(
      ensureDeepSeekHarnessCapacity(
        {
          call: async (method: string) => {
            if (method === "settings.update") throw new Error("settings-conflict: revision changed")
            return {
              writable: true,
              namespaces: [
                { ns: "llm-deepseek", value: { defaultContextWindow: 131_072 }, revision: 9 },
              ],
            }
          },
        },
        config,
        true,
      ),
    ).rejects.toThrow("需要重启")
  })

  test("npm 锁文件固定官方 DSH tarball 完整性且没有补丁依赖", () => {
    const lock = JSON.parse(
      readFileSync(join(import.meta.dir, "..", "..", "dsh-runtime", "package-lock.json"), "utf8"),
    ) as { packages: Record<string, { version?: string; integrity?: string; resolved?: string }> }
    const dsh = lock.packages["node_modules/@deepseek-ai/dsh"]
    expect(dsh?.version).toBe("0.1.0-rc.6")
    expect(dsh?.integrity).toBe(
      "sha512-brpZfED7ieRa2PQ5tUxMhHrM1pb2CmKFVM/f6yMULBDMicahk+Z2OsHgTwTDnoiZm23Ftu9rQz0NN4pflaoJcg==",
    )
    expect(Object.keys(lock.packages).some((name) => name.toLowerCase().includes("patch"))).toBe(false)
  })

  test("Linux 构建根文件系统固定为 glibc 2.28 的官方 x64 制品", () => {
    expect(linuxBuilderRootfs.architecture).toBe("linux/amd64")
    expect(linuxBuilderRootfs.glibc).toBe("2.28")
    expect(linuxBuilderRootfs.sha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(linuxBuilderRootfs.url).toContain("github.com/AlmaLinux/wsl-images/releases/download/")
  })

  test("Linux 运行时缺少 sharp 或 node-pty 原生文件时拒绝打包", () => {
    const root = mkdtempSync(join(tmpdir(), "chipmate-dsh-native-gate-"))
    mkdirSync(join(root, "node_modules", "@deepseek-ai", "dsh", "lib"), { recursive: true })
    writeFileSync(join(root, "node"), "not-an-elf")
    writeFileSync(join(root, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"), "")
    try {
      expect(() => verifyRuntime(root, "linux", "x64")).toThrow("原生目录")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("Linux ABI 门禁拒绝高于 glibc 2.28 或 GLIBCXX 3.4.25", () => {
    expect(() => verifyGlibcVersions("GLIBC_2.2.5 GLIBC_2.28 GLIBCXX_3.4.25")).not.toThrow()
    expect(() => verifyGlibcVersions("GLIBC_2.29")).toThrow("glibc 2.28")
    expect(() => verifyGlibcVersions("GLIBCXX_3.4.26")).toThrow("GLIBCXX_3.4.25")
  })

  test("启动环境移除 ChipMate、OpenCode、Kilo 和父进程 DSH 注入", () => {
    const injected = [
      "CHIPMATE_RAG_ENDPOINT",
      "OPENCODE_MCP_CONFIG",
      "KILO_MEMORY_URL",
      "DSH_PERMISSION_MODE",
      "DEEPSEEK_API_KEY",
      "NODE_OPTIONS",
    ] as const
    const prior = Object.fromEntries(injected.map((key) => [key, process.env[key]]))
    Object.assign(process.env, {
      CHIPMATE_RAG_ENDPOINT: "secret-rag",
      OPENCODE_MCP_CONFIG: "secret-mcp",
      KILO_MEMORY_URL: "secret-memory",
      DSH_PERMISSION_MODE: "danger",
      DEEPSEEK_API_KEY: "parent-key",
      NODE_OPTIONS: "--require evil.js",
    })
    try {
      const env = cleanDeepSeekHarnessEnvironment(
        {
          baseURL: "https://example.test/v1",
          apiKey: "official-key",
          models: [{ id: "deepseek", name: "DeepSeek" }],
        },
        "/private/dsh-home",
      )
      expect(env.CHIPMATE_RAG_ENDPOINT).toBeUndefined()
      expect(env.OPENCODE_MCP_CONFIG).toBeUndefined()
      expect(env.KILO_MEMORY_URL).toBeUndefined()
      expect(env.DSH_PERMISSION_MODE).toBeUndefined()
      expect(env.NODE_OPTIONS).toBeUndefined()
      expect(env.DSH_HOME).toBe("/private/dsh-home")
      expect(env.DEEPSEEK_API_KEY).toBe("official-key")
      expect(env.PATH).toBe(process.env.PATH)
    } finally {
      for (const key of injected) {
        const value = prior[key]
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })

  test("私有 DSH_HOME 只接受官方 web Profile 和空 patch", () => {
    const home = join(tmpdir(), `chipmate-dsh-home-${crypto.randomUUID()}`)
    const profile = join(home, "profiles", "web")
    mkdirSync(profile, { recursive: true })
    writeFileSync(
      join(profile, "package.json"),
      JSON.stringify({
        name: "dsh-profile-web",
        private: true,
        dependencies: {},
        dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] } },
      }),
    )
    writeFileSync(join(profile, "cordis.patch.yml"), "# official empty profile patch\n[]\n")
    try {
      expect(() => validateOfficialWebHome(home)).not.toThrow()
      writeFileSync(join(profile, "cordis.patch.yml"), "- id: injected\n")
      expect(() => validateOfficialWebHome(home)).toThrow("patch")
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  test("ChipMate DeepSeek Harness 执行与投影链路不导入普通 Agent、索引或工具模块", () => {
    const packageRoot = join(import.meta.dir, "..", "..")
    const source = [
      "src/services/deepseek-harness/installer.ts",
      "src/services/deepseek-harness/protocol.ts",
      "src/services/deepseek-harness/runtime.ts",
      "src/services/deepseek-harness/service.ts",
      "webview-ui/src/context/deepseek-harness.tsx",
      "webview-ui/src/context/deepseek-harness-official-client.ts",
      "webview-ui/src/components/deepseek-harness/DeepSeekHarnessConversation.tsx",
      "webview-ui/src/components/deepseek-harness/deepseek-harness-presentation.ts",
    ]
      .map((name) => readFileSync(join(packageRoot, name), "utf8"))
      .join("\n")
    for (const forbidden of ["MessageV2", "indexing", "document-rag", "code-graph", "memory/", "tool-registry", "mcp/"]) {
      expect(source.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
    expect(readFileSync(join(packageRoot, "src/services/deepseek-harness/service.ts"), "utf8")).not.toContain(
      "pendingRequests",
    )
    const conversation = readFileSync(
      join(packageRoot, "webview-ui/src/components/deepseek-harness/DeepSeekHarnessConversation.tsx"),
      "utf8",
    )
    expect(conversation).not.toContain("OfficialFrame")
    expect(conversation).not.toContain("JSON.stringify")
  })

  test("Relay 只开放官方会话投影和交互所需接口", () => {
    const context = {
      extensionUri: { fsPath: "/tmp/chipmate-extension" },
      globalStorageUri: { fsPath: "/tmp/chipmate-storage" },
    } as never
    const service = new DeepSeekHarnessService(context, "linux-x64-baseline")
    const allowed = (
      service as unknown as { isRelayRequestAllowed: (path: string, method: "GET" | "POST") => boolean }
    ).isRelayRequestAllowed.bind(service)
    for (const name of [
      "host.describe",
      "respond",
      "session.list",
      "session.create",
      "session.history",
      "session.models",
      "session.selectModel",
      "session.prompt",
      "session.updateQueue",
      "session.cancel",
      "workspace.list",
    ]) {
      expect(allowed(`/api/${name}`, "POST")).toBe(true)
    }
    for (const name of [
      "session.delete",
      "session.rename",
      "workspace.delete",
      "settings.update",
      "credentials.set",
      "plugin.install",
      "events.mux",
    ]) {
      expect(allowed(`/api/${name}`, "POST")).toBe(false)
    }
  })

  test("创建会话后以官方 session.list 回读并拒绝非 minimal preset", async () => {
    const storage = mkdtempSync(join(tmpdir(), "chipmate-dsh-preset-verify-"))
    try {
      const service = new DeepSeekHarnessService({
        extensionUri: { fsPath: "/tmp/chipmate-extension" },
        globalStorageUri: { fsPath: storage },
      } as never, "linux-x64-baseline")
      const calls: Array<{ method: string; payload: unknown }> = []
      Object.assign(service as unknown as Record<string, unknown>, {
        state: "ready",
        protocol: {
          call: async (method: string, payload: unknown) => {
            calls.push({ method, payload })
            if (method === "session.create") return { sessionId: "created-standard" }
            if (method === "session.list")
              return { items: [{ sessionId: "created-standard", agentPreset: "standard", blank: true }] }
            return {}
          },
        },
      })
      await expect(
        (
          service as unknown as { createSession: (taskId: string, workspace: string) => Promise<void> }
        ).createSession("task", "/repo"),
      ).rejects.toThrow("未采用平台要求的 minimal")
      expect(calls.find((call) => call.method === "session.create")?.payload).toEqual({
        cwd: "/repo",
        agentPreset: "minimal",
      })
    } finally {
      rmSync(storage, { recursive: true, force: true })
    }
  })

  test("Windows 创建官方 standard 会话且现有 standard 映射保持可写", async () => {
    const storage = mkdtempSync(join(tmpdir(), "chipmate-dsh-windows-standard-"))
    try {
      const service = new DeepSeekHarnessService({
        extensionUri: { fsPath: "/tmp/chipmate-extension" },
        globalStorageUri: { fsPath: storage },
      } as never, "win32-x64-baseline")
      const calls: Array<{ method: string; payload: unknown }> = []
      Object.assign(service as unknown as Record<string, unknown>, {
        state: "ready",
        protocol: {
          call: async (method: string, payload: unknown) => {
            calls.push({ method, payload })
            if (method === "session.create") return { sessionId: "windows-standard" }
            if (method === "session.list")
              return { items: [{ sessionId: "windows-standard", agentPreset: "standard", blank: true, cwd: "/repo" }] }
            return {}
          },
        },
      })
      await (
        service as unknown as { createSession: (taskId: string, workspace: string) => Promise<void> }
      ).createSession("windows-task", "/repo")
      expect(calls.find((call) => call.method === "session.create")?.payload).toEqual({
        cwd: "/repo",
        agentPreset: "standard",
      })
      const snapshot = (
        service as unknown as { snapshot: () => DeepSeekHarnessSnapshot }
      ).snapshot()
      expect(snapshot.sessionId).toBe("windows-standard")
      expect(snapshot.expectedAgentPreset).toBe("standard")
      expect(snapshot.agentPreset).toBe("standard")
      expect(snapshot.presetState).toBe("ready")
      expect(snapshot.readOnlySession).toBe(false)

      const restored = new DeepSeekHarnessService({
        extensionUri: { fsPath: "/tmp/chipmate-extension" },
        globalStorageUri: { fsPath: storage },
      } as never, "win32-x64-baseline")
      Object.assign(restored as unknown as Record<string, unknown>, {
        state: "ready",
        protocol: {
          call: async (method: string) => {
            if (method === "session.list")
              return { items: [{ sessionId: "windows-standard", agentPreset: "standard", blank: false, cwd: "/repo" }] }
            if (method === "session.history") return { events: [], hasMore: false }
            return {}
          },
        },
      })
      await (
        restored as unknown as { openTask: (taskId: string, workspace: string) => Promise<void> }
      ).openTask("windows-task", "/repo")
      const restoredSnapshot = (
        restored as unknown as { snapshot: () => DeepSeekHarnessSnapshot }
      ).snapshot()
      expect(restoredSnapshot.sessionId).toBe("windows-standard")
      expect(restoredSnapshot.presetState).toBe("ready")
      expect(restoredSnapshot.readOnlySession).toBe(false)
    } finally {
      rmSync(storage, { recursive: true, force: true })
    }
  })

  test("schema v1 只原地迁移空白标准会话，非空会话保留为历史标准模式", async () => {
    const storage = mkdtempSync(join(tmpdir(), "chipmate-dsh-mapping-v2-"))
    try {
      const service = new DeepSeekHarnessService({
        extensionUri: { fsPath: "/tmp/chipmate-extension" },
        globalStorageUri: { fsPath: storage },
      } as never, "linux-x64-baseline")
      let blank = true
      let selects = 0
      Object.assign(service as unknown as Record<string, unknown>, {
        state: "ready",
        protocol: {
          call: async (method: string) => {
            if (method === "session.list")
              return { items: [{ sessionId: "legacy", agentPreset: "standard", blank, cwd: "/repo" }] }
            if (method === "agentPreset.select") {
              selects += 1
              return { agentPreset: "minimal" }
            }
            return {}
          },
        },
      })
      const upgrade = (
        service as unknown as {
          upgradeMapping: (mapping: {
            schemaVersion: 1
            chipmateTaskId: string
            officialDshSessionId: string
            workspaceUri: string
            createdAt: string
            lastOpenedAt: string
            displayTitle: string
          }) => Promise<{ sessions: Array<{ agentPreset: string }> }>
        }
      ).upgradeMapping.bind(service)
      const legacy = {
        schemaVersion: 1 as const,
        chipmateTaskId: "task",
        officialDshSessionId: "legacy",
        workspaceUri: "/repo",
        createdAt: new Date(0).toISOString(),
        lastOpenedAt: new Date(0).toISOString(),
        displayTitle: "Harness",
      }
      expect((await upgrade(legacy)).sessions[0]?.agentPreset).toBe("minimal")
      expect(selects).toBe(1)
      blank = false
      expect((await upgrade({ ...legacy, chipmateTaskId: "task-2" })).sessions[0]?.agentPreset).toBe("standard")
      expect(selects).toBe(1)
    } finally {
      rmSync(storage, { recursive: true, force: true })
    }
  })

  test("只读标准会话在 Relay 层拒绝 Prompt、切模和历史交互修改", async () => {
    const service = new DeepSeekHarnessService({
      extensionUri: { fsPath: "/tmp/chipmate-extension" },
      globalStorageUri: { fsPath: "/tmp/chipmate-storage" },
    } as never, "linux-x64-baseline")
    let requests = 0
    Object.assign(service as unknown as Record<string, unknown>, {
      state: "ready",
      readOnlySession: true,
      connectionGeneration: 1,
      sessionId: "legacy",
      taskMapping: {
        schemaVersion: 2,
        chipmateTaskId: "task",
        workspaceUri: "/repo",
        activeMappingKey: "minimal-key",
        sessions: [
          { mappingKey: "minimal-key", officialDshSessionId: "minimal", agentPreset: "minimal" },
          { mappingKey: "legacy-key", officialDshSessionId: "legacy", agentPreset: "standard" },
        ],
      },
      protocol: {
        request: async () => {
          requests += 1
          return { status: 200, headers: [], body: "" }
        },
      },
    })
    await expect(service.transport(1, "/api/session.prompt", "POST", "{}")).rejects.toThrow("只读历史")
    await expect(service.transport(1, "/api/session.selectModel", "POST", "{}")).rejects.toThrow("只读历史")
    await expect(service.transport(1, "/api/respond", "POST", "{}")).rejects.toThrow("只读历史")
    expect(requests).toBe(0)
  })

  test("远程运行时清单固定官方版本、目标和内容寻址路径", () => {
    const sha = "a".repeat(64)
    const catalog = parseDeepSeekHarnessRuntimeCatalog({
      schemaVersion: 1,
      runtime: "deepseek-harness",
      dshVersion: "0.1.0-rc.6",
      nodeVersion: "24.19.0",
      artifacts: {
        "win32-x64-baseline": {
          target: "win32-x64-baseline",
          dshVersion: "0.1.0-rc.6",
          nodeVersion: "24.19.0",
          url: `/packages/runtimes/deepseek-harness/0.1.0-rc.6/win32-x64-baseline/${sha}.zip`,
          sha256: sha,
          sizeBytes: 10,
          expandedSizeBytes: 20,
          fileCount: 2,
          fileManifestSha256: "b".repeat(64),
        },
      },
    })
    expect(catalog.artifacts["win32-x64-baseline"]?.sha256).toBe(sha)
    expect(() =>
      parseDeepSeekHarnessRuntimeCatalog({ ...catalog, dshVersion: "latest" }),
    ).toThrow("版本")
  })

  test("ZIP 路径门禁拒绝逃逸、反斜杠、ADS 和大小写冲突前置路径", () => {
    expect(validateDeepSeekHarnessArchivePath("dsh-runtime/node_modules/dsh/lib/bin.js")).toBe(
      "node_modules/dsh/lib/bin.js",
    )
    expect(validateDeepSeekHarnessArchivePath("dsh-runtime/node_modules/")).toBeUndefined()
    for (const path of [
      "../node.exe",
      "dsh-runtime/../node.exe",
      "dsh-runtime/node\\evil",
      "dsh-runtime/node.exe:stream",
    ]) {
      expect(() => validateDeepSeekHarnessArchivePath(path)).toThrow()
    }
  })

  test("运行时下载只允许 HTTPS、回环地址和字面量 RFC1918 私网 IPv4", () => {
    expect(isAllowedDeepSeekHarnessRuntimeBase(new URL("https://packages.example.com"))).toBe(true)
    expect(isAllowedDeepSeekHarnessRuntimeBase(new URL("http://127.0.0.1:6001"))).toBe(true)
    expect(isAllowedDeepSeekHarnessRuntimeBase(new URL("http://10.10.5.23:6001"))).toBe(true)
    expect(isAllowedDeepSeekHarnessRuntimeBase(new URL("http://172.31.2.3:6001"))).toBe(true)
    expect(isAllowedDeepSeekHarnessRuntimeBase(new URL("http://192.168.1.2:6001"))).toBe(true)
    expect(isAllowedDeepSeekHarnessRuntimeBase(new URL("http://172.32.2.3:6001"))).toBe(false)
    expect(isAllowedDeepSeekHarnessRuntimeBase(new URL("http://private.example.com:6001"))).toBe(false)
    expect(isAllowedDeepSeekHarnessRuntimeBase(new URL("ftp://10.10.5.23/runtime.zip"))).toBe(false)
  })
})

describe("DeepSeek Harness 官方连接协议", () => {
  test("Supervisor 以活进程身份保留超过 30 秒的 v2 租约", async () => {
    if (process.platform === "win32") return
    const node = Bun.which("node")
    expect(node).toBeTruthy()
    const root = mkdtempSync(join(tmpdir(), "chipmate-dsh-supervisor-stale-lease-"))
    const leaseDirectory = join(root, "leases")
    const supervisorDirectory = join(root, "supervisor")
    const lease = join(leaseDirectory, "test.json")
    const metadata = join(supervisorDirectory, "test.json")
    const log = join(root, "dsh.log")
    mkdirSync(leaseDirectory, { recursive: true })
    mkdirSync(supervisorDirectory, { recursive: true })
    writeDeepSeekHarnessLease(lease, {
      schemaVersion: 2,
      ownerId: "live-extension-host",
      ownerPid: process.pid,
      ownerStartIdentity: await deepSeekHarnessProcessStartIdentity(process.pid),
      createdAt: Date.now() - 60_000,
      updatedAt: Date.now() - 60_000,
    })
    const supervisor = join(import.meta.dir, "..", "..", "supervisor", "deepseek-harness-supervisor.cjs")
    const fake = join(import.meta.dir, "..", "fixtures", "fake-dsh-web.cjs")
    const child = spawn(node!, [supervisor, node!, fake, root, root, log, metadata], { stdio: "ignore" })
    try {
      await eventually(() => existsSync(metadata) && readFileSync(log, "utf8").includes("dsh web:"))
      await new Promise((resolve) => setTimeout(resolve, 2_500))
      expect(existsSync(metadata)).toBe(true)
      expect(() => process.kill(child.pid!, 0)).not.toThrow()

      rmSync(lease, { force: true })
      const resultPath = join(supervisorDirectory, "stop.result.json")
      await eventually(() => existsSync(resultPath), 7_000)
      const result = JSON.parse(readFileSync(resultPath, "utf8")) as {
        schemaVersion?: number
        forced?: boolean
        gracefulExit?: boolean
        reason?: string
      }
      expect(result).toMatchObject({
        schemaVersion: 2,
        forced: false,
        gracefulExit: true,
        reason: "lease-expired",
      })
    } finally {
      if (child.pid) {
        try {
          process.kill(child.pid, "SIGKILL")
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
        }
      }
      rmSync(root, { recursive: true, force: true })
    }
  }, 10_000)

  test("Supervisor 拒绝 PID 相同但启动标识不匹配的陈旧租约", async () => {
    if (process.platform === "win32") return
    const node = Bun.which("node")
    expect(node).toBeTruthy()
    const root = mkdtempSync(join(tmpdir(), "chipmate-dsh-supervisor-reused-pid-"))
    const leaseDirectory = join(root, "leases")
    const supervisorDirectory = join(root, "supervisor")
    const metadata = join(supervisorDirectory, "test.json")
    const log = join(root, "dsh.log")
    mkdirSync(leaseDirectory, { recursive: true })
    mkdirSync(supervisorDirectory, { recursive: true })
    writeDeepSeekHarnessLease(join(leaseDirectory, "test.json"), {
      schemaVersion: 2,
      ownerId: "reused-extension-host-pid",
      ownerPid: process.pid,
      ownerStartIdentity: "not-the-current-process",
      createdAt: Date.now() - 60_000,
      updatedAt: Date.now() - 60_000,
    })
    const supervisor = join(import.meta.dir, "..", "..", "supervisor", "deepseek-harness-supervisor.cjs")
    const fake = join(import.meta.dir, "..", "fixtures", "fake-dsh-web.cjs")
    const child = spawn(node!, [supervisor, node!, fake, root, root, log, metadata], { stdio: "ignore" })
    try {
      const resultPath = join(supervisorDirectory, "stop.result.json")
      await eventually(() => existsSync(resultPath), 7_000)
      expect(JSON.parse(readFileSync(resultPath, "utf8"))).toMatchObject({
        schemaVersion: 2,
        forced: false,
        gracefulExit: true,
        reason: "lease-expired",
      })
    } finally {
      if (child.pid) {
        try {
          process.kill(child.pid, "SIGKILL")
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
        }
      }
      rmSync(root, { recursive: true, force: true })
    }
  }, 10_000)

  test("Supervisor 不会把短暂不可读的租约误判为窗口全部退出", async () => {
    if (process.platform === "win32") return
    const node = Bun.which("node")
    expect(node).toBeTruthy()
    const root = mkdtempSync(join(tmpdir(), "chipmate-dsh-supervisor-lease-"))
    const leaseDirectory = join(root, "leases")
    const supervisorDirectory = join(root, "supervisor")
    const lease = join(leaseDirectory, "test.json")
    const metadata = join(supervisorDirectory, "test.json")
    const log = join(root, "dsh.log")
    mkdirSync(leaseDirectory, { recursive: true })
    mkdirSync(supervisorDirectory, { recursive: true })
    writeFileSync(lease, JSON.stringify({ pid: process.pid, updatedAt: Date.now() }))
    const supervisor = join(import.meta.dir, "..", "..", "supervisor", "deepseek-harness-supervisor.cjs")
    const fake = join(import.meta.dir, "..", "fixtures", "fake-dsh-web.cjs")
    const child = spawn(node!, [supervisor, node!, fake, root, root, log, metadata], { stdio: "ignore" })
    try {
      await eventually(() => existsSync(metadata) && readFileSync(log, "utf8").includes("dsh web:"))
      writeFileSync(lease, "{")
      await new Promise((resolve) => setTimeout(resolve, 2_500))
      writeFileSync(lease, JSON.stringify({ pid: process.pid, updatedAt: Date.now() }))
      await new Promise((resolve) => setTimeout(resolve, 750))
      expect(existsSync(metadata)).toBe(true)
      expect(() => process.kill(child.pid!, 0)).not.toThrow()

      rmSync(lease, { force: true })
      const resultPath = join(supervisorDirectory, "stop.result.json")
      await eventually(() => existsSync(resultPath), 7_000)
      const result = JSON.parse(readFileSync(resultPath, "utf8")) as { forced?: boolean; reason?: string }
      expect(result).toMatchObject({ forced: false, reason: "lease-expired" })
    } finally {
      if (child.pid) {
        try {
          process.kill(child.pid, "SIGKILL")
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
        }
      }
      rmSync(root, { recursive: true, force: true })
    }
  }, 10_000)

  test("独立 Supervisor 在停止请求后向官方进程发送正常清理信号", async () => {
    if (process.platform === "win32") return
    const node = Bun.which("node")
    expect(node).toBeTruthy()
    const root = mkdtempSync(join(tmpdir(), "chipmate-dsh-supervisor-"))
    const leaseDirectory = join(root, "leases")
    const supervisorDirectory = join(root, "supervisor")
    const metadata = join(supervisorDirectory, "test.json")
    const log = join(root, "dsh.log")
    const disposed = join(root, "disposed.txt")
    mkdirSync(leaseDirectory, { recursive: true })
    mkdirSync(supervisorDirectory, { recursive: true })
    writeFileSync(join(leaseDirectory, "test.json"), JSON.stringify({ pid: process.pid, updatedAt: Date.now() }))
    const supervisor = join(import.meta.dir, "..", "..", "supervisor", "deepseek-harness-supervisor.cjs")
    const fake = join(import.meta.dir, "..", "fixtures", "fake-dsh-web.cjs")
    const child = spawn(
      node!,
      [supervisor, node!, fake, root, root, log, metadata],
      {
        env: { ...process.env, CHIPMATE_DSH_TEST_DISPOSED: disposed },
        stdio: "ignore",
      },
    )
    try {
      await eventually(() => existsSync(metadata) && readFileSync(log, "utf8").includes("dsh web:"))
      writeFileSync(
        join(supervisorDirectory, "stop.request.json"),
        JSON.stringify({ schemaVersion: 2, supervisorPid: child.pid, requestedAt: Date.now() }),
      )
      await eventually(() => existsSync(join(supervisorDirectory, "stop.result.json")))
      const result = JSON.parse(readFileSync(join(supervisorDirectory, "stop.result.json"), "utf8")) as {
        schemaVersion?: number
        forced?: boolean
        signalAttempted?: boolean
        signalDelivered?: boolean
        gracefulExit?: boolean
        reason?: string
      }
      expect(result).toMatchObject({
        schemaVersion: 2,
        forced: false,
        signalAttempted: true,
        signalDelivered: true,
        gracefulExit: true,
        reason: "requested-stop",
      })
      expect(readFileSync(disposed, "utf8")).toContain("正常清理")
    } finally {
      if (child.pid) {
        try {
          process.kill(child.pid, "SIGKILL")
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
        }
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("并发选择复用一次启动，停止会等待在途启动后再清理", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [{ id: "deepseek-v4-flash" }] }), {
        headers: { "content-type": "application/json" },
      })) as typeof fetch
    try {
      const storage = mkdtempSync(join(tmpdir(), "chipmate-dsh-service-"))
      const context = {
        extensionUri: { fsPath: "/tmp/chipmate-extension" },
        globalStorageUri: { fsPath: storage },
      } as never
      const service = new DeepSeekHarnessService(context, "linux-x64-baseline")
      let release!: (protocol: unknown) => void
      const gate = new Promise((resolve) => (release = resolve))
      let starts = 0
      let stops = 0
      const protocol = {
        call: async (method: string) => {
          if (method === "session.create") return { sessionId: "official-session" }
          if (method === "session.list")
            return { items: [{ sessionId: "official-session", agentPreset: "minimal", blank: true, cwd: "/repo" }] }
          if (method === "session.history") return { events: [], hasMore: false }
          return {}
        },
        close: () => undefined,
      }
      ;(service as unknown as { runtime: unknown }).runtime = {
        currentConfigFingerprint: undefined,
        reusableProtocol: () => undefined,
        runtimeAvailable: () => true,
        prepareRuntime: async () => ({
          root: "/tmp/chipmate-dsh-runtime",
          artifact: { target: "linux-x64-baseline", sha256: "a".repeat(64) },
        }),
        ensure: async () => {
          starts += 1
          return gate
        },
        stop: async () => {
          stops += 1
          return { forced: false }
        },
        hasActiveWork: async () => false,
      }
      const config = {
        baseURL: "https://example.test/v1",
        apiKey: "secret",
        models: [{ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }],
      }
      const models = [{ providerID: "newapi", modelID: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }]
      const first = service.activate("chipmate-task", "/repo", config, models, models[0]!)
      const second = service.activate("chipmate-task", "/repo", config, models, models[0]!)
      await tick()
      const stopping = service.stop(false)
      release(protocol)
      await Promise.all([first, second, stopping])
      expect(starts).toBe(1)
      expect(stops).toBe(1)
      rmSync(storage, { recursive: true, force: true })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("官方 ConversationSnapshot 回执前保持 projecting-session，回执后才 ready", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [{ id: "deepseek-v4-flash" }] }), {
        headers: { "content-type": "application/json" },
      })) as typeof fetch
    const storage = mkdtempSync(join(tmpdir(), "chipmate-dsh-projection-"))
    try {
      const context = {
        extensionUri: { fsPath: "/tmp/chipmate-extension" },
        globalStorageUri: { fsPath: storage },
      } as never
      const service = new DeepSeekHarnessService(context, "linux-x64-baseline")
      const protocol = {
        openPluginEvents: async () => undefined,
        bootManifest: async () => ({
          rev: "official-rev",
          entries: [
            {
              id: "@deepseek-ai/dsh-client-modules",
              url: "/plugins/@deepseek-ai/dsh-client-modules/client.js?rev=module-rev",
              rev: "module-rev",
            },
          ],
        }),
        call: async (method: string) => {
          if (method === "session.create") return { sessionId: "official-session" }
          if (method === "session.list")
            return { items: [{ sessionId: "official-session", agentPreset: "minimal", blank: true, cwd: "/repo" }] }
          return {}
        },
      }
      ;(service as unknown as { runtime: unknown }).runtime = {
        currentConfigFingerprint: undefined,
        reusableProtocol: () => undefined,
        runtimeAvailable: () => true,
        prepareRuntime: async () => ({
          root: "/tmp/chipmate-dsh-runtime",
          artifact: { target: "linux-x64-baseline", sha256: "a".repeat(64) },
        }),
        ensure: async () => protocol,
        stop: async () => ({ forced: false }),
        hasActiveWork: async () => false,
      }
      let snapshot: DeepSeekHarnessSnapshot | undefined
      service.subscribe((value) => (snapshot = value))
      const models = [{ providerID: "newapi", modelID: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }]
      const activation = service.activate(
        "chipmate-task",
        "/repo",
        {
          baseURL: "https://example.test/v1",
          apiKey: "secret",
          models: [{ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }],
        },
        models,
        models[0]!,
      )
      await eventually(() => snapshot?.state === "projecting-session")
      expect(snapshot?.state).toBe("projecting-session")
      expect(snapshot?.bootManifest?.rev).toBe("official-rev")
      service.projectionReady("official-session", snapshot!.connectionGeneration)
      await activation
      expect(snapshot?.state).toBe("ready")
    } finally {
      globalThis.fetch = originalFetch
      rmSync(storage, { recursive: true, force: true })
    }
  })

  test("同一任务反复切换复用运行时、物理连接和官方会话", async () => {
    const originalFetch = globalThis.fetch
    let modelChecks = 0
    globalThis.fetch = (async () => {
      modelChecks += 1
      return new Response(JSON.stringify({ data: [{ id: "deepseek-v4-flash" }] }), {
        headers: { "content-type": "application/json" },
      })
    }) as typeof fetch
    const storage = mkdtempSync(join(tmpdir(), "chipmate-dsh-warm-switch-"))
    try {
      const service = new DeepSeekHarnessService({
        extensionUri: { fsPath: "/tmp/chipmate-extension" },
        globalStorageUri: { fsPath: storage },
      } as never, "linux-x64-baseline")
      const config = {
        baseURL: "https://example.test/v1",
        apiKey: "secret",
        models: [
          { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
          { id: "deepseek-v4", name: "DeepSeek V4" },
        ],
      }
      const fingerprint = DeepSeekHarnessRuntime.fingerprint(config, "linux-x64-baseline")
      const models = [
        { providerID: "newapi", modelID: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
        { providerID: "newapi", modelID: "deepseek-v4", name: "DeepSeek V4" },
      ]
      const calls = {
        prepare: 0,
        ensure: 0,
        boot: 0,
        plugins: 0,
        create: 0,
        history: 0,
        select: 0,
      }
      let createPayload: unknown
      let connected = false
      const protocol = {
        connected: true,
        bootManifest: async () => {
          calls.boot += 1
          return {
            rev: "official-rev",
            entries: [
              {
                id: "@deepseek-ai/dsh-client-modules",
                url: "/plugins/@deepseek-ai/dsh-client-modules/client.js?rev=module-rev",
                rev: "module-rev",
              },
            ],
          }
        },
        openPluginEvents: async () => {
          calls.plugins += 1
        },
        call: async (method: string, payload: unknown) => {
          if (method === "session.create") {
            calls.create += 1
            createPayload = payload
            return { sessionId: `official-session-${calls.create}` }
          }
          if (method === "session.list")
            return { items: [{ sessionId: `official-session-${calls.create}`, agentPreset: "minimal", blank: true, cwd: "/repo" }] }
          if (method === "session.history") {
            calls.history += 1
            return { events: [], hasMore: false }
          }
          if (method === "session.selectModel") calls.select += 1
          return {}
        },
        close: () => undefined,
      }
      const runtime = {
        get currentConfigFingerprint() {
          return connected ? fingerprint : undefined
        },
        reusableProtocol: () => (connected ? protocol : undefined),
        runtimeAvailable: () => true,
        prepareRuntime: async () => {
          calls.prepare += 1
          return {
            root: "/tmp/chipmate-dsh-runtime",
            artifact: { target: "linux-x64-baseline", sha256: "a".repeat(64) },
          }
        },
        ensure: async (_workspace: string, _config: unknown, verified: unknown) => {
          calls.ensure += 1
          expect(verified).toBeTruthy()
          connected = true
          return protocol
        },
        stop: async () => ({ forced: false }),
        hasActiveWork: async () => false,
        logPath: "/tmp/dsh.log",
        transportLogPath: "/tmp/transport.log",
      }
      ;(service as unknown as { runtime: unknown }).runtime = runtime
      let snapshot: DeepSeekHarnessSnapshot | undefined
      const states: string[] = []
      service.subscribe((value) => {
        snapshot = value
        states.push(value.state)
      })

      const cold = service.activate("chipmate-task", "/repo", config, models, models[0]!)
      await eventually(() => snapshot?.state === "projecting-session")
      service.projectionReady("official-session-1", snapshot!.connectionGeneration)
      await cold
      const generation = snapshot!.connectionGeneration
      const coldStateCount = states.length

      for (let index = 0; index < 20; index += 1) {
        service.setActive(false)
        await service.activate("chipmate-task", "/repo", config, models, models[0]!)
        service.setActive(true)
      }

      expect(calls).toEqual({ prepare: 1, ensure: 1, boot: 1, plugins: 1, create: 1, history: 0, select: 1 })
      expect(createPayload).toEqual({ cwd: "/repo", agentPreset: "minimal" })
      expect(modelChecks).toBe(1)
      expect(snapshot?.connectionGeneration).toBe(generation)
      expect(snapshot?.sessionId).toBe("official-session-1")
      expect(states.slice(coldStateCount)).not.toContain("installing-runtime")
      expect(states.slice(coldStateCount)).not.toContain("projecting-session")

      await service.activate("chipmate-task", "/repo", config, models, models[1]!)
      expect(calls.select).toBe(2)
      expect(calls.prepare).toBe(1)
      expect(calls.ensure).toBe(1)
      expect(snapshot?.connectionGeneration).toBe(generation)

      const taskSwitch = service.activate("chipmate-task-2", "/repo", config, models, models[1]!)
      await eventually(() => snapshot?.state === "projecting-session")
      expect(snapshot?.connectionGeneration).toBe(generation)
      expect(calls.prepare).toBe(1)
      expect(calls.ensure).toBe(1)
      expect(calls.boot).toBe(1)
      expect(calls.plugins).toBe(1)
      service.projectionReady("official-session-2", generation)
      await taskSwitch
      expect(snapshot?.sessionId).toBe("official-session-2")
      expect(calls.create).toBe(2)
      expect(calls.select).toBe(3)
    } finally {
      globalThis.fetch = originalFetch
      rmSync(storage, { recursive: true, force: true })
    }
  })

  test("运行配置恢复为当前进程指纹后取消无必要的重启要求", () => {
    const service = new DeepSeekHarnessService({
      extensionUri: { fsPath: "/tmp/chipmate-extension" },
      globalStorageUri: { fsPath: "/tmp/chipmate-storage" },
    } as never, "linux-x64-baseline")
    const original = {
      baseURL: "https://example.test/v1",
      apiKey: "original",
      models: [{ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }],
    }
    const models = [{ providerID: "newapi", modelID: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }]
    const protocol = { connected: true }
    ;(service as unknown as {
      config: DeepSeekHarnessConfig
      models: DeepSeekHarnessModel[]
      selectedModel: DeepSeekHarnessModel
      connectedFingerprint: string
      protocol: unknown
      state: DeepSeekHarnessSnapshot["state"]
    }).config = original
    ;(service as unknown as { models: DeepSeekHarnessModel[] }).models = models
    ;(service as unknown as { selectedModel: DeepSeekHarnessModel }).selectedModel = models[0]!
    ;(service as unknown as { connectedFingerprint: string }).connectedFingerprint =
      DeepSeekHarnessRuntime.fingerprint(original, "linux-x64-baseline")
    ;(service as unknown as { protocol: unknown }).protocol = protocol
    ;(service as unknown as { state: DeepSeekHarnessSnapshot["state"] }).state = "ready"
    let snapshot: DeepSeekHarnessSnapshot | undefined
    service.subscribe((value) => (snapshot = value))

    service.noteConfiguration({ ...original, apiKey: "changed" }, models)
    expect(snapshot?.state).toBe("restart-required")
    service.noteConfiguration(original, models)
    expect(snapshot?.state).toBe("ready")
    expect(snapshot?.error).toBeUndefined()
  })

  test("Relay 向官方客户端投影转发完整双通道信封且不在服务层重建待处理状态", () => {
    const context = {
      extensionUri: { fsPath: "/tmp/chipmate-extension" },
      globalStorageUri: { fsPath: "/tmp/chipmate-storage" },
    } as never
    const service = new DeepSeekHarnessService(context, "linux-x64-baseline")
    ;(service as unknown as { sessionId: string }).sessionId = "s1"
    let snapshot: DeepSeekHarnessSnapshot | undefined
    const downlinks: Array<{ channel: string; payload: { data?: string; frame?: unknown }; generation: number }> = []
    service.subscribe(
      (value) => (snapshot = value),
      (channel, payload, generation) => downlinks.push({ channel, payload, generation }),
    )
    const receive = (service as unknown as { receiveMux: (data: string) => void }).receiveMux.bind(
      service,
    )
    receive(JSON.stringify({
      type: "server-request",
      rpcId: "event-rpc",
      method: "session/event",
      payload: { type: "session/event", sessionId: "s1", event: { type: "turn/start" } },
    }))
    expect(downlinks.at(-1)).toMatchObject({
      channel: "mux",
      payload: { data: expect.stringContaining('"rpcId":"event-rpc"') },
    })
    receive(JSON.stringify({
      type: "server-request",
      rpcId: "approval-rpc",
      method: "approval/requested",
      payload: { type: "approval/requested", sessionId: "s1", approvalId: "a1", toolName: "bash" },
    }))
    expect(downlinks.at(-1)).toMatchObject({
      channel: "mux",
      payload: { data: expect.stringContaining('"rpcId":"approval-rpc"') },
    })
    receive(JSON.stringify({
      type: "server-request",
      rpcId: "resolved-rpc",
      method: "approval/resolved",
      payload: { type: "approval/resolved", sessionId: "s1", approvalId: "a1", outcome: "allowed-once" },
    }))
    expect(downlinks).toHaveLength(3)
    const receiveHost = (
      service as unknown as { receiveHost: (data: string) => void }
    ).receiveHost.bind(service)
    receiveHost(JSON.stringify({
      type: "server-request",
      rpcId: "status-rpc",
      method: "host/session-status",
      payload: { type: "host/session-status", sessionId: "s1", running: true },
    }))
    expect(snapshot?.running).toBe(true)
    expect(downlinks.at(-1)).toMatchObject({
      channel: "host",
      payload: { data: expect.stringContaining('"rpcId":"status-rpc"') },
    })
  })

  test("一次物理断流只切换一次连接代次并进入官方会话恢复", () => {
    const context = {
      extensionUri: { fsPath: "/tmp/chipmate-extension" },
      globalStorageUri: { fsPath: "/tmp/chipmate-storage" },
    } as never
    const service = new DeepSeekHarnessService(context, "linux-x64-baseline")
    const runtime = {
      connectionCycle: 1,
      reconnectAttempt: 1,
      currentProtocol: { openPluginEvents: async () => undefined },
      transportLogPath: "/tmp/transport.log",
      logPath: "/tmp/dsh.log",
    }
    ;(service as unknown as { runtime: unknown }).runtime = runtime
    let snapshot: DeepSeekHarnessSnapshot | undefined
    service.subscribe((value) => (snapshot = value))
    const phase = (
      service as unknown as { handleRuntimePhase: (state: DeepSeekHarnessSnapshot["state"]) => void }
    ).handleRuntimePhase.bind(service)
    phase("reconnecting-events")
    const generation = snapshot!.connectionGeneration
    runtime.reconnectAttempt = 2
    phase("reconnecting-events")
    expect(snapshot?.connectionGeneration).toBe(generation)
    expect(snapshot?.state).toBe("reconnecting-events")
    expect(snapshot?.launchStage).toBeUndefined()
    phase("resyncing-session")
    expect(snapshot?.state).toBe("resyncing-session")
    runtime.connectionCycle = 2
    phase("reconnecting-events")
    expect(snapshot?.connectionGeneration).toBe(generation + 1)
    ;(service as unknown as { clearReconnectWarning: () => void }).clearReconnectWarning()
  })

  test("事件恢复期间只应用最后一个目标任务且不建立第二套连接", async () => {
    const storage = mkdtempSync(join(tmpdir(), "chipmate-dsh-deferred-task-"))
    try {
      const service = new DeepSeekHarnessService({
        extensionUri: { fsPath: "/tmp/chipmate-extension" },
        globalStorageUri: { fsPath: storage },
      } as never, "linux-x64-baseline")
      const config = {
        baseURL: "https://example.test/v1",
        apiKey: "secret",
        models: [{ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }],
      }
      const model = { providerID: "newapi", modelID: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }
      const fingerprint = DeepSeekHarnessRuntime.fingerprint(config, "linux-x64-baseline")
      let created = 0
      const protocol = {
        connected: true,
        openPluginEvents: async () => undefined,
        call: async (method: string) => {
          if (method === "session.create") {
            created += 1
            return { sessionId: `deferred-session-${created}` }
          }
          if (method === "session.list")
            return { items: [{ sessionId: `deferred-session-${created}`, agentPreset: "minimal", blank: true, cwd: "/repo" }] }
          return {}
        },
      }
      const runtime = {
        connectionCycle: 1,
        reconnectAttempt: 1,
        currentProtocol: protocol,
        currentConfigFingerprint: fingerprint,
        reusableProtocol: () => protocol,
        transportLogPath: "/tmp/transport.log",
        logPath: "/tmp/dsh.log",
      }
      Object.assign(service as unknown as Record<string, unknown>, {
        runtime,
        protocol: undefined,
        config,
        models: [model],
        selectedModel: model,
        connectedFingerprint: fingerprint,
        workspace: "/repo",
        taskId: "task-original",
        sessionId: "session-original",
        bootManifest: { rev: "official-rev", entries: [] },
        state: "reconnecting-events",
      })
      let snapshot: DeepSeekHarnessSnapshot | undefined
      service.subscribe((value) => (snapshot = value))

      await service.activate("task-stale", "/repo", config, [model], model)
      await service.activate("task-latest", "/repo", config, [model], model)
      const phase = (
        service as unknown as { handleRuntimePhase: (state: DeepSeekHarnessSnapshot["state"]) => void }
      ).handleRuntimePhase.bind(service)
      phase("resyncing-session")
      await eventually(() => snapshot?.state === "resyncing-session")
      service.projectionReady("session-original", snapshot!.connectionGeneration)
      await eventually(
        () => snapshot?.state === "projecting-session" && snapshot.taskId === "task-latest",
      )
      service.projectionReady("deferred-session-1", snapshot!.connectionGeneration)
      await eventually(() => snapshot?.state === "ready")

      expect(snapshot?.taskId).toBe("task-latest")
      expect(snapshot?.sessionId).toBe("deferred-session-1")
      expect(created).toBe(1)
      expect(snapshot?.connectionGeneration).toBe(0)
      ;(service as unknown as { clearReconnectWarning: () => void }).clearReconnectWarning()
    } finally {
      rmSync(storage, { recursive: true, force: true })
    }
  })

  test("只有 host.describe 和两条事件连接同时成功才就绪", async () => {
    const requests: Array<{ method?: string; type?: string }> = []
    const mux: unknown[] = []
    const host: unknown[] = []
    const plugins: unknown[] = []
    const disconnects: Array<{ channel: string; kind: string; code?: number }> = []
    const sockets = new WebSocketServer({ noServer: true })
    server = createServer(async (request, response) => {
      if (request.url === "/") {
        response.setHeader("content-type", "text/html")
        response.end(
          '<script>window.__DSH_BOOT__ = {"rev":"graph-rev","entries":[{"id":"@deepseek-ai/dsh-client-modules","url":"/plugins/@deepseek-ai/dsh-client-modules/client.js?rev=module-rev","rev":"module-rev"}]}</script>',
        )
        return
      }
      if (request.url === "/plugins/events") {
        response.setHeader("content-type", "text/event-stream")
        response.end('data: {"type":"graph","rev":"next-rev"}\n\n')
        return
      }
      const body = await readBody(request)
      requests.push(body)
      if (request.url === "/api/respond") {
        response.setHeader("content-type", "application/json")
        response.end(
          JSON.stringify(body.rpcId === "late-rpc" ? { accepted: false, reason: "not-pending" } : { accepted: true }),
        )
        return
      }
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          type: "server-response",
          rpcId: body.rpcId,
          result: { ok: true, value: { version: "0.0.1" } },
        }),
      )
    })
    server.on("upgrade", (request, socket, head) => {
      sockets.handleUpgrade(request, socket, head, (websocket) => {
        sockets.emit("connection", websocket, request)
        const type = request.url === "/api/events.mux" ? "session/subscribed" : "host/session-added"
        if (request.url === "/api/events.mux") websocket.send("{malformed-official-frame")
        websocket.send(
          JSON.stringify({ type: "server-request", rpcId: `${type}-rpc`, method: type, payload: { type } }),
        )
      })
    })
    const port = await listen(server)
    const protocol = new DeepSeekHarnessProtocol(
      `http://127.0.0.1:${port}`,
      (frame) => mux.push(frame),
      (frame) => host.push(frame),
      (disconnect) => disconnects.push(disconnect),
      (frame) => plugins.push(frame),
    )
    const description = await protocol.connect()
    expect(protocol.connected).toBe(true)
    const manifest = await protocol.bootManifest()
    await protocol.openPluginEvents()
    await protocol.respond("approval-rpc", { outcome: "allowed-once" })
    await protocol.reject("cancel-rpc")
    await expect(protocol.respond("late-rpc", {})).rejects.toThrow("拒绝了响应")
    await tick()

    expect(description).toEqual({ version: "0.0.1" })
    expect(manifest).toMatchObject({ rev: "graph-rev", entries: [{ id: "@deepseek-ai/dsh-client-modules" }] })
    expect(plugins).toContainEqual({ type: "graph", rev: "next-rev" })
    expect(requests[0]).toMatchObject({ type: "client-request", method: "host.describe" })
    expect(requests).toContainEqual({
      type: "client-response",
      rpcId: "cancel-rpc",
      result: {
        ok: false,
        error: { code: "cancelled", message: "the user closed this question request", details: {} },
      },
    })
    expect(mux[0]).toBe("{malformed-official-frame")
    expect(mux.slice(1).map((frame) => JSON.parse(String(frame)))).toContainEqual({
      type: "server-request",
      rpcId: "session/subscribed-rpc",
      method: "session/subscribed",
      payload: { type: "session/subscribed" },
    })
    expect(host.map((frame) => JSON.parse(String(frame)))).toContainEqual({
      type: "server-request",
      rpcId: "host/session-added-rpc",
      method: "host/session-added",
      payload: { type: "host/session-added" },
    })
    for (const socket of sockets.clients) socket.terminate()
    await eventually(() => disconnects.length === 1)
    expect(disconnects).toEqual([
      expect.objectContaining({ channel: expect.any(String), kind: "close", code: 1006 }),
    ])
    protocol.close()
    expect(protocol.connected).toBe(false)
    for (const socket of sockets.clients) socket.terminate()
    sockets.close()
  })
})

function listen(target: Server): Promise<number> {
  return new Promise((resolve) => {
    target.listen(0, "127.0.0.1", () => {
      const address = target.address()
      if (!address || typeof address === "string") throw new Error("测试服务器未监听 TCP 端口")
      resolve(address.port)
    })
  })
}

function readBody(request: import("node:http").IncomingMessage): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    let body = ""
    request.setEncoding("utf8")
    request.on("data", (chunk) => (body += chunk))
    request.on("end", () => resolve(body ? JSON.parse(body) : {}))
  })
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 20))

async function eventually(check: () => boolean, timeout = 5_000): Promise<void> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error("等待测试条件超时")
}
