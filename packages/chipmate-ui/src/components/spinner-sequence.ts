export const variants = ["orbital", "signal", "prism", "liquid"] as const

export type SpinnerVariant = (typeof variants)[number]

export function sequence(random: () => number = Math.random) {
  let bag: SpinnerVariant[] = []
  let last: SpinnerVariant | undefined

  const refill = () => {
    const items = variants.slice()

    for (let i = items.length - 1; i > 0; i--) {
      const index = Math.floor(random() * (i + 1))
      const value = items[i]
      items[i] = items[index]
      items[index] = value
    }

    if (last && items[items.length - 1] === last) {
      const value = items[0]
      items[0] = items[items.length - 1]
      items[items.length - 1] = value
    }

    return items
  }

  return () => {
    if (bag.length === 0) bag = refill()
    const value = bag.pop()!
    last = value
    return value
  }
}

const pools = new Map<string, () => SpinnerVariant>()
const cycles = new Map<string, Map<number, SpinnerVariant>>()

export function next(scope = "default") {
  const current = pools.get(scope)
  if (current) return current()

  const choose = sequence()
  pools.set(scope, choose)
  return choose()
}

export function cycle(key: number | undefined, scope = "default") {
  if (key === undefined) return next(scope)

  const current = cycles.get(scope) ?? new Map<number, SpinnerVariant>()
  cycles.set(scope, current)

  const found = current.get(key)
  if (found) return found

  const variant = next(scope)
  current.set(key, variant)

  if (current.size > 32) {
    const first = current.keys().next().value
    if (first !== undefined) current.delete(first)
  }

  return variant
}
