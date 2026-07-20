const statuses = new Set(["PASS", "FAIL", "FLAKY", "BLOCKED"])
const attemptStatuses = new Set(["PASS", "FAIL", "BLOCKED"])
const metricStatuses = new Set(["PASS", "FAIL", "BLOCKED", "SKIP"])
const units = new Set(["ms", "bytes", "percent", "boolean"])

export function validate(data) {
  const errors = []
  if (!data || typeof data !== "object") return ["result must be an object"]
  if (!Number.isFinite(Date.parse(data.generatedAt))) errors.push("generatedAt must be an ISO date")
  if (data.lane !== "webview" && data.lane !== "installed") errors.push("lane must be webview or installed")
  if (data.profile?.id !== "2c-8gb-hdd-proxy") errors.push("profile.id must be 2c-8gb-hdd-proxy")
  if (data.profile?.cpuRate !== 6) errors.push("profile.cpuRate must be 6")
  if (!statuses.has(data.status)) errors.push(`invalid result status: ${data.status}`)
  if (!Array.isArray(data.attempts) || data.attempts.length < 1 || data.attempts.length > 2) {
    errors.push("attempts must contain one or two entries")
    return errors
  }
  for (const attempt of data.attempts) {
    if (!attemptStatuses.has(attempt.status)) errors.push(`invalid attempt status: ${attempt.status}`)
    if (!Number.isInteger(attempt.number) || attempt.number < 1 || attempt.number > 2)
      errors.push("invalid attempt number")
    if (!Array.isArray(attempt.metrics)) {
      errors.push(`attempt ${attempt.number} metrics must be an array`)
      continue
    }
    for (const metric of attempt.metrics) {
      if (typeof metric.id !== "string" || !metric.id) errors.push("metric id must be non-empty")
      if (!metricStatuses.has(metric.status)) errors.push(`invalid metric status: ${metric.status}`)
      if (!Array.isArray(metric.samples) || metric.samples.some((sample) => !Number.isFinite(sample)))
        errors.push(`invalid metric samples: ${metric.id}`)
      if (!units.has(metric.unit)) errors.push(`invalid metric unit: ${metric.id}`)
      if (typeof metric.summary !== "string") errors.push(`metric summary must be a string: ${metric.id}`)
    }
  }
  return errors
}
