import { describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  applyPackagedChipmateServer,
  resolvePackagedChipmateServer,
  restorePackagedManifest,
} from "../../script/chipmate-server-defaults"

describe("ChipMate Server package defaults", () => {
  it("derives all compatibility defaults from a unified address", () => {
    expect(resolvePackagedChipmateServer({ baseUrl: "package.test:6001" })).toEqual({
      baseUrl: "http://package.test:6001",
      marketplace: "http://package.test:6001/marketplace",
      word: "http://package.test:6001/render/word",
      mermaid: "http://package.test:6001/render/mermaid",
    })
  })

  it("extracts a common origin from one legacy package input", () => {
    expect(resolvePackagedChipmateServer({ word: "https://legacy.test:7443/render/word" })).toMatchObject({
      baseUrl: "https://legacy.test:7443",
      marketplace: "https://legacy.test:7443/marketplace",
      mermaid: "https://legacy.test:7443/render/mermaid",
    })
  })

  it("accepts matching legacy package inputs", () => {
    expect(
      resolvePackagedChipmateServer({
        marketplace: "http://legacy.test:6001/marketplace",
        word: "http://legacy.test:6001/render/word",
        mermaid: "http://legacy.test:6001/render/mermaid",
      }),
    ).toMatchObject({ baseUrl: "http://legacy.test:6001" })
  })

  it("rejects package inputs that point to different origins", () => {
    expect(() =>
      resolvePackagedChipmateServer({
        marketplace: "http://market.test:6001/marketplace",
        word: "http://render.test:6001/render/word",
      }),
    ).toThrow("different origins")
  })

  it("rejects a legacy package input with the wrong route", () => {
    expect(() => resolvePackagedChipmateServer({ word: "http://legacy.test:6001/v1" })).toThrow(
      "not a valid /render/word endpoint",
    )
  })

  it("injects the unified and compatibility defaults together", () => {
    const keys = [
      "chipmate.v2.chipmateServer.baseUrl",
      "chipmate.v2.marketplace.baseUrl",
      "chipmate.v2.documents.wordRender.remoteEndpoint",
      "chipmate.v2.documents.mermaidRender.remoteEndpoint",
    ]
    const manifest = {
      contributes: {
        configuration: {
          properties: Object.fromEntries(keys.map((key) => [key, { default: "" }])),
        },
      },
    }
    applyPackagedChipmateServer(manifest, resolvePackagedChipmateServer({ baseUrl: "package.test:6001" }))
    expect(manifest.contributes.configuration.properties).toEqual({
      "chipmate.v2.chipmateServer.baseUrl": { default: "http://package.test:6001" },
      "chipmate.v2.marketplace.baseUrl": { default: "http://package.test:6001/marketplace" },
      "chipmate.v2.documents.wordRender.remoteEndpoint": { default: "http://package.test:6001/render/word" },
      "chipmate.v2.documents.mermaidRender.remoteEndpoint": { default: "http://package.test:6001/render/mermaid" },
    })
  })

  it("restores the tracked manifest source after temporary injection", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chipmate-server-defaults-"))
    const file = join(dir, "package.json")
    const source = '{"version":"0.0.0"}\n'
    try {
      await Bun.write(file, '{"version":"0.0.0","privateDefault":"temporary"}\n')
      await restorePackagedManifest(file, source)
      expect(await Bun.file(file).text()).toBe(source)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
