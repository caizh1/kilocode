import { afterEach, describe, expect, it, mock } from "bun:test"
import * as vscode from "vscode"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { createHash } from "node:crypto"
import * as yazl from "yazl"
import { LAST_AUTO_KEY, UpdateCheckService, compareVersions, resolvePackageUrl } from "../../src/services/update-check"

const INSTALL = "Install Update"
const RELOAD = "Reload Window"
const TARGET = "win32-x64-baseline"
const roots: string[] = []
const services: UpdateCheckService[] = []

type Config = Record<string, unknown>

const api = vscode as unknown as {
  workspace: {
    getConfiguration: (section?: string) => { get: <T>(key: string, fallback: T) => T }
  }
  window: {
    showWarningMessage: (message: string) => Promise<unknown>
    showInformationMessage: (message: string, ...items: unknown[]) => Promise<unknown>
  }
  commands: {
    executeCommand: (command: string) => Promise<unknown>
  }
}

const original = {
  config: api.workspace.getConfiguration,
  warning: api.window.showWarningMessage,
  info: api.window.showInformationMessage,
  command: api.commands.executeCommand,
}

afterEach(async () => {
  for (const service of services.splice(0)) service.dispose()
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
  api.workspace.getConfiguration = original.config
  api.window.showWarningMessage = original.warning
  api.window.showInformationMessage = original.info
  api.commands.executeCommand = original.command
})

