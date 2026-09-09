import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dir, "../..")
const providerIcon = fs.readFileSync(path.join(root, "../chipmate-ui/src/components/provider-icon.tsx"), "utf-8")
const officialIcon = fs.readFileSync(path.join(root, "assets/icons/chipmate-light.svg"), "utf-8")

describe("ChipMate provider icon branding", () => {
  it("uses every path from the official chip-and-spark mark", () => {
    const paths = [...officialIcon.matchAll(/d="([^"]+)"/g)].map((match) => match[1])

    expect(paths).toHaveLength(3)
    for (const data of paths) expect(providerIcon).toContain(`d="${data}"`)
    expect(providerIcon).not.toContain("M16 16H0V0H16V16")
  })

  it("delegates non-ChipMate providers to the existing icon component", () => {
    expect(providerIcon).toContain('if (local.id !== "chipmate")')
    expect(providerIcon).toContain("<OpenCodeProviderIcon id={local.id} {...rest} />")
  })
})
