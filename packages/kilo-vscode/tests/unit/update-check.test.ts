import { afterEach, describe, expect, it, mock } from "bun:test"
import * as vscode from "vscode"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { createHash } from "node:crypto"
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
    expect(env.warnings).toEqual(["Failed to read update manifest: network down"])
    expect(env.logs.warn[0]).toContain("[Kilo New] Update check failed (manifest):")
  })

  it("throttles repeated automatic failure warnings inside intervalHours", async () => {
    const env = await setup()
    env.fetch.mockImplementation(async () => {
      throw new Error("network down")
    })

    await env.service.checkAuto()
    await env.state.update(LAST_AUTO_KEY, 0)
    await env.service.checkAuto()

    expect(env.fetch).toHaveBeenCalledTimes(2)
    expect(env.warnings).toEqual(["Failed to read update manifest: network down"])
  })

  it("automatically downloads, verifies, installs, and only asks the user to reload", async () => {
    const body = Buffer.from("vsix package")
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
      { timeout: 120000 },
    ])
    expect(env.info).toEqual([{ message: "ChipMate update installed. Reload Window to finish.", items: [RELOAD] }])
    expect(env.commands).toEqual(["workbench.action.reloadWindow"])
  })

  it("offers manual installation when automatic installation is disabled", async () => {
    const body = Buffer.from("vsix package")
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

    expect(env.info[0]?.message).toBe(`No compatible ChipMate update package is available for ${TARGET}.`)
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
    env.fetch.mockResolvedValueOnce(json(manifest({ version: "0.0.18", sha256: "0".repeat(64) })))
    env.fetch.mockResolvedValueOnce(new Response("not the expected package", { status: 200 }))

    await env.service.checkManual()

    expect(env.warnings).toEqual(["VSIX sha256 verification failed."])
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

  it("removes the downloaded VSIX and provides a command when installation fails", async () => {
    const body = Buffer.from("vsix package")
    const cli = "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
    const env = await setup({ config: { codeCliPath: cli } })
    env.fetch.mockResolvedValueOnce(json(manifest({ version: "0.0.20", sha256: sha(body), sizeBytes: body.length })))
    env.fetch.mockResolvedValueOnce(new Response(body, { status: 200 }))
    env.exec.mockRejectedValueOnce(new Error("code not found"))

    await env.service.checkManual()

    expect(env.exec.mock.calls[0]?.[0]).toBe(cli)
    expect(env.warnings[0]).toContain("--install-extension")
    expect(env.warnings[0]).toContain(env.final("0.0.20"))
    expect(env.warnings[0]).toContain("code not found")
    expect(await exists(env.final("0.0.20"))).toBe(false)
  })
})

describe("update-check version comparison", () => {
  it("compares dotted versions numerically", () => {
    expect(compareVersions("0.0.10", "0.0.9")).toBe(1)
    expect(compareVersions("0.0.9", "0.0.10")).toBe(-1)
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0)
  })
})

async function setup(opts: { config?: Config; info?: unknown[] } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-update-check-"))
  roots.push(root)
  const state = memento()
  const warnings: string[] = []
  const info: Array<{ message: string; items: unknown[] }> = []
  const commands: string[] = []
  const logs = { log: [] as string[], warn: [] as string[], error: [] as string[] }
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
        chipmatePackageTarget: TARGET,
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
    now: () => 1_000,
    updates: () => "http://server.test:6001/packages/manifest.json",
    log: {
      log: (...parts: unknown[]) => logs.log.push(parts.join(" ")),
      warn: (...parts: unknown[]) => logs.warn.push(parts.join(" ")),
      error: (...parts: unknown[]) => logs.error.push(parts.join(" ")),
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
