import { MemoryDebug } from "@/kilocode/memory-debug"

export namespace HeapSnapshot {
  export function write() {
    return MemoryDebug.snapshot()
  }
}
