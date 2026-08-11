import { ChipMateMarkdown } from "../config/markdown"

export namespace ChipMateInstruction {
  export function content(text: string, item: string, options: ChipMateMarkdown.Options) {
    return ChipMateMarkdown.substitute(text, item, options)
  }

  export async function read(item: string, options: ChipMateMarkdown.Options) {
    return content(await ChipMateMarkdown.read(item, options), item, options)
  }
}
