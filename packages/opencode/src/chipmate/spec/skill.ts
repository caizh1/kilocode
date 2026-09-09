import path from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { Global } from "@opencode-ai/core/global"
import { ProductProfile } from "../product-profile"
import skill from "./SKILL.md" with { type: "text" }
import understanding from "./references/理解与对齐.md" with { type: "text" }
import planning from "./references/计划.md" with { type: "text" }
import delivery from "./references/开发与验收.md" with { type: "text" }
import sources from "./templates/资料与决议.md" with { type: "text" }
import baseline from "./templates/执行基线.md" with { type: "text" }
import tasks from "./templates/开发任务.md" with { type: "text" }
import verification from "./templates/验收记录.md" with { type: "text" }
import progress from "./templates/进度.md" with { type: "text" }

// 编译时内嵌资源；不注册到 Skill 自动发现列表，不读取用户任务。
const files: Record<string, string> = {
  "SKILL.md": skill,
  "references/理解与对齐.md": understanding,
  "references/计划.md": planning,
  "references/开发与验收.md": delivery,
  "templates/资料与决议.md": sources,
  "templates/执行基线.md": baseline,
  "templates/开发任务.md": tasks,
  "templates/验收记录.md": verification,
  "templates/进度.md": progress,
}

export async function load(workspace: string) {
  const version = createHash("sha256").update(JSON.stringify(files)).digest("hex")
  const directory = path.join(Global.Path.cache, "spec-resources", version)
  await Promise.all(
    Object.entries(files).map(async ([name, content]) => {
      const file = path.join(directory, name)
      const previous = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined
        throw error
      })
      if (previous === content) return
      await mkdir(path.dirname(file), { recursive: true })
      const temporary = `${file}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, content, { flag: "wx", mode: 0o600 })
        await rename(temporary, file)
      } finally {
        await rm(temporary, { force: true })
      }
    }),
  )
  return [
    "<spec-skill>",
    skill,
    "\n## 本次命令的资源位置",
    `Skill 资源目录：${JSON.stringify(directory)}`,
    `当前工作区：${JSON.stringify(workspace)}`,
    `任务材料根目录：${JSON.stringify(ProductProfile.project(workspace, "artifacts", "spec"))}`,
    "以上路径已经按当前产品解析。参考资料和模板按当前工作需要使用，执行方式由你结合任务决定。",
    "</spec-skill>",
  ].join("\n")
}
