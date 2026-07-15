import type { SkillSummary } from "@chipmate/market-contracts"
import { icon } from "./shared"

type Item = Pick<SkillSummary, "id" | "category" | "artwork">
type Group = keyof typeof pools

const pools = {
  documents: [
    "/assets/skill-icons/docs-quill.webp",
    "/assets/skill-icons/docs-book.webp",
    "/assets/skill-icons/docs-evidence.webp",
    "/assets/skill-icons/docs-diagram.webp",
    "/assets/skill-icons/docs-folder.webp",
  ],
  development: [
    "/assets/skill-icons/dev-code.webp",
    "/assets/skill-icons/dev-api.webp",
    "/assets/skill-icons/dev-chip.webp",
    "/assets/skill-icons/dev-architecture.webp",
    "/assets/skill-icons/dev-terminal.webp",
  ],
  testing: [
    "/assets/skill-icons/test-flask.webp",
    "/assets/skill-icons/test-shield.webp",
    "/assets/skill-icons/test-search.webp",
    "/assets/skill-icons/test-bug.webp",
    "/assets/skill-icons/test-gauge.webp",
  ],
  operations: [
    "/assets/skill-icons/ops-rocket.webp",
    "/assets/skill-icons/ops-cloud.webp",
    "/assets/skill-icons/ops-database.webp",
    "/assets/skill-icons/ops-gear.webp",
    "/assets/skill-icons/ops-release.webp",
  ],
} as const

const groups = Object.keys(pools) as Group[]
const featured = new Set(["source-backed-detail-design"])

function hash(value: string) {
  return [...value].reduce((code, char) => Math.imul(code ^ char.codePointAt(0)!, 16_777_619), 2_166_136_261) >>> 0
}

function group(value: string): Group {
  const key = value.trim().toLowerCase() as Group
  if (key in pools) return key
  return groups[hash(key) % groups.length]!
}

export function art(item: Pick<Item, "id" | "category">) {
  if (featured.has(item.id)) return icon
  const key = group(item.category)
  const choices = pools[key]
  return choices[hash(`${key}:${item.id}:skill`) % choices.length]!
}

export function image(item: Item) {
  return item.artwork?.url ?? art(item)
}

export function repair(event: { currentTarget: HTMLImageElement }, item: Pick<Item, "id" | "category">) {
  event.currentTarget.onerror = null
  event.currentTarget.src = art(item)
}
