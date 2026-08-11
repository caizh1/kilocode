import path from "path"
import { topicTitle } from "./content-contract"
import type { DesignTopicIR, Evidence, EvidencePack } from "./domain"

type Section = "conclusions" | "mechanisms" | "flows" | "exceptions" | "constraints"

const sections: readonly Section[] = ["conclusions", "mechanisms", "flows", "exceptions", "constraints"]

/**
 * 模型只决定源码证据的分组和展示顺序，不拥有可发布事实的措辞。
 * 最终正文完全由已验证的 Evidence.fact/attributes 生成，避免合法 evidenceId
 * 被借来承载源码不存在的安全、网络、持久化或其他业务语义。
 */
export function canonicalizeTopicIR(ir: DesignTopicIR, pack: EvidencePack): DesignTopicIR {
  const title = topicTitle(ir.topic)
  if (ir.applicability !== "applicable") {
    return {
      ...ir,
      title,
      summary:
        ir.applicability === "not-applicable"
          ? `当前源码快照中未发现可以直接证明“${title}”的专用生产代码。`
          : `当前源码证据不足，暂时无法确认“${title}”。`,
      conclusions: [],
      mechanisms: [],
      flows: [],
      exceptions: [],
      constraints: [],
      assumptions: [],
      unknowns: deterministicUnknowns(pack),
    }
  }

  const evidence = new Map(pack.evidence.map((item) => [item.id, item]))
  const locations = new Map<string, Array<{ section: Section; order: number }>>()
  let order = 0
  for (const section of sections) {
    for (const claim of ir[section]) {
      for (const id of claim.evidenceIDs) {
        const current = locations.get(id) ?? []
        current.push({ section, order })
        locations.set(id, current)
      }
      order++
    }
  }
  // 模型只提供可选的分组顺序提示。所有必需证据都由 runtime 补入，模型遗漏、
  // 旧候选引用已淘汰证据或返回空分组，都不能触发新的修复 Session，更不能造成正文缺项。
  for (const id of pack.obligations.filter((item) => item.required).flatMap((item) => item.evidenceIDs)) {
    if (locations.has(id) || !evidence.has(id)) continue
    locations.set(id, [{ section: preferredSection(evidence.get(id)!), order: order++ }])
  }

  const assigned = new Map<Section, Array<{ item: Evidence; order: number }>>(sections.map((section) => [section, []]))
  for (const [id, candidates] of locations) {
    const item = evidence.get(id)
    if (!item || !candidates.length) continue
    // 章节由证据类型确定，模型只保留同一章节内的相对展示顺序。这样同一源码事实
    // 即使被模型分散到“结论/机制/流程”，发布时仍会聚合成一条人类可读事实。
    const selected = candidates.toSorted((left, right) => left.order - right.order)[0]!
    assigned.get(preferredSection(item))!.push({ item, order: selected.order })
  }

  return {
    ...ir,
    title,
    summary: `${readerModuleName(pack.moduleName)} 的“${title}”由以下源码事实构成。`,
    conclusions: canonicalClaims(assigned.get("conclusions") ?? []),
    mechanisms: canonicalClaims(assigned.get("mechanisms") ?? []),
    flows: canonicalClaims(assigned.get("flows") ?? []),
    exceptions: canonicalClaims(assigned.get("exceptions") ?? []),
    constraints: canonicalClaims(assigned.get("constraints") ?? []),
    assumptions: [],
    unknowns: deterministicUnknowns(pack),
  }
}

function preferredSection(item: Evidence): Section {
  if (["error-node", "error-edge", "error-path"].includes(item.kind)) return "exceptions"
  if (["flow-edge", "data-flow", "state-transition"].includes(item.kind)) return "flows"
  if (["flow-node", "call-message", "event-handler"].includes(item.kind)) return "mechanisms"
  if (["guard", "timeout"].includes(item.kind)) return "constraints"
  return "conclusions"
}

