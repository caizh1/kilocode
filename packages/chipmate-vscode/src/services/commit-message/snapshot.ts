import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { promisify } from "node:util"

const execute = promisify(execFile)

/** 绑定实际暂存内容、工作区变化和分支；迟到结果不能覆盖新的提交范围。 */
export async function snapshotRepository(directory: string): Promise<string> {
  const hash = createHash("sha256")
  for (const args of [
    ["diff", "--cached", "--binary", "--no-ext-diff"],
    ["diff", "--binary", "--no-ext-diff"],
    ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"],
  ]) {
    const { stdout } = await execute("git", args, {
      cwd: directory,
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    })
    hash.update(String(stdout.length)).update(":").update(stdout)
  }
  return hash.digest("hex")
}
