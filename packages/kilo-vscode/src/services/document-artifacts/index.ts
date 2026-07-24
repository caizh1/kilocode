import fs from "fs/promises"
import path from "path"
import * as vscode from "vscode"

const DEFAULT_ARTIFACT_ROOT = ".chipmate-v2/artifacts"
const ARTIFACT_ROOT_CONFIG = "chipmate.v2.documents.artifacts.root"
const DOCUMENT_TOOLS_ENABLED_CONFIG = "chipmate.v2.documents.tools.enabled"

export type ArtifactManifest = {
  kind: string
  title: string
  primaryFile?: string
  derivedFiles?: string[]
  warnings?: string[]
  quality?: { status?: "ok" | "warning" | "failed" | "unknown" }
}

export type DocumentArtifactCardLink = {
  kind: "primary" | "pdf" | "page-png" | "diagnostics" | "folder" | "source" | "json"
  label: string
  path: string
  webviewUri?: string
}

export type DocumentArtifactCard = {
  artifactDir: string
  title: string
  kind: string
  quality: "ok" | "warning" | "failed" | "unknown"
  warnings: string[]
  links: DocumentArtifactCardLink[]
}

export function registerDocumentArtifactCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("chipmate.v2.documents.openArtifact", async (input?: string | vscode.Uri) => {
      if (!(await ensureDocumentToolsEnabled())) return
      const uri = await resolveInput(input, "Artifact file or folder path")
      if (!uri) return
      await vscode.commands.executeCommand("vscode.open", uri)
    }),
    vscode.commands.registerCommand("chipmate.v2.documents.openArtifactFolder", async (input?: string | vscode.Uri) => {
      if (!(await ensureDocumentToolsEnabled())) return
      const uri = await resolveInput(input, "Artifact file or folder path")
      if (!uri) return
      const stat = await fs.stat(uri.fsPath)
      await vscode.commands.executeCommand(
        "revealFileInOS",
        stat.isDirectory() ? uri : vscode.Uri.file(path.dirname(uri.fsPath)),
      )
    }),
    vscode.commands.registerCommand("chipmate.v2.documents.exportDiagnostics", async () => {
      if (!(await ensureDocumentToolsEnabled())) return
      const root = artifactRoot()
      await fs.mkdir(root, { recursive: true })
      const diagnostics = {
        generatedAt: new Date().toISOString(),
        workspace: workspaceRoot(),
        root: artifactRootRelative(),
        artifacts: await readArtifacts(root),
      }
      const file = path.join(root, `artifact-diagnostics-${stamp()}.json`)
      await fs.writeFile(file, `${JSON.stringify(diagnostics, null, 2)}\n`, "utf8")
      const uri = vscode.Uri.file(file)
      await vscode.commands.executeCommand("vscode.open", uri)
    }),
  )
}

export function artifactManifestToCard(input: {
  artifactDir: string
  manifest: ArtifactManifest
  webview?: vscode.Webview
}): DocumentArtifactCard {
  const artifactDir = normalizeArtifactRelative(input.artifactDir)
  const files = [input.manifest.primaryFile, ...(input.manifest.derivedFiles ?? [])].filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  )
  const links = uniqueLinks([
    link("primary", "Open artifact", artifactPath(artifactDir, input.manifest.primaryFile)),
    ...files
      .filter((file) => /\.pdf$/i.test(file))
      .map((file) => link("pdf", "Open PDF", artifactPath(artifactDir, file))),
    ...files
      .filter((file) => /\.png$/i.test(file))
      .map((file, index) => pngLink(artifactDir, file, input.webview, index + 1)),
    ...files
      .filter((file) => /diagnostic|diagnostics/i.test(file))
      .map((file) => link("diagnostics", "Open diagnostics", artifactPath(artifactDir, file))),
    ...files
      .filter((file) => /\.json$/i.test(file) && !/diagnostic|diagnostics/i.test(file))
      .map((file) => link("json", "Open JSON", artifactPath(artifactDir, file))),
    ...files
      .filter((file) => /\.mmd$/i.test(file))
      .map((file) => link("source", "Open Mermaid source", artifactPath(artifactDir, file))),
    link("folder", "Open artifact folder", artifactDir),
  ])
  return {
    artifactDir,
    title: input.manifest.title || input.manifest.kind || "Document Artifact",
    kind: input.manifest.kind || "artifact",
    quality: quality(input.manifest.quality?.status, input.manifest.warnings ?? []),
    warnings: input.manifest.warnings ?? [],
    links,
  }
}

