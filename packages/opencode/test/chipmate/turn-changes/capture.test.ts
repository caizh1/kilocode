import { afterAll, expect, test } from "bun:test"
import path from "node:path"
import fs from "node:fs/promises"
import { $ } from "bun"
import { Exit } from "effect"
import { jsonSchema, type Tool } from "ai"
import { MessageID, SessionID } from "../../../src/session/schema"
import { makeRuntime } from "../../../src/effect/run-service"
import { AppNodeBuilderV1 } from "../../../src/effect/app-node-builder-v1"
import * as Changes from "../../../src/chipmate/turn-changes/runtime"
import { tmpdir, provideTestInstance, disposeTestRuntime } from "../../fixture/fixture"

const runtime = makeRuntime(Changes.Service, AppNodeBuilderV1.build(Changes.node))

afterAll(async () => {
  await runtime.dispose()
  await disposeTestRuntime()
})

test.each([
  "normal",
  "untracked",
  "tracked-ignored",
  "ignored",
  "attributes",
  "large-untracked",
  "nested-empty",
  "nested-file",
])(
  "capture actual JSON edit from a repository root: %s",
  async (scenario) => {
    const file = "validation/llt/modules/nfi_rdc/module.json"
    const padding = " ".repeat(scenario === "large-untracked" ? 2 * 1024 * 1024 : 4634)
    const before = '{"enabled":false}\n' + padding
    const after = '{"enabled":true}\n' + padding
    await using temporary = await tmpdir({
      git: true,
      init: async (root) => {
        await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true })
        await Bun.write(path.join(root, file), before)
        await fs.chmod(path.join(root, file), 0o664)
        if (!["ignored", "untracked", "large-untracked", "nested-empty", "nested-file"].includes(scenario))
          await $`git add ${file}`.cwd(root).quiet()
        if (scenario === "nested-empty") await $`git init --quiet incomplete-checkout`.cwd(root).quiet()
        if (scenario === "nested-file") await $`git init --quiet ${path.dirname(file)}`.cwd(root).quiet()
        if (["ignored", "tracked-ignored"].includes(scenario))
          await Bun.write(path.join(root, ".gitignore"), "**/module.json\n")
        if (scenario === "attributes") await Bun.write(path.join(root, ".gitattributes"), "*.json text eol=lf\n")
      },
    })
    await provideTestInstance({
      directory: temporary.path,
      fn: async () => {
        const session = SessionID.make("ses_" + crypto.randomUUID())
        const message = MessageID.ascending()
        const target = path.join(temporary.path, file)
        await runtime.runPromise((service) => service.enter(session, message))
        const tools: Record<string, Tool> = {
          write: {
            inputSchema: jsonSchema({ type: "object" }),
            execute: async () => {
              await Bun.write(target, after)
              return "done"
            },
          },
        }
        await runtime.runPromise((service) => service.wrapTools(tools, session))
        await tools.write.execute!({ filePath: target, content: after }, { toolCallId: "write", messages: [] })
        await runtime.runPromise((service) => service.complete(session, Exit.succeed(undefined)))
        const summary = await runtime.runPromise((service) => service.get(session, message))
        expect(await Bun.file(target).text()).toBe(after)
        if (["normal", "untracked", "attributes", "nested-empty"].includes(scenario)) {
          expect(summary?.reason).toBeUndefined()
          expect(summary?.files.map((entry) => entry.file)).toEqual([file])
          expect(summary?.canRevert).toBe(true)
          const reverted = await runtime.runPromise((service) =>
            service.mutate(session, message, {
              action: "revert",
              revision: summary!.revision,
              requestID: "revert-json",
            }),
          )
          expect(await Bun.file(target).text()).toBe(before)
          await runtime.runPromise((service) =>
            service.mutate(session, message, {
              action: "restore",
              revision: reverted.revision,
              requestID: "restore-json",
            }),
          )
          expect(await Bun.file(target).text()).toBe(after)
        } else {
          expect(summary?.phase).toBe("unavailable")
          expect(summary?.reason).toBe(`文件已发生变化，但未被快照完整收录，暂不能撤销：${file}`)
          expect(summary?.files).toEqual([])
          expect(summary?.canRevert).toBe(false)
          const denied = await runtime.runPromiseExit((service) =>
            service.mutate(session, message, {
              action: "revert",
              revision: summary!.revision,
              requestID: "do-not-revert-omitted-json",
            }),
          )
          expect(Exit.isFailure(denied)).toBe(true)
          expect(await Bun.file(target).text()).toBe(after)
        }
        await runtime.runPromise((service) => service.remove(session))
      },
    })
  },
  30_000,
)
