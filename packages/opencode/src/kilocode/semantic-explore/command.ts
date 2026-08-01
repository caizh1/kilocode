import type { Command } from "@/command"
import PROMPT from "./prompt.txt"

export const name = "semantic-explore"

export function semanticExploreCommand(): Command.Info {
  return {
    name,
    description: "使用语义检索探索未知实现，并用精确搜索验证",
    agent: "explore",
    source: "command",
    template: PROMPT,
    hints: ["$ARGUMENTS"],
  }
}
