import { MemoryDebug } from "@/chipmate/memory-debug"

export namespace HeapSnapshot {
  export function write() {
    return MemoryDebug.snapshot()
  }
}
