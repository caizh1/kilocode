import { describe, it, expect, afterEach } from "bun:test"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { createHash, randomUUID } from "crypto"
import { createCanonicalArchive, validateSkillArchive } from "@chipmate/skill-spec"
import { MarketplaceInstaller } from "../../src/services/marketplace/installer"
import { MarketplacePaths } from "../../src/services/marketplace/paths"
import type { AgentMarketplaceItem } from "../../src/services/marketplace/types"
import * as yaml from "yaml"

const tmpDir = path.join(os.tmpdir(), `chipmate-test-${Date.now()}`)

class TestPaths extends MarketplacePaths {
  override configPath(scope: "project" | "global", workspace?: string): string {
    if (scope === "global") return path.join(tmpDir, "global", "chipmate.json")
    return path.join(tmpDir, "project", ".chipmate", "chipmate.json")
  }
  override skillsDir(scope: "project" | "global", workspace?: string): string {
    return path.join(tmpDir, "skills")
  }
}

class LinkedPaths extends TestPaths {
  override skillsDir(): string {
    return path.join(tmpDir, "linked-root", "skills")
  }
}

function skill(content: string, id = "test-skill") {
  return {
    type: "skill" as const,
    id,
    name: "Test Skill",
    description: "test",
    category: "test",
    githubUrl: "https://example.com",
    content,
    displayName: "Test Skill",
    displayCategory: "Test",
  }
}

function agent(content: AgentMarketplaceItem["content"], id = "test-agent"): AgentMarketplaceItem {
  return {
    type: "agent",
    id,
    name: "Test Agent",
    description: "test",
    category: "development",
    content,
  }
}

async function frontmatter(file: string) {
  const content = await fs.readFile(file, "utf-8")
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  expect(match).not.toBeNull()
  return yaml.parse(match?.[1] ?? "") as Record<string, unknown>
}

async function archive(
  name = "test-skill",
  content = "# Test Skill\n",
  files: Record<string, string> = {},
  manifestName = name,
): Promise<Buffer> {
  const included = { "skill.json": `${JSON.stringify({ id: name, category: "general", tags: [] }, null, 2)}\n`, ...files }
  return createCanonicalArchive(name, [
    {
      path: "SKILL.md",
      data: Buffer.from(
        `---\nname: ${manifestName}\ndescription: ${manifestName} fixture\n---\n\n${content}\n请将此技能用于可重复验证的项目流程。\n`,
      ),
    },
    ...Object.entries(included).map(([file, value]) => ({ path: file, data: Buffer.from(value) })),
  ])
}

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe("MarketplaceInstaller MCP format normalization", () => {
  it("converts local command+args+env format to CLI format", async () => {
    const installer = new MarketplaceInstaller(new TestPaths())
    const item = {
      type: "mcp" as const,
      id: "memory",
      name: "Memory",
      description: "test",
      category: "development",
      url: "https://example.com",
      content: JSON.stringify({
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-memory"],
        env: { MY_KEY: "my-value" },
      }),
    }
    const result = await installer.install(item, { target: "global" }, undefined)
    expect(result.success).toBe(true)

    const written = JSON.parse(await fs.readFile(new TestPaths().configPath("global"), "utf-8"))
    const mcp = written.mcp?.memory
    expect(mcp.type).toBe("local")
    expect(mcp.command).toEqual(["npx", "-y", "@modelcontextprotocol/server-memory"])
    expect(mcp.environment).toEqual({ MY_KEY: "my-value" })
    expect(mcp.args).toBeUndefined()
    expect(mcp.env).toBeUndefined()
  })

  it("converts sse type to remote type", async () => {
    const installer = new MarketplaceInstaller(new TestPaths())
    const item = {
      type: "mcp" as const,
      id: "myremote",
      name: "Remote",
      description: "test",
      category: "development",
      url: "https://example.com",
      content: JSON.stringify({
        type: "sse",
        url: "https://example.com/sse",
        headers: { Authorization: "Bearer token" },
      }),
    }
    const result = await installer.install(item, { target: "global" }, undefined)
    expect(result.success).toBe(true)

    const written = JSON.parse(await fs.readFile(new TestPaths().configPath("global"), "utf-8"))
    const mcp = written.mcp?.myremote
    expect(mcp.type).toBe("remote")
    expect(mcp.url).toBe("https://example.com/sse")
    expect(mcp.headers).toEqual({ Authorization: "Bearer token" })
  })

  it("keeps already-normalized local format unchanged", async () => {
    const installer = new MarketplaceInstaller(new TestPaths())
    const item = {
      type: "mcp" as const,
      id: "already",
      name: "Already Done",
      description: "test",
      category: "development",
      url: "https://example.com",
      content: JSON.stringify({
        type: "local",
        command: ["npx", "-y", "someserver"],
        environment: { KEY: "val" },
      }),
    }
    const result = await installer.install(item, { target: "global" }, undefined)
    expect(result.success).toBe(true)

    const written = JSON.parse(await fs.readFile(new TestPaths().configPath("global"), "utf-8"))
    const mcp = written.mcp?.already
    expect(mcp).toEqual({ type: "local", command: ["npx", "-y", "someserver"], environment: { KEY: "val" } })
  })
})

