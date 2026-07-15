import { minimatch } from "minimatch"

export namespace FileIgnore {
  export const FOLDERS = [
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
    ".kilo",
    ".opencode",
    ".kilocode",
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

  const folders = new Set<string>(FOLDERS)

  const files = [
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
    "**/.kilo/worktrees/**",
    "**/.kilocode/worktrees/**",
  ]

  export const PATTERNS = [...files, ...folders]

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
