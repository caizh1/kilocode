import { describe, expect, test } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import {
  declareArtifact,
  exportArtifactDiagnostics,
  listArtifacts,
  resolveOpenArtifact,
} from "../../src/kilocode/documents/artifacts"
import { provideTmpdirInstance } from "../fixture/fixture"

describe("kilocode document artifacts", () => {
  test("declares and lists artifact manifests under .kilo/artifacts", async () => {
    await Effect.runPromise(
      provideTmpdirInstance(
        (dir) =>
          Effect.promise(async () => {
            const artifact = await declareArtifact({
              kind: "word-document",
              title: "Interface Design",
              taskSlug: "interface design",
              primaryFile: "design.docx",
              derivedFiles: ["design.pdf", "rendered/page-001.png"],
              sourceFiles: ["source.md"],
              warnings: ["render endpoint not configured"],
              qualityStatus: "warning",
            })

            expect(artifact.artifactDir).toStartWith(".kilo/artifacts/")
            expect(artifact.manifestPath).toBe(`${artifact.artifactDir}/artifact.json`)
            expect(artifact.manifest).toMatchObject({
              kind: "word-document",
              title: "Interface Design",
              primaryFile: "design.docx",
              derivedFiles: ["design.pdf", "rendered/page-001.png"],
              sourceFiles: ["source.md"],
              warnings: ["render endpoint not configured"],
              quality: { status: "warning" },
            })

            const manifest = JSON.parse(await fs.readFile(path.join(dir, artifact.manifestPath), "utf8"))
            expect(manifest.title).toBe("Interface Design")
            expect(manifest.primaryFile).toBe("design.docx")

            const artifacts = await listArtifacts()
            expect(artifacts).toHaveLength(1)
            expect(artifacts[0]?.artifactDir).toBe(artifact.artifactDir)
            expect(artifacts[0]?.manifestPath).toBe(artifact.manifestPath)
          }),
        { git: true },
      ).pipe(Effect.scoped, Effect.provide(CrossSpawnSpawner.defaultLayer)),
    )
  })

  test("resolves artifact paths and exports diagnostics", async () => {
    await Effect.runPromise(
      provideTmpdirInstance(
        (dir) =>
          Effect.promise(async () => {
            const artifact = await declareArtifact({
              kind: "mermaid-diagram",
              title: "State Machine",
              taskSlug: "state-machine",
              primaryFile: "diagrams/state.png",
              qualityStatus: "ok",
            })
            const file = path.join(dir, artifact.artifactDir, "diagrams", "state.png")
            await fs.mkdir(path.dirname(file), { recursive: true })
            await fs.writeFile(file, "png")

            const openedFile = await resolveOpenArtifact({ path: `${artifact.artifactDir}/diagrams/state.png` })
            expect(openedFile.path).toBe(`${artifact.artifactDir}/diagrams/state.png`)
            expect(openedFile.isDirectory).toBe(false)

            const openedFolder = await resolveOpenArtifact({
              path: `${artifact.artifactDir}/diagrams/state.png`,
              target: "folder",
            })
            expect(openedFolder.path).toBe(`${artifact.artifactDir}/diagrams`)
            expect(openedFolder.isDirectory).toBe(true)

            const diagnostics = await exportArtifactDiagnostics()
            expect(diagnostics.path).toStartWith(".kilo/artifacts/artifact-diagnostics-")
            expect(diagnostics.diagnostics.artifacts).toHaveLength(1)
            expect(await fs.readFile(path.join(dir, diagnostics.path), "utf8")).toContain("State Machine")
          }),
        { git: true },
      ).pipe(Effect.scoped, Effect.provide(CrossSpawnSpawner.defaultLayer)),
    )
  })

  test("rejects paths outside the workspace or artifact root", async () => {
    await Effect.runPromise(
      provideTmpdirInstance(
        () =>
          Effect.promise(async () => {
            await expect(declareArtifact({ kind: "word-document", artifactDir: "../outside" })).rejects.toThrow(
              "artifactDir must be inside .kilo/artifacts",
            )
            await expect(
              declareArtifact({
                kind: "word-document",
                title: "Unsafe",
                primaryFile: "/tmp/unsafe.docx",
              }),
            ).rejects.toThrow("artifact file paths must be relative")
            await expect(resolveOpenArtifact({ path: "../outside/artifact.json" })).rejects.toThrow(
              "path must be inside .",
            )
          }),
        { git: true },
      ).pipe(Effect.scoped, Effect.provide(CrossSpawnSpawner.defaultLayer)),
    )
  })
})
