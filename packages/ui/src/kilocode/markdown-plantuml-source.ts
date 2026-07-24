const START = /^[ \t]*@startuml(?:[ \t]+.*)?[ \t]*$/i
const END = /^[ \t]*@enduml[ \t]*$/i

export function cleanPlantUml(input: string) {
  return input.replace(/\r\n?/g, "\n").trim()
}

export function completePlantUml(input: string) {
  const rows = cleanPlantUml(input)
    .split("\n")
    .filter((row) => row.trim())
  const starts = rows.map((row, index) => (START.test(row) ? index : -1)).filter((index) => index >= 0)
  const ends = rows.map((row, index) => (END.test(row) ? index : -1)).filter((index) => index >= 0)
  if (starts.length !== 1 || ends.length !== 1) return false
  if (starts[0]! >= ends[0]!) return false
  return END.test(rows.at(-1) ?? "")
}
