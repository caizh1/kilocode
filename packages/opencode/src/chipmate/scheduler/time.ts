import { DateTime, IANAZone } from "luxon"
import type { ScheduleRule, TaskDefinition } from "@opencode-ai/core/chipmate/scheduler/types"

export function validate(definition: TaskDefinition) {
  if (!definition.name?.trim() || definition.name.length > 120) throw new Error("任务名称须为 1～120 个字符")
  if (!definition.prompt?.trim() || definition.prompt.length > 100_000) throw new Error("任务指令须为 1～100000 个字符")
  if (!IANAZone.isValidZone(definition.timezone)) throw new Error("请选择有效的 IANA 时区")
  if (!definition.agent || !definition.model?.providerID || !definition.model?.modelID)
    throw new Error("必须指定执行 Agent 和模型")
  if (!Number.isInteger(definition.timeoutMinutes) || definition.timeoutMinutes < 1 || definition.timeoutMinutes > 240)
    throw new Error("执行超时须为 1～240 分钟")
  const rule = definition.schedule
  if (!rule) throw new Error("缺少时间规则")
  if (rule.kind === "once" || rule.kind === "interval") {
    const value = rule.kind === "once" ? rule.at : rule.anchor
    if (!/([zZ]|[+-]\d\d:\d\d)$/.test(value) || !DateTime.fromISO(value).isValid)
      throw new Error("日期时间必须包含时区偏移")
  }
  if (rule.kind === "interval" && (!Number.isInteger(rule.minutes) || rule.minutes < 1))
    throw new Error("间隔必须为正整数分钟")
  if (
    rule.kind === "weekly" &&
    (!rule.days.length || rule.days.some((day) => !Number.isInteger(day) || day < 1 || day > 7))
  )
    throw new Error("星期须为 1～7，星期一为 1")
  if (rule.kind === "monthly" && (!Number.isInteger(rule.day) || rule.day < 1 || rule.day > 31))
    throw new Error("日期须为 1～31")
  if ((rule.kind === "weekly" || rule.kind === "monthly") && !/^([01]\d|2[0-3]):[0-5]\d$/.test(rule.time))
    throw new Error("时间格式应为 HH:mm")
}

export function nextTime(rule: ScheduleRule, zone: string, after: number): number | null {
  if (rule.kind === "once") {
    const at = DateTime.fromISO(rule.at).toMillis()
    return at > after ? at : null
  }
  if (rule.kind === "interval") {
    const anchor = DateTime.fromISO(rule.anchor).toMillis()
    const period = rule.minutes * 60_000
    return anchor + Math.max(0, Math.floor((after - anchor) / period) + 1) * period
  }
  const [hour, minute] = rule.time.split(":").map(Number)
  let date = DateTime.fromMillis(after, { zone }).startOf("day")
  for (let offset = 0; offset < 400; offset++) {
    if (
      (rule.kind === "weekly" && rule.days.includes(date.weekday)) ||
      (rule.kind === "monthly" && date.day === rule.day)
    ) {
      const local = date.set({ hour, minute })
      if (local.hour === hour && local.minute === minute) {
        const at = Math.min(...local.getPossibleOffsets().map((item) => item.toMillis()))
        if (at > after) return at
      }
    }
    date = date.plus({ days: 1 })
  }
  return null
}

export function preview(definition: TaskDefinition, now = Date.now()) {
  validate(definition)
  const dates: string[] = []
  let cursor = now
  for (let count = 0; count < 5; count++) {
    const next = nextTime(definition.schedule, definition.timezone, cursor)
    if (next === null) break
    dates.push(DateTime.fromMillis(next, { zone: definition.timezone }).toISO()!)
    cursor = next
  }
  return dates
}
