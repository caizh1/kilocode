import { createHash } from "node:crypto"
import type { ChangeFile, ReviewObligation } from "./types"

type Macro = {
  path: string
  line: number
  name: string
  value: string
  domain?: Domain
  numeric?: bigint
}

type Catalog = {
  macros: Map<string, Macro>
}

type Domain = {
  name: string
  rank: number
  signed: boolean
  bits?: number
  max: string
}

type Variable = {
  domain: Domain
  line: number
}

type Operand = {
  text: string
  domain: Domain
  line?: number
  macro?: Macro
  numeric?: bigint
}

type Input = {
  path: string
  source: string
  signature: string
  start: number
  end: number
  changed: number[]
  catalog: Catalog
}

const types = String.raw`(?:u?int(?:8|16|32|64)_t|size_t|ptrdiff_t|unsigned\s+long\s+long|signed\s+long\s+long|long\s+long|unsigned\s+long|signed\s+long|long|unsigned\s+int|signed\s+int|int|unsigned\s+short|signed\s+short|short|unsigned\s+char|signed\s+char|char)`
const literal = String.raw`(?:0[xX][0-9A-Fa-f]+|[0-9]+)(?:[uU](?:ll|LL|l|L)?|(?:ll|LL|l|L)[uU]?)?`

export function catalog(files: Pick<ChangeFile, "path" | "after">[]): Catalog {
  const macros = new Map<string, Macro>()
  for (const file of files) {
    for (const [index, row] of file.after.split(/\r?\n/).entries()) {
      const match = new RegExp(String.raw`^\s*#\s*define\s+([A-Za-z_]\w*)\s+(${literal})\s*(?:$|//|/\*)`).exec(row)
      if (!match?.[1] || !match[2]) continue
      const parsed = number(match[2])
      macros.set(match[1], {
        path: file.path,
        line: index + 1,
        name: match[1],
        value: match[2],
        ...(parsed.domain ? { domain: parsed.domain } : {}),
        ...(parsed.numeric !== undefined ? { numeric: parsed.numeric } : {}),
      })
    }
  }
  return { macros }
}

export function derive(input: Input): ReviewObligation[] {
  const rows = input.source.split(/\r?\n/)
  const source = rows.slice(input.start - 1, input.end).join("\n")
  const clean = mask(source)
  const vars = variables(clean, input.signature, input.start)
  const values = [...integer(input, clean, vars), ...capacity(input, clean)]
  return unique(values)
}

function integer(input: Input, source: string, vars: Map<string, Variable>): ReviewObligation[] {
  const result: ReviewObligation[] = []
  const target = resultType(input.signature)
  const pattern = /[^;{}]+;/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source))) {
    const statement = match[0].trim()
    const line = input.start + lines(source, match.index + Math.max(0, match[0].search(/\S/)))
    if (!input.changed.includes(line)) continue
    const rhs = value(statement, vars)
    if (!rhs) continue
    const cast = outer(rhs.expression)
    const expression = strip(cast?.expression ?? rhs.expression)
    const product = multiply(expression)
    if (!product) continue
    const left = operand(product.left, vars, input.catalog)
    const right = operand(product.right, vars, input.catalog)
    if (!left || !right) continue
    const operation = common(left.domain, right.domain)
    const sink = cast?.domain ?? rhs.domain ?? (rhs.returned ? target : undefined)
    if (!sink || sink.rank <= operation.rank) continue
    if (!possible(left, right, operation)) continue
    const guard = protection(source.slice(0, match.index), left, right, operation)
    if (guard) continue
    const facts = [`${input.path}:${line} ${statement}`, ...fact(input.path, left), ...fact(input.path, right)]
    result.push({
      id: id("INTEGER_PROMOTION", input.path, line, statement),
      kind: "INTEGER_PROMOTION",
      category: "CONTROL_CONTRACT",
      path: input.path,
      line,
      expression: product.text,
      invariant: `乘法必须在 ${sink.name} 域中执行，或在进入 ${operation.name} 运算前证明两个操作数的乘积不超过 ${operation.max}。`,
      facts: [...new Set(facts)].slice(0, 6),
      guards: [],
      counterexample: example(left, right, operation),
      confidence: "DETERMINISTIC_CANDIDATE",
    })
  }
  return result
}

