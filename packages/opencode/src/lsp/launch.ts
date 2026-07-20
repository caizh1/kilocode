import type { ChildProcessWithoutNullStreams } from "child_process"
import { Process } from "@/util/process"
import { userOptions } from "@/kilocode/product-env" // kilocode_change

type Child = Process.Child & ChildProcessWithoutNullStreams

export function spawn(cmd: string, args: string[], opts?: Process.Options): Child
export function spawn(cmd: string, opts?: Process.Options): Child
export function spawn(cmd: string, argsOrOpts?: string[] | Process.Options, opts?: Process.Options) {
  const args = Array.isArray(argsOrOpts) ? [...argsOrOpts] : []
  const cfg = Array.isArray(argsOrOpts) ? opts : argsOrOpts
  const proc = Process.spawn(
    [cmd, ...args],
    userOptions({
      // kilocode_change
      ...cfg,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    }),
  ) as Child // kilocode_change

  if (!proc.stdin || !proc.stdout || !proc.stderr) throw new Error("Process output not available")

  return proc
}
