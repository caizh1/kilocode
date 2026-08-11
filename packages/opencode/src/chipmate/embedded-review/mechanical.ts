import path from "node:path"
import type { ChangeFile, Rule, RulePack, StandardFinding } from "./types"

type Check = (file: ChangeFile, rule: Rule, version: string) => StandardFinding[]

const generated = /(^|\/)(generated|gen|vendor|third[_-]?party|external|build|dist)(\/|$)/i

const checks: Record<string, Check> = {
  "C-011": parens,
  "C-014": trailing,
  "C-015": assignments,
  "C-018": postfix,
  "C-035": braces,
  "C-038": guards,
}

export function mechanicalRuleIds() {
  return Object.keys(checks)
}

export function runMechanical(files: ChangeFile[], pack: RulePack) {
  const active = pack.rules.filter((rule) => rule.level === "MUST" && rule.check === "mechanical")
  const supported = active.filter((rule) => checks[rule.id] && rule.exceptions.length === 0)
  const findings = supported.flatMap((rule) =>
    files.flatMap((file) => {
      const check = checks[rule.id]
      if (!check) return []
      if (!rule.languages.includes(language(file.path))) return []
      return check(file, rule, pack.version)
    }),
  )
  return {
    findings,
    evaluatedRuleIds: supported.map((rule) => rule.id),
    unsupportedRuleIds: active.filter((rule) => !checks[rule.id] || rule.exceptions.length > 0).map((rule) => rule.id),
  }
}

function trailing(file: ChangeFile, rule: Rule, version: string) {
  return changed(file).flatMap(({ line, code }) => {
    if (!/[ \t]+$/.test(code)) return []
    return [finding(file, rule, version, line, code, "行尾包含无意义的空格或制表符。")]
  })
}

function parens(file: ChangeFile, rule: Rule, version: string) {
  return changed(file).flatMap(({ line, code }) => {
    const masked = mask(code)
    if (/\(\s+[^)\s]/.test(masked) || /[^(\s]\s+\)/.test(masked)) {
      return [finding(file, rule, version, line, code, "括号内侧包含多余空格。")]
    }
    if (/\belse\b/.test(masked) && masked.trim() !== "else") {
      return [finding(file, rule, version, line, code, "`else` 没有独占一行。")]
    }
    return []
  })
}

function assignments(file: ChangeFile, rule: Rule, version: string) {
  return changed(file).flatMap(({ line, code }) => {
    const masked = mask(code)
    const operators = [...masked.matchAll(/(?:<<=|>>=|[+\-*/%&|^]?=)/g)]
    for (const match of operators) {
      const op = match[0]
      const index = match.index
      if (op === "=" && (masked[index - 1] === "=" || masked[index + 1] === "=")) continue
      if (op === "=" && ["!", "<", ">"].includes(masked[index - 1] ?? "")) continue
      if (
        masked[index - 1] !== " " ||
        masked[index - 2] === " " ||
        masked[index + op.length] !== " " ||
        masked[index + op.length + 1] === " "
      ) {
        return [finding(file, rule, version, line, code, `赋值运算符 \`${op}\` 两侧没有各保留一个空格。`)]
      }
    }
    return []
  })
}

function postfix(file: ChangeFile, rule: Rule, version: string) {
  return changed(file).flatMap(({ line, code }) => {
    const masked = mask(code)
    const calls = [...masked.matchAll(/\b([A-Za-z_]\w*)\s+\(/g)].some(
      (match) => !["if", "for", "while", "switch", "sizeof", "alignof", "return"].includes(match[1] ?? ""),
    )
    const conflict =
      /\b[A-Za-z_]\w*\s+\[/.test(masked) ||
      /(?:\w|\])\s+(?:\.|->)/.test(masked) ||
      /(?:\.|->)\s+\w/.test(masked) ||
      calls
    if (!conflict) return []
    return [finding(file, rule, version, line, code, "数组索引、成员访问或函数调用与其操作数之间存在空白。")]
  })
}

function braces(file: ChangeFile, rule: Rule, version: string) {
  if (generated.test(file.path)) return []
  return changed(file).flatMap(({ line, code }) => {
    const masked = mask(code)
    const trimmed = masked.trim()
    if (trimmed === "{" || trimmed === "}") return []
    if (/^\s*#/.test(masked)) return []
    const open = /(?:\)|\b(?:else|do|try))\s*\{/.test(masked)
    const close = /\}\s*(?:else|while|catch|[A-Za-z_])/.test(masked)
    if (!open && !close) return []
    return [
      finding(
        file,
        rule,
        version,
        line,
        code,
        "程序块大括号没有独占一行。",
        "该路径不属于生成、供应商、第三方、外部、构建或发布目录。",
      ),
    ]
  })
}

function guards(file: ChangeFile, rule: Rule, version: string) {
  if (![".h", ".hh", ".hpp", ".hxx"].includes(path.extname(file.path).toLowerCase())) return []
  if (file.status === "deleted" || generated.test(file.path)) return []
  const source = strip(file.after)
  if (/^\s*#\s*pragma\s+once\b/m.test(source)) return []
  const open = source.match(/^\s*#\s*ifndef\s+([A-Za-z_]\w*)\s*$/m)
  const define = open ? new RegExp(`^\\s*#\\s*define\\s+${escape(open[1])}\\b`, "m").test(source) : false
  const close = /^\s*#\s*endif\b/m.test(source)
  if (open && define && close) return []
  const line = file.changedLines[0]
  if (!line) return []
  return [
    finding(
      file,
      rule,
      version,
      line,
      source.split(/\r?\n/)[line - 1] ?? "",
      "变更的头文件既没有 `#pragma once`，也没有匹配的 `#ifndef`/`#define` 头文件保护。",
      "该文件是已变更头文件，且路径不属于生成目录或受控第三方目录。",
    ),
  ]
}

function changed(file: ChangeFile) {
  const lines = file.after.split(/\r?\n/)
  return file.changedLines.map((line) => ({ line, code: lines[line - 1] ?? "" }))
}

function finding(
  file: ChangeFile,
  rule: Rule,
  version: string,
  line: number,
  code: string,
  violation: string,
  exceptionCounterevidence = "已发布规则未声明可自动适用于此变更行的例外。",
): StandardFinding {
  return {
    track: "STANDARD",
    ruleId: rule.id,
    ruleVersion: version,
    path: file.path,
    line,
    violation,
    code,
    exceptionCounterevidence,
  }
}

function language(file: string): "c" | "cpp" {
  return [".cc", ".hh", ".cpp", ".hpp", ".cxx", ".hxx", ".inl"].includes(path.extname(file).toLowerCase()) ? "cpp" : "c"
}

function mask(value: string) {
  return value
    .replace(/"(?:\\.|[^"\\])*"/g, (match) => " ".repeat(match.length))
    .replace(/'(?:\\.|[^'\\])*'/g, (match) => " ".repeat(match.length))
    .replace(/\/\/.*$/, (match) => " ".repeat(match.length))
}

function strip(value: string) {
  return value.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
}

function escape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
