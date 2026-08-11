export const CODE_GRAPH_SCHEMA_VERSION = 1
export const CODE_GRAPH_PARSER_VERSION = 2
export const CODE_GRAPH_STORAGE_DIR = "codegraph"
export const CODE_GRAPH_STORAGE_VERSION_DIR = "v3"
export const CODE_GRAPH_SHORT_SNIPPET_MAX_CHARS = 240

export const CODE_GRAPH_SUPPORTED_EXTENSIONS = [".c", ".h", ".cc", ".cpp", ".hpp", ".hh"] as const

export const CODE_POSTINGS_SCHEMA_VERSION = 1
export const CODE_POSTINGS_TOKENIZER_VERSION = 1
export const CODE_POSTINGS_STORAGE_DIR = "codepostings"
export const CODE_POSTINGS_STORAGE_VERSION_DIR = "v3"

export const CODE_POSTINGS_FIELD_WEIGHTS = {
  symbol: 5,
  macro: 5,
  type: 4,
  path: 2.5,
  code: 3,
  comment: 1,
} as const
