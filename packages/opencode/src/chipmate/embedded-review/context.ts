import { createHash } from "node:crypto"
import { parseCodeGraphFile } from "@chipmate/chipmate-indexing/codegraph-parser"
import { logicHints } from "./hints"
import { catalog, derive } from "./obligations"
import { logicProfiles } from "./risks"
import type { ChangeFile, ReviewPacket, Rule } from "./types"

const MAX_FUNCTION_LINES = 300
const MAX_RELATED_LINES = 180
const MAX_RELATED = 6
const MAX_RULES = 3

export function packets(files: ChangeFile[], rules: Rule[]): ReviewPacket[] {
  const facts = catalog(files)
  const snaps = files.map((file) => ({
    file,
    after: graph(file.path, file.after),
    before: graph(file.previousPath ?? file.path, file.before),
  }))
  const result = snaps.flatMap((snap) =>
    snap.file.hunks.flatMap((hunk) => {
      const lines = hunk.changed.flatMap((line) => (line.next ? [line.next] : []))
      if (!lines.length) return []
      const parsed = snap.after
      const fns =
        parsed?.functions.filter((fn) => lines.some((line) => line >= fn.startLine && line <= fn.endLine)) ?? []
      const targets = fns.length ? fns : [undefined]
      return targets.map((fn) => {
        const changed = fn
          ? lines.filter((line) => line >= fn.startLine && line <= fn.endLine)
          : lines.filter((line) => !fns.some((item) => line >= item.startLine && line <= item.endLine))
        const body = fn ? slice(snap.file.after, fn.startLine, fn.endLine, MAX_FUNCTION_LINES) : ""
        const related = fn
          ? neighbors(
              fn.name,
              fn.calls.map((call) => call.calleeName),
              body,
              snaps,
            )
          : []
        const diff = fn ? section(hunk, fn.startLine, fn.endLine) : [hunk.header, ...hunk.lines].join("\n")
        const narrow = [diff, body].join("\n")
        const code = [narrow, ...related.map((item) => item.source)].join("\n")
        const selected = select(rules, code)
        const calls =
          fn?.calls.slice(0, 24).map((call) => ({
            callee: call.calleeName,
            line: call.startLine,
            args: call.args,
            ...(call.returnHandling ? { returnHandling: call.returnHandling } : {}),
          })) ?? []
        const macros =
          parsed?.macros
            .filter((macro) => body.includes(macro.name) || hunk.lines.some((line) => line.includes(macro.name)))
            .slice(0, 16)
            .map((macro) => ({
              name: macro.name,
              line: macro.startLine,
              ...(macro.shortSnippet ? { snippet: macro.shortSnippet } : {}),
            })) ?? []
        const types =
          parsed?.types
            .filter((type) => body.includes(type.name) || hunk.lines.some((line) => line.includes(type.name)))
            .slice(0, 16)
            .map((type) => ({
              name: type.name,
              kind: type.kind,
              line: type.startLine,
              ...(type.shortSnippet ? { snippet: type.shortSnippet } : {}),
            })) ?? []
        return {
          path: snap.file.path,
          hunk: diff,
          changedLines: changed,
          ...(fn
            ? {
                function: {
                  name: fn.name,
                  signature: fn.signature,
                  startLine: fn.startLine,
                  endLine: fn.endLine,
                  source: body,
                  calls,
                },
              }
            : {}),
          relatedFunctions: related,
          macros,
          types,
          rules: selected,
          logicProfiles: logicProfiles({
            source: code,
            calls: [...calls.map((call) => call.callee), ...related.map((item) => item.name)],
            macros: macros.map((macro) => macro.name),
            types: types.map((type) => type.name),
          }),
          logicHints: fn ? logicHints(narrow) : [],
          obligations: fn
            ? derive({
                path: snap.file.path,
                source: snap.file.after,
                signature: fn.signature,
                start: fn.startLine,
                end: fn.endLine,
                changed,
                catalog: facts,
              })
            : [],
        }
      })
    }),
  )
  return merge(result)
}

function graph(file: string, content: string) {
  if (!content) return undefined
  return parseCodeGraphFile({
    workspacePath: "",
    filePath: file,
    content,
    fileHash: createHash("sha256").update(content).digest("hex"),
  })
}

