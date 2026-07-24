type Row = {
  text: string
  eol: string
}

type Open = {
  mark: string
  prefix: string
}

const START = /^[ \t]{0,3}@startuml(?:[ \t]+.*)?[ \t]*$/i
const END = /^[ \t]{0,3}@enduml[ \t]*$/i
const OPEN = /^([ \t]{0,3})(`{3,}|~{3,}).*$/

function rows(input: string) {
  return (input.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) ?? []).filter(Boolean).map((raw): Row => {
    const match = raw.match(/(\r\n|\r|\n)$/)
    const eol = match?.[1] ?? ""
    return { text: eol ? raw.slice(0, -eol.length) : raw, eol }
  })
}

function open(row: Row): Open | undefined {
  const match = row.text.match(OPEN)
  const mark = match?.[2]
  if (!mark) return
  return { prefix: match?.[1] ?? "", mark }
}

function close(row: Row, mark: string) {
  const match = row.text.match(/^[ \t]{0,3}(`+|~+)[ \t]*$/)
  const next = match?.[1]
  if (!next) return false
  return next[0] === mark[0] && next.length >= mark.length
}

function document(source: Row[], from: number, to: number) {
  const body = source.slice(from, to).filter((row) => row.text.trim())
  if (!body.length) return false
  if (!START.test(body[0]!.text) || !END.test(body.at(-1)!.text)) return false
  return (
    body.filter((row) => START.test(row.text)).length === 1 && body.filter((row) => END.test(row.text)).length === 1
  )
}

function newline(source: Row[], index: number) {
  return source[index]?.eol || source[index - 1]?.eol || source[index + 1]?.eol || "\n"
}

function marker(source: Row[], from: number, to: number) {
  const text = source
    .slice(from, to)
    .map((row) => row.text)
    .join("\n")
  const runs = text.match(/`+/g) ?? []
  const size = runs.reduce((max, run) => Math.max(max, run.length + 1), 3)
  return "`".repeat(size)
}

export namespace PlantUml {
  export function normalize(input: string) {
    if (!/@startuml/i.test(input) || !/@enduml/i.test(input)) return input

    const source = rows(input)
    const output: string[] = []

    for (let index = 0; index < source.length; index++) {
      const row = source[index]!
      const fence = open(row)
      if (fence) {
        const end = source.findIndex((candidate, offset) => offset > index && close(candidate, fence.mark))
        if (end < 0) {
          output.push(...source.slice(index).map((candidate) => candidate.text + candidate.eol))
          break
        }
        const valid = document(source, index + 1, end)
        output.push(
          valid ? `${fence.prefix}${fence.mark}plantuml${row.eol}` : row.text + row.eol,
          ...source.slice(index + 1, end + 1).map((candidate) => candidate.text + candidate.eol),
        )
        index = end
        continue
      }

      if (!START.test(row.text)) {
        output.push(row.text + row.eol)
        continue
      }

      const end = source.findIndex(
        (candidate, offset) => offset > index && (START.test(candidate.text) || END.test(candidate.text)),
      )
      if (end >= 0 && START.test(source[end]!.text)) {
        const close = source.findIndex((candidate, offset) => offset > end && END.test(candidate.text))
        if (close < 0) {
          output.push(...source.slice(index).map((candidate) => candidate.text + candidate.eol))
          break
        }
        output.push(...source.slice(index, close + 1).map((candidate) => candidate.text + candidate.eol))
        index = close
        continue
      }
      if (end < 0 || !document(source, index, end + 1)) {
        output.push(row.text + row.eol)
        continue
      }

      const eol = newline(source, index)
      const mark = marker(source, index, end + 1)
      output.push(`${mark}plantuml${eol}`)
      output.push(...source.slice(index, end + 1).map((candidate) => candidate.text + candidate.eol))
      if (!source[end]!.eol) output.push(eol)
      output.push(mark + (end + 1 < source.length ? eol : ""))
      index = end
    }

    return output.join("")
  }
}
