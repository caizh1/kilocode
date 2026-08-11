export const CODEGRAPH_JSON_TARGET_PART_BYTES = 32 * 1024 * 1024
export const CODEGRAPH_JSON_HARD_PART_BYTES = 64 * 1024 * 1024

type JsonStringify = (value: unknown) => string | undefined

type Progress = {
  label: string
  processed: number
  total: number
}

export type BoundedJsonPart<T> = {
  key: string
  path: string
  entries: number
  estimatedBytes: number
  payload: T
}

export function encodeBoundedJson(
  value: unknown,
  input: {
    label: string
    part?: string
    hardPartBytes?: number
    stringify?: JsonStringify
  },
): Uint8Array {
  return new TextEncoder().encode(stringifyBoundedJson(value, input))
}

export function stringifyBoundedJson(
  value: unknown,
  input: {
    label: string
    part?: string
    hardPartBytes?: number
    stringify?: JsonStringify
  },
): string {
  const hard = normalizeHard(input.hardPartBytes)
  const json = stringify(value, input)
  const bytes = size(json)
  if (bytes > hard) throw new Error(`${label(input)} is ${bytes} bytes, above hard JSON part limit ${hard}.`)
  return json
}

export function estimateJsonBytes(
  value: unknown,
  input: {
    label: string
    part?: string
    hardPartBytes?: number
    stringify?: JsonStringify
  },
): number {
  return size(stringifyBoundedJson(value, input))
}

export function splitRecordIntoBoundedJsonParts<TValue, TPayload>(input: {
  record: Record<string, TValue>
  label: string
  createPayload: (records: Record<string, TValue>, part: string) => TPayload
  pathForPart: (index: number, part: string) => string
  targetPartBytes?: number
  hardPartBytes?: number
  stringify?: JsonStringify
}): BoundedJsonPart<TPayload>[] {
  const hard = normalizeHard(input.hardPartBytes)
  const target = normalizeTarget(input.targetPartBytes, hard)
  const entries = Object.entries(input.record).sort(([left], [right]) => left.localeCompare(right))
  const out: BoundedJsonPart<TPayload>[] = []
  let index = 0
  let current = state(input, index)

  const flush = () => {
    if (current.entries === 0) return
    const payload = input.createPayload(current.records, current.key)
    const json = stringifyBoundedJson(payload, {
      label: input.label,
      part: current.key,
      hardPartBytes: hard,
      stringify: input.stringify,
    })
    out.push({
      key: current.key,
      path: input.pathForPart(index, current.key),
      entries: current.entries,
      estimatedBytes: size(json),
      payload,
    })
    index += 1
    current = state(input, index)
  }

  for (const [key, value] of entries) {
    const one = Object.create(null) as Record<string, TValue>
    one[key] = value
    const payload = input.createPayload(one, current.key)
    const bytes = size(
      stringifyBoundedJson(payload, {
        label: `${input.label} record ${key}`,
        part: current.key,
        hardPartBytes: hard,
        stringify: input.stringify,
      }),
    )
    const inc = Math.max(1, bytes - current.emptyBytes + 1)
    if (current.entries > 0 && current.estimatedBytes + inc > target) flush()
    current.records[key] = value
    current.entries += 1
    current.estimatedBytes += inc
    if (current.estimatedBytes >= hard) flush()
  }

  flush()
  return out
}