describe("UpdateCheckService", () => {
  it("does not throw from startup checks when the service is unreachable", async () => {
    const env = await setup()
    env.fetch.mockImplementation(async () => {
      throw new Error("network down")
    })

    await expect(env.service.checkOnStartup()).resolves.toBeUndefined()
    expect(env.warnings).toEqual([])
    expect(env.logs.warn[0]).toContain("[Kilo New] 更新检查失败（availability）：")
  })

  it("opens the dedicated update log through the service", async () => {
    const env = await setup()

    env.service.showLog()

    expect(env.logs.shown).toBe(1)
  })

  it("keeps repeated automatic availability failures silent", async () => {
    const env = await setup()
    env.fetch.mockImplementation(async () => {
      throw new Error("network down")
    })

    await env.service.checkAuto()
    await env.state.update(LAST_AUTO_KEY, 0)
    await env.service.checkAuto()

    expect(env.fetch).toHaveBeenCalledTimes(2)
    expect(env.warnings).toEqual([])
    expect(env.logs.warn).toHaveLength(2)
  })

  it("keeps transient HTTP failures silent during automatic checks", async () => {
    const env = await setup()
    env.fetch.mockResolvedValueOnce(new Response("unavailable", { status: 503 }))

    await env.service.checkAuto()

    expect(env.warnings).toEqual([])
    expect(env.logs.warn[0]).toContain("（availability）：")
  })

  it("warns during automatic checks when the manifest is malformed", async () => {
    const env = await setup()
    env.fetch.mockResolvedValueOnce(new Response("not-json", { status: 200 }))

    await env.service.checkAuto()

    expect(env.warnings).toHaveLength(1)
    expect(env.warnings[0]).toContain("Failed to parse update manifest:")
  })

  it("aborts a manifest request that does not return headers in time", async () => {
    const env = await setup({ config: { timeoutMs: 5 } })
    env.fetch.mockImplementation(async (_input, init) => {
      await aborted(init?.signal)
      throw new Error("unreachable")
    })

    await env.service.checkManual()

    expect(env.warnings).toEqual(["Failed to read update manifest: aborted"])
  })

  it("aborts and removes a stalled VSIX after the total download deadline", async () => {
    const env = await setup({ config: { timeoutMs: 1000, downloadTimeoutMs: 5 } })
    env.fetch.mockResolvedValueOnce(json(manifest({ sizeBytes: 1, sha256: "0".repeat(64) })))
    env.fetch.mockResolvedValueOnce(new Response(new ReadableStream({ start() {} }), { status: 200 }))

    const available = await env.service.probeManual()
    expect(available.status).toBe("available")
    if (available.status !== "available") throw new Error("expected update candidate")
    const result = await env.service.installManual(available.candidateId)

    expect(result).toMatchObject({ status: "error", code: "download" })
    expect(await exists(env.final("0.0.17"))).toBe(false)
  })

  it("automatically downloads, verifies, installs, and only asks the user to reload", async () => {
    const body = await vsix()
    const env = await setup({ info: [RELOAD] })
    env.fetch.mockResolvedValueOnce(json(manifest({ version: "0.0.17", sha256: sha(body), sizeBytes: body.length })))
    env.fetch.mockResolvedValueOnce(new Response(body, { status: 200 }))
    env.exec.mockResolvedValueOnce({ stdout: "", stderr: "" })

    await env.service.checkAuto()

    expect(env.fetch.mock.calls.map((call) => String(call[0]))).toEqual([
      "http://server.test:6001/packages/manifest.json",
      "http://server.test:6001/packages/chipmate.vsix",
    ])
    expect(env.exec.mock.calls[0]).toEqual([
      "code",
      ["--install-extension", env.final("0.0.17"), "--force"],
      { timeout: 300000, windowsHide: true },
    ])
    expect(env.info).toEqual([{ message: "ChipMate update installed. Reload Window to finish.", items: [RELOAD] }])
    expect(env.commands).toEqual(["workbench.action.reloadWindow"])
    const log = env.logs.log.join("\n")
    expect(log).toContain("开始自动检查更新")
    expect(log).toContain("清单请求成功")
    expect(log).toContain("VSIX 下载完成")
    expect(log).toContain("SHA-256 校验通过")
    expect(log).toContain("VSIX 身份校验通过")
    expect(log).toContain("安装器成功退出")
    expect(log).toContain("等待用户重载窗口后激活")
    expect(log).not.toContain("VSCODE_IPC_HOOK_CLI")
  })

  it("offers manual installation when automatic installation is disabled", async () => {
    const body = await vsix()
    const env = await setup({ config: { autoInstall: false }, info: [INSTALL] })
    env.fetch.mockResolvedValueOnce(json(manifest({ version: "0.0.17", sha256: sha(body), sizeBytes: body.length })))
    env.fetch.mockResolvedValueOnce(new Response(body, { status: 200 }))
    env.exec.mockResolvedValueOnce({ stdout: "", stderr: "" })

    await env.service.checkManual()

    expect(env.info[0]).toEqual({
      message: "ChipMate update 0.0.17 is available. Current version: 0.0.16.",
      items: [INSTALL],
    })
    expect(env.exec).toHaveBeenCalledTimes(1)
  })

  it("reports a manual check as current without downloading", async () => {
    const env = await setup()
    env.fetch.mockResolvedValueOnce(json(manifest({ version: "0.0.16" })))

    await env.service.checkManual()

    expect(env.info[0]?.message).toBe("ChipMate is already up to date.")
    expect(env.exec).not.toHaveBeenCalled()
    expect(env.fetch).toHaveBeenCalledTimes(1)
  })

  it("reports a missing compatible package without downloading", async () => {
    const env = await setup()
    env.fetch.mockResolvedValueOnce(json({ schemaVersion: 2, latestByTarget: {} }))

    await env.service.checkManual()

    expect(env.info[0]?.message).toBe("ChipMate is already up to date.")
    expect(env.exec).not.toHaveBeenCalled()
  })

  it("rejects a malformed target package before installation", async () => {
    const env = await setup()
    env.fetch.mockResolvedValueOnce(json(manifest({ target: "linux-x64-baseline" })))

    await env.service.checkManual()

    expect(env.warnings).toEqual([`Update package target does not match ${TARGET}.`])
    expect(env.exec).not.toHaveBeenCalled()
  })

  it("deletes temporary files and skips install when sha256 does not match", async () => {
    const env = await setup()
    const body = Buffer.from("not the expected package")
    env.fetch.mockResolvedValueOnce(
      json(manifest({ version: "0.0.18", sha256: "0".repeat(64), sizeBytes: body.length })),
    )
    env.fetch.mockResolvedValueOnce(new Response(body, { status: 200 }))

    const available = await env.service.probeManual()
    expect(available.status).toBe("available")
    if (available.status !== "available") throw new Error("expected update candidate")
    const result = await env.service.installManual(available.candidateId)

    expect(result).toMatchObject({ status: "error", code: "sha256" })
    expect(await exists(env.final("0.0.18"))).toBe(false)
    expect(await exists(`${env.final("0.0.18")}.tmp`)).toBe(false)
    expect(env.exec).not.toHaveBeenCalled()
  })

  it("rejects missing sha256 before downloading", async () => {
    const env = await setup()
    env.fetch.mockResolvedValueOnce(json(manifest({ sha256: "" })))

    await env.service.checkManual()

    expect(env.warnings).toEqual([`Update package for ${TARGET} is incomplete.`])
    expect(env.fetch).toHaveBeenCalledTimes(1)
  })

  it("selects only the current macOS target when the manifest also contains a newer Windows package", async () => {
    const target = "darwin-arm64"
    const env = await setup({ target })
    const item = manifest({ version: "0.0.99" }).latestByTarget[TARGET]
    env.fetch.mockResolvedValueOnce(json({
      schemaVersion: 2,
      latestByTarget: {
        [TARGET]: item,
        [target]: { ...item, version: "0.0.16", target },
      },
    }))

    await env.service.checkManual()

    expect(env.info[0]?.message).toBe("ChipMate is already up to date.")
    expect(env.fetch).toHaveBeenCalledTimes(1)
    expect(env.exec).not.toHaveBeenCalled()
  })

  it("accepts only same-origin paths below /packages/", () => {
    const base = new URL("http://server.test:6001/packages/manifest.json")

    expect(resolvePackageUrl(base, "/packages/chipmate.vsix").toString()).toBe(
      "http://server.test:6001/packages/chipmate.vsix",
    )
    expect(resolvePackageUrl(base, "packages/releases/chipmate.vsix").toString()).toBe(
      "http://server.test:6001/packages/releases/chipmate.vsix",
    )
    expect(() => resolvePackageUrl(base, "https://example.com/chipmate.vsix")).toThrow("same-origin")
    expect(() => resolvePackageUrl(base, "/packages/../chipmate.vsix")).toThrow("stay under")
    expect(() => resolvePackageUrl(base, "/packages/%2e%2e/chipmate.vsix")).toThrow("stay under")
    expect(() => resolvePackageUrl(base, "/packages/releases%2fchipmate.vsix")).toThrow("stay under")
  })

  it("stops oversized downloads before writing a VSIX", async () => {
    const env = await setup({ config: { maxDownloadBytes: 3 } })
    env.fetch.mockResolvedValueOnce(json(manifest({ version: "0.0.19", sizeBytes: 4 })))

    await env.service.checkManual()

    expect(env.warnings).toEqual(["VSIX download is larger than 3 bytes."])
    expect(await exists(env.final("0.0.19"))).toBe(false)
    expect(await exists(`${env.final("0.0.19")}.tmp`)).toBe(false)
    expect(env.fetch).toHaveBeenCalledTimes(1)
    expect(env.exec).not.toHaveBeenCalled()
  })

  it("retains a verified VSIX and returns the original reason when installation fails", async () => {
    const body = await vsix({ version: "0.0.20" })
    const cli = "custom-code"
    const env = await setup({ config: { codeCliPath: cli } })
    env.fetch.mockResolvedValueOnce(json(manifest({ version: "0.0.20", sha256: sha(body), sizeBytes: body.length })))
    env.fetch.mockResolvedValueOnce(new Response(body, { status: 200 }))
    env.exec.mockRejectedValueOnce(new Error("code not found"))

    const available = await env.service.probeManual()
    expect(available.status).toBe("available")
    if (available.status !== "available") throw new Error("expected update candidate")
    const result = await env.service.installManual(available.candidateId)

    expect(env.exec.mock.calls[0]?.[0]).toBe(cli)
    expect(result).toMatchObject({ status: "error", code: "install" })
    expect(result.status === "error" ? result.message : "").toContain("code not found")
    expect(await exists(env.final("0.0.20"))).toBe(true)
  })

  it("rejects an internal VSIX identity mismatch before installation", async () => {
    const body = await vsix({ name: "other" })
    const env = await setup()
    env.fetch.mockResolvedValueOnce(json(manifest({ sha256: sha(body), sizeBytes: body.length })))
    env.fetch.mockResolvedValueOnce(new Response(body, { status: 200 }))

    const available = await env.service.probeManual()
    expect(available.status).toBe("available")
    if (available.status !== "available") throw new Error("expected update candidate")
    const result = await env.service.installManual(available.candidateId)

    expect(result).toMatchObject({ status: "error", code: "identity" })
    expect(env.exec).not.toHaveBeenCalled()
    expect(await exists(env.final("0.0.17"))).toBe(false)
  })

  it("rejects a body whose exact size differs from the manifest", async () => {
    const body = await vsix()
    const env = await setup()
    env.fetch.mockResolvedValueOnce(json(manifest({ sha256: sha(body), sizeBytes: body.length + 1 })))
    env.fetch.mockResolvedValueOnce(new Response(body, { status: 200 }))

    const available = await env.service.probeManual()
    expect(available.status).toBe("available")
    if (available.status !== "available") throw new Error("expected update candidate")
    const result = await env.service.installManual(available.candidateId)

    expect(result).toMatchObject({ status: "error", code: "download-size" })
    expect(env.exec).not.toHaveBeenCalled()
  })

  it("coalesces concurrent explicit installs into one download and install", async () => {
    const body = await vsix()
    const env = await setup({ config: { autoInstall: false } })
    env.fetch.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith("manifest.json")) {
        return json(manifest({ sha256: sha(body), sizeBytes: body.length }))
      }
      return new Response(body, { status: 200 })
    })
    env.exec.mockResolvedValue({ stdout: "", stderr: "" })

    const available = await env.service.probeManual()
    expect(available.status).toBe("available")
    if (available.status !== "available") throw new Error("expected update candidate")
    await Promise.all([
      env.service.installManual(available.candidateId),
      env.service.installManual(available.candidateId),
    ])

    expect(env.exec).toHaveBeenCalledTimes(1)
    expect(env.fetch.mock.calls.filter((call) => String(call[0]).endsWith("chipmate.vsix"))).toHaveLength(1)
    expect(env.info).toHaveLength(0)
  })

  it("suppresses repeat install attempts while a successful update awaits reload", async () => {
    const body = await vsix()
    const env = await setup()
    env.fetch.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith("manifest.json")) {
        return json(manifest({ sha256: sha(body), sizeBytes: body.length }))
      }
      return new Response(body, { status: 200 })
    })

    const available = await env.service.probeManual()
    expect(available.status).toBe("available")
    if (available.status !== "available") throw new Error("expected update candidate")
    await env.service.installManual(available.candidateId)
    await env.service.installManual(available.candidateId)

    expect(env.exec).toHaveBeenCalledTimes(1)
    expect(env.fetch.mock.calls.filter((call) => String(call[0]).endsWith("chipmate.vsix"))).toHaveLength(1)
    expect(env.info).toHaveLength(0)
  })

  it("retries a retained verified VSIX only after another explicit install action", async () => {
    const body = await vsix({ version: "0.0.21" })
    const env = await setup()
    env.fetch.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith("manifest.json")) {
        return json(manifest({ version: "0.0.21", sha256: sha(body), sizeBytes: body.length }))
      }
      return new Response(body, { status: 200 })
    })
    env.exec.mockRejectedValue(new Error("code not found"))

    const available = await env.service.probeManual()
    expect(available.status).toBe("available")
    if (available.status !== "available") throw new Error("expected update candidate")
    await env.service.installManual(available.candidateId)
    await env.service.installManual(available.candidateId)

    expect(env.exec).toHaveBeenCalledTimes(2)
    expect(env.fetch.mock.calls.filter((call) => String(call[0]).endsWith("chipmate.vsix"))).toHaveLength(1)
    expect(await exists(env.final("0.0.21"))).toBe(true)
  })

  it("revalidates a retained VSIX before retrying installation", async () => {
    const body = await vsix({ version: "0.0.25" })
    const env = await setup()
    env.fetch.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith("manifest.json")) {
        return json(manifest({ version: "0.0.25", sha256: sha(body), sizeBytes: body.length }))
      }
      return new Response(body, { status: 200 })
    })
    env.exec.mockRejectedValueOnce(new Error("code not found"))

    const available = await env.service.probeManual()
    expect(available.status).toBe("available")
    if (available.status !== "available") throw new Error("expected update candidate")
    expect(await env.service.installManual(available.candidateId)).toMatchObject({ status: "error", code: "install" })
    await fs.writeFile(env.final("0.0.25"), "已被修改")

    expect(await env.service.installManual(available.candidateId)).toMatchObject({
      status: "error",
      code: "download-size",
    })
    expect(env.exec).toHaveBeenCalledTimes(1)
    expect(env.fetch.mock.calls.filter((call) => String(call[0]).endsWith("chipmate.vsix"))).toHaveLength(1)
  })

  it("keeps a manual probe two-step even when automatic installation is enabled", async () => {
    const env = await setup()
    env.fetch.mockResolvedValueOnce(json(manifest({ version: "0.0.22" })))

    const result = await env.service.probeManual()

    expect(result).toMatchObject({ status: "available", currentVersion: "0.0.16", version: "0.0.22" })
    expect(env.exec).not.toHaveBeenCalled()
    expect(env.fetch).toHaveBeenCalledTimes(1)
  })

  it("returns release notes with an opaque candidate and rejects forged candidates", async () => {
    const env = await setup()
    env.fetch.mockResolvedValueOnce(
      json(
        manifest({
          version: "0.0.23",
          releaseNotes: "# ChipMate 0.0.23\n\n- Safer updates",
          publishedAt: "2026-07-24T08:00:00.000Z",
        }),
      ),
    )

    const result = await env.service.probeManual()

    expect(result).toMatchObject({
      status: "available",
      version: "0.0.23",
      releaseNotes: "# ChipMate 0.0.23\n\n- Safer updates",
      publishedAt: "2026-07-24T08:00:00.000Z",
    })
    expect(await env.service.installManual("forged")).toMatchObject({ status: "error", code: "manifest" })
    expect(env.exec).not.toHaveBeenCalled()
  })

  it("expires candidates before any package download", async () => {
    const clock = { value: 1_000 }
    const env = await setup({ now: () => clock.value })
    env.fetch.mockResolvedValueOnce(json(manifest({ version: "0.0.24" })))
    const result = await env.service.probeManual()
    expect(result.status).toBe("available")
    if (result.status !== "available") throw new Error("expected update candidate")

    clock.value += 31 * 60_000

    expect(await env.service.installManual(result.candidateId)).toMatchObject({ status: "error", code: "manifest" })
    expect(env.fetch).toHaveBeenCalledTimes(1)
    expect(env.exec).not.toHaveBeenCalled()
  })
})

