import { extensions as allExtensions } from "../../tree-sitter"
import { normalizeFileExtensions } from "../../file-extensions"

const documentOnlyExtensions = new Set([".md", ".markdown"])

// Markdown belongs exclusively to Document RAG. Keep parser support available
// for non-indexing callers, but never admit it into the Code RAG pipeline.
export const parserExtensions = allExtensions
export const scannerExtensions = allExtensions.filter((extension) => !documentOnlyExtensions.has(extension))

export function resolveFileExtensions(input: readonly string[] | undefined): string[] {
  return (normalizeFileExtensions(input) ?? scannerExtensions).filter(
    (extension) => !documentOnlyExtensions.has(extension),
  )
}

/**
 * Extensions that should always use fallback chunking instead of tree-sitter parsing.
 *
 * These are either formats with no query/parser wiring yet, text-like build/doc files,
 * or languages where AST chunking is intentionally disabled for indexing stability.
 *
 * NOTE: Any extension listed here must also appear in `src/tree-sitter/index.ts`.
 * Keep this list explicit so broad-support formats do not rely on parser-load failures
 * to become indexable.
 */
export const fallbackExtensions = [
  // Shell and build scripts
  ".bash",
  ".bazel",
  ".bzl",
  ".build",
  ".gradle",
  ".ninja",
  ".sh",
  ".zsh",

  // Languages with no query or parser wiring yet
  ".dart",
  ".elm",
  ".m",
  ".mm",
  ".ql",
  ".r",
  ".res",
  ".resi",
  ".sql",
  ".vb",
  ".yaml",
  ".yml",

  // Documentation and query formats
  ".rst",

  // Known unstable or intentionally disabled AST chunking
  ".scala",
  ".swift",
]

/**
 * Check if a file extension should use fallback chunking
 * @param extension File extension (including the dot)
 * @returns true if the extension should use fallback chunking
 */
export function shouldUseFallbackChunking(extension: string): boolean {
  return fallbackExtensions.includes(extension.toLowerCase())
}
