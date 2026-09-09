import type { Command } from "@/command"
import type { Plugin } from "@chipmate/plugin"

export function specCommand(): Command.Info {
  return {
    name: "spec",
    source: "command",
    subtask: false,
    description: "依据已评审详设开发，在当前对话中确认基线、计划和交付",
    template: "<chipmate-spec-command>\n执行显式文档开发命令。输入资料：$ARGUMENTS",
    hints: ["$ARGUMENTS"],
  }
}

export const SpecPlugin: Plugin = async ({ directory }) => ({
  "command.execute.before": async (input, output) => {
    if (input.command !== "spec") return
    const part = output.parts.find((part) => part.type === "text" && part.text.startsWith("<chipmate-spec-command>\n"))
    if (!part || part.type !== "text") return
    const { load } = await import("./skill")
    // 在现有命令文本上追加指引，保留参数、附件及标准消息生命周期。
    part.text += "\n\n" + (await load(directory))
  },
})
