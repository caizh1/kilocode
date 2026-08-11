import type { LogicCategory, LogicProfile } from "./types"

const checks: Record<LogicCategory, string[]> = {
  CONTROL_CONTRACT: [
    "检查条件与后续使用、状态迁移、返回值契约是否矛盾。",
    "检查单位、端序、位宽、边界以及调用方与被调方契约。",
  ],
  MEMORY_SECURITY: [
    "检查数组、指针、长度、整数转换和内存操作是否存在可达的越界或破坏。",
    "检查不可信输入进入危险内存操作前是否有完整约束。",
  ],
  REALTIME_CONCURRENCY: [
    "检查中断上下文中的阻塞、无限循环、不可接受延迟和非原子共享状态。",
    "检查锁、中断、原子操作和临界区是否在所有路径成对恢复。",
  ],
  RESOURCE_LIFECYCLE: [
    "检查内存、句柄、锁、时钟、外设和启停操作是否在成功及错误路径闭环。",
    "检查重复释放、释放后使用以及初始化失败后的逆序清理。",
  ],
  UPDATE_PERSISTENCE: [
    "检查 Bootloader、OTA、Flash、NVM、配置和 ABI 变更的兼容、校验与回滚。",
    "检查断电窗口、提交顺序、版本迁移、双副本和持久化完整性。",
  ],
}

const order: LogicCategory[] = [
  "MEMORY_SECURITY",
  "REALTIME_CONCURRENCY",
  "RESOURCE_LIFECYCLE",
  "UPDATE_PERSISTENCE",
  "CONTROL_CONTRACT",
]

type Input = {
  source: string
  calls?: string[]
  macros?: string[]
  types?: string[]
}

