type Hint = {
  category: "CONTROL_CONTRACT" | "MEMORY_SECURITY" | "RESOURCE_LIFECYCLE" | "UPDATE_PERSISTENCE"
  text: string
}

export function logicHints(source: string): string[] {
  const hints: Hint[] = []
  derived(source, hints)
  address(source, hints)
  lifecycle(source, hints)
  persistence(source, hints)
  return hints.slice(0, 3).map((hint) => `${hint.category}: ${hint.text}`)
}

function derived(source: string, hints: Hint[]) {
  const values = [
    ...source.matchAll(/\b([A-Za-z_]\w*(?:->|\.)[A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s*\+\s*1(?:U|UL|ULL)?\s*;/g),
  ]
  for (const match of values) {
    const derived = match[1]
    const raw = match[2]
    if (!derived || !raw) continue
    const escaped = escape(raw)
    const boundary = new RegExp(
      `(?:\\b${escaped}\\b\\s*(?:>|>=)\\s*[^;]*(?:capacity|limit|max)|(?:capacity|limit|max)[^;]*-\\s*\\b${escaped}\\b)`,
      "i",
    )
    if (!boundary.test(source)) continue
    hints.push({
      category: "CONTROL_CONTRACT",
      text: `核对边界检查是否错误地使用原始值 ${raw}，而后续执行使用派生值 ${derived}；必须证明两者的 +1 语义不会形成末端越界。`,
    })
    return
  }
}

function address(source: string, hints: Hint[]) {
  if (!/\b(?:PRP|addr|address|dma)\w*\s*\[\s*1\s*\]\s*&\s*0x(?:FFF|FFFU|FFFUL)\b/i.test(source)) return
  hints.push({
    category: "MEMORY_SECURITY",
    text: "已检测到代码对地址数组 [1] 掩 0xFFF。必须核对实际 DMA 调用：若 [1] 作为地址高 32 位、[0] 作为地址低 32 位，则页偏移只能检查 [0] 的低 12 位；除非包内证明布局相反，或同一路径另有 [0] & 0xFFF 的 4 KiB 保护，否则应形成 P1 候选。仅有 [0] & 0xF 的 16 字节保护不是反证。",
  })
}

function lifecycle(source: string, hints: Hint[]) {
  if (!/\bReserve\w*Slot\s*\(/.test(source)) return
  if (!/\bPutTo\w*Q\s*\(/.test(source)) return
  if (!/\bRelease\w*Batch\s*\(/.test(source)) return
  hints.push({
    category: "RESOURCE_LIFECYCLE",
    text: "核对逐项保留的请求槽是否被批量释放提前归还，而队列仍持有这些槽；必须沿保留、入队、释放和消费顺序证明所有权闭环。",
  })
}

function persistence(source: string, hints: Hint[]) {
  const erase = source.search(/\bErase\w*(?:Slot|Block|Page)\s*\(/)
  const write = source.search(/\bWrite\w*(?:Header|Commit|Metadata)\s*\(/)
  if (erase === -1 || write === -1 || erase > write) return
  hints.push({
    category: "UPDATE_PERSISTENCE",
    text: "核对旧有效副本是否在新元数据写入并提交前被擦除；必须证明任意断电点仍至少保留一个可恢复副本。",
  })
}

function escape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
