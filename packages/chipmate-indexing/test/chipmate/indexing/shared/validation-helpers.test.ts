import { describe, test, expect } from "bun:test"
import { handleValidationError, sanitizeErrorMessage } from "../../../../src/indexing/shared/validation-helpers"

describe("sanitizeErrorMessage", () => {
  test("should sanitize Unix-style file paths", () => {
    const input = "Error reading file /Users/username/projects/myapp/src/index.ts"
    const expected = "Error reading file [REDACTED_PATH]"
    expect(sanitizeErrorMessage(input)).toBe(expected)
  })

  test("should sanitize Windows-style file paths", () => {
    const input = "Cannot access C:\\Users\\username\\Documents\\project\\file.js"
    const expected = "Cannot access [REDACTED_PATH]"
    expect(sanitizeErrorMessage(input)).toBe(expected)
  })

  test("should sanitize relative file paths", () => {
    const input = "File not found: ./src/components/Button.tsx"
    const expected = "File not found: [REDACTED_PATH]"
    expect(sanitizeErrorMessage(input)).toBe(expected)

    const input2 = "Cannot read ../config/settings.json"
    const expected2 = "Cannot read [REDACTED_PATH]"
    expect(sanitizeErrorMessage(input2)).toBe(expected2)
  })

  test("should sanitize URLs with various protocols", () => {
    const input = "Failed to connect to http://localhost:11434/api/embed"
    const expected = "Failed to connect to [REDACTED_URL]"
    expect(sanitizeErrorMessage(input)).toBe(expected)

    const input2 = "Error fetching https://api.example.com:8080/v1/embeddings"
    const expected2 = "Error fetching [REDACTED_URL]"
    expect(sanitizeErrorMessage(input2)).toBe(expected2)
  })

  test("should sanitize IP addresses", () => {
    const input = "Connection refused at 192.168.1.100"
    const expected = "Connection refused at [REDACTED_IP]"
    expect(sanitizeErrorMessage(input)).toBe(expected)
  })

  test("should sanitize port numbers", () => {
    const input = "Server running on :8080 failed"
    const expected = "Server running on :[REDACTED_PORT] failed"
    expect(sanitizeErrorMessage(input)).toBe(expected)
  })

  test("should sanitize email addresses", () => {
    const input = "User john.doe@example.com not found"
    const expected = "User [REDACTED_EMAIL] not found"
    expect(sanitizeErrorMessage(input)).toBe(expected)
  })

  test("should sanitize paths in quotes", () => {
    const input = 'Cannot open file "/home/user/documents/secret.txt"'
    const expected = 'Cannot open file "[REDACTED_PATH]"'
    expect(sanitizeErrorMessage(input)).toBe(expected)
  })

  test("should handle complex error messages with multiple sensitive items", () => {
    const input = "Failed to fetch http://localhost:11434 from /Users/john/project at 192.168.1.1:3000"
    const expected = "Failed to fetch [REDACTED_URL] from [REDACTED_PATH] at [REDACTED_IP]:[REDACTED_PORT]"
    expect(sanitizeErrorMessage(input)).toBe(expected)
  })

  test("should handle non-string inputs gracefully", () => {
    expect(sanitizeErrorMessage(null as any)).toBe("null")
    expect(sanitizeErrorMessage(undefined as any)).toBe("undefined")
    expect(sanitizeErrorMessage(123 as any)).toBe("123")
    expect(sanitizeErrorMessage({} as any)).toBe("[object Object]")
  })

  test("should preserve non-sensitive error messages", () => {
    const input = "Invalid JSON format"
    expect(sanitizeErrorMessage(input)).toBe(input)

    const input2 = "Connection timeout"
    expect(sanitizeErrorMessage(input2)).toBe(input2)
  })

  test("should handle file paths with special characters", () => {
    const input = 'Error in "/path/to/file with spaces.txt"'
    const expected = 'Error in "[REDACTED_PATH]"'
    expect(sanitizeErrorMessage(input)).toBe(expected)
  })

  test("should sanitize multiple occurrences of sensitive data", () => {
    const input = "Copy from /src/file1.js to /dest/file2.js failed"
    const expected = "Copy from [REDACTED_PATH] to [REDACTED_PATH] failed"
    expect(sanitizeErrorMessage(input)).toBe(expected)
  })

  test("should sanitize credentials retained in provider errors", () => {
    const input =
      'Authorization: Bearer secret-token, "authorization":"Bearer json-token", api_key="private-key", token=private-token, fallback sk-sensitive123'
    const expected =
      'Authorization: Bearer [REDACTED_CREDENTIAL], "authorization":"Bearer [REDACTED_CREDENTIAL]", api_key="[REDACTED_CREDENTIAL]", token=[REDACTED_CREDENTIAL], fallback [REDACTED_CREDENTIAL]'
    expect(sanitizeErrorMessage(input)).toBe(expected)
  })
})

describe("handleValidationError", () => {
  test("preserves sanitized HTTP 400 provider details", () => {
    const error = Object.assign(
      new Error(
        '400 {"error":{"message":"dimensions must be 1024; endpoint http://localhost:1234/v1/embeddings; api_key=private-key"}}',
      ),
      { status: 400 },
    )

    expect(handleValidationError(error, "openai-compatible")).toEqual({
      valid: false,
      error:
        'Embedding service rejected the request (HTTP 400): 400 {"error":{"message":"dimensions must be 1024; endpoint [REDACTED_URL]; api_key=[REDACTED_CREDENTIAL]"}}',
    })
  })

  test("reports HTTP 500 even when the provider returns no details", () => {
    expect(handleValidationError({ status: 500 }, "openai-compatible")).toEqual({
      valid: false,
      error: "Embedding service returned a server error (HTTP 500) without an error message.",
    })
  })

  test("preserves the sanitized provider detail for an invalid endpoint response", () => {
    const error = Object.assign(new Error("HTTP 404: route /v1/embeddings was not found"), { status: 404 })

    expect(handleValidationError(error, "openai-compatible")).toEqual({
      valid: false,
      error: "Embedding service rejected the request (HTTP 404): route [REDACTED_PATH] was not found",
    })
  })

  test("sanitizes credentials and endpoints in generic validation failures", () => {
    const error = new Error("request to https://internal.example/v1 failed with api_key=private-key")

    expect(handleValidationError(error, "openai-compatible")).toEqual({
      valid: false,
      error: "request to [REDACTED_URL] failed with api_key=[REDACTED_CREDENTIAL]",
    })
  })
})
