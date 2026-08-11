import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { existsSync } from "fs"
import path from "path"
import { Skill } from "../../src/skill"
import * as KiloSkill from "../../src/kilocode/skill-remove"
import { BUILTIN_SKILLS } from "../../src/kilocode/skills/builtin"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(AppNodeBuilder.build(Skill.node), AppNodeBuilder.build(CrossSpawnSpawner.node)))

it.instance(
  "built-in skills are present in empty project",
  () =>
    Effect.gen(function* () {
      const skill = yield* Skill.Service
      const skills = yield* skill.all()
      for (const builtin of BUILTIN_SKILLS) {
        const found = skills.find((s) => s.name === builtin.name)
        expect(found).toBeDefined()
        if (builtin.files) {
          expect(found!.location).toContain(path.join("builtin-skills", builtin.name, "SKILL.md"))
        } else {
          expect(found!.location).toBe(Skill.BUILTIN_LOCATION)
        }
        expect(found!.description).toBe(builtin.description)
        expect(found!.content.length).toBeGreaterThan(0)
      }
    }),
  { git: true },
)

it.instance(
  "built-in skill has correct metadata",
  () =>
    Effect.gen(function* () {
      const skill = yield* Skill.Service
      const item = yield* skill.get("kilo-config")
      expect(item).toBeDefined()
      expect(item!.name).toBe("kilo-config")
      expect(item!.location).toBe(Skill.BUILTIN_LOCATION)
      expect(item!.content).toContain("kilo")
    }),
  { git: true },
)

it.instance(
  "grill-me ships as an original built-in skill",
  () =>
    Effect.gen(function* () {
      const skill = yield* Skill.Service
      const item = yield* skill.get("grill-me")

      expect(item).toBeDefined()
      expect(item!.location).toBe(Skill.BUILTIN_LOCATION)
      expect(item!.content.startsWith("---\nname: grill-me\n")).toBe(true)
      expect(item!.content).toContain("Ask the questions one at a time.")
      expect(item!.content).toContain(
        "If a question can be answered by exploring the codebase, explore the codebase instead.",
      )
    }),
  { git: true },
)

it.instance(
  "document deliverable skills ship as built-ins without replacing QA",
  () =>
    Effect.gen(function* () {
      const skill = yield* Skill.Service

      const documents = yield* skill.get("documents")
      expect(documents).toBeDefined()
      expect(documents!.location).toBe(Skill.BUILTIN_LOCATION)
      expect(documents!.content.startsWith("---\n")).toBe(true)
      expect(documents!.content).not.toMatch(/^<hr\s*\/?/i)
      expect(documents!.content).toContain("not a QA pipeline")
      expect(documents!.content).toContain("generic Word/Mermaid/artifact guidance")
      expect(documents!.content).toContain("diagramId -> targetSection -> pngPath -> QA status")
      expect(documents!.content).toContain("sections[].blocks[]")
      expect(documents!.content).toContain("inspect_word_document.imageCount")
      expect(documents!.content).not.toContain("WordDocSpec")
      expect(documents!.content).not.toContain("FigureSpec")
      expect(documents!.content).not.toContain("artifactPath")

      const sourceBacked = yield* skill.get("source-backed-detail-design")
      expect(sourceBacked).toBeDefined()
      expect(sourceBacked!.location).toContain(path.join("builtin-skills", "source-backed-detail-design", "SKILL.md"))
      expect(sourceBacked!.content.startsWith("---\n")).toBe(true)
      expect(sourceBacked!.content).not.toMatch(/^<hr\s*\/?/i)
      expect(sourceBacked!.content).toContain("SBDD_JOB_REVISION=2026-08-chunked-v1")
      expect(sourceBacked!.content).toContain("source_backed_design_job")
      expect(sourceBacked!.content).toContain("普通 QA、普通 Mermaid、普通 Word")
      expect(sourceBacked!.content).toContain("不自动创建任务")
      expect(sourceBacked!.content).toContain("以后恢复完整任务必须重新显式加载本 Skill")
      expect(existsSync(path.join(path.dirname(sourceBacked!.location), "references", "01-core-principles.md"))).toBe(
        true,
      )
      expect(
        existsSync(
          path.join(path.dirname(sourceBacked!.location), "references", "15-business-flow-abstraction-rules.md"),
        ),
      ).toBe(true)

      const builtin = BUILTIN_SKILLS.find((item) => item.name === "source-backed-detail-design")
      expect(builtin).toBeDefined()
      for (const content of Object.values(builtin!.files ?? {})) {
        expect(content.startsWith("#")).toBe(true)
        expect(content).not.toMatch(/^<h[1-6]\b/i)
      }
    }),
  { git: true },
)

it.instance(
  "kilo-config is protected from removal",
  () =>
    Effect.gen(function* () {
      const skill = yield* Skill.Service
      const item = yield* skill.get("kilo-config")
      expect(item).toBeDefined()
      expect(KiloSkill.builtin(item!.location)).toBe(true)
    }),
  { git: true },
)

it.instance(
  "user skill overrides built-in with same name",
  () =>
    Effect.gen(function* () {
      const instance = yield* TestInstance
      const dir = path.join(instance.directory, ".kilo", "skill", "kilo-config")
      yield* Effect.promise(() =>
        Bun.write(
          path.join(dir, "SKILL.md"),
          `---
name: kilo-config
description: User override of kilo-config.
---

# Custom kilo-config

User-provided content.
`,
        ),
      )

      const skill = yield* Skill.Service
      const item = yield* skill.get("kilo-config")
      expect(item).toBeDefined()
      expect(item!.description).toBe("User override of kilo-config.")
      expect(item!.location).not.toBe(Skill.BUILTIN_LOCATION)
      expect(item!.location).toContain(path.join("skill", "kilo-config", "SKILL.md"))
    }),
  { git: true },
)