function canonicalClaims(values: Array<{ item: Evidence; order: number }>) {
  const groups = new Map<string, Array<{ item: Evidence; order: number }>>()
  for (const value of values) {
    // 同一源码实体的不同证据家族（例如 action 节点与 call-message）属于同一段实现说明，
    // 不应因为静态分析内部分类而拆成连续重复的小段落。
    const key = [value.item.source.path, sourceOwner(value.item)].join("\u0000")
    const group = groups.get(key) ?? []
    group.push(value)
    groups.set(key, group)
  }
  return [...groups.values()]
    .sort((left, right) => {
      const a = left.toSorted(compareCanonicalValue)[0]!
      const b = right.toSorted(compareCanonicalValue)[0]!
      return (
        a.order - b.order ||
        a.item.source.path.localeCompare(b.item.source.path) ||
        a.item.source.startLine - b.item.source.startLine
      )
    })
    .flatMap((group) => {
      const ordered = group.toSorted(compareCanonicalValue)
      const detailed = ordered.map((value) => ({ value, atom: canonicalAtom(value.item) }))
      const atoms = new Map<string, Array<{ item: Evidence; order: number }>>()
      for (const { value, atom } of detailed) {
        const targetName =
          value.item.kind === "call-message"
            ? (stringAttribute(value.item, "label") ?? value.item.fact.match(/调用\s+([A-Za-z_][A-Za-z\d_]*)$/u)?.[1])
            : undefined
        const key = targetName
          ? (detailed.find((candidate) => candidate.value !== value && candidate.atom.includes(`${targetName}(`))
              ?.atom ?? atom)
          : atom
        const current = atoms.get(key) ?? []
        current.push(value)
        atoms.set(key, current)
      }
      return chunks([...atoms.values()], 6).map((chunk) =>
        canonicalClaim(chunk.flatMap((values) => values.map((value) => value.item))),
      )
    })
}

function compareCanonicalValue(left: { item: Evidence; order: number }, right: { item: Evidence; order: number }) {
  return (
    left.order - right.order ||
    left.item.source.startLine - right.item.source.startLine ||
    left.item.id.localeCompare(right.item.id)
  )
}

function canonicalClaim(items: Evidence[]) {
  const ordered = [...items].sort(
    (left, right) => left.source.startLine - right.source.startLine || left.id.localeCompare(right.id),
  )
  const source = path.posix.basename(ordered[0]!.source.path)
  const owner = sourceOwner(ordered[0]!)
  const detailed = ordered.map((item) => ({ item, atom: canonicalAtom(item) }))
  const atoms = [
    ...new Set(
      detailed.flatMap(({ item, atom }) => {
        if (item.kind !== "call-message") return [atom]
        const targetName = stringAttribute(item, "label") ?? item.fact.match(/调用\s+([A-Za-z_][A-Za-z\d_]*)$/u)?.[1]
        if (
          targetName &&
          detailed.some((candidate) => candidate.item !== item && candidate.atom.includes(`${targetName}(`))
        ) {
          return []
        }
        return [atom]
      }),
    ),
  ]
  const subject = owner && owner !== source ? `${source} 的 ${owner}` : source
  const facts = readerAtoms(atoms, owner, source)
  return {
    text: `${subject}：${facts.join("；")}。`,
    evidenceIDs: ordered.map((item) => item.id),
  }
}

function readerAtoms(atoms: string[], owner: string, source: string) {
  const concise = atoms.map((atom) => {
    if (owner && atom.startsWith(`${owner} `)) return atom.slice(owner.length + 1)
    if (atom.startsWith(`${source} `)) return atom.slice(source.length + 1)
    return atom
  })
  const actions = concise.flatMap((atom) => {
    const match = atom.match(/^执行操作（([\s\S]+)）$/u)
    return match ? [match[1]!.replace(/;$/u, "")] : []
  })
  if (actions.length < 2) return concise
  const first = concise.findIndex((atom) => /^执行操作（[\s\S]+）$/u.test(atom))
  return concise.flatMap((atom, index) => {
    if (!/^执行操作（[\s\S]+）$/u.test(atom)) return [atom]
    return index === first ? [`执行以下操作：${actions.join("；")}`] : []
  })
}

