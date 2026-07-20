import assert from "node:assert/strict"
import test from "node:test"
import { gunzipSync } from "node:zlib"
import { packSkillFolder, scanSkillFolder } from "../src/skill-folder.ts"

test("skill folder creates a deterministic USTAR gzip and ignores local noise", async () => {
  const first = folder("demo/SKILL.md", "---\nname: demo\ndescription: demo skill\n---\nUse this skill safely.")
  const script = folder("demo/scripts/run.py", "print('ok')")
  const ignored = folder("demo/node_modules/pkg/index.js", "ignored")
  const scan = scanSkillFolder([script, ignored, first])
  assert.equal(scan.root, "demo")
  assert.deepEqual(
    scan.files.map((item) => item.path),
    ["scripts/run.py", "SKILL.md"],
  )
  assert.deepEqual(scan.ignored, ["node_modules/pkg/index.js"])
  const a = new Uint8Array(await (await packSkillFolder(scan)).arrayBuffer())
  const b = new Uint8Array(await (await packSkillFolder(scan)).arrayBuffer())
  assert.deepEqual(a, b)
  const raw = gunzipSync(a)
  assert.equal(raw.subarray(0, 100).toString().replaceAll("\0", ""), "scripts/run.py")
  assert.equal(
    raw
      .subarray(
        512 + script.size + ((512 - (script.size % 512)) % 512),
        612 + script.size + ((512 - (script.size % 512)) % 512),
      )
      .toString()
      .replaceAll("\0", ""),
    "SKILL.md",
  )
})

test("skill folder requires one root and a root SKILL.md", () => {
  assert.throws(() => scanSkillFolder([folder("one/SKILL.md", "ok"), folder("two/file.txt", "x")]), /一次只能选择一个/)
  assert.throws(() => scanSkillFolder([folder("one/nested/SKILL.md", "ok")]), /根目录必须包含/)
})

test("skill folder rejects case collisions and oversized files", () => {
  assert.throws(() => scanSkillFolder([folder("one/SKILL.md", "ok"), folder("one/skill.md", "again")]), /大小写冲突/)
  const large = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.bin")
  Object.defineProperty(large, "webkitRelativePath", { value: "one/large.bin" })
  assert.throws(() => scanSkillFolder([folder("one/SKILL.md", "ok"), large]), /超过 10 MiB/)
})

function folder(path: string, content: string) {
  const file = new File([content], path.split("/").at(-1)!)
  Object.defineProperty(file, "webkitRelativePath", { value: path })
  return file
}
