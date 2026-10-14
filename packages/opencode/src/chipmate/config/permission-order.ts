import { applyEdits, modify, parse } from "jsonc-parser"

/** 显式修改工具规则后放到通配规则之后，与运行时后匹配优先保持一致。 */
export function orderPermissions(input: string, patch: Record<string, unknown>): string {
  if (!patch.permission || typeof patch.permission !== "object" || Array.isArray(patch.permission)) return input
  const config = parse(input)
  const current = config?.permission
  if (!current || typeof current !== "object" || Array.isArray(current)) return input
  const rules = { ...current }
  for (const key of Object.keys(patch.permission)) {
    if (key === "*" || !Object.hasOwn(rules, key)) continue
    const value = rules[key]
    delete rules[key]
    rules[key] = value
  }
  if (JSON.stringify(Object.keys(rules)) === JSON.stringify(Object.keys(current))) return input
  return applyEdits(
    input,
    modify(input, ["permission"], rules, { formattingOptions: { insertSpaces: true, tabSize: 2 } }),
  )
}