describe("MarketplaceInstaller skills", () => {
  it("rejects project installs without a workspace directory", async () => {
    const installer = new MarketplaceInstaller(new TestPaths())
    const result = await installer.installSkill(skill("https://example.com/skill.tar.gz"), "project")

    expect(result).toEqual({
      success: false,
      slug: "test-skill",
      error: "No workspace directory for project-scope install",
    })
  })

  it("rejects project removals without a workspace directory", async () => {
    const installer = new MarketplaceInstaller(new TestPaths())
    const result = await installer.removeSkill(skill("https://example.com/skill.tar.gz"), "project")

    expect(result).toEqual({
      success: false,
      slug: "test-skill",
      error: "No workspace directory for project-scope removal",
    })
  })

  it("rejects project MCP and agent removals without a workspace directory", async () => {
    const installer = new MarketplaceInstaller(new TestPaths())
    const results = await Promise.all([
      installer.remove(
        {
          type: "mcp",
          id: "test-mcp",
          name: "Test MCP",
          description: "test",
          category: "development",
          url: "https://example.com",
          content: "{}",
        },
        "project",
      ),
      installer.remove(
        {
          type: "agent",
          id: "test-agent",
          name: "Test Agent",
          description: "test",
          category: "development",
          content: { mode: "all", description: "test", prompt: "test" },
        },
        "project",
      ),
    ])

    expect(results).toEqual([
      { success: false, slug: "test-mcp", error: "No workspace directory for project-scope removal" },
      { success: false, slug: "test-agent", error: "No workspace directory for project-scope removal" },
    ])
  })

  it("rejects skill ids that are unsafe on supported filesystems", async () => {
    const paths = new TestPaths()
    const dir = path.join(paths.skillsDir("project", tmpDir), "installed")
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, "SKILL.md"), "# Installed\n")
    const installer = new MarketplaceInstaller(paths)

    for (const id of [".", "installed.", "CON", "nul.txt"]) {
      const result = await installer.removeSkill(skill("https://example.com/skill.tar.gz", id), "project", tmpDir)
      expect(result).toEqual({ success: false, slug: id, error: "Invalid skill id" })
    }

    expect(await fs.readFile(path.join(dir, "SKILL.md"), "utf-8")).toBe("# Installed\n")
  })

  it("does not report a missing managed Skill as successfully removed", async () => {
    const paths = new TestPaths()
    const installer = new MarketplaceInstaller(paths)

    const result = await installer.removeSkill(
      skill("https://example.com/skill.tar.gz"),
      "project",
      tmpDir,
      path.join(paths.skillsDir("project", tmpDir), "test-skill", "SKILL.md"),
    )

    expect(result).toEqual({
      success: false,
      slug: "test-skill",
      error: "Skill is not installed in the selected scope",
    })
  })

  it("removes the complete managed Skill directory", async () => {
    const paths = new TestPaths()
    const dir = path.join(paths.skillsDir("project", tmpDir), "test-skill")
    await fs.mkdir(path.join(dir, "references"), { recursive: true })
    await Promise.all([
      fs.writeFile(
        path.join(dir, "SKILL.md"),
        "---\nname: test-skill\ndescription: Installed fixture\n---\n\n# Installed\n",
      ),
      fs.writeFile(path.join(dir, "references", "guide.md"), "# Guide\n"),
    ])
    const installer = new MarketplaceInstaller(paths)

    const result = await installer.removeSkill(
      skill("https://example.com/skill.tar.gz"),
      "project",
      tmpDir,
      path.join(dir, "SKILL.md"),
    )

    expect(result).toEqual({ success: true, slug: "test-skill" })
    expect(
      await fs.stat(dir).then(
        () => true,
        () => false,
      ),
    ).toBe(false)
  })

  it("refuses to remove a managed directory containing a nested Skill", async () => {
    const paths = new TestPaths()
    const dir = path.join(paths.skillsDir("project", tmpDir), "test-skill")
    const child = path.join(dir, "child")
    await fs.mkdir(child, { recursive: true })
    await Promise.all([
      fs.writeFile(path.join(dir, "SKILL.md"), "# Parent\n"),
      fs.writeFile(path.join(child, "SKILL.md"), "# Child\n"),
    ])
    const installer = new MarketplaceInstaller(paths)

    const result = await installer.removeSkill(
      skill("https://example.com/skill.tar.gz"),
      "project",
      tmpDir,
      path.join(dir, "SKILL.md"),
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain("nested Skill")
    expect(await fs.readFile(path.join(dir, "SKILL.md"), "utf8")).toBe("# Parent\n")
    expect(await fs.readFile(path.join(child, "SKILL.md"), "utf8")).toBe("# Child\n")
  })

  it("refuses to remove a managed Skill through a symbolic link", async () => {
    if (process.platform === "win32") return
    const paths = new TestPaths()
    const target = path.join(tmpDir, "target")
    const dir = path.join(paths.skillsDir("project", tmpDir), "test-skill")
    await fs.mkdir(target, { recursive: true })
    await fs.mkdir(path.dirname(dir), { recursive: true })
    await fs.writeFile(path.join(target, "SKILL.md"), "# Linked\n")
    await fs.symlink(target, dir)
    const installer = new MarketplaceInstaller(paths)

    const result = await installer.removeSkill(
      skill("https://example.com/skill.tar.gz"),
      "project",
      tmpDir,
      path.join(dir, "SKILL.md"),
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain("regular directory")
    expect(await fs.readFile(path.join(target, "SKILL.md"), "utf8")).toBe("# Linked\n")
  })

  it("refuses a symbolic link above the managed Skill root", async () => {
    if (process.platform === "win32") return
    const paths = new LinkedPaths()
    const actual = path.join(tmpDir, "actual-root")
    const dir = path.join(actual, "skills", "test-skill")
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, "SKILL.md"), "# Linked root\n")
    await fs.symlink(actual, path.join(tmpDir, "linked-root"))
    const installer = new MarketplaceInstaller(paths)

    const result = await installer.removeSkill(
      skill("https://example.com/skill.tar.gz"),
      "project",
      tmpDir,
      path.join(dir, "SKILL.md"),
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain("regular directory")
    expect(await fs.readFile(path.join(dir, "SKILL.md"), "utf8")).toBe("# Linked root\n")
  })

  it("installs an extracted project skill without leaving staging directories", async () => {
    const buffer = await archive()
    const url = `data:application/gzip;base64,${buffer.toString("base64")}`
    const paths = new TestPaths()
    const installer = new MarketplaceInstaller(paths)
    const result = await installer.installSkill(skill(url), "project", tmpDir)

    expect(result.success).toBe(true)
    expect(
      await fs.readFile(path.join(paths.skillsDir("project", tmpDir), "test-skill", "SKILL.md"), "utf-8"),
    ).toContain("# Test Skill\n")
    expect(
      (await fs.readdir(paths.skillsDir("project", tmpDir))).filter((name) => name.startsWith(".staging-")),
    ).toEqual([])
  })

  it("handles concurrent installs without sharing temporary paths", async () => {
    const buffer = await archive()
    const original = globalThis.fetch
    const paths = new TestPaths()
    const installer = new MarketplaceInstaller(paths)
    const item = skill("https://example.com/skill.tar.gz")
    const gate = Promise.withResolvers<void>()
    let count = 0
    globalThis.fetch = async () => {
      count += 1
      if (count === 2) gate.resolve()
      await gate.promise
      return new Response(buffer)
    }

    try {
      const results = await Promise.all([
        installer.installSkill(item, "project", tmpDir),
        installer.installSkill(item, "project", tmpDir),
      ])
      expect(count).toBe(2)
      expect(results.filter((result) => result.success)).toHaveLength(1)
      expect(results.find((result) => !result.success)?.error).toBe(
        "Skill already installed. Uninstall it before installing again.",
      )
      expect(
        await fs.readFile(path.join(paths.skillsDir("project", tmpDir), "test-skill", "SKILL.md"), "utf-8"),
      ).toContain("# Test Skill\n")
      expect(
        (await fs.readdir(paths.skillsDir("project", tmpDir))).filter((name) => name.startsWith(".staging-")),
      ).toEqual([])
    } finally {
      globalThis.fetch = original
    }
  })

  it("verifies hash and archive root before atomically installing and updating a skill", async () => {
    const first = await archive("test-skill", "# First\n")
    const paths = new TestPaths()
    const installer = new MarketplaceInstaller(paths)
    const payload = (buffer: Buffer, revision: number, sha256 = createHash("sha256").update(buffer).digest("hex")) => ({
      id: "test-skill",
      revision,
      sha256,
      url: `data:application/gzip;base64,${buffer.toString("base64")}`,
    })

    expect((await installer.installVerifiedSkill(payload(first, 1), "project", tmpDir)).success).toBe(true)
    expect(
      await fs.readFile(path.join(paths.skillsDir("project", tmpDir), "test-skill", "SKILL.md"), "utf8"),
    ).toContain("# First\n")

    const second = await archive("test-skill", "# Second\n")
    expect((await installer.installVerifiedSkill(payload(second, 2), "project", tmpDir)).success).toBe(true)
    expect(
      await fs.readFile(path.join(paths.skillsDir("project", tmpDir), "test-skill", "SKILL.md"), "utf8"),
    ).toContain("# Second\n")

    const rejected = await installer.installVerifiedSkill(payload(second, 3, "0".repeat(64)), "project", tmpDir)
    expect(rejected.error).toBe("Skill archive SHA-256 mismatch")
    expect(
      await fs.readFile(path.join(paths.skillsDir("project", tmpDir), "test-skill", "SKILL.md"), "utf8"),
    ).toContain("# Second\n")

    const wrong = await archive("unexpected-root", "# Unsafe\n")
    const unsafe = await installer.installVerifiedSkill(payload(wrong, 3), "project", tmpDir)
    expect(unsafe.error).toContain("unexpected root")
    expect(
      await fs.readFile(path.join(paths.skillsDir("project", tmpDir), "test-skill", "SKILL.md"), "utf8"),
    ).toContain("# Second\n")
  })

  it("installs a canonical skill whose archive includes an examples resource directory", async () => {
    const buffer = await archive("uml", "# UML\n", {
      "examples/sequence.puml": "@startuml\nAlice -> Bob: request\n@enduml\n",
      "skill.json": `${JSON.stringify({ id: "uml", category: "general", tags: [] }, null, 2)}\n`,
    })
    const installer = new MarketplaceInstaller(new TestPaths())
    const result = await installer.installVerifiedSkill(
      {
        id: "uml",
        revision: 1,
        sha256: createHash("sha256").update(buffer).digest("hex"),
        url: `data:application/gzip;base64,${buffer.toString("base64")}`,
      },
      "project",
      tmpDir,
    )

    expect(result.success).toBe(true)
    expect(
      await fs.readFile(
        path.join(new TestPaths().skillsDir("project", tmpDir), "uml", "examples/sequence.puml"),
        "utf8",
      ),
    ).toContain("Alice -> Bob")
  })

  it("returns a structured identity error without changing the installed skill", async () => {
    const paths = new TestPaths()
    const installer = new MarketplaceInstaller(paths)
    const payload = (buffer: Buffer, revision: number) => ({
      id: "examples",
      revision,
      sha256: createHash("sha256").update(buffer).digest("hex"),
      url: `data:application/gzip;base64,${buffer.toString("base64")}`,
    })
    const malformed = await archive("examples", "# UML\n", {}, "uml")

    const rejected = await installer.installVerifiedSkill(payload(malformed, 1), "project", tmpDir)

    expect(rejected).toMatchObject({
      success: false,
      slug: "examples",
      errorCode: "skill-identity-mismatch",
    })
    expect(rejected.error).toContain("未安装任何文件")
    expect(await fs.readdir(paths.skillsDir("project", tmpDir))).toEqual([])

    const existing = await archive("examples", "# Existing\n")
    expect((await installer.installVerifiedSkill(payload(existing, 1), "project", tmpDir)).success).toBe(true)
    const update = await installer.installVerifiedSkill(payload(malformed, 2), "project", tmpDir)

    expect(update.errorCode).toBe("skill-identity-mismatch")
    expect(await fs.readFile(path.join(paths.skillsDir("project", tmpDir), "examples", "SKILL.md"), "utf8")).toContain(
      "# Existing",
    )
    expect(
      (await fs.readdir(paths.skillsDir("project", tmpDir))).filter(
        (name) => name.startsWith(".staging-") || name.startsWith(".backup-"),
      ),
    ).toEqual([])
  })

  it("installs on Windows without using directory rename even when rename permanently returns EPERM", async () => {
    const paths = new TestPaths()
    const buffer = await archive("uml", "# UML\n")
    const state = { attempts: 0 }
    const installer = new MarketplaceInstaller(paths, {
      platform: "win32",
      wait: async () => undefined,
      rename: async () => {
        state.attempts += 1
        const err = new Error("directory rename is not permitted") as NodeJS.ErrnoException
        err.code = "EPERM"
        throw err
      },
    })

    const result = await installer.installVerifiedSkill(
      {
        id: "uml",
        revision: 1,
        sha256: createHash("sha256").update(buffer).digest("hex"),
        url: `data:application/gzip;base64,${buffer.toString("base64")}`,
      },
      "project",
      tmpDir,
    )

    expect(result.success).toBe(true)
    expect(state.attempts).toBe(0)
    expect(await fs.readFile(path.join(paths.skillsDir("project", tmpDir), "uml", "SKILL.md"), "utf8")).toContain(
      "# UML",
    )
    const transactions = path.join(path.dirname(paths.skillsDir("project", tmpDir)), ".skill-install-transactions")
    expect((await fs.readdir(transactions)).filter((entry) => entry !== ".locks")).toEqual([])
    expect(await fs.readdir(path.join(transactions, ".locks"))).toEqual([])
  })

  it("verifies canonical snapshots when Windows reports synthesized 0666 file modes", async () => {
    const paths = new TestPaths()
    const buffer = await archive("uml", "# UML\n", {
      "examples/sequence.puml": "@startuml\n@enduml",
      "scripts/render.sh": "#!/bin/sh\nprintf 'uml\\n'\n",
    })
    const installer = new MarketplaceInstaller(paths, {
      platform: "win32",
      writeFile: async (file, data) => {
        await fs.writeFile(file, data)
        await fs.chmod(file, 0o666)
      },
    })

    const result = await installer.installVerifiedSkill(
      {
        id: "uml",
        revision: 1,
        sha256: createHash("sha256").update(buffer).digest("hex"),
        url: `data:application/gzip;base64,${buffer.toString("base64")}`,
      },
      "project",
      tmpDir,
    )

    expect(result.success).toBe(true)
    expect(await fs.readFile(path.join(paths.skillsDir("project", tmpDir), "uml", "SKILL.md"), "utf8")).toContain(
      "# UML",
    )
    expect(
      await fs.readFile(path.join(paths.skillsDir("project", tmpDir), "uml", "examples/sequence.puml"), "utf8"),
    ).toContain("@startuml")
  })

  it("cleans Windows staging when the initial snapshot verification fails", async () => {
    const paths = new TestPaths()
    const buffer = await archive("uml", "# UML\n", { "examples/sequence.puml": "expected" })
    const installer = new MarketplaceInstaller(paths, {
      platform: "win32",
      writeFile: async (file, data, mode) => {
        const written = file.endsWith(path.join("examples", "sequence.puml")) ? Buffer.from("modified") : data
        await fs.writeFile(file, written, { mode: mode ?? 0o644 })
      },
    })

    const result = await installer.installVerifiedSkill(
      {
        id: "uml",
        revision: 1,
        sha256: createHash("sha256").update(buffer).digest("hex"),
        url: `data:application/gzip;base64,${buffer.toString("base64")}`,
      },
      "project",
      tmpDir,
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain("snapshot SHA-256 mismatch")
    expect(await fs.readdir(paths.skillsDir("project", tmpDir))).toEqual([])
    const transactions = path.join(path.dirname(paths.skillsDir("project", tmpDir)), ".skill-install-transactions")
    expect((await fs.readdir(transactions)).filter((entry) => entry !== ".locks")).toEqual([])
    expect(await fs.readdir(path.join(transactions, ".locks"))).toEqual([])
  })

  it("updates on Windows by copying manifest last and removes stale files without directory rename", async () => {
    const paths = new TestPaths()
    const first = await archive("uml", "# Existing UML\n", { "obsolete.txt": "old" })
    const payload = (buffer: Buffer, revision: number) => ({
      id: "uml",
      revision,
      sha256: createHash("sha256").update(buffer).digest("hex"),
      url: `data:application/gzip;base64,${buffer.toString("base64")}`,
    })
    const state = { attempts: 0 }
    const installer = new MarketplaceInstaller(paths, {
      platform: "win32",
      wait: async () => undefined,
      rename: async () => {
        state.attempts += 1
        const err = new Error("directory rename is forbidden") as NodeJS.ErrnoException
        err.code = "EPERM"
        throw err
      },
    })
    expect((await installer.installVerifiedSkill(payload(first, 1), "project", tmpDir)).success).toBe(true)
    const second = await archive("uml", "# Updated UML\n", { "examples/sequence.puml": "@startuml\n@enduml" })

    const result = await installer.installVerifiedSkill(payload(second, 2), "project", tmpDir)

    expect(result.success).toBe(true)
    expect(state.attempts).toBe(0)
    expect(await fs.readFile(path.join(paths.skillsDir("project", tmpDir), "uml", "SKILL.md"), "utf8")).toContain(
      "# Updated UML",
    )
    expect(await fs.readFile(path.join(paths.skillsDir("project", tmpDir), "uml", "examples/sequence.puml"), "utf8")).toContain(
      "@startuml",
    )
    expect(await fs.stat(path.join(paths.skillsDir("project", tmpDir), "uml", "obsolete.txt")).catch(() => undefined)).toBeUndefined()
  })

  it("restores an existing Windows skill when copying the update is interrupted", async () => {
    const paths = new TestPaths()
    const existing = await archive("uml", "# Existing UML\n")
    const payload = (buffer: Buffer, revision: number) => ({
      id: "uml",
      revision,
      sha256: createHash("sha256").update(buffer).digest("hex"),
      url: `data:application/gzip;base64,${buffer.toString("base64")}`,
    })
    expect(
      (await new MarketplaceInstaller(paths, { platform: "win32" }).installVerifiedSkill(payload(existing, 1), "project", tmpDir)).success,
    ).toBe(true)

    const update = await archive("uml", "# Updated UML\n", { "examples/sequence.puml": "new" })
    const state = { copying: false, failed: false }
    const installer = new MarketplaceInstaller(paths, {
      platform: "win32",
      onTransactionPhase: async (phase) => {
        if (phase === "copying") state.copying = true
      },
      writeFile: async (file, data, mode) => {
        if (state.copying && !state.failed && file.endsWith(path.join("examples", "sequence.puml"))) {
          state.failed = true
          throw new Error("injected copy interruption")
        }
        await fs.writeFile(file, data, { mode: mode ?? 0o644 })
      },
    })

    const result = await installer.installVerifiedSkill(payload(update, 2), "project", tmpDir)

    expect(result.success).toBe(false)
    expect(result.error).toContain("injected copy interruption")
    expect(await fs.readFile(path.join(paths.skillsDir("project", tmpDir), "uml", "SKILL.md"), "utf8")).toContain(
      "# Existing UML",
    )
    expect(await fs.readdir(paths.skillsDir("project", tmpDir))).toEqual(["uml"])
  })

  it("keeps the existing Windows skill unchanged when backup copying is interrupted", async () => {
    const paths = new TestPaths()
    const existing = await archive("uml", "# Existing UML\n", { "examples/old.puml": "old" })
    const payload = (buffer: Buffer, revision: number) => ({
      id: "uml",
      revision,
      sha256: createHash("sha256").update(buffer).digest("hex"),
      url: `data:application/gzip;base64,${buffer.toString("base64")}`,
    })
    expect(
      (await new MarketplaceInstaller(paths, { platform: "win32" }).installVerifiedSkill(payload(existing, 1), "project", tmpDir)).success,
    ).toBe(true)

    const update = await archive("uml", "# Updated UML\n")
    const state = { prepared: false, failed: false }
    const installer = new MarketplaceInstaller(paths, {
      platform: "win32",
      onTransactionPhase: async (phase) => {
        if (phase === "prepared") state.prepared = true
      },
      writeFile: async (file, data, mode) => {
        if (state.prepared && !state.failed && file.includes(`${path.sep}backup-`)) {
          state.failed = true
          throw new Error("injected backup interruption")
        }
        await fs.writeFile(file, data, { mode: mode ?? 0o644 })
      },
    })

    const result = await installer.installVerifiedSkill(payload(update, 2), "project", tmpDir)

    expect(result.success).toBe(false)
    expect(result.error).toContain("injected backup interruption")
    expect(await fs.readFile(path.join(paths.skillsDir("project", tmpDir), "uml", "SKILL.md"), "utf8")).toContain(
      "# Existing UML",
    )
    expect(await fs.readFile(path.join(paths.skillsDir("project", tmpDir), "uml", "examples/old.puml"), "utf8")).toBe(
      "old",
    )
    const transactions = path.join(path.dirname(paths.skillsDir("project", tmpDir)), ".skill-install-transactions")
    expect((await fs.readdir(transactions)).filter((entry) => entry !== ".locks")).toEqual([])
  })

  it("keeps a partial Windows copy undiscoverable until SKILL.md is written last", async () => {
    const paths = new TestPaths()
    const buffer = await archive("uml", "# UML workflow\n", { "examples/sequence.puml": "example" })
    const observed: boolean[] = []
    const target = path.join(paths.skillsDir("project", tmpDir), "uml", "SKILL.md")
    const installer = new MarketplaceInstaller(paths, {
      platform: "win32",
      onTransactionPhase: async (phase) => {
        if (phase === "copying") observed.push(await fs.access(target).then(() => true).catch(() => false))
      },
    })

    const result = await installer.installVerifiedSkill(
      {
        id: "uml",
        revision: 1,
        sha256: createHash("sha256").update(buffer).digest("hex"),
        url: `data:application/gzip;base64,${buffer.toString("base64")}`,
      },
      "project",
      tmpDir,
    )

    expect(result.success).toBe(true)
    expect(observed).toEqual([false])
    expect(await fs.access(target).then(() => true)).toBe(true)
  })

  it("serializes concurrent Windows installs for the same scope and Skill", async () => {
    const paths = new TestPaths()
    const buffer = await archive("uml", "# UML workflow\n")
    const payload = {
      id: "uml",
      revision: 1,
      sha256: createHash("sha256").update(buffer).digest("hex"),
      url: `data:application/gzip;base64,${buffer.toString("base64")}`,
    }
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const state = { prepared: 0, active: 0, maximum: 0 }
    const installer = new MarketplaceInstaller(paths, {
      platform: "win32",
      onTransactionPhase: async (phase) => {
        if (phase === "prepared") {
          state.prepared += 1
          state.active += 1
          state.maximum = Math.max(state.maximum, state.active)
          if (state.prepared === 1) {
            started.resolve()
            await release.promise
          }
        }
        if (phase === "committed") state.active -= 1
      },
    })

    const first = installer.installVerifiedSkill(payload, "project", tmpDir)
    await started.promise
    const second = installer.installVerifiedSkill(payload, "project", tmpDir)
    release.resolve()
    const results = await Promise.all([first, second])

    expect(results.every((result) => result.success)).toBe(true)
    expect(state.maximum).toBe(1)
    expect(state.prepared).toBe(2)
  })

  it("recovers an interrupted Windows update after extension restart", async () => {
    const paths = new TestPaths()
    const existing = await archive("uml", "# Existing UML\n")
    const installer = new MarketplaceInstaller(paths, { platform: "win32" })
    const payload = {
      id: "uml",
      revision: 1,
      sha256: createHash("sha256").update(existing).digest("hex"),
      url: `data:application/gzip;base64,${existing.toString("base64")}`,
    }
    expect((await installer.installVerifiedSkill(payload, "project", tmpDir)).success).toBe(true)

    const base = paths.skillsDir("project", tmpDir)
    const home = path.join(path.dirname(base), ".skill-install-transactions", "uml")
    const backup = path.join(home, `backup-${randomUUID()}`)
    const staging = path.join(home, `staging-${randomUUID()}`)
    await fs.cp(path.join(base, "uml"), backup, { recursive: true })
    await fs.mkdir(staging, { recursive: true })
    await fs.rm(path.join(base, "uml", "SKILL.md"))
    await fs.writeFile(path.join(base, "uml", "partial.txt"), "partial")
    await fs.writeFile(
      path.join(home, "record.json"),
      `${JSON.stringify({
        version: 1,
        id: "uml",
        scope: "project",
        target: path.join(base, "uml"),
        staging,
        backup,
        sourceSha256: payload.sha256,
        snapshotSha256: validateSkillArchive(existing).snapshotSha256,
        previousExists: true,
        phase: "copying",
        createdAt: new Date().toISOString(),
      })}\n`,
    )

    await new MarketplaceInstaller(paths, { platform: "win32" }).recoverSkillTransactions("project", tmpDir)

    expect(await fs.readFile(path.join(base, "uml", "SKILL.md"), "utf8")).toContain("# Existing UML")
    expect(await fs.access(path.join(base, "uml", "partial.txt")).then(() => true).catch(() => false)).toBe(false)
    expect(await fs.access(home).then(() => true).catch(() => false)).toBe(false)
  })
})

describe("MarketplaceInstaller agents", () => {
  it("preserves requirements in installed agent frontmatter", async () => {
    const installer = new MarketplaceInstaller(new TestPaths())
    const item = agent({
      mode: "all",
      description: "Requires local setup",
      prompt: "Use the available project tools.",
      requirements: {
        skills: ["project-skill"],
        mcps: ["project-mcp"],
        vscode_extensions: [{ name: "Project Helper", id: "publisher.project-helper" }],
      },
    })

    const result = await installer.installAgent(item, "project", tmpDir)

    expect(result.success).toBe(true)
    expect(result.filePath).toBeDefined()
    if (!result.filePath) throw new Error("agent install did not return a file path")
    const data = await frontmatter(result.filePath)
    expect(data.requirements).toEqual(item.content.requirements)
  })
})
