import { extname } from "node:path"
import { open, type Entry, type ZipFile } from "yauzl"
import type { ExtensionManifest } from "@chipmate/market-db"

const MANIFEST_LIMIT = 2 * 1024 * 1024
const README_LIMIT = 4 * 1024 * 1024
const ICON_LIMIT = 2 * 1024 * 1024
const EXPANDED_LIMIT = 4 * 1024 * 1024 * 1024
const ENTRY_LIMIT = 100_000
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

interface PackageJson {
  publisher?: unknown
  name?: unknown
  displayName?: unknown
  description?: unknown
  version?: unknown
  preview?: unknown
  engines?: { vscode?: unknown }
  categories?: unknown
  keywords?: unknown
  icon?: unknown
  extensionDependencies?: unknown
  extensionPack?: unknown
}

export async function inspectVsix(path: string): Promise<ExtensionManifest> {
  const first = await entries(
    path,
    new Map([
      ["extension/package.json", MANIFEST_LIMIT],
      ["extension/package.nls.json", MANIFEST_LIMIT],
      ["extension.vsixmanifest", MANIFEST_LIMIT],
      ["extension/readme.md", README_LIMIT],
      ["extension/readme.txt", README_LIMIT],
    ]),
  )
  const raw = first.get("extension/package.json")
  if (!raw) throw new Error("INVALID_VSIX: extension/package.json is required")
  if (!first.has("extension.vsixmanifest")) throw new Error("INVALID_VSIX: extension.vsixmanifest is required")
  const pkg = json<PackageJson>(raw, "extension/package.json")
  const xml = first.get("extension.vsixmanifest")?.toString("utf8") ?? ""
  const nls = first.get("extension/package.nls.json")
    ? json<Record<string, unknown>>(first.get("extension/package.nls.json")!, "extension/package.nls.json")
    : {}
  const publisher = text(pkg.publisher) || attribute(xml, "Publisher")
  const name = text(pkg.name) || attribute(xml, "Id")
  const version = text(pkg.version) || attribute(xml, "Version")
  if (!publisher || !name) throw new Error("INVALID_VSIX: publisher and name are required")
  if (!SEMVER.test(version)) throw new Error("INVALID_VSIX: version must be valid SemVer")
  const id = `${publisher}.${name}`.toLocaleLowerCase()
  if (!/^[a-z0-9][a-z0-9._-]{1,255}$/.test(id)) throw new Error("INVALID_VSIX: extension id is invalid")
  const target = normalizeTarget(attribute(xml, "TargetPlatform"))
  const icon = safeEntry(text(pkg.icon))
  const iconData = icon ? await iconUrl(path, `extension/${icon}`) : undefined
  const readme = first.get("extension/readme.md") ?? first.get("extension/readme.txt")
  const deps = [...strings(pkg.extensionDependencies), ...strings(pkg.extensionPack)]
  return {
    id,
    publisher,
    name,
    displayName: localized(text(pkg.displayName) || name, nls),
    description: localized(text(pkg.description) || "暂无描述", nls),
    version,
    target,
    engineVscode: text(pkg.engines?.vscode) || "*",
    categories: strings(pkg.categories).slice(0, 32),
    keywords: strings(pkg.keywords).slice(0, 64),
    dependencies: [...new Set(deps)].slice(0, 256),
    prerelease: version.includes("-") || pkg.preview === true || /PreRelease[^>]*Value=["']true["']/i.test(xml),
    systemPlugin: id === "chipmate.chipmate",
    readme: readme?.toString("utf8") ?? "",
    ...(iconData ? { iconData } : {}),
  }
}

export function safeVsixFilename(value: string): string {
  const base = value
    .normalize("NFKC")
    .replaceAll("\\", "/")
    .split("/")
    .at(-1)
    ?.split("")
    .map((char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? "-" : char))
    .join("")
    .replace(/[<>:"|?*]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180)
  if (!base?.toLocaleLowerCase().endsWith(".vsix")) throw new Error("INVALID_VSIX: filename must end with .vsix")
  return base
}

async function iconUrl(path: string, name: string): Promise<string | undefined> {
  const found = await entries(path, new Map([[name.toLocaleLowerCase(), ICON_LIMIT]]))
  const data = found.get(name.toLocaleLowerCase())
  if (!data) return undefined
  const mime = iconMime(name)
  if (!mime) return undefined
  return `data:${mime};base64,${data.toString("base64")}`
}

async function entries(path: string, wanted: Map<string, number>): Promise<Map<string, Buffer>> {
  const zip = await openZip(path)
  return new Promise((resolve, reject) => {
    const found = new Map<string, Buffer>()
    const state = { entries: 0, expanded: 0, done: false }
    const fail = (err: unknown) => {
      if (state.done) return
      state.done = true
      zip.close()
      reject(err instanceof Error ? err : new Error(String(err)))
    }
    zip.on("error", fail)
    zip.on("end", () => {
      if (state.done) return
      state.done = true
      zip.close()
      resolve(found)
    })
    zip.on("entry", (entry: Entry) => {
      try {
        state.entries += 1
        state.expanded += entry.uncompressedSize
        if (state.entries > ENTRY_LIMIT) throw new Error("ARCHIVE_UNSAFE: too many ZIP entries")
        if (state.expanded > EXPANDED_LIMIT) throw new Error("ARCHIVE_UNSAFE: expanded archive is too large")
        safeEntry(entry.fileName, true)
        if (entry.compressedSize > 0 && entry.uncompressedSize > 10 * 1024 * 1024) {
          if (entry.uncompressedSize / entry.compressedSize > 100)
            throw new Error("ARCHIVE_UNSAFE: suspicious compression ratio")
        }
        const key = entry.fileName.toLocaleLowerCase()
        const limit = wanted.get(key)
        if (!limit || entry.fileName.endsWith("/")) return zip.readEntry()
        if (entry.uncompressedSize > limit) throw new Error(`ARCHIVE_UNSAFE: ${entry.fileName} is too large`)
        zip.openReadStream(entry, (err, stream) => {
          if (err || !stream) return fail(err ?? new Error(`Unable to read ${entry.fileName}`))
          const chunks: Buffer[] = []
          const size = { value: 0 }
          stream.on("data", (chunk: Buffer) => {
            size.value += chunk.length
            if (size.value > limit) {
              stream.destroy(new Error(`ARCHIVE_UNSAFE: ${entry.fileName} is too large`))
              return
            }
            chunks.push(chunk)
          })
          stream.on("error", fail)
          stream.on("end", () => {
            found.set(key, Buffer.concat(chunks))
            zip.readEntry()
          })
        })
      } catch (err) {
        fail(err)
      }
    })
    zip.readEntry()
  })
}

function openZip(path: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    open(path, { lazyEntries: true, autoClose: false, validateEntrySizes: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error("Unable to open VSIX"))
      resolve(zip)
    })
  })
}

