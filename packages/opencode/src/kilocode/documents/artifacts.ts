import fs from "fs/promises"
import path from "path"
import { Instance } from "@/kilocode/instance"
import { ProductProfile } from "@/kilocode/product-profile"

export const DEFAULT_ARTIFACT_ROOT = `${ProductProfile.label()}/artifacts`
let nonce = 0

export type ArtifactQualityStatus = "ok" | "warning" | "failed" | "unknown"

export type ArtifactManifest = {
  kind: string
  title: string
  createdAt: string
  updatedAt: string
  primaryFile?: string
  derivedFiles: string[]
  sourceFiles: string[]
  warnings: string[]
  quality: {
    status: ArtifactQualityStatus
  }
}

export type DeclaredArtifact = {
  artifactDir: string
  manifestPath: string
  manifest: ArtifactManifest
}

export type ListedArtifact = DeclaredArtifact & {
  absoluteManifestPath: string
}

export type OpenArtifactResult = {
  path: string
  absolutePath: string
  isDirectory: boolean
}

export type ArtifactDiagnostics = {
  generatedAt: string
  workspace: string
  root: string
  artifacts: ListedArtifact[]
}

export type ArtifactDiagnosticsResult = {
  path: string
  absolutePath: string
  diagnostics: ArtifactDiagnostics
}

export async function declareArtifact(input: {
  kind: string
  title?: string
  taskSlug?: string
  artifactDir?: string
  primaryFile?: string
  derivedFiles?: string[]
  sourceFiles?: string[]
  warnings?: string[]
  qualityStatus?: ArtifactQualityStatus
  /** Remove files declared by the previous manifest when they are absent from the replacement set. */
  replaceDerivedFiles?: boolean
}): Promise<DeclaredArtifact> {
  const now = new Date().toISOString()
  const workspace = Instance.directory
  const root = artifactRootAbsolute(workspace)
  await fs.mkdir(root, { recursive: true })

  const absoluteDir = input.artifactDir
    ? resolveArtifactDir(input.artifactDir, workspace, root)
    : path.join(root, `${stamp()}-${slug(input.taskSlug ?? input.title ?? input.kind)}-${unique()}`)
  assertInside(root, absoluteDir, "artifactDir", workspace)
  await fs.mkdir(absoluteDir, { recursive: true })

  const manifestPath = path.join(absoluteDir, "artifact.json")
  const existing = await readManifest(manifestPath)
  const warnings = normalizeList(input.warnings ?? existing?.warnings ?? [])
  const manifest: ArtifactManifest = {
    kind: input.kind.trim() || existing?.kind || "artifact",
    title: (input.title ?? existing?.title ?? input.kind).trim() || "Artifact",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...(input.primaryFile !== undefined || existing?.primaryFile
      ? { primaryFile: normalizeArtifactRelative(input.primaryFile ?? existing?.primaryFile ?? "") }
      : {}),
    derivedFiles: normalizePathList(input.derivedFiles ?? existing?.derivedFiles ?? []),
    sourceFiles: normalizePathList(input.sourceFiles ?? existing?.sourceFiles ?? []),
    warnings,
    quality: {
      status: input.qualityStatus ?? existing?.quality?.status ?? (warnings.length > 0 ? "warning" : "unknown"),
    },
  }

  if (input.replaceDerivedFiles && existing) {
    const retained = new Set(manifest.derivedFiles)
    for (const file of existing.derivedFiles) {
      if (retained.has(file)) continue
      const target = path.resolve(absoluteDir, file)
      assertInside(absoluteDir, target, "derivedFile", workspace)
      await fs.rm(target, { force: true })
    }
  }

  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  return {
    artifactDir: relativeWorkspacePath(absoluteDir, workspace),
    manifestPath: relativeWorkspacePath(manifestPath, workspace),
    manifest,
  }
}

export async function listArtifacts(): Promise<ListedArtifact[]> {
  const workspace = Instance.directory
  return scan(workspace)
}

async function scan(workspace: string): Promise<ListedArtifact[]> {
  const root = artifactRootAbsolute(workspace)
  let entries: string[]
  try {
    entries = await fs.readdir(root)
  } catch (err) {
    if (isNotFound(err)) return []
    throw err
  }

  const artifacts: ListedArtifact[] = []
  for (const entry of entries.sort()) {
    const absoluteDir = path.join(root, entry)
    const stat = await statOrNull(absoluteDir)
    if (!stat?.isDirectory()) continue

    const absoluteManifestPath = path.join(absoluteDir, "artifact.json")
    const manifest = await readManifest(absoluteManifestPath)
    if (!manifest) continue

    artifacts.push({
      artifactDir: relativeWorkspacePath(absoluteDir, workspace),
      manifestPath: relativeWorkspacePath(absoluteManifestPath, workspace),
      absoluteManifestPath,
      manifest,
    })
  }
  return artifacts
}

