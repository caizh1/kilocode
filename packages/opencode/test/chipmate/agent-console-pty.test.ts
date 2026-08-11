import { describe, expect, test } from "bun:test"
import * as ConsolePty from "../../src/chipmate/agent-console/pty"

const token = "0123456789abcdef0123456789abcdef"

function osc(kind: string, ...values: Array<string | number>) {
  return `\x1b]6973;${token};${[kind, ...values].join(";")}\x07`
}

function cwd(value: string) {
  return Buffer.from(value).toString("base64")
}

describe("Agent Console same-PTY bridge", () => {
  test("waits for the real Bash completion marker and returns ordered output", async () => {
    const directory = "/tmp/agent-console-slow"
    const writes: string[] = []
    const socket = ConsolePty.attach({
      directory,
      ptyID: "pty-slow",
      token,
      write: async (data) => {
        writes.push(data)
        if (data !== "printf slow\x18\x05") return
        socket.send(`printf slow\r\n${osc("begin", cwd(directory))}first\r\n`)
        setTimeout(() => socket.send(`second\r\n${osc("end", 0, cwd(directory))}`), 520)
        setTimeout(() => socket.send(osc("ready", cwd(directory))), 650)
      },
    })
    socket.send(osc("ready", cwd(directory)))
    ConsolePty.bind({ directory, ptyID: "pty-slow", sessionID: "session-slow" })

    const started = Date.now()
    const result = await ConsolePty.run({
      directory,
      sessionID: "session-slow",
      command: "printf slow",
      abort: new AbortController().signal,
      timeout: 2_000,
    })

    expect(Date.now() - started).toBeGreaterThanOrEqual(600)
    expect(writes).toEqual(["printf slow\x18\x05"])
    expect(result.output).toBe("first\nsecond")
    expect(result.exitCode).toBe(0)
    expect(result.cwd).toBe(directory)
    expect(ConsolePty.inspect({ directory, sessionID: "session-slow" }).generation).toBe(1)
    socket.close()
  })

  test("interrupts an active command and restores readiness only after Bash ends it", async () => {
    const directory = "/tmp/agent-console-abort"
    const controller = new AbortController()
    const writes: string[] = []
    const socket = ConsolePty.attach({
      directory,
      ptyID: "pty-abort",
      token,
      write: async (data) => {
        writes.push(data)
        if (data === "sleep 60\x18\x05") socket.send(osc("begin", cwd(directory)))
        if (data === "\x03") socket.send(`${osc("end", 130, cwd(directory))}${osc("ready", cwd(directory))}`)
      },
    })
    socket.send(osc("ready", cwd(directory)))
    ConsolePty.bind({ directory, ptyID: "pty-abort", sessionID: "session-abort" })

    const running = ConsolePty.run({
      directory,
      sessionID: "session-abort",
      command: "sleep 60",
      abort: controller.signal,
    })
    controller.abort()

    await expect(running).rejects.toThrow("cancelled")
    expect(writes).toEqual(["sleep 60\x18\x05", "\x03"])
    expect(ConsolePty.inspect({ directory, sessionID: "session-abort" }).cwd).toBe(directory)
    socket.close()
  })

  test("rejects a running command when the terminal closes and isolates replacements", async () => {
    const directory = "/tmp/agent-console-close"
    const socket = ConsolePty.attach({
      directory,
      ptyID: "pty-close",
      token,
      write: async (data) => {
        if (data === "wait\x18\x05") socket.send(osc("begin", cwd(directory)))
      },
    })
    socket.send(osc("ready", cwd(directory)))
    ConsolePty.bind({ directory, ptyID: "pty-close", sessionID: "session-close" })
    const running = ConsolePty.run({
      directory,
      sessionID: "session-close",
      command: "wait",
      abort: new AbortController().signal,
    })
    socket.close(1006, "offline")

    await expect(running).rejects.toThrow("offline")
    expect(() => ConsolePty.inspect({ directory, sessionID: "session-close" })).toThrow("not bound")

    const replacement = ConsolePty.attach({
      directory,
      ptyID: "pty-close",
      token,
      write: async () => undefined,
    })
    replacement.send(osc("ready", cwd(directory)))
    ConsolePty.bind({ directory, ptyID: "pty-close", sessionID: "session-close" })
    expect(ConsolePty.inspect({ directory, sessionID: "session-close" }).generation).toBe(2)
    replacement.close()
  })

  test("resynchronizes after an aborted command loses its end marker", async () => {
    const directory = "/tmp/agent-console-resync"
    const controller = new AbortController()
    const writes: string[] = []
    const socket = ConsolePty.attach({
      directory,
      ptyID: "pty-resync",
      token,
      write: async (data) => {
        writes.push(data)
        if (data === "hang\x18\x05") socket.send(osc("begin", cwd(directory)))
        if (data === "__chipmate_resync\x18\x05") {
          socket.send(`${osc("resync", cwd(directory))}${osc("ready", cwd(directory))}`)
        }
        if (data === "next\x18\x05") {
          socket.send(osc("begin", cwd(directory)))
          socket.send(`next-ok${osc("end", 0, cwd(directory))}${osc("ready", cwd(directory))}`)
        }
      },
    })
    socket.send(osc("ready", cwd(directory)))
    ConsolePty.bind({ directory, ptyID: "pty-resync", sessionID: "session-resync" })

    const running = ConsolePty.run({
      directory,
      sessionID: "session-resync",
      command: "hang",
      abort: controller.signal,
    })
    controller.abort()
    await expect(running).rejects.toThrow("cancelled")
    expect(ConsolePty.inspect({ directory, sessionID: "session-resync" }).cwd).toBe(directory)

    const next = await ConsolePty.run({
      directory,
      sessionID: "session-resync",
      command: "next",
      abort: new AbortController().signal,
    })
    expect(next.output).toBe("next-ok")
    expect(writes).toEqual(["hang\x18\x05", "\x03", "__chipmate_resync\x18\x05", "next\x18\x05"])
    socket.close()
  })

  test("keeps a command alive while it continues producing output", async () => {
    const directory = "/tmp/agent-console-active"
    const socket = ConsolePty.attach({
      directory,
      ptyID: "pty-active",
      token,
      write: async (data) => {
        if (data !== "stream\x18\x05") return
        socket.send(osc("begin", cwd(directory)))
        setTimeout(() => socket.send("one\n"), 25)
        setTimeout(() => socket.send("two\n"), 60)
        setTimeout(() => socket.send(`three\n${osc("end", 0, cwd(directory))}${osc("ready", cwd(directory))}`), 95)
      },
    })
    socket.send(osc("ready", cwd(directory)))
    ConsolePty.bind({ directory, ptyID: "pty-active", sessionID: "session-active" })

    const result = await ConsolePty.run({
      directory,
      sessionID: "session-active",
      command: "stream",
      abort: new AbortController().signal,
      timeout: 45,
    })
    expect(result.output).toBe("one\ntwo\nthree")
    socket.close()
  })
})