function json<T>(value: Buffer, name: string): T {
  try {
    return JSON.parse(value.toString("utf8")) as T
  } catch (err) {
    throw new Error(`INVALID_VSIX: ${name} is not valid JSON`, { cause: err })
  }
}

function safeEntry(value: string, required = false): string | undefined {
  const path = value.replaceAll("\\", "/").replace(/^\.\//, "")
  const unsafe =
    !path || path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.split("/").some((part) => part === "..")
  if (unsafe) {
    if (required) throw new Error(`ARCHIVE_UNSAFE: invalid ZIP path ${value}`)
    return undefined
  }
  return path
}

function attribute(xml: string, name: string): string {
  return xml.match(new RegExp(`\\b${name}=["']([^"']+)["']`, "i"))?.[1]?.trim() ?? ""
}

function localized(value: string, nls: Record<string, unknown>): string {
  const key = value.match(/^%(.+)%$/)?.[1]
  return key && typeof nls[key] === "string" ? String(nls[key]).trim() || value : value
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : []
}

function normalizeTarget(value: string): string {
  const target = value.trim().toLocaleLowerCase()
  return target && /^[a-z0-9._-]{1,64}$/.test(target) ? target : "universal"
}

function iconMime(path: string): string | undefined {
  const ext = extname(path).toLocaleLowerCase()
  if (ext === ".png") return "image/png"
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg"
  if (ext === ".webp") return "image/webp"
  if (ext === ".gif") return "image/gif"
  if (ext === ".svg") return "image/svg+xml"
  return undefined
}