describe("update-check version comparison", () => {
  it("compares dotted versions numerically", () => {
    expect(compareVersions("0.0.10", "0.0.9")).toBe(1)
    expect(compareVersions("0.0.9", "0.0.10")).toBe(-1)
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0)
  })
})

async function setup(opts: { config?: Config; info?: unknown[]; target?: string; now?: () => number } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-update-check-"))
  roots.push(root)
  const state = memento()
  const warnings: string[] = []
  const info: Array<{ message: string; items: unknown[] }> = []
  const commands: string[] = []
  const logs = { log: [] as string[], warn: [] as string[], error: [] as string[], shown: 0 }
  const fetcher = mock(async () => new Response("", { status: 404 }))
  const exec = mock(async () => ({ stdout: "", stderr: "" }))
  const context = {
    globalState: state,
    globalStorageUri: vscode.Uri.file(root),
    extension: {
      packageJSON: {
        publisher: "chipmate",
        name: "chipmate",
        version: "0.0.16",
        chipmatePackageTarget: opts.target ?? TARGET,
      },
    },
    subscriptions: [] as vscode.Disposable[],
  } as unknown as vscode.ExtensionContext

  api.workspace.getConfiguration = () => ({
    get: <T>(key: string, fallback: T) => (key in (opts.config ?? {}) ? (opts.config?.[key] as T) : fallback),
  })
  api.window.showWarningMessage = async (message) => {
    warnings.push(message)
    return undefined
  }
  api.window.showInformationMessage = async (message, ...items) => {
    info.push({ message, items })
    return opts.info?.shift()
  }
  api.commands.executeCommand = async (command) => {
    commands.push(command)
    return undefined
  }

  const service = new UpdateCheckService(context, {
    fetch: fetcher as unknown as typeof fetch,
    exec,
    now: opts.now ?? (() => 1_000),
    updates: () => "http://server.test:6001/packages/manifest.json",
    log: {
      log: (...parts: unknown[]) => logs.log.push(parts.join(" ")),
      warn: (...parts: unknown[]) => logs.warn.push(parts.join(" ")),
      error: (...parts: unknown[]) => logs.error.push(parts.join(" ")),
      show: () => {
        logs.shown += 1
      },
    },
  })
  services.push(service)

  return {
    root,
    state,
    service,
    fetch: fetcher,
    exec,
    warnings,
    info,
    commands,
    logs,
    final: (version: string) => path.join(root, "update-check", `chipmate.chipmate-${version}.vsix`),
  }
}

