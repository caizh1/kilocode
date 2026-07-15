import { describe, expect, test } from "bun:test"
import { mkdtemp } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"

import { parseSourceCodeDefinitionsForFile } from "../../../src/tree-sitter/index"

describe("parseSourceCodeDefinitionsForFile", () => {
  test("returns undefined for fallback-only extensions without AST definition support", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tree-sitter-index-"))
    const file = join(dir, "build.gradle")
    await Bun.write(
      file,
      `plugins { id("java") }
repositories { mavenCentral() }
dependencies { testImplementation("org.junit.jupiter:junit-jupiter:5.10.2") }
`,
    )
    const result = await parseSourceCodeDefinitionsForFile(file)
    expect(result).toBeUndefined()
  })
})
