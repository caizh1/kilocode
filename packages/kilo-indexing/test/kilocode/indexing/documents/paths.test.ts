import { describe, expect, test } from "bun:test"
import path from "path"
import { external, key, same, token, within } from "../../../../src/indexing/documents/paths"

describe("document external paths", () => {
  test("creates distinct stable keys for roots with the same filename", () => {
    const left = key("/library/one", "/library/one/guide.md", path.posix)
    const right = key("/library/two", "/library/two/guide.md", path.posix)

    expect(left).toMatch(/^@external\/[0-9a-f]{16}\/guide\.md$/)
    expect(right).toMatch(/^@external\/[0-9a-f]{16}\/guide\.md$/)
    expect(left).not.toBe(right)
    expect(external(left)).toBe(true)
  })

  test("normalizes Windows drive casing and separators", () => {
    expect(same("C:\\Docs", "c:\\docs", path.win32)).toBe(true)
    expect(token("C:\\Docs", path.win32)).toBe(token("c:/docs", path.win32))
    expect(key("C:\\Docs", "c:\\docs\\Guide.md", path.win32)).toMatch(/^@external\/[0-9a-f]{16}\/Guide\.md$/)
  })

  test("handles Windows cross-drive and UNC boundaries", () => {
    expect(within("C:\\Workspace", "D:\\Library", path.win32)).toBe(false)
    expect(within("\\\\server\\share\\docs", "\\\\server\\share\\docs\\guide.md", path.win32)).toBe(true)
    expect(within("\\\\server\\share\\docs", "\\\\server\\share\\other\\secret.md", path.win32)).toBe(false)
  })
})