async function resolveInput(input: string | vscode.Uri | undefined, prompt: string): Promise<vscode.Uri | undefined> {
  if (input instanceof vscode.Uri) return ensureWorkspaceUri(input)
  const value = typeof input === "string" && input.trim() ? input : await vscode.window.showInputBox({ prompt })
  if (!value) return undefined
  return ensureWorkspaceUri(vscode.Uri.file(path.resolve(workspaceRoot(), value)))
}

function ensureWorkspaceUri(uri: vscode.Uri): vscode.Uri {
  const root = workspaceRoot()
  const relative = path.relative(root, uri.fsPath)
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return uri
  throw new Error(`Artifact path must be inside the current workspace: ${uri.fsPath}`)
}

function workspaceRoot(): string {
  const folder = vscode.workspace.workspaceFolders?.[0]
  if (!folder) throw new Error("A workspace folder is required to use document artifacts.")
  return folder.uri.fsPath
}

function artifactRoot(): string {
  return path.join(workspaceRoot(), ...artifactRootRelative().split("/"))
}

function artifactPath(artifactDir: string, file: string | undefined): string | undefined {
  if (!file?.trim()) return undefined
  const normalized = normalizeArtifactRelative(file)
  if (normalized === artifactDir || normalized.startsWith(`${artifactDir}/`)) return normalized
  return normalizeArtifactRelative(path.posix.join(artifactDir, normalized))
}

function pngLink(
  artifactDir: string,
  file: string,
  webview: vscode.Webview | undefined,
  index: number,
): DocumentArtifactCardLink {
  const relative = artifactPath(artifactDir, file) ?? file
  const absolute = vscode.Uri.file(path.join(workspaceRoot(), ...relative.split("/")))
  return {
    kind: "page-png",
    label: `Open page PNG ${index}`,
    path: relative,
    webviewUri: webview?.asWebviewUri(absolute).toString(),
  }
}

function link(
  kind: DocumentArtifactCardLink["kind"],
  label: string,
  input: string | undefined,
): DocumentArtifactCardLink | undefined {
  if (!input?.trim()) return undefined
  return { kind, label, path: input }
}

function uniqueLinks(input: Array<DocumentArtifactCardLink | undefined>): DocumentArtifactCardLink[] {
  const seen = new Set<string>()
  const result: DocumentArtifactCardLink[] = []
  for (const item of input) {
    if (!item) continue
    const key = `${item.kind}:${item.path}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

function quality(input: unknown, warnings: string[]): DocumentArtifactCard["quality"] {
  if (input === "ok" || input === "warning" || input === "failed" || input === "unknown") return input
  if (warnings.some((item) => /\bfailed|error\b/i.test(item))) return "failed"
  if (warnings.length) return "warning"
  return "unknown"
}

function normalizeArtifactRelative(input: string): string {
  return input
    .split(/[\\/]+/)
    .filter((part) => part && part !== "." && part !== "..")
    .join("/")
}

async function readArtifacts(root: string): Promise<unknown[]> {
  let entries: string[]
  try {
    entries = await fs.readdir(root)
  } catch (err) {
    if (isNotFound(err)) return []
    throw err
  }

  const artifacts: unknown[] = []
  const rootRelative = artifactRootRelative()
  for (const entry of entries.sort()) {
    const entryPath = path.join(root, entry)
    const stat = await fs.stat(entryPath)
    if (!stat.isDirectory()) continue
    const manifest = path.join(root, entry, "artifact.json")
    try {
      artifacts.push({
        artifactDir: path.posix.join(rootRelative, entry),
        manifestPath: path.posix.join(rootRelative, entry, "artifact.json"),
        manifest: JSON.parse(await fs.readFile(manifest, "utf8")),
      })
    } catch (err) {
      if (!isNotFound(err)) throw err
    }
  }
  return artifacts
}

function artifactRootRelative(): string {
  const configured = vscode.workspace.getConfiguration().get<string>(ARTIFACT_ROOT_CONFIG, DEFAULT_ARTIFACT_ROOT)
  return normalizeArtifactRelative(configured || DEFAULT_ARTIFACT_ROOT) || DEFAULT_ARTIFACT_ROOT
}

async function ensureDocumentToolsEnabled(): Promise<boolean> {
  const enabled = vscode.workspace.getConfiguration().get<boolean>(DOCUMENT_TOOLS_ENABLED_CONFIG, true)
  if (enabled) return true
  await vscode.window.showInformationMessage(
    "ChipMate document artifact commands are disabled by chipmate.v2.documents.tools.enabled.",
  )
  return false
}

function isNotFound(err: unknown): boolean {
  return !!err && typeof err === "object" && "code" in err && err.code === "ENOENT"
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-")
}
