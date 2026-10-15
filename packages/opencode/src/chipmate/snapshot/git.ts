import { Effect } from "effect"

export namespace SnapshotGit {
  interface Result {
    readonly code: number
    readonly text: string
    readonly stderr: string
  }

  interface Options {
    readonly cwd?: string
    readonly env?: Record<string, string>
    readonly stdin?: string
  }

  type Git = (args: string[], options?: Options) => Effect.Effect<Result>
  type Command = "add" | "rm"

  export function make(git: Git) {
    const capabilities = new Map<Command, { sparse: boolean; stdin: boolean }>()

    return Effect.fnUntraced(function* (
      command: Command,
      files: string[],
      options?: Omit<Options, "stdin"> & { root?: boolean },
    ) {
      const success: Result = { code: 0, text: "", stderr: "" }
      if (!files.length) return success

      const cached = capabilities.get(command)
      const flags =
        cached ??
        (yield* Effect.gen(function* () {
          // Help is read-only and exposes capabilities even on vendor builds with backports.
          const result = yield* git([command, "-h"], options)
          const help = `${result.text}\n${result.stderr}`.replaceAll("[no-]", "")
          const value = {
            sparse: help.includes("--sparse"),
            stdin: help.includes("--pathspec-from-file") && help.includes("--pathspec-file-nul"),
          }
          capabilities.set(command, value)
          return value
        }))

      const args =
        command === "add"
          ? ["add", "--all", ...(flags.sparse ? ["--sparse"] : [])]
          : ["rm", "--cached", "-f", "--ignore-unmatch"]

      // Preserve the one-pathspec fast path when initializing a whole worktree.
      if (command === "add" && options?.root) return yield* git([...args, "--", "."], options)

      const paths = files.map((file) => `:(top,literal)${file}`)
      if (flags.stdin)
        return yield* git([...args, "--pathspec-from-file=-", "--pathspec-file-nul"], {
          ...options,
          stdin: paths.join("\0") + "\0",
        })

      // Older Git lacks stdin pathspecs. Bound argv size and preserve literal filenames.
      const batches: string[][] = [[]]
      let size = 0
      for (const file of paths) {
        const bytes = Buffer.byteLength(file) + 1
        if (size && size + bytes > 8192) {
          batches.push([])
          size = 0
        }
        batches[batches.length - 1].push(file)
        size += bytes
      }
      for (const batch of batches) {
        const result = yield* git([...args, "--", ...batch], options)
        if (result.code !== 0) return result
      }
      return success
    })
  }
}
