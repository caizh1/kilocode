import { Log } from "../../util/log"

const log = Log.create({ service: "indexing-validation" })

/**
 * Sanitizes error messages by removing sensitive information like file paths and URLs
 * @param errorMessage The error message to sanitize
 * @returns The sanitized error message
 */
export function sanitizeErrorMessage(errorMessage: string): string {
  if (!errorMessage || typeof errorMessage !== "string") {
    return String(errorMessage)
  }

  let sanitized = errorMessage

  // Redact credentials before retaining provider response details in diagnostics.
  sanitized = sanitized.replace(
    /(authorization["']?\s*[:=]\s*["']?bearer\s+)[^"',}\s]+/gi,
    "$1[REDACTED_CREDENTIAL]",
  )
  sanitized = sanitized.replace(
    /((?:api[_-]?key|access[_-]?token|token|secret)["']?\s*[:=]\s*)(["']?)[^"',}\s]+\2/gi,
    "$1$2[REDACTED_CREDENTIAL]$2",
  )
  sanitized = sanitized.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_CREDENTIAL]")

  // Replace URLs first (http, https, ftp, file protocols)
  // This needs to be done before file paths to avoid partial replacements
  sanitized = sanitized.replace(
    /(?:https?|ftp|file):\/\/(?:localhost|[\w\-\.]+)(?::\d+)?(?:\/[\w\-\.\/\?\&\=\#]*)?/gi,
    "[REDACTED_URL]",
  )

  // Replace email addresses
  sanitized = sanitized.replace(/[\w\-\.]+@[\w\-\.]+\.\w+/g, "[REDACTED_EMAIL]")

  // Replace IP addresses (IPv4)
  sanitized = sanitized.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[REDACTED_IP]")

  // Replace file paths in quotes (handles paths with spaces)
  sanitized = sanitized.replace(/"[^"]*(?:\/|\\)[^"]*"/g, '"[REDACTED_PATH]"')

  // Replace file paths (Unix and Windows style)
  // Matches paths like /Users/username/path, C:\Users\path, ./relative/path, ../relative/path
  sanitized = sanitized.replace(
    /(?:\/[\w\-\.]+)+(?:\/[\w\-\.\s]*)*|(?:[A-Za-z]:\\[\w\-\.\\]+)|(?:\.{1,2}\/[\w\-\.\/]+)/g,
    "[REDACTED_PATH]",
  )

  // Replace port numbers that appear after colons (e.g., :11434, :8080)
  // Do this after URLs to avoid double replacement
  sanitized = sanitized.replace(/(?<!REDACTED_URL\]):(\d{2,5})\b/g, ":[REDACTED_PORT]")

  return sanitized
}

/**
 * HTTP error interface for embedder errors
 */
export interface HttpError extends Error {
  status?: number
  response?: {
    status?: number
  }
}

/**
 * Common error types that can occur during embedder validation
 */
export interface ValidationError {
  status?: number
  message?: string
  name?: string
  code?: string
}

/**
 * Maps HTTP status codes to appropriate error messages
 */
export function getErrorMessageForStatus(status: number | undefined, embedderType: string): string | undefined {
  switch (status) {
    case 401:
    case 403:
      return "Authentication failed. Please check your API key."
    case 404:
      return embedderType === "openai" ? "The specified embedding model is not available." : undefined
    case 429:
      return "Service is temporarily unavailable due to rate limiting. Please try again later."
    case 402:
      return "Add credits to continue, or switch to a free embedding model."
    default:
      return undefined
  }
}

/**
 * Extracts status code from various error formats
 */
export function extractStatusCode(error: any): number | undefined {
  // Direct status property
  if (error?.status) return error.status

  // Response status property
  if (error?.response?.status) return error.response.status

  // Extract from error message (e.g., "HTTP 404: Not Found")
  if (error?.message) {
    const match = error.message.match(/HTTP (\d+):/)
    if (match) {
      return parseInt(match[1], 10)
    }
  }

  return undefined
}

/**
 * Extracts error message from various error formats
 */
export function extractErrorMessage(error: any): string {
  if (error?.message) {
    return error.message
  }

  if (typeof error === "string") {
    return error
  }

  if (error && typeof error === "object" && "toString" in error) {
    try {
      return String(error)
    } catch {
      return "Unknown error"
    }
  }

  return "Unknown error"
}

/**
 * Standard validation error handler for embedder configuration validation
 * Returns a consistent error response based on the error type
 */
export function handleValidationError(
  error: any,
  embedderType: string,
  customHandlers?: {
    beforeStandardHandling?: (error: any) => { valid: boolean; error: string } | undefined
  },
): { valid: boolean; error: string } {
  // Allow custom handling first
  if (customHandlers?.beforeStandardHandling) {
    const customResult = customHandlers.beforeStandardHandling(error)
    if (customResult) return customResult
  }

  const statusCode = extractStatusCode(error)
  const errorMessage = extractErrorMessage(error)

  // Check for status-based errors first
  const statusError = getErrorMessageForStatus(statusCode, embedderType)
  if (statusError) {
    return { valid: false, error: statusError }
  }

  if (statusCode && statusCode >= 400 && statusCode < 600) {
    const detail = sanitizeErrorMessage(errorMessage.replace(new RegExp(`^HTTP ${statusCode}:\\s*`), "")).trim()
    const summary =
      statusCode >= 500 ? "Embedding service returned a server error" : "Embedding service rejected the request"
    if (detail && detail !== "Unknown error" && detail !== "[object Object]") {
      return { valid: false, error: `${summary} (HTTP ${statusCode}): ${detail}` }
    }
    return { valid: false, error: `${summary} (HTTP ${statusCode}) without an error message.` }
  }

  // Check for connection errors
  if (errorMessage) {
    if (
      errorMessage.includes("ENOTFOUND") ||
      errorMessage.includes("ECONNREFUSED") ||
      errorMessage.includes("ETIMEDOUT") ||
      errorMessage === "AbortError" ||
      errorMessage.includes("HTTP 0:") ||
      errorMessage === "No response"
    ) {
      return { valid: false, error: "Connection failed. Please check the endpoint URL and network connectivity." }
    }

    if (errorMessage.includes("Failed to parse response JSON")) {
      return { valid: false, error: "Received an invalid response from the embedding service." }
    }
  }

  // For generic errors, preserve the original error message if it's not a standard one
  if (errorMessage && errorMessage !== "Unknown error") {
    return { valid: false, error: sanitizeErrorMessage(errorMessage) }
  }

  // Fallback to generic error
  return { valid: false, error: "Embedder configuration validation failed without an error message." }
}

/**
 * Wraps an async validation function with standard error handling
 */
export async function withValidationErrorHandling<T extends { valid: boolean; error?: string }>(
  validationFn: () => Promise<T>,
  embedderType: string,
  customHandlers?: Parameters<typeof handleValidationError>[2],
): Promise<{ valid: boolean; error?: string }> {
  try {
    return await validationFn()
  } catch (error) {
    return handleValidationError(error, embedderType, customHandlers)
  }
}

/**
 * Formats an embedding error message based on the error type and context
 */
export function formatEmbeddingError(error: any, maxRetries: number): Error {
  const errorMessage = sanitizeErrorMessage(extractErrorMessage(error))
  const statusCode = extractStatusCode(error)

  if (statusCode === 401) {
    return new Error("Authentication failed. Please check your API key.")
  }
  if (statusCode) {
    return new Error(`Embedding request failed after ${maxRetries} attempts with status ${statusCode}: ${errorMessage}`)
  }
  return new Error(`Embedding request failed after ${maxRetries} attempts: ${errorMessage}`)
}