function capacity(input: Input, source: string): ReviewObligation[] {
  const result: ReviewObligation[] = []
  for (const loop of loops(source)) {
    if (single(loop.condition)) continue
    const body = source.slice(loop.open + 1, loop.close)
    const additions = [
      ...body.matchAll(/\b([A-Za-z_]\w*)\s*\+=\s*([^;]+);/g),
      ...body.matchAll(/\b([A-Za-z_]\w*)\s*=\s*\1\s*\+\s*([^;]+);/g),
    ]
    for (const addition of additions) {
      const sum = addition[1]
      const step = addition[2]?.trim()
      if (!sum || !step) continue
      const before = source.slice(0, loop.start)
      const init = new RegExp(String.raw`\b${escape(sum)}\s*=\s*0(?:[uUlL]*)\s*;`, "g")
      const initializers = [...before.matchAll(init)]
      const initialized = initializers.at(-1)
      if (!initialized) continue
      const guard = itemGuard(body, step)
      if (!guard) continue
      const limit = guard.limit
      if (cumulative(body, sum, step, limit)) continue
      const sink = sinkStatement(body, sum, step)
      if (!sink) continue
      const prefix = body.slice(0, sink.index).replace(/\s+/g, "")
      if (new RegExp(String.raw`\b${escape(sum)}=0(?:[uUlL]*);`).test(prefix)) continue
      const additionIndex = loop.open + 1 + (addition.index ?? 0)
      const sinkIndex = loop.open + 1 + sink.index
      if (sinkIndex > additionIndex) continue
      const guardIndex = loop.open + 1 + guard.start
      const candidates = [
        input.start + lines(source, guardIndex),
        input.start + lines(source, sinkIndex),
        input.start + lines(source, additionIndex),
      ]
      const line = candidates.find((value) => input.changed.includes(value))
      if (!line) continue
      const initIndex = initialized.index ?? 0
      const initLine = input.start + lines(source, initIndex)
      const sinkLine = input.start + lines(source, sinkIndex)
      const addLine = input.start + lines(source, additionIndex)
      const macro = input.catalog.macros.get(limit)
      const facts = [
        `${input.path}:${initLine} ${sum} 从 0 开始累计。`,
        `${input.path}:${line} 现有保护只约束单次 ${step} 不超过 ${limit}。`,
        `${input.path}:${sinkLine} 写入地址使用累计偏移 ${sum}。`,
        `${input.path}:${addLine} 每次循环执行 ${sum} += ${step}。`,
        ...(macro ? [`${macro.path}:${macro.line} ${macro.name} = ${macro.value}。`] : []),
      ]
      result.push({
        id: id("CUMULATIVE_CAPACITY", input.path, line, `${sum}:${step}:${limit}`),
        kind: "CUMULATIVE_CAPACITY",
        category: "MEMORY_SECURITY",
        path: input.path,
        line,
        expression: `${sum} + ${step} <= ${limit}`,
        invariant: `每次写入前必须证明累计偏移 ${sum} 与本次长度 ${step} 之和不超过总容量 ${limit}。`,
        facts: facts.slice(0, 6),
        guards: [`${step} <= ${limit}`],
        counterexample: `循环至少执行两次时，令第一次 ${step} = ${limit}、第二次 ${step} = 1；两次单段检查均可通过，但第二次写入从容量末端之后开始。`,
        confidence: "DETERMINISTIC_CANDIDATE",
      })
    }
  }
  return result
}

function variables(source: string, signature: string, start: number) {
  const result = new Map<string, Variable>()
  const pattern = new RegExp(String.raw`\b(${types})\s+([A-Za-z_]\w*)\b`, "g")
  const text = `${signature};\n${source}`
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    const domain = type(match[1] ?? "")
    const name = match[2]
    if (!domain || !name) continue
    const offset = Math.max(0, match.index - signature.length - 2)
    result.set(name, {
      domain,
      line: start + lines(source, offset),
    })
  }
  return result
}