export async function resolveOpenArtifact(input: {
  path: string
  target?: "path" | "folder"
}): Promise<OpenArtifactResult> {
  const workspace = Instance.directory
  const absolute = resolveWorkspaceRelative(input.path, workspace)
  const stat = await statOrThrow(absolute, workspace)
  const openPath = input.target === "folder" && !stat.isDirectory() ? path.dirname(absolute) : absolute
  const openStat = await statOrThrow(openPath, workspace)
  return {
    path: relativeWorkspacePath(openPath, workspace),
    absolutePath: openPath,
    isDirectory: openStat.isDirectory(),
  }
}

export async function exportArtifactDiagnostics(): Promise<ArtifactDiagnosticsResult> {
  const workspace = Instance.directory
  const root = artifactRootAbsolute(workspace)
  await fs.mkdir(root, { recursive: true })
  const diagnostics: ArtifactDiagnostics = {
    generatedAt: new Date().toISOString(),
    workspace,
    root: relativeWorkspacePath(root, workspace),
    artifacts: await scan(workspace),
  }
  const absolutePath = path.join(root, `artifact-diagnostics-${stamp()}.json`)
  await fs.writeFile(absolutePath, `${JSON.stringify(diagnostics, null, 2)}\n`, "utf8")
  return {
    path: relativeWorkspacePath(absolutePath, workspace),
    absolutePath,
    diagnostics,
  }
}

function artifactRootAbsolute(workspace: string): string {
  return path.join(workspace, DEFAULT_ARTIFACT_ROOT)
}

function resolveArtifactDir(input: string, workspace: string, root: string): string {
  if (!input.trim()) throw new Error("artifactDir is required")
  const absolute = path.resolve(workspace, input)
  assertInside(root, absolute, "artifactDir", workspace)
  return absolute
}

function resolveWorkspaceRelative(input: string, workspace: string): string {
  if (!input.trim()) throw new Error("path is required")
  const absolute = path.resolve(workspace, input)
  assertInside(workspace, absolute, "path", workspace)
  return absolute
}

function relativeWorkspacePath(input: string, workspace: string): string {
  return normalizePortable(path.relative(workspace, input))
}

function assertInside(base: string, target: string, label: string, workspace: string): void {
  const relative = path.relative(base, target)
  if (relative === "") return
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} must be inside ${normalizePortable(path.relative(workspace, base) || ".")}`)
  }
}

function normalizeArtifactRelative(input: string): string {
  if (!input.trim()) return ""
  if (path.isAbsolute(input)) throw new Error(`artifact file paths must be relative: ${input}`)
  const normalized = path.normalize(input)
  if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`artifact file paths must stay inside the artifact directory: ${input}`)
  }
  return normalizePortable(normalized)
}

function normalizePathList(input: string[]): string[] {
  return normalizeList(input).map(normalizeArtifactRelative).filter(Boolean)
}

function normalizeList(input: string[]): string[] {
  return input.map((item) => item.trim()).filter(Boolean)
}

async function readManifest(input: string): Promise<ArtifactManifest | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(input, "utf8")) as Partial<ArtifactManifest>
    if (!parsed || typeof parsed !== "object") return null
    if (typeof parsed.kind !== "string" || typeof parsed.title !== "string") return null
    return {
      kind: parsed.kind,
      title: parsed.title,
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      ...(typeof parsed.primaryFile === "string" ? { primaryFile: parsed.primaryFile } : {}),
      derivedFiles: Array.isArray(parsed.derivedFiles)
        ? parsed.derivedFiles.filter((item): item is string => typeof item === "string")
        : [],
      sourceFiles: Array.isArray(parsed.sourceFiles)
        ? parsed.sourceFiles.filter((item): item is string => typeof item === "string")
        : [],
      warnings: Array.isArray(parsed.warnings)
        ? parsed.warnings.filter((item): item is string => typeof item === "string")
        : [],
      quality: {
        status: qualityStatus(parsed.quality?.status),
      },
    }
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

function qualityStatus(input: unknown): ArtifactQualityStatus {
  if (input === "ok" || input === "warning" || input === "failed" || input === "unknown") return input
  return "unknown"
}

async function statOrNull(input: string) {
  try {
    return await fs.stat(input)
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

async function statOrThrow(input: string, workspace: string) {
  const stat = await statOrNull(input)
  if (!stat) throw new Error(`path does not exist: ${relativeWorkspacePath(input, workspace)}`)
  return stat
}

function isNotFound(err: unknown): boolean {
  return !!err && typeof err === "object" && "code" in err && err.code === "ENOENT"
}

function normalizePortable(input: string): string {
  return input.split(path.sep).join("/")
}

function slug(input: string): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return cleaned || "artifact"
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-")
}

function unique(): string {
  nonce = (nonce + 1) % Number.MAX_SAFE_INTEGER
  return `${process.pid}-${Date.now()}-${nonce}`
}