export function logicProfiles(input: Input): LogicProfile[] {
  const source = [input.source, ...(input.calls ?? []), ...(input.macros ?? []), ...(input.types ?? [])].join("\n")
  const scores = new Map<LogicCategory, { score: number; signals: string[] }>()
  const add = (category: LogicCategory, score: number, signal: string) => {
    const current = scores.get(category) ?? { score: 0, signals: [] }
    current.score += score
    if (!current.signals.includes(signal)) current.signals.push(signal)
    scores.set(category, current)
  }
  match(
    source,
    /(?:->|\*\s*[A-Za-z_]|\[[^\]]*\]|\b\w*ptr\w*\b|\b(?:memcpy|memmove|memset|strcpy|strcat|snprintf|read_bytes|copy_bounded|copy_checked)\b)/i,
    () => add("MEMORY_SECURITY", 4, "检测到指针、数组或内存操作"),
  )
  match(source, /\b(?:malloc|calloc|realloc)\b[^\n;]*(?:sizeof|size|count|len|length)/i, () =>
    add("MEMORY_SECURITY", 3, "检测到按大小分配或调整内存"),
  )
  match(source, /\b(?:malloc|calloc|realloc)\b/i, () => add("MEMORY_SECURITY", 3, "检测到动态内存分配操作"))
  match(source, /\b(?:len|length|size|count|index|offset|capacity|bounds?|overflow|underflow)\b/i, () =>
    add("MEMORY_SECURITY", 2, "检测到长度、索引或容量数据"),
  )
  match(source, /\b(?:uint\d+_t|int\d+_t|size_t|uintptr_t)\b|(?:<<|>>)/i, () =>
    add("MEMORY_SECURITY", 1, "检测到位宽转换或移位"),
  )

  match(
    source,
    /\b(?:irq|isr|interrupt|critical|atomic|mutex|spinlock|semaphore|lock|unlock)\w*\b|\b\w*_(?:irq|isr)\w*\b/i,
    () => add("REALTIME_CONCURRENCY", 4, "检测到中断、原子或同步操作"),
  )
  match(source, /\b(?:memory_barrier|barrier|doorbell)\w*\b/i, () =>
    add("REALTIME_CONCURRENCY", 3, "检测到硬件发布顺序或内存屏障"),
  )
  match(source, /\b(?:now_ticks|deadline_ticks|tick_count|tick_deadline)\b/i, () =>
    add("REALTIME_CONCURRENCY", 3, "检测到系统节拍与截止时间比较"),
  )
  match(source, /\b(?:delay|sleep|wait|yield|poll|busy|blocking)\w*\b|\b(?:for|while|do)\s*(?:\(|\{)/i, () =>
    add("REALTIME_CONCURRENCY", 2, "检测到等待、阻塞或循环"),
  )
  match(source, /\bvolatile\w*\b|\b(?:shared|atomic)\w*\b[^\n;]*(?:\+\+|--|[|&^]=)/i, () =>
    add("REALTIME_CONCURRENCY", 1, "检测到共享状态或复合更新"),
  )

  match(source, /\b(?:alloc|malloc|calloc|realloc|free|open|close|acquire|release|lock|unlock)\w*\b/i, () =>
    add("RESOURCE_LIFECYCLE", 4, "检测到资源获取或释放"),
  )
  match(
    source,
    /\b(?:init|deinit|enable|disable|start|stop|clock|power|device|handle)\w*\b|\b\w*_(?:init|deinit|enable|disable|start|stop|get|put)\w*\b/i,
    () => add("RESOURCE_LIFECYCLE", 2, "检测到组件、时钟或外设生命周期"),
  )
  match(source, /\b\w*_(?:owned|ownership)\w*\b/i, () => add("RESOURCE_LIFECYCLE", 3, "检测到资源所有权或所有权转移"))
  match(source, /\b(?:goto\s+cleanup|cleanup|error|fail|return)\b/i, () =>
    add("RESOURCE_LIFECYCLE", 1, "检测到错误退出或清理路径"),
  )

  match(
    source,
    /\b(?:boot|bootloader|ota|firmware|fw_(?:update|upgrade)|upgrade|rollback|image_(?:update|install|header)|install_image|slot|bank)\w*\b/i,
    () => add("UPDATE_PERSISTENCE", 4, "检测到启动、升级、分区或回滚逻辑"),
  )
  match(source, /\b(?:flash|nvm|eeprom|persist|storage|config|journal|commit|crc|checksum)\w*\b/i, () =>
    add("UPDATE_PERSISTENCE", 3, "检测到持久化、校验或提交操作"),
  )
  match(
    source,
    /\b(?:version|schema|layout|abi|migrate|generation|sequence|magic)\w*\b|\b\w*_(?:version|schema|abi)\w*\b/i,
    () => add("UPDATE_PERSISTENCE", 2, "检测到版本、布局或迁移数据"),
  )

  match(source, /\b(?:state|status|mode|phase|transition|result)\b/i, () =>
    add("CONTROL_CONTRACT", 4, "检测到状态或结果契约"),
  )
  match(source, /\b(?:if|switch|case|return|error)\b/i, () => add("CONTROL_CONTRACT", 2, "检测到条件或返回值控制"))
  match(
    source,
    /\b(?:ms|us|ns|hz|khz|mhz|byte|word|bit|timeout|endian|bswap|hton|ntoh|le\d+|be\d+)\b|\b\w*_(?:bit|mask)\b/i,
    () => add("CONTROL_CONTRACT", 3, "检测到单位、端序、超时或位语义"),
  )
  match(source, /\b[A-Za-z_]\w*\s*\([^;{}]*\)/, () => add("CONTROL_CONTRACT", 1, "检测到函数调用契约"))

  if (!scores.size) add("CONTROL_CONTRACT", 1, "默认检查控制流与调用契约")
  return order
    .flatMap((category) => {
      const value = scores.get(category)
      return value ? [{ category, ...value }] : []
    })
    .toSorted((left, right) => right.score - left.score || order.indexOf(left.category) - order.indexOf(right.category))
    .slice(0, 2)
    .map((value) => ({
      category: value.category,
      signals: value.signals.slice(0, 3),
      checks: checks[value.category],
    }))
}

function match(source: string, pattern: RegExp, found: () => void) {
  if (pattern.test(source)) found()
}