function value(statement: string, vars: Map<string, Variable>) {
  const returned = /^return\s+(.+);$/s.exec(statement)
  if (returned?.[1]) return { expression: returned[1].trim(), returned: true }
  const declared = new RegExp(String.raw`^(${types})\s+([A-Za-z_]\w*)\s*=\s*(.+);$`, "s").exec(statement)
  if (declared?.[1] && declared[3]) {
    return {
      expression: declared[3].trim(),
      returned: false,
      domain: type(declared[1]),
    }
  }
  const assigned = /^([A-Za-z_]\w*)\s*=\s*(.+);$/s.exec(statement)
  const variable = assigned?.[1] ? vars.get(assigned[1]) : undefined
  if (assigned?.[2] && variable) {
    return {
      expression: assigned[2].trim(),
      returned: false,
      domain: variable.domain,
    }
  }
  return undefined
}
function resultType(signature: string) {
  const name = /\b[A-Za-z_]\w*\s*\(/.exec(signature)
  if (!name) return undefined
  return type(signature.slice(0, name.index))
}

function outer(expression: string) {
  const match = new RegExp(String.raw`^\s*\((${types})\)\s*(\(.+\))\s*$`, "s").exec(expression)
  if (!match?.[1] || !match[2] || !wrapped(match[2])) return undefined
  const domain = type(match[1])
  return domain ? { domain, expression: match[2] } : undefined
}

function multiply(expression: string) {
  let depth = 0
  for (let index = 0; index < expression.length; index++) {
    const char = expression[index]
    if (char === "(" || char === "[") depth++
    if (char === ")" || char === "]") depth--
    if (char !== "*" || depth !== 0) continue
    const left = expression.slice(0, index).trim()
    const right = expression.slice(index + 1).trim()
    if (!left || !right) continue
    return { left, right, text: `${left} * ${right}` }
  }
  return undefined
}

function operand(value: string, vars: Map<string, Variable>, facts: Catalog): Operand | undefined {
  const text = strip(value)
  const cast = new RegExp(String.raw`^\((${types})\)\s*(.+)$`, "s").exec(text)
  if (cast?.[1] && cast[2]) {
    const domain = type(cast[1])
    if (!domain) return undefined
    return { text, domain }
  }
  const variable = vars.get(text)
  if (variable) return { text, ...variable }
  const macro = facts.macros.get(text)
  if (macro?.domain) {
    return {
      text,
      domain: macro.domain,
      macro,
      ...(macro.numeric !== undefined ? { numeric: macro.numeric } : {}),
    }
  }
  const parsed = number(text)
  if (!parsed.domain) return undefined
  return {
    text,
    domain: parsed.domain,
    ...(parsed.numeric !== undefined ? { numeric: parsed.numeric } : {}),
  }
}

function type(value: string): Domain | undefined {
  const name = value
    .replace(/\b(?:const|volatile|static|register|extern)\b/g, "")
    .replace(/\s+/g, " ")
    .trim()
  const exact = /^u?int(8|16|32|64)_t$/.exec(name)
  if (exact?.[1]) {
    const bits = Number(exact[1])
    const signed = !name.startsWith("u")
    return {
      name,
      rank: bits <= 8 ? 1 : bits <= 16 ? 2 : bits <= 32 ? 3 : 5,
      signed,
      bits,
      max: `${name.toUpperCase().replace("_T", "")}_MAX`,
    }
  }
  const values: Record<string, Domain> = {
    "unsigned char": { name: "unsigned char", rank: 1, signed: false, max: "UCHAR_MAX" },
    "signed char": { name: "signed char", rank: 1, signed: true, max: "SCHAR_MAX" },
    char: { name: "char", rank: 1, signed: true, max: "CHAR_MAX" },
    "unsigned short": { name: "unsigned short", rank: 2, signed: false, max: "USHRT_MAX" },
    "signed short": { name: "signed short", rank: 2, signed: true, max: "SHRT_MAX" },
    short: { name: "short", rank: 2, signed: true, max: "SHRT_MAX" },
    "unsigned int": { name: "unsigned int", rank: 3, signed: false, max: "UINT_MAX" },
    "signed int": { name: "signed int", rank: 3, signed: true, max: "INT_MAX" },
    int: { name: "int", rank: 3, signed: true, max: "INT_MAX" },
    "unsigned long": { name: "unsigned long", rank: 4, signed: false, max: "ULONG_MAX" },
    "signed long": { name: "signed long", rank: 4, signed: true, max: "LONG_MAX" },
    long: { name: "long", rank: 4, signed: true, max: "LONG_MAX" },
    "unsigned long long": { name: "unsigned long long", rank: 5, signed: false, max: "ULLONG_MAX" },
    "signed long long": { name: "signed long long", rank: 5, signed: true, max: "LLONG_MAX" },
    "long long": { name: "long long", rank: 5, signed: true, max: "LLONG_MAX" },
    size_t: { name: "size_t", rank: 4, signed: false, max: "SIZE_MAX" },
    ptrdiff_t: { name: "ptrdiff_t", rank: 4, signed: true, max: "PTRDIFF_MAX" },
  }
  return values[name]
}

function number(value: string) {
  if (!new RegExp(`^${literal}$`).test(value)) return {}
  const suffix = /([uUlL]+)$/.exec(value)?.[1]?.toLowerCase() ?? ""
  const raw = suffix ? value.slice(0, -suffix.length) : value
  const numeric = BigInt(raw)
  const domain = suffix.includes("ll")
    ? type(suffix.includes("u") ? "unsigned long long" : "long long")
    : suffix.includes("l")
      ? type(suffix.includes("u") ? "unsigned long" : "long")
      : type(suffix.includes("u") ? "unsigned int" : "int")
  return { domain, numeric }
}

function common(left: Domain, right: Domain) {
  if (left.rank > right.rank) return left
  if (right.rank > left.rank) return right
  if (!left.signed) return left
  return right
}

function possible(left: Operand, right: Operand, domain: Domain) {
  if (left.numeric === 0n || left.numeric === 1n || right.numeric === 0n || right.numeric === 1n) return false
  if (left.numeric !== undefined && right.numeric !== undefined) {
    if (!domain.bits) return false
    const max = domain.signed ? (1n << BigInt(domain.bits - 1)) - 1n : (1n << BigInt(domain.bits)) - 1n
    return left.numeric * right.numeric > max
  }
  return true
}

function protection(source: string, left: Operand, right: Operand, domain: Domain) {
  const pair =
    left.numeric !== undefined
      ? { constant: left, variable: right }
      : right.numeric !== undefined
        ? { constant: right, variable: left }
        : undefined
  if (!pair) return false
  const text = source.replace(/[\s()]+/g, "")
  const guard = `${domain.max}/${pair.constant.text.replace(/\s+/g, "")}`
  const variable = pair.variable.text.replace(/[\s()]+/g, "")
  const index = text.indexOf(`${variable}>${guard}`)
  if (index === -1) return false
  return /(?:return|goto|break)/.test(text.slice(index, index + 200))
}

function example(left: Operand, right: Operand, domain: Domain) {
  const pair =
    left.numeric !== undefined
      ? { constant: left, variable: right }
      : right.numeric !== undefined
        ? { constant: right, variable: left }
        : undefined
  if (pair) {
    return `令 ${pair.variable.text} = ${domain.max} / ${pair.constant.text} + 1；该值通过类型约束，但数学乘积超过 ${domain.max}，随后再转换到宽类型已经无法恢复高位。`
  }
  return `令一个操作数取 ${domain.max}、另一个操作数取 2；若调用路径没有更窄上界，数学乘积超过 ${domain.max}。`
}

function fact(path: string, value: Operand) {
  if (value.macro) return [`${value.macro.path}:${value.macro.line} ${value.macro.name} = ${value.macro.value}。`]
  if (value.line) return [`${path}:${value.line} ${value.text} 的运算类型为 ${value.domain.name}。`]
  return []
}

function loops(source: string) {
  const result: Array<{ start: number; open: number; close: number; condition: string }> = []
  const pattern = /\b(?:for|while)\s*\(/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source))) {
    const paren = source.indexOf("(", match.index)
    const end = close(source, paren, "(", ")")
    if (end === -1) continue
    const open = next(source, end + 1)
    if (source[open] !== "{") continue
    const closed = close(source, open, "{", "}")
    if (closed === -1) continue
    result.push({
      start: match.index,
      open,
      close: closed,
      condition: source.slice(paren + 1, end),
    })
    pattern.lastIndex = closed + 1
  }
  return result
}