export function splitArrayRecordIntoBoundedJsonParts<TValue, TPayload>(input: {
  record: Record<string, TValue[]>
  label: string
  createPayload: (records: Record<string, TValue[]>, part: string) => TPayload
  pathForPart: (index: number, part: string) => string
  targetPartBytes?: number
  hardPartBytes?: number
  stringify?: JsonStringify
}): BoundedJsonPart<TPayload>[] {
  const hard = normalizeHard(input.hardPartBytes)
  const target = normalizeTarget(input.targetPartBytes, hard)
  const entries = Object.entries(input.record).sort(([left], [right]) => left.localeCompare(right))
  const out: BoundedJsonPart<TPayload>[] = []
  let index = 0
  let current = state(input, index)

  const flush = () => {
    if (current.entries === 0) return
    const payload = input.createPayload(current.records, current.key)
    const json = stringifyBoundedJson(payload, {
      label: input.label,
      part: current.key,
      hardPartBytes: hard,
      stringify: input.stringify,
    })
    out.push({
      key: current.key,
      path: input.pathForPart(index, current.key),
      entries: current.entries,
      estimatedBytes: size(json),
      payload,
    })
    index += 1
    current = state(input, index)
  }

  for (const [key, values] of entries) {
    if (!Array.isArray(values) || values.length === 0) continue
    const chunks = splitArrayValueIntoBoundedChunks({
      values,
      label: `${input.label} record ${key}`,
      hardPartBytes: hard,
      targetPartBytes: target,
      stringify: input.stringify,
      createPayload: (items) => {
        const record = Object.create(null) as Record<string, TValue[]>
        record[key] = items
        return input.createPayload(record, current.key)
      },
    })
    for (const chunk of chunks) {
      if (current.records[key]) flush()
      const one = Object.create(null) as Record<string, TValue[]>
      one[key] = chunk
      const payload = input.createPayload(one, current.key)
      const bytes = size(
        stringifyBoundedJson(payload, {
          label: `${input.label} record ${key}`,
          part: current.key,
          hardPartBytes: hard,
          stringify: input.stringify,
        }),
      )
      const inc = Math.max(1, bytes - current.emptyBytes + 1)
      if (current.entries > 0 && current.estimatedBytes + inc > target) flush()
      current.records[key] = chunk
      current.entries += chunk.length
      current.estimatedBytes += inc
      if (current.estimatedBytes >= hard) flush()
    }
  }

  flush()
  return out
}

export function splitArrayValueIntoBoundedChunks<TValue, TPayload>(input: {
  values: TValue[]
  label: string
  createPayload: (values: TValue[]) => TPayload
  targetPartBytes?: number
  hardPartBytes?: number
  stringify?: JsonStringify
  progressIntervalItems?: number
  onProgress?: (event: Progress) => void
}): TValue[][] {
  const hard = normalizeHard(input.hardPartBytes)
  const target = normalizeTarget(input.targetPartBytes, hard)
  const out: TValue[][] = []
  const every = Math.max(1, Math.floor(input.progressIntervalItems ?? 2048))
  let current: TValue[] = []
  let bytes = 0

  const flush = () => {
    if (current.length === 0) return
    stringifyBoundedJson(input.createPayload(current), {
      label: input.label,
      hardPartBytes: hard,
      stringify: input.stringify,
    })
    out.push(current)
    current = []
    bytes = 0
  }

  for (let index = 0; index < input.values.length; index += 1) {
    const item = input.values[index]!
    const single = size(
      stringifyBoundedJson(input.createPayload([item]), {
        label: `${input.label} item ${index}`,
        hardPartBytes: hard,
        stringify: input.stringify,
      }),
    )
    if (current.length > 0 && bytes + single > target) flush()
    current.push(item)
    bytes += single
    if (bytes >= hard) flush()
    if ((index + 1) % every === 0 || index + 1 === input.values.length) {
      input.onProgress?.({ label: input.label, processed: index + 1, total: input.values.length })
    }
  }

  flush()
  return out
}

export function codeGraphPartName(index: number): string {
  return Math.max(0, index).toString(36).padStart(4, "0")
}

function state<TValue, TPayload>(
  input: {
    createPayload: (records: Record<string, TValue>, part: string) => TPayload
    label: string
    hardPartBytes?: number
    stringify?: JsonStringify
  },
  index: number,
) {
  const key = codeGraphPartName(index)
  const records = Object.create(null) as Record<string, TValue>
  const emptyBytes = size(
    stringifyBoundedJson(input.createPayload(records, key), {
      label: input.label,
      part: key,
      hardPartBytes: input.hardPartBytes,
      stringify: input.stringify,
    }),
  )
  return {
    key,
    records,
    emptyBytes,
    estimatedBytes: emptyBytes,
    entries: 0,
  }
}

function stringify(value: unknown, input: { label: string; part?: string; stringify?: JsonStringify }): string {
  try {
    const json = (input.stringify ?? JSON.stringify)(value)
    if (typeof json !== "string") throw new TypeError("JSON.stringify returned undefined")
    return json
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Failed to serialize ${label(input)}: ${msg}`)
  }
}

function label(input: { label: string; part?: string }): string {
  return input.part ? `${input.label} part ${input.part}` : input.label
}

function size(json: string): number {
  return new TextEncoder().encode(json).byteLength
}

function normalizeHard(input?: number): number {
  return Math.max(1, Math.floor(input ?? CODEGRAPH_JSON_HARD_PART_BYTES))
}

function normalizeTarget(input: number | undefined, hard: number): number {
  return Math.max(1, Math.min(Math.floor(input ?? CODEGRAPH_JSON_TARGET_PART_BYTES), hard))
}
