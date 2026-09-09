import { expect, test } from "bun:test"
import path from "node:path"
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import type { PluginInput } from "@chipmate/plugin"
import { Global } from "@opencode-ai/core/global"
import { SpecPlugin, specCommand } from "../../src/chipmate/spec/command"
import { ProductProfile } from "../../src/chipmate/product-profile"
import { tmpdir } from "../fixture/fixture"

test("只有显式内置命令加载 Skill，原参数和附件保留", async () => {
  await using workspace = await tmpdir()
  const hook = (await SpecPlugin({ directory: workspace.path } as PluginInput))["command.execute.before"]!
  for (const [command, text] of [
    ["other", String(specCommand().template)],
    ["spec", "同名自定义命令"],
    ["other", "请介绍 /spec"],
  ]) {
    const parts = [{ id: "片段", sessionID: "会话", messageID: "消息", type: "text" as const, text: String(text) }]
    await hook({ command, sessionID: "会话", arguments: "" }, { parts })
    expect(parts).toHaveLength(1)
    expect(parts[0]!.text).toBe(text)
  }
  const file = {
    id: "附件",
    sessionID: "会话",
    messageID: "消息",
    type: "file" as const,
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    url: "file:///设计.docx",
  }
  const original = {
    id: "文本",
    sessionID: "会话",
    messageID: "消息",
    type: "text" as const,
    text: String(specCommand().template).replace("$ARGUMENTS", "用户范围"),
  }
  const parts = [original, file]
  const output = { parts }
  await hook({ command: "spec", sessionID: "会话", arguments: "用户范围" }, output)
  expect(output.parts).toBe(parts)
  expect(parts[0]).toBe(original)
  expect(parts[1]).toBe(file)
  expect(parts).toHaveLength(2)
  expect(output).not.toHaveProperty("execute")
  expect(parts[0].type === "text" && parts[0].text).toContain("<spec-skill>")
  expect(parts[0].type === "text" && parts[0].text).toContain(
    ProductProfile.project(workspace.path, "artifacts", "spec"),
  )
  expect(await readdir(workspace.path)).toEqual([])
})

test("资源可并发加载、损坏后恢复，重启无需源码路径，旧任务不变", async () => {
  await using workspace = await tmpdir()
  const legacy = path.join(workspace.path, "task.json")
  await writeFile(legacy, '{"paused":"旧任务保留"}')
  const { load } = await import("../../src/chipmate/spec/skill")
  const values = await Promise.all([load(workspace.path), load(workspace.path)])
  expect(values[0]).toBe(values[1])
  const line = values[0].split("\n").find((line) => line.startsWith("Skill 资源目录："))!
  const directory = JSON.parse(line.slice("Skill 资源目录：".length)) as string
  expect(directory.startsWith(path.join(Global.Path.cache, "spec-resources"))).toBe(true)
  expect((await readdir(path.join(directory, "references"))).sort()).toEqual(
    ["理解与对齐.md", "计划.md", "开发与验收.md"].sort(),
  )
  expect((await readdir(path.join(directory, "templates"))).sort()).toEqual(
    ["资料与决议.md", "执行基线.md", "开发任务.md", "验收记录.md", "进度.md"].sort(),
  )
  // 核对真实内嵌资源与引用，不将阶段参考全部注入首个请求。
  const contents = [values[0]]
  for (const match of values[0].matchAll(/`((?:references|templates)\/[^`]+\.md)`/g)) {
    const name = match[1]!
    const content = await readFile(path.join(directory, name), "utf8")
    expect(content.length).toBeGreaterThan(100)
    expect(values[0]).not.toContain(content)
    contents.push(content)
  }
  const guidance = contents.join("\n")
  autonomous(guidance)
  for (const confirmation of ["第一次确认", "第二次确认", "第三次确认", "需要修改", "暂停", "真实回答"])
    expect(guidance).toContain(confirmation)
  // 这是对已批准文本边界的回归检查，不是新增运行时工具黑名单。
  for (const previous of [
    "Word 使用 `inspect_word_document` 补充结构。",
    "按需调用 `word_to_images`。",
    "每个新子会话最多读取两页图片，默认一页。",
    "使用原生 `task`；主会话不直接 `read` 页面图片。",
    "每次默认读取 200 行。",
  ])
    expect(() => autonomous(guidance + previous)).toThrow()
  const reference = path.join(directory, "references", "理解与对齐.md")
  const before = await readFile(reference, "utf8")
  expect(values[0]).not.toContain(before)
  await writeFile(reference, "损坏的缓存")
  await load(workspace.path)
  expect(await readFile(reference, "utf8")).toBe(before)
  expect(await readFile(legacy, "utf8")).toBe('{"paused":"旧任务保留"}')
  expect(await readdir(workspace.path)).toEqual(["task.json"])
})

function autonomous(content: string) {
  expect(content).not.toMatch(/\b(?:inspect_word_document|word_to_images|render_word_document|read|task_id)\b|`task`/)
  expect(content).not.toMatch(/(?:默认|最多|每次|每批).{0,20}(?:\d+|[一二两三十]+)\s*(?:页|行)/)
  expect(content).not.toMatch(/references\/图页|templates\/(?:读图任务|图页证据)/)
}

test("资源准备失败时命令不注入半份 Skill，也不创建任务", async () => {
  await using workspace = await tmpdir()
  const { load } = await import("../../src/chipmate/spec/skill")
  const loaded = await load(workspace.path)
  const line = loaded.split("\n").find((line) => line.startsWith("Skill 资源目录："))!
  const directory = JSON.parse(line.slice("Skill 资源目录：".length)) as string
  const file = path.join(directory, "references", "计划.md")
  await rename(file, `${file}.backup`)
  try {
    await mkdir(file)
    const hook = (await SpecPlugin({ directory: workspace.path } as PluginInput))["command.execute.before"]!
    const text = String(specCommand().template)
    const parts = [{ id: "文本", sessionID: "会话", messageID: "消息", type: "text" as const, text }]
    await expect(hook({ command: "spec", sessionID: "会话", arguments: "" }, { parts })).rejects.toThrow()
    expect(parts[0].text).toBe(text)
    expect(await readdir(workspace.path)).toEqual([])
  } finally {
    await rm(file, { recursive: true, force: true })
    await rename(`${file}.backup`, file)
  }
})
