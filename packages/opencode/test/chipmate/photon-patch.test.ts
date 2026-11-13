import { expect, test } from "bun:test"
import { createRequire } from "node:module"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"

test("Photon 在指定嵌入资源路径下初始化并读写图像", async () => {
  const require = createRequire(import.meta.url)
  const entry = require.resolve("@silvia-odwyer/photon-node")
  await using directory = await tmpdir()
  const resource = path.join(directory.path, "embedded.wasm")
  await Bun.write(resource, Bun.file(path.join(path.dirname(entry), "photon_rs_bg.wasm")))
  const node = Bun.which("node")
  if (!node) throw new Error("测试需要 Node.js")
  const script = `
    globalThis.__CHIPMATE_PHOTON_WASM_PATH = process.argv[1]
    const photon = require(process.argv[2])
    const image = new photon.PhotonImage(new Uint8Array([255, 0, 0, 255]), 1, 1)
    console.log(JSON.stringify([image.get_width(), image.get_height()]))
    image.free()
  `
  const result = Bun.spawnSync([node, "-e", script, resource, entry], { windowsHide: true })
  expect(result.exitCode).toBe(0)
  expect(JSON.parse(result.stdout.toString())).toEqual([1, 1])
  const missing = Bun.spawnSync([node, "-e", script, `${resource}.missing`, entry], { windowsHide: true })
  expect(missing.exitCode).not.toBe(0)
})
