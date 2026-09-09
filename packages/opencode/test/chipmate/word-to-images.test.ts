import { expect } from "bun:test"
import path from "node:path"
import { readdir } from "node:fs/promises"
import { DEFAULT_ARTIFACT_ROOT } from "../../src/chipmate/documents/artifacts"
import { Effect } from "effect"
import { Instance } from "../../src/chipmate/instance"
import { wordToImages } from "../../src/chipmate/documents/word-to-images"
import { testEffect } from "../lib/effect"
import { TestInstance } from "../fixture/fixture"
import { specLayer, specOptions } from "./spec-fixture"
const it = testEffect(specLayer)
it.instance(
  "转图拒绝旧接口、丢失图片、错误页码、无效 PNG 和取消，不回退",
  () =>
    Effect.gen(function* () {
      const { directory } = yield* TestInstance
      const context = yield* Effect.sync(() => Instance.current)
      yield* Effect.promise(async () => {
        await Bun.write(
          path.join(directory, "设计.docx"),
          Bun.file(path.resolve("../../ufs-query-module-interface.docx")),
        )
        const convert = (input: Parameters<typeof wordToImages>[0], signal: AbortSignal) =>
          Instance.restore(context, () => wordToImages(input, signal))
        const old = process.env.CHIPMATE_WORD_TO_IMAGES_ENDPOINT
        let mode = "旧接口"
        const requests: string[] = []
        const server = Bun.serve({
          port: 0,
          hostname: "127.0.0.1",
          fetch: (request) => {
            requests.push(new URL(request.url).pathname)
            if (mode === "旧接口") return new Response("不存在", { status: 404 })
            const pages =
              mode === "缺失图片"
                ? []
                : [
                    {
                      page: mode === "错误页码" ? 2 : 1,
                      contentType: "image/png",
                      base64: "dGVzdA==",
                      width: 10,
                      height: 10,
                    },
                  ]
            return Response.json({
              ok: true,
              pageCount: 1,
              returnedPageCount: 1,
              startPage: 1,
              nextPage: null,
              pages,
              issues: [],
              renderer: { kind: "word-to-images" },
            })
          },
        })
        process.env.CHIPMATE_WORD_TO_IMAGES_ENDPOINT = server.url + "convert/word-to-images"
        try {
          await expect(convert({ sourcePath: "设计.docx" }, new AbortController().signal)).rejects.toThrow(
            "请升级 Server",
          )
          for (const value of ["缺失图片", "错误页码", "无效 PNG"]) {
            mode = value
            await expect(convert({ sourcePath: "设计.docx" }, new AbortController().signal)).rejects.toThrow()
          }
          const controller = new AbortController()
          controller.abort()
          await expect(convert({ sourcePath: "设计.docx" }, controller.signal)).rejects.toThrow()
          expect(requests).toEqual(Array(4).fill("/convert/word-to-images"))
          await expect(readdir(path.join(directory, DEFAULT_ARTIFACT_ROOT))).rejects.toThrow("ENOENT")
        } finally {
          server.stop(true)
          if (old === undefined) delete process.env.CHIPMATE_WORD_TO_IMAGES_ENDPOINT
          else process.env.CHIPMATE_WORD_TO_IMAGES_ENDPOINT = old
        }
      })
    }),
  specOptions,
  30000,
)
