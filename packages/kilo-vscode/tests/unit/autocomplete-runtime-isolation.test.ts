import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(__dirname, "../..")

describe("autocomplete runtime isolation", () => {
  it("does not wake the legacy autocomplete runtime from extension activation", () => {
    const source = readFileSync(join(root, "src/extension.ts"), "utf8")

    expect(source).not.toContain("ensureBackendForAutocomplete")
    expect(source).not.toContain("AutocompleteServiceManager")
    expect(source).toContain("registerQwenAutocompleteProvider")
  })

  it("keeps legacy autocomplete commands as shims without constructing the old manager", () => {
    const source = readFileSync(join(root, "src/services/autocomplete/index.ts"), "utf8")

    expect(source).not.toContain("new AutocompleteServiceManager")
    expect(source).not.toContain("ensureBackendForAutocomplete")
    expect(source).toContain("kilo-code.new.autocomplete.generateSuggestions")
  })
})