function itemGuard(source: string, step: string) {
  const item = step.replace(/\s+/g, "")
  for (const condition of conditions(source)) {
    const dense = condition.text.replace(/\s+/g, "")
    const match = new RegExp(
      String.raw`${escape(item)}>([A-Za-z_]\w*|${literal})|([A-Za-z_]\w*|${literal})<${escape(item)}`,
    ).exec(dense)
    const limit = match?.[1] ?? match?.[2]
    if (!limit) continue
    if (!/\b(?:return|break|goto)\b/.test(source.slice(condition.end + 1, condition.end + 241))) continue
    return { limit, start: condition.start }
  }
  return undefined
}

function cumulative(source: string, sum: string, step: string, limit: string) {
  const item = step.replace(/\s+/g, "")
  const total = `${sum}+${item}`
  const remain = `${limit}-${sum}`
  return conditions(source).some((condition) => {
    const dense = condition.text.replace(/\s+/g, "")
    const guarded =
      dense.includes(`${item}>${remain}`) ||
      dense.includes(`${item}>=${remain}`) ||
      dense.includes(`${remain}<${item}`) ||
      dense.includes(`${remain}<=${item}`) ||
      dense.includes(`${total}>${limit}`) ||
      dense.includes(`${total}>=${limit}`) ||
      dense.includes(`${limit}<${total}`) ||
      dense.includes(`${limit}<=${total}`)
    if (!guarded) return false
    return /\b(?:return|break|goto)\b/.test(source.slice(condition.end + 1, condition.end + 241))
  })
}

