import { createRequire } from "module"
import { writeSync } from "node:fs"
import path from "path"
import type { Opts, Proc } from "@opencode-ai/core/pty/pty"

export type { Disp, Exit, Opts, Proc } from "@opencode-ai/core/pty/pty"

const load = createRequire(process.execPath)
const root = path.join(path.dirname(process.execPath), "node-pty-arm64", "lib", "index.js")
const pty = load(root) as typeof import("@lydell/node-pty")

export function spawn(file: string, args: string[], opts: Opts): Proc {
  const proc = pty.spawn(file, args, opts)
  const arm = proc as typeof proc & {
    _agent: {
      _input: number
    }
  }
  return {
    pid: proc.pid,
    onData(listener) {
      return proc.onData(listener)
    },
    onExit(listener) {
      return proc.onExit(listener)
    },
    write(data) {
      const size = writeSync(arm._agent._input, data)
      if (size !== Buffer.byteLength(data)) {
        throw new Error(`Windows ARM64 PTY input write was incomplete: ${size}/${Buffer.byteLength(data)}`)
      }
    },
    resize(cols, rows) {
      proc.resize(cols, rows)
    },
    kill(signal) {
      proc.kill(signal)
    },
  }
}