function canonicalAtom(item: Evidence) {
  const basename = path.posix.basename(item.source.path)
  const fact = readerFact(sentencePart(item.fact.replaceAll(item.source.path, basename)))
  const detail = evidenceDetail(item)
  if (!detail || fact.includes(detail)) return fact
  return `${fact}（${detail}）`
}

function readerFact(value: string) {
  return value
    .replace(/声明\s+function\b/gu, "声明函数")
    .replace(/声明\s+method\b/gu, "声明方法")
    .replace(/声明\s+struct\b/gu, "声明结构体")
    .replace(/声明\s+enum\b/gu, "声明枚举")
    .replace(/包含\s+action\s+步骤/gu, "执行操作")
    .replace(/包含\s+entry\s+步骤/gu, "作为执行入口")
    .replace(/包含\s+decision\s+步骤/gu, "执行条件判断")
    .replace(/包含\s+return\s+步骤/gu, "返回处理结果")
    .replace(/包含\s+loop\s+步骤/gu, "执行循环")
}

function evidenceDetail(item: Evidence) {
  if (item.kind === "code-symbol") {
    const kind = typeof item.attributes.symbolKind === "string" ? symbolKind(item.attributes.symbolKind) : "源码符号"
    const name = stringAttribute(item, "qualifiedName") ?? stringAttribute(item, "name")
    return name ? `${kind} ${name}` : kind
  }
  if (
    ["flow-node", "flow-edge", "call-message", "data-entity", "data-flow", "error-node", "error-edge"].includes(
      item.kind,
    )
  ) {
    return stringAttribute(item, "label")
  }
  if (item.kind === "state-transition") {
    const from = stringAttribute(item, "from")
    const to = stringAttribute(item, "to")
    const trigger = stringAttribute(item, "trigger")
    const guard = stringAttribute(item, "guard")
    const action = stringAttribute(item, "action")
    const transition = from && to ? `${from} → ${to}` : undefined
    return [
      transition,
      trigger ? `触发：${trigger}` : undefined,
      guard ? `条件：${guard}` : undefined,
      action ? `动作：${action}` : undefined,
    ]
      .filter((value): value is string => Boolean(value))
      .join("；")
  }
  if (item.kind === "dependency") {
    const target = stringAttribute(item, "to")
    return target ? `依赖 ${target}` : undefined
  }
  if (item.kind === "configuration") {
    const key = stringAttribute(item, "key")
    return key ? `配置项 ${key}` : undefined
  }
  return stringAttribute(item, "label") ?? stringAttribute(item, "state")
}

function sourceOwner(item: Evidence) {
  const value = stringAttribute(item, "ownerRef") ?? item.source.symbol ?? stringAttribute(item, "ref")
  if (!value) return path.posix.basename(item.source.path)
  const fragment = value.includes("#") ? value.slice(value.indexOf("#") + 1) : value
  return fragment.split("::", 1)[0]!.replace(/@\d+.*$/u, "")
}

function deterministicUnknowns(pack: EvidencePack) {
  return pack.unknowns
    .filter((value) => !/^(?:topic-|scope-disclosure:|scope-)/u.test(value))
    .map((text) => ({ text, evidenceIDs: [] }))
}

function readerModuleName(value: string | undefined) {
  if (!value || /^MOD-[a-f\d]{20}$/iu.test(value)) return "目标模块"
  return value
}

function stringAttribute(item: Evidence, key: string) {
  const value = item.attributes[key]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function sentencePart(value: string) {
  return value.trim().replace(/[。；;]+$/u, "")
}

function symbolKind(value: string) {
  return (
    {
      function: "函数",
      method: "方法",
      class: "类",
      interface: "接口",
      struct: "结构体",
      enum: "枚举",
      type: "类型",
      variable: "变量",
    }[value] ?? "源码符号"
  )
}

function chunks<T>(values: T[], size: number) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size),
  )
}