function neighbors(
  name: string,
  calls: string[],
  source: string,
  snaps: Array<{ file: ChangeFile; after: ReturnType<typeof graph> }>,
): ReviewPacket["relatedFunctions"] {
  const result: ReviewPacket["relatedFunctions"] = []
  const seen = new Set<string>()
  const add = (
    snap: (typeof snaps)[number],
    fn: NonNullable<ReturnType<typeof graph>>["functions"][number],
    relation: "callee" | "caller" | "shared",
  ) => {
    const key = `${snap.file.path}:${fn.startLine}`
    if (seen.has(key) || fn.name === name || result.length >= MAX_RELATED) return
    seen.add(key)
    result.push({
      path: snap.file.path,
      name: fn.name,
      signature: fn.signature,
      startLine: fn.startLine,
      endLine: fn.endLine,
      source: slice(snap.file.after, fn.startLine, fn.endLine, MAX_RELATED_LINES),
      relation,
    })
  }
  const globals = [...new Set(source.match(/\bg_[A-Za-z_]\w*\b/g) ?? [])]
  for (const global of globals) {
    for (const snap of snaps) {
      for (const fn of snap.after?.functions ?? []) {
        const body = slice(snap.file.after, fn.startLine, fn.endLine, MAX_RELATED_LINES)
        if (new RegExp(`\\b${global}\\b`).test(body)) add(snap, fn, "shared")
      }
    }
  }
  for (const callee of calls) {
    for (const snap of snaps) {
      const fn = snap.after?.functions.find((item) => item.name === callee)
      if (fn) add(snap, fn, "callee")
    }
  }
  for (const snap of snaps) {
    for (const fn of snap.after?.functions ?? []) {
      if (fn.calls.some((call) => call.calleeName === name)) add(snap, fn, "caller")
    }
  }
  return result
}

function slice(source: string, start: number, end: number, limit: number) {
  return source
    .split(/\r?\n/)
    .slice(start - 1, end)
    .slice(0, limit)
    .join("\n")
}

function section(hunk: ChangeFile["hunks"][number], start: number, end: number) {
  const rows: string[] = []
  let old = hunk.oldStart
  let next = hunk.nextStart
  for (const line of hunk.lines) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      if (next >= start && next <= end) rows.push(line)
      next++
      continue
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      if (old >= start && old <= end) rows.push(line)
      old++
      continue
    }
    if (line.startsWith("\\")) {
      if (rows.length) rows.push(line)
      continue
    }
    if ((next >= start && next <= end) || (old >= start && old <= end)) rows.push(line)
    old++
    next++
  }
  return [hunk.header, ...rows].join("\n")
}

function merge(values: ReviewPacket[]) {
  const hunks = group(values, (packet) => `${packet.path}:${packet.hunk.split("\n")[0]}`)
  const combined = group(hunks, (packet, index) =>
    packet.function
      ? `${packet.path}:${packet.function.startLine}:${packet.function.endLine}`
      : `${packet.path}:hunk:${index}`,
  )
  return combined.map((packet) => ({
    ...packet,
    relatedFunctions: uniqueBy(packet.relatedFunctions, (fn) => `${fn.path}:${fn.startLine}`)
      .filter((fn) => !packet.function || fn.path !== packet.path || fn.startLine !== packet.function.startLine)
      .toSorted((left, right) => (left.relation === "changed" ? -1 : right.relation === "changed" ? 1 : 0))
      .slice(0, MAX_RELATED),
  }))
}

function group(values: ReviewPacket[], key: (packet: ReviewPacket, index: number) => string) {
  const result = new Map<string, ReviewPacket>()
  for (const [index, packet] of values.entries()) {
    const id = key(packet, index)
    const found = result.get(id)
    if (!found) {
      result.set(id, packet)
      continue
    }
    absorb(found, packet)
  }
  return [...result.values()]
}