function manifest(patch: Record<string, unknown> = {}) {
  const body = Buffer.from("manifest package")
  const item = {
    extensionId: "chipmate.chipmate",
    publisher: "chipmate",
    name: "chipmate",
    version: "0.0.17",
    target: TARGET,
    url: "/packages/chipmate.vsix",
    sha256: sha(body),
    sizeBytes: body.length,
    ...patch,
  }
  return { schemaVersion: 2, latestByTarget: { [TARGET]: item } }
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } })
}

function sha(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}

function vsix(patch: Record<string, unknown> = {}): Promise<Buffer> {
  const zip = new yazl.ZipFile()
  const chunks: Buffer[] = []
  const manifest = {
    publisher: "chipmate",
    name: "chipmate",
    version: "0.0.17",
    chipmatePackageTarget: TARGET,
    ...patch,
  }
  zip.addBuffer(Buffer.from(JSON.stringify(manifest)), "extension/package.json")
  zip.addBuffer(Buffer.from("extension payload"), "extension/dist/extension.js")
  return new Promise((resolve, reject) => {
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk))
    zip.outputStream.on("error", reject)
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)))
    zip.end()
  })
}

function memento() {
  const values = new Map<string, unknown>()
  return {
    get: <T>(key: string, fallback?: T) => (values.has(key) ? (values.get(key) as T) : fallback),
    update: async (key: string, value: unknown) => {
      values.set(key, value)
    },
  } as unknown as vscode.Memento
}

async function exists(file: string) {
  return fs.access(file).then(
    () => true,
    () => false,
  )
}

function aborted(signal: AbortSignal | null | undefined): Promise<void> {
  return new Promise((_, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"))
      return
    }
    signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
  })
}
