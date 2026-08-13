import { minimatch } from "minimatch"
import { LEGACY_STATE_FOLDERS, LEGACY_WORKTREE_PATTERNS } from "../indexing/chipmate/legacy-ignore"

export namespace FileIgnore {
  const currentFolders = [
    "node_modules",
    "bower_components",
    ".pnpm-store",
    "vendor",
    ".npm",
    "dist",
    "build",
    "out",
    ".next",
    "target",
    "bin",
    "obj",
    ".git",
    ".svn",
    ".hg",
    ".vscode",
    ".idea",
    ".chipmate",
    ".opencode",
    ".chipmate-v2",
    ".turbo",
    ".output",
    "desktop",
    ".sst",
    ".cache",
    ".webkit-cache",
    "__pycache__",
    ".pytest_cache",
    "mypy_cache",
    ".history",
    ".gradle",
  ] as const

  export const DIAGNOSTIC_FOLDERS = currentFolders
  export const FOLDERS = [...new Set([...currentFolders, ...LEGACY_STATE_FOLDERS])] as readonly string[]

  const folders = new Set<string>(FOLDERS)

  const currentFiles = [
    "**/*.swp",
    "**/*.swo",
    "**/*.pyc",
    "**/.DS_Store",
    "**/Thumbs.db",
    "**/logs/**",
    "**/tmp/**",
    "**/temp/**",
    "**/*.log",
    "**/coverage/**",
    "**/.nyc_output/**",
    "**/.chipmate/worktrees/**",
    "**/.chipmate-v2/worktrees/**",
  ]

  const files = [...new Set([...currentFiles, ...LEGACY_WORKTREE_PATTERNS])]

  export const PATTERNS = [...new Set([...files, ...FOLDERS])]

  export function match(
    filePath: string,
    opts?: {
      extra?: string[]
      whitelist?: string[]
    },
  ) {
    const normalized = filePath.replaceAll("\\", "/")

    for (const pattern of opts?.whitelist || []) {
      if (minimatch(normalized, pattern, { dot: true })) return false
    }

    const parts = normalized.split("/")
    for (const part of parts) {
      if (folders.has(part)) return true
    }

    const extra = opts?.extra || []
    for (const pattern of [...files, ...extra]) {
      if (minimatch(normalized, pattern, { dot: true })) return true
    }

    return false
  }
}
