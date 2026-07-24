import { describe, expect, test } from "bun:test"
import { PlantUml } from "./plantuml"

describe("PlantUml.normalize", () => {
  test.each(["plantuml", "PlantUML", "puml", "PUML", "uml", "text", "plaintext", "mermaid", ""])(
    "normalizes a complete %s fence",
    (lang) => {
      const input = `before\n\n\`\`\`${lang}\n@startuml\nAlice -> Bob: hello\n@enduml\n\`\`\`\n\nafter`
      expect(PlantUml.normalize(input)).toBe(
        "before\n\n```plantuml\n@startuml\nAlice -> Bob: hello\n@enduml\n```\n\nafter",
      )
    },
  )

  test("wraps a bare document without changing its source", () => {
    const input = "before\r\n\r\n@startuml Cortex-R8\r\nAlice -> Bob: 中文\r\n@enduml\r\n\r\nafter"
    expect(PlantUml.normalize(input)).toBe(
      "before\r\n\r\n```plantuml\r\n@startuml Cortex-R8\r\nAlice -> Bob: 中文\r\n@enduml\r\n```\r\n\r\nafter",
    )
  })

  test("wraps separate bare documents independently", () => {
    const input = "@startuml\nA -> B\n@enduml\nbetween\n@startuml\nC -> D\n@enduml"
    expect(PlantUml.normalize(input)).toBe(
      "```plantuml\n@startuml\nA -> B\n@enduml\n```\nbetween\n```plantuml\n@startuml\nC -> D\n@enduml\n```",
    )
  })

  test("leaves incomplete and multi-document fences unchanged", () => {
    const incomplete = "```uml\n@startuml\nA -> B\n```"
    const multiple = "```uml\n@startuml\nA -> B\n@enduml\n@startuml\nC -> D\n@enduml\n```"
    expect(PlantUml.normalize(incomplete)).toBe(incomplete)
    expect(PlantUml.normalize(multiple)).toBe(multiple)
  })

  test("normalizes only after a streaming snapshot becomes complete", () => {
    const incomplete = "类图：\n\n@startuml\nA --> B"
    const complete = `${incomplete}\n@enduml`
    expect(PlantUml.normalize(incomplete)).toBe(incomplete)
    expect(PlantUml.normalize(complete)).toBe("类图：\n\n```plantuml\n@startuml\nA --> B\n@enduml\n```")
  })

  test("does not partially wrap malformed bare source", () => {
    const input = "@startuml\nA -> B\n@startuml\nC -> D\n@enduml"
    expect(PlantUml.normalize(input)).toBe(input)
  })

  test("leaves an incomplete bare marker before a later document unchanged", () => {
    const input = "@startuml\nincomplete\n@startuml\nA -> B\n@enduml"
    expect(PlantUml.normalize(input)).toBe(input)
  })

  test("does not reinterpret markers inside an unrelated outer fence", () => {
    const input = "````text\n```plantuml\n@startuml\nA -> B\n@enduml\n```\n````"
    expect(PlantUml.normalize(input)).toBe(input)
  })

  test("leaves ordinary Mermaid and prose unchanged", () => {
    const mermaid = "```mermaid\nflowchart TD\nA --> B\n```"
    const prose = "Use `@startuml` and `@enduml` to delimit a PlantUML document."
    expect(PlantUml.normalize(mermaid)).toBe(mermaid)
    expect(PlantUml.normalize(prose)).toBe(prose)
  })

  test("uses a longer virtual fence when the source contains backticks", () => {
    const input = '@startuml\nnote "```" as N\n@enduml'
    expect(PlantUml.normalize(input)).toBe('````plantuml\n@startuml\nnote "```" as N\n@enduml\n````')
  })
})
