import { describe, expect, test } from "bun:test"
import { completePlantUml } from "./markdown-plantuml-source"

describe("complete PlantUML source", () => {
  test("accepts one ordered document ending at the last non-empty line", () => {
    expect(completePlantUml("@startuml Cortex-R8\nA --> B\n@enduml\n\n")).toBe(true)
  })

  test.each([
    "@startuml\nA --> B",
    "@startuml\nA --> B\n@enduml\ntrailing source",
    "@startuml\nA --> B\n@enduml\n@startuml\nC --> D\n@enduml",
    "@enduml\nA --> B\n@startuml",
  ])("rejects incomplete, trailing, multiple, or reversed source", (source) => {
    expect(completePlantUml(source)).toBe(false)
  })
})