function sinkStatement(source: string, sum: string, step: string) {
  const pattern = /[^;{}]+;/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source))) {
    const value = match[0].replace(/\s+/g, "")
    if (!value.includes(`+${sum}`) && !value.includes(`[${sum}]`)) continue
    if (!value.includes(step.replace(/\s+/g, ""))) continue
    if (!/\b[A-Za-z_]\w*\s*\(/.test(match[0])) continue
    return { index: match.index, value: match[0].trim() }
  }
  return undefined
}

function conditions(source: string) {
  const result: Array<{ text: string; start: number; end: number }> = []
  const pattern = /\bif\s*\(/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source))) {
    const open = source.indexOf("(", match.index)
    const end = close(source, open, "(", ")")
    if (end === -1) continue
    result.push({
      text: source.slice(open + 1, end),
      start: match.index,
      end,
    })
    pattern.lastIndex = end + 1
  }
  return result
}

function single(condition: string) {
  const clauses = condition.split(";")
  const test = clauses.length === 3 ? (clauses[1] ?? "") : condition
  return /(?:^|[^\w])(?:[A-Za-z_]\w*)\s*<\s*1(?:[uUlL]*)\b/.test(test)
}

function strip(value: string) {
  let result = value.trim()
  while (wrapped(result)) result = result.slice(1, -1).trim()
  return result
}

function wrapped(value: string) {
  if (!value.startsWith("(") || !value.endsWith(")")) return false
  return close(value, 0, "(", ")") === value.length - 1
}

function close(source: string, start: number, open: string, end: string) {
  let depth = 0
  for (let index = start; index < source.length; index++) {
    if (source[index] === open) depth++
    if (source[index] === end) depth--
    if (depth === 0) return index
  }
  return -1
}

function next(source: string, start: number) {
  for (let index = start; index < source.length; index++) {
    if (!/\s/.test(source[index] ?? "")) return index
  }
  return source.length
}

function mask(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (value) => value.replace(/[^\r\n]/g, " "))
    .replace(/\/\/[^\r\n]*/g, (value) => " ".repeat(value.length))
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, (value) => value.replace(/[^\r\n]/g, " "))
}

function lines(source: string, index: number) {
  return source.slice(0, index).split("\n").length - 1
}

function escape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function id(kind: ReviewObligation["kind"], path: string, line: number, expression: string) {
  return createHash("sha256").update(`${kind}:${path}:${line}:${expression}`).digest("hex").slice(0, 16)
}

function unique(values: ReviewObligation[]) {
  return [...new Map(values.map((value) => [value.id, value])).values()].slice(0, 4)
}
