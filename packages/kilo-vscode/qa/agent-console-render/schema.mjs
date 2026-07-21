const statuses = new Set(["PASS", "FAIL", "FLAKY", "REVIEW", "BLOCKED"])
const attempt = new Set(["PASS", "FAIL", "REVIEW", "BLOCKED"])
const assertion = new Set(["PASS", "FAIL", "REVIEW", "BLOCKED"])

export function validate(data) {
  const errors = []
  if (!data || typeof data !== "object") return ["result must be an object"]
  if (!Number.isFinite(Date.parse(data.generatedAt))) errors.push("generatedAt must be an ISO date")
  if (data.lane !== "macos-source-render-proxy") errors.push("invalid lane")
  if (!statuses.has(data.status)) errors.push(`invalid status: ${data.status}`)
  if (!Array.isArray(data.attempts) || data.attempts.length < 1 || data.attempts.length > 3)
    errors.push("attempts must contain one to three entries")
  for (const run of data.attempts ?? []) {
    if (!attempt.has(run.status)) errors.push(`invalid attempt status: ${run.status}`)
    if (!Array.isArray(run.cases) || run.cases.length !== 8) errors.push(`attempt ${run.number} must contain 8 cases`)
    for (const item of run.cases ?? []) {
      if (![1, 1.25, 1.5, 2].includes(item.scale)) errors.push(`invalid scale: ${item.scale}`)
      if (item.gpu !== "default" && item.gpu !== "disabled") errors.push(`invalid GPU mode: ${item.gpu}`)
      if (!attempt.has(item.status)) errors.push(`invalid case status: ${item.status}`)
      for (const check of item.assertions ?? []) {
        if (!assertion.has(check.status)) errors.push(`invalid assertion status: ${check.id}`)
        if (typeof check.summary !== "string") errors.push(`invalid assertion summary: ${check.id}`)
      }
    }
  }
  return errors
}
