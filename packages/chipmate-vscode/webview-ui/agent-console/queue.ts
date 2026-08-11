import type { TerminalWriter } from "../agent-manager/terminal/state"

interface Item {
  id: string
  data: string
}

export function queue(fail: (id: string, message: string) => void) {
  const items: Item[] = []
  let writer: TerminalWriter | undefined

  const flush = () => {
    if (!writer) return
    while (items.length > 0) {
      const item = items[0]!
      if (!writer(item.data)) return
      items.shift()
    }
  }

  return {
    send(id: string, data: string) {
      if (writer?.(data)) return true
      if (!items.some((item) => item.id === id)) items.push({ id, data })
      return false
    },
    write(data: string) {
      return writer?.(data) ?? false
    },
    bind(next: TerminalWriter) {
      writer = next
      flush()
      return () => {
        if (writer === next) writer = undefined
      }
    },
    reject(message: string) {
      const pending = items.splice(0)
      for (const item of pending) fail(item.id, message)
    },
    clear() {
      items.splice(0)
    },
  }
}