function absorb(found: ReviewPacket, packet: ReviewPacket) {
  const replace = packet.function && packet.logicHints.length > found.logicHints.length
  if (replace && found.function) found.relatedFunctions.push(related(found.path, found.function))
  if (!replace && packet.function) found.relatedFunctions.push(related(packet.path, packet.function))
  if (replace) found.function = packet.function
  found.hunk = unique([found.hunk, packet.hunk]).join("\n")
  found.changedLines = [...new Set([...found.changedLines, ...packet.changedLines])].toSorted(
    (left, right) => left - right,
  )
  found.relatedFunctions.push(...packet.relatedFunctions)
  found.macros = uniqueBy([...found.macros, ...packet.macros], (macro) => `${macro.name}:${macro.line}`)
  found.types = uniqueBy([...found.types, ...packet.types], (type) => `${type.name}:${type.line}`)
  found.rules = uniqueBy([...found.rules, ...packet.rules], (rule) => rule.id).slice(0, MAX_RULES)
  found.logicProfiles = uniqueBy(
    [...found.logicProfiles, ...packet.logicProfiles],
    (profile) => profile.category,
  ).slice(0, 2)
  found.logicHints = unique([...found.logicHints, ...packet.logicHints]).slice(0, 3)
  found.obligations = uniqueBy([...found.obligations, ...packet.obligations], (item) => item.id).slice(0, 4)
}

function related(path: string, fn: NonNullable<ReviewPacket["function"]>) {
  return {
    path,
    name: fn.name,
    signature: fn.signature,
    startLine: fn.startLine,
    endLine: fn.endLine,
    source: fn.source,
    relation: "changed" as const,
  }
}

function unique(values: string[]) {
  return [...new Set(values)]
}

function uniqueBy<T>(values: T[], key: (value: T) => string) {
  return [...new Map(values.map((value) => [key(value), value])).values()]
}

function select(rules: Rule[], source: string) {
  const semantic = rules.filter((rule) => rule.level === "MUST" && rule.check === "semantic")
  const features = {
    pointer: /(?:->|\*\s*[A-Za-z_]|NULL|nullptr)/.test(source),
    array: /(?:\[[^\]]*\]|\bmem(?:cpy|move|set)\b|\bstr(?:cpy|ncpy|cat|ncat)\b)/.test(source),
    state: /\b(state|status|mode|phase|transition)\b/i.test(source),
    unit: /\b(ms|us|ns|hz|khz|mhz|byte|word|bit|len|size|count|timeout)\b/i.test(source),
    endian: /\b(endian|bswap|hton|ntoh|le\d+|be\d+)\b/i.test(source),
    resource: /\b(alloc|free|open|close|lock|unlock|enable|disable|init|deinit)\b/i.test(source),
    error: /\b(err|error|fail|return|goto|cleanup)\b/i.test(source),
    register: /\b(reg(?:ister)?|mmio|volatile|readl|writel)\b/i.test(source),
    macro: /^\s*#\s*(?:define|if|ifdef|ifndef|elif)\b/m.test(source),
    loop: /\b(?:for|while|do)\s*(?:\(|\{)/.test(source),
  }
  const terms = Object.entries(features)
    .filter((entry) => entry[1])
    .map((entry) => entry[0])
  const ids = new Set(["C-043", "C-044", "C-053"])
  if (features.pointer) ["C-005", "C-036", "C-045", "C-048", "C-107"].forEach((id) => ids.add(id))
  if (features.array) ["C-008", "C-030", "C-045", "C-053", "C-106"].forEach((id) => ids.add(id))
  if (features.state) ["C-007", "C-032", "C-033", "C-051", "C-053", "C-109"].forEach((id) => ids.add(id))
  if (features.unit || features.endian) ["C-023", "C-024", "C-048", "C-054", "C-105"].forEach((id) => ids.add(id))
  if (features.resource) ["C-045", "C-108"].forEach((id) => ids.add(id))
  if (features.error) ["C-043", "C-044", "C-047", "C-053"].forEach((id) => ids.add(id))
  if (features.register) ["C-050", "C-109", "C-110"].forEach((id) => ids.add(id))
  if (features.macro) ids.add("C-046")
  if (features.loop) ["C-103", "C-104"].forEach((id) => ids.add(id))
  const selected = [...ids].flatMap((id) => {
    const rule = semantic.find((item) => item.id === id)
    return rule ? [rule] : []
  })
  const ranked = semantic
    .filter((rule) => !ids.has(rule.id))
    .toSorted((left, right) => score(right, terms) - score(left, terms))
  return [...selected, ...ranked].slice(0, MAX_RULES)
}

function score(rule: Rule, terms: string[]) {
  const text = [rule.title, rule.description, ...rule.appliesTo].join(" ").toLowerCase()
  return terms.reduce((total, term) => total + (text.includes(term) ? 1 : 0), 0)
}
