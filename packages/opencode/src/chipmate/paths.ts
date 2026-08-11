import * as path from "path"
import os from "os"
import { Filesystem } from "../util/filesystem"
import { ProductProfile } from "./product-profile"

export namespace ChipMatePaths {
  const home = () => process.env.HOME || process.env.USERPROFILE || os.homedir()

  /**
   * Get the platform-specific VSCode global storage path for ChipMate extension.
   * - macOS: ~/Library/Application Support/Code/User/globalStorage/chipmate.chipmate-code
   * - Windows: %APPDATA%/Code/User/globalStorage/chipmate.chipmate-code
   * - Linux: ~/.config/Code/User/globalStorage/chipmate.chipmate-code
   */
  export function vscodeGlobalStorage(): string {
    const storage = ProductProfile.storage()
    if (storage) return path.join(storage, "config")
    const home = os.homedir()
    switch (process.platform) {
      case "darwin":
        return path.join(home, "Library", "Application Support", "Code", "User", "globalStorage", "chipmate.chipmate-code")
      case "win32":
        return path.join(
          process.env.APPDATA || path.join(home, "AppData", "Roaming"),
          "Code",
          "User",
          "globalStorage",
          "chipmate.chipmate-code",
        )
      default:
        return path.join(home, ".config", "Code", "User", "globalStorage", "chipmate.chipmate-code")
    }
  }

  /** Global ChipMate directory in the user home. */
  export function globalDirs(): string[] {
    const config = ProductProfile.config()
    if (config) return [config]
    return [path.join(home(), ".chipmate")]
  }

  /**
   * Discover ChipMate directories containing skills.
   * Returns parent directories for glob pattern "skills/[*]/SKILL.md".
   *
   * - Walks up from projectDir to worktreeRoot for .chipmate/
   * - Includes global ~/.chipmate/
   * - Includes VSCode extension global storage
   *
   * Does NOT copy/migrate skills - just provides paths for discovery.
   * Skills remain in their original locations and can be managed independently
   * by the ChipMate VSCode extension.
   */
  export async function skillDirectories(opts: {
    projectDir: string
    worktreeRoot: string
    skipGlobalPaths?: boolean
  }): Promise<string[]> {
    const directories: string[] = []

    if (!opts.skipGlobalPaths) {
      // 1. Global ~/.chipmate/ (loaded first so project-level overrides)
      for (const global of globalDirs()) {
        const globalSkills = path.join(global, "skills")
        if (!(await Filesystem.isDir(globalSkills))) continue
        directories.push(global) // Return parent, not skills/
      }

      // 2. VSCode extension global storage (marketplace-installed skills)
      const vscode = vscodeGlobalStorage()
      const vscodeSkills = path.join(vscode, "skills")
      if (await Filesystem.isDir(vscodeSkills)) {
        directories.push(vscode) // Return parent, not skills/
      }
    }

    // 3. Walk up from project dir to worktree root for .chipmate/
    // Returns parent directories (not skills/) because
    // the glob pattern "skills/[*]/SKILL.md" is applied from the parent
    // Loaded last so project-level skills take precedence over global
    for (const target of ProductProfile.dirs) {
      const projectDirs = await Array.fromAsync(
        Filesystem.up({
          targets: [target],
          start: opts.projectDir,
          stop: opts.worktreeRoot,
        }),
      )
      for (const dir of projectDirs) {
        const skillsDir = path.join(dir, "skills")
        if ((await Filesystem.isDir(skillsDir)) && !directories.includes(dir)) {
          directories.push(dir)
        }
      }
    }

    return directories
  }
}
