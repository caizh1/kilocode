export function redact(input: string): string {
  return input.replace(/([?&]auth_token=)[^&\s"'<>)}\]]+/gi, "$1[redacted]")
}
