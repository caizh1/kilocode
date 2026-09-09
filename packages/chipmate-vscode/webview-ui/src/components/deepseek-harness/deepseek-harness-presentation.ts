import type { AssistantBlock } from "@deepseek-ai/dsh-client-runtime/client"

const OPEN = "<think>"
const CLOSE = "</think>"

export type AssistantPresentationBlock =
  | {
      kind: "reasoning"
      key: string
      text: string
      running: boolean
      source: "official" | "think-tag"
    }
  | {
      kind: "content"
      key: string
      block: AssistantBlock
    }

export interface TaggedReasoningSplit {
  reasoning: string
  answer: string
  running: boolean
}

function tagPrefixLength(value: string, tag: string): number {
  const lower = value.toLowerCase()
  const token = tag.toLowerCase()
  const max = Math.min(lower.length, token.length - 1)
  for (let length = max; length > 0; length -= 1) {
    if (lower.endsWith(token.slice(0, length))) return length
  }
  return 0
}

/**
 * 仅把文本块开头的模型思考标签投影成展示数据。返回 undefined 表示
 * 这是普通正文；函数不修改输入，也不承担官方会话或执行状态。
 */
export function splitTaggedReasoning(text: string, running: boolean): TaggedReasoningSplit | undefined {
  const body = text.trimStart()
  if (!body) return undefined

  const lower = body.toLowerCase()
  if (!lower.startsWith(OPEN)) {
    if (running && OPEN.startsWith(lower)) return { reasoning: "", answer: "", running: true }
    return undefined
  }

  const tagged = body.slice(OPEN.length)
  const close = tagged.toLowerCase().indexOf(CLOSE)
  if (close >= 0) {
    return {
      reasoning: tagged.slice(0, close),
      answer: tagged.slice(close + CLOSE.length).trimStart(),
      running: false,
    }
  }

  const prefix = running ? tagPrefixLength(tagged, CLOSE) : 0
  return {
    reasoning: prefix > 0 ? tagged.slice(0, -prefix) : tagged,
    answer: "",
    running,
  }
}

/** 将官方 assistant blocks 转换成非权威、只读的 ChipMate QA 展示序列。 */
export function projectAssistantBlocks(
  nodeId: string,
  blocks: readonly AssistantBlock[],
  running: boolean,
): AssistantPresentationBlock[] {
  const native = blocks.some((block) => block.kind === "reasoning")
  const firstText = native ? -1 : blocks.findIndex((block) => block.kind === "text" && block.text.trim() !== "")
  const last = blocks.length - 1

  return blocks.flatMap((block, index): AssistantPresentationBlock[] => {
    if (block.kind === "reasoning") {
      return [
        {
          kind: "reasoning",
          key: `${nodeId}:${index}:official-reasoning`,
          text: block.text,
          running: running && index === last,
          source: "official",
        },
      ]
    }

    if (index !== firstText || block.kind !== "text") {
      return [{ kind: "content", key: `${nodeId}:${index}:content`, block }]
    }

    const split = splitTaggedReasoning(block.text, running)
    if (!split) return [{ kind: "content", key: `${nodeId}:${index}:content`, block }]

    const projected: AssistantPresentationBlock[] = []
    if (split.reasoning || split.running) {
      projected.push({
        kind: "reasoning",
        key: `${nodeId}:${index}:tagged-reasoning`,
        text: split.reasoning,
        running: split.running,
        source: "think-tag",
      })
    }
    if (split.answer) {
      projected.push({
        kind: "content",
        key: `${nodeId}:${index}:tagged-answer`,
        block: { kind: "text", text: split.answer },
      })
    }
    return projected
  })
}
