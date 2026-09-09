export function parseVersion(value: string): RegExpExecArray | null {
  return /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value)
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) return 0
  for (const index of [1, 2, 3]) {
    const order = numeric(left[index], right[index])
    if (order) return order
  }
  if (left[4] === right[4]) return 0
  if (!left[4]) return 1
  if (!right[4]) return -1
  const first = left[4].split(".")
  const second = right[4].split(".")
  for (let index = 0; index < Math.max(first.length, second.length); index++) {
    const x = first[index]
    const y = second[index]
    if (x === y) continue
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) {
      const order = numeric(x, y)
      if (order) return order
      continue
    }
    if (xn !== yn) return xn ? -1 : 1
    return x > y ? 1 : -1
  }
  return 0
}

function numeric(a: string, b: string): number {
  const x = a.replace(/^0+(?=\d)/, "")
  const y = b.replace(/^0+(?=\d)/, "")
  if (x.length !== y.length) return x.length > y.length ? 1 : -1
  return x === y ? 0 : x > y ? 1 : -1
}
