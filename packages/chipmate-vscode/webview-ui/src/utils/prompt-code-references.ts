/** 识别沿用的 ADD_TO_CONTEXT 文本格式；摘要从草稿正文派生，撤销和切换后不会残留。 */
export function promptCodeReferences(text: string) {
  const pattern = /^(.+):(\d+)-(\d+)\n```[^\n]*\n[\s\S]*?\n```/gm
  return [...text.matchAll(pattern)].map((match) => ({
    path: match[1],
    label: `${match[1]}:${match[2]}-${match[3]}`,
    start: match.index,
    end: match.index + match[0].length,
    text: match[0],
  }))
}
