import fs from "fs/promises"
import path from "path"
import { DOMParser, type Document, type Element, type Node } from "@xmldom/xmldom"
import { TextReader, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, ZipWriter } from "@zip.js/zip.js"
import { declareArtifact } from "@/kilocode/documents/artifacts"
import { Instance } from "@/kilocode/instance"

const REQUIRED_PARTS = ["[Content_Types].xml", "_rels/.rels", "word/document.xml"]
const CONTENT_TYPES_NAMESPACE = "http://schemas.openxmlformats.org/package/2006/content-types"
const PACKAGE_RELATIONSHIPS_NAMESPACE = "http://schemas.openxmlformats.org/package/2006/relationships"
const WORDPROCESSING_NAMESPACES = new Set([
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  "http://purl.oclc.org/ooxml/wordprocessingml/main",
])
const NAMESPACES = {
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
  pic: "http://schemas.openxmlformats.org/drawingml/2006/picture",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
} as const
const RELATIONSHIP_NAMESPACES = new Set([NAMESPACES.r, "http://purl.oclc.org/ooxml/officeDocument/relationships"])

export type WordDocumentDiagnostic = {
  part: string
  code: string
  message: string
  line?: number
  column?: number
  prefix?: string
}

export type WordDocumentRepair = {
  part: string
  code: "drawing-namespace-added" | "xml-control-character-replaced"
  message: string
  count: number
}

export type ValidateWordDocumentInput = {
  path: string
  repairMode?: "none" | "safe"
  outputFile?: string
  taskSlug?: string
}

export type ValidatedWordDocument = {
  status: "valid" | "repaired" | "invalid"
  sourcePath: string
  path?: string
  artifactDir?: string
  manifestPath?: string
  errors: WordDocumentDiagnostic[]
  warnings: WordDocumentDiagnostic[]
  repairs: WordDocumentRepair[]
}

type Package = {
  entries: Array<{ filename: string; bytes: Uint8Array }>
  names: Set<string>
  xml: Map<string, string>
}

type Analysis = {
  errors: WordDocumentDiagnostic[]
  warnings: WordDocumentDiagnostic[]
  pkg?: Package
}

type Outcome = {
  status: ValidatedWordDocument["status"]
  errors: WordDocumentDiagnostic[]
  warnings: WordDocumentDiagnostic[]
  repairs: WordDocumentRepair[]
  bytes?: Uint8Array
}

export async function validateWordDocument(input: ValidateWordDocumentInput): Promise<ValidatedWordDocument> {
  const absolute = resolveWorkspacePath(input.path)
  const sourcePath = normalizePortable(path.relative(Instance.directory, absolute))
  const bytes = new Uint8Array(await fs.readFile(absolute))
  const result = await validateWordDocumentBytes(bytes, input.repairMode ?? "none")
  if (result.status === "invalid" || !result.bytes) {
    return {
      status: "invalid",
      sourcePath,
      errors: result.errors,
      warnings: result.warnings,
      repairs: result.repairs,
    }
  }
  if (result.status === "valid") {
    return {
      status: "valid",
      sourcePath,
      path: sourcePath,
      errors: [],
      warnings: result.warnings,
      repairs: [],
    }
  }

  const outputFile = safeDocxName(
    input.outputFile ?? `${path.basename(input.path, path.extname(input.path))}-repaired.docx`,
  )
  const warnings = result.warnings.map((item) => `${item.code}: ${item.message}`)
  const artifact = await declareArtifact({
    kind: "word-document",
    title: `Repaired ${path.basename(input.path)}`,
    taskSlug: input.taskSlug ?? `${path.basename(input.path, path.extname(input.path))}-repaired`,
    primaryFile: outputFile,
    sourceFiles: [sourcePath],
    warnings,
    qualityStatus: warnings.length ? "warning" : "ok",
  })
  const dir = path.join(Instance.directory, artifact.artifactDir)
  const output = path.join(dir, artifact.manifest.primaryFile ?? outputFile)
  assertInside(dir, output, "outputFile")
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.writeFile(output, result.bytes)
  return {
    status: "repaired",
    sourcePath,
    path: normalizePortable(path.relative(Instance.directory, output)),
    artifactDir: artifact.artifactDir,
    manifestPath: artifact.manifestPath,
    errors: [],
    warnings: result.warnings,
    repairs: result.repairs,
  }
}

export async function assertValidWordDocumentBytes(bytes: Uint8Array, label: string): Promise<void> {
  const result = await validateWordDocumentBytes(bytes, "none")
  if (result.status === "valid") return
  throw new Error(`${label} is not a valid DOCX: ${formatDiagnostics(result.errors)}`)
}

export async function prepareWordDocumentBytes(
  bytes: Uint8Array,
  label: string,
): Promise<{ bytes: Uint8Array; warnings: string[]; repairs: WordDocumentRepair[] }> {
  const result = await validateWordDocumentBytes(bytes, "safe")
  if (result.status === "invalid" || !result.bytes)
    throw new Error(`${label} is not a valid DOCX: ${formatDiagnostics(result.errors)}`)
  return {
    bytes: result.bytes,
    warnings: result.warnings.map((item) => `${item.code}: ${item.message}`),
    repairs: result.repairs,
  }
}

export async function validateWordDocumentBytes(
  bytes: Uint8Array,
  repairMode: "none" | "safe" = "none",
): Promise<Outcome> {
  const first = await analyze(bytes)
  if (!first.errors.length) return { status: "valid", errors: [], warnings: first.warnings, repairs: [], bytes }
  if (repairMode === "none" || !first.pkg)
    return { status: "invalid", errors: first.errors, warnings: first.warnings, repairs: [] }

  const repaired = repair(first.pkg, first.errors)
  if (!repaired.repairs.length)
    return { status: "invalid", errors: first.errors, warnings: first.warnings, repairs: [] }
  const nextBytes = await writePackage(first.pkg, repaired.xml)
  const next = await analyze(nextBytes)
  if (next.errors.length)
    return {
      status: "invalid",
      errors: next.errors,
      warnings: [...first.warnings, ...next.warnings],
      repairs: repaired.repairs,
    }
  return {
    status: "repaired",
    errors: [],
    warnings: [
      ...next.warnings,
      ...repaired.repairs.map((item) => ({
        part: item.part,
        code: item.code,
        message: item.message,
      })),
    ],
    repairs: repaired.repairs,
    bytes: nextBytes,
  }
}

async function analyze(bytes: Uint8Array): Promise<Analysis> {
  const errors: WordDocumentDiagnostic[] = []
  const warnings: WordDocumentDiagnostic[] = []
  const pkg = await readPackage(bytes, errors)
  if (!pkg) return { errors, warnings }

  for (const part of REQUIRED_PARTS) {
    if (pkg.names.has(part)) continue
    errors.push({ part, code: "docx-part-missing", message: `Required OPC part is missing: ${part}` })
  }
  validatePartNames(pkg, errors)

  const docs = new Map<string, Document>()
  for (const [part, source] of pkg.xml) {
    const invalid = invalidCharacters(source)
    for (const item of invalid) {
      errors.push({
        part,
        code: "xml-invalid-character",
        message: `XML 1.0 forbids character U+${item.code.toString(16).toUpperCase().padStart(4, "0")}.`,
        line: item.line,
        column: item.column,
      })
    }
    if (invalid.length) continue

    const parsed = parseXml(part, source)
    errors.push(...parsed.errors)
    warnings.push(...parsed.warnings)
    if (parsed.doc) docs.set(part, parsed.doc)
  }

  validateMainDocument(docs, errors)
  validateContentTypes(pkg, docs, errors)
  validateRelationships(pkg, docs, errors)
  return { errors: uniqueDiagnostics(errors), warnings: uniqueDiagnostics(warnings), pkg }
}

async function readPackage(bytes: Uint8Array, errors: WordDocumentDiagnostic[]): Promise<Package | undefined> {
  const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(bytes)))
  try {
    const entries = await reader.getEntries()
    const names = new Set<string>()
    const data: Package["entries"] = []
    const xml = new Map<string, string>()
    for (const entry of entries) {
      if (entry.directory) continue
      if (names.has(entry.filename)) {
        errors.push({
          part: entry.filename,
          code: "docx-part-duplicate",
          message: `DOCX contains a duplicate ZIP part: ${entry.filename}`,
        })
        continue
      }
      names.add(entry.filename)
      const value = await entry.getData?.(new Uint8ArrayWriter())
      if (!value) {
        errors.push({
          part: entry.filename,
          code: "docx-part-unreadable",
          message: `DOCX part could not be read: ${entry.filename}`,
        })
        continue
      }
      data.push({ filename: entry.filename, bytes: value })
      if (!entry.filename.endsWith(".xml") && !entry.filename.endsWith(".rels")) continue
      try {
        xml.set(entry.filename, decodeXml(value))
      } catch (err) {
        errors.push({
          part: entry.filename,
          code: "xml-decode-error",
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }
    return { entries: data, names, xml }
  } catch (err) {
    errors.push({
      part: "[package]",
      code: "docx-zip-invalid",
      message: err instanceof Error ? err.message : String(err),
    })
    return undefined
  } finally {
    await reader.close().catch(() => undefined)
  }
}

function parseXml(part: string, source: string) {
  const errors: WordDocumentDiagnostic[] = []
  const warnings: WordDocumentDiagnostic[] = []
  const parser = new DOMParser({
    locator: true,
    onError: (level, message, context) => {
      const diagnostic = {
        part,
        code: "xml-parse-error",
        message,
        ...location(context?.locator),
      }
      if (level === "warning" && message.includes("Unicode replacement character detected")) {
        warnings.push({ ...diagnostic, code: "xml-replacement-character" })
        return
      }
      errors.push(diagnostic)
    },
  })
  const doc = (() => {
    try {
      return parser.parseFromString(source, "application/xml")
    } catch (err) {
      if (!errors.length) {
        const point = location((err as { locator?: unknown })?.locator)
        const message = err instanceof Error ? err.message : String(err)
        const prefixes = message.includes("NamespaceError") ? namespacePrefixesAt(source, point.line, point.column) : []
        if (prefixes.length) {
          errors.push(
            ...prefixes.map((prefix) => ({
              part,
              code: "xml-namespace-prefix-undefined",
              message: `Namespace prefix ${prefix} is not defined.`,
              prefix,
              ...point,
            })),
          )
          return undefined
        }
        errors.push({ part, code: "xml-parse-error", message, ...point })
      }
      return undefined
    }
  })()
  if (!doc?.documentElement) {
    if (!errors.length) errors.push({ part, code: "xml-root-missing", message: "XML part has no root element." })
    return { errors, warnings, doc }
  }

  for (const node of descendants(doc.documentElement)) {
    if (node.nodeType !== 1) continue
    const element = node as Element
    const prefix = element.prefix
    if (prefix && prefix !== "xml" && prefix !== "xmlns" && !element.namespaceURI) {
      errors.push({
        part,
        code: "xml-namespace-prefix-undefined",
        message: `Namespace prefix ${prefix} on ${element.nodeName} is not defined.`,
        prefix,
        ...location(element),
      })
    }
    const attributes = element.attributes
    for (let index = 0; index < attributes.length; index += 1) {
      const attribute = attributes.item(index)
      if (!attribute?.prefix || attribute.prefix === "xml" || attribute.prefix === "xmlns") continue
      if (attribute.namespaceURI) continue
      errors.push({
        part,
        code: "xml-namespace-prefix-undefined",
        message: `Namespace prefix ${attribute.prefix} on ${attribute.name} is not defined.`,
        prefix: attribute.prefix,
        ...location(attribute),
      })
    }
  }
  return { errors, warnings, doc }
}

function validateRelationships(pkg: Package, docs: Map<string, Document>, errors: WordDocumentDiagnostic[]): void {
  const ids = new Map<string, Set<string>>()
  let office = false
  for (const [part, doc] of docs) {
    if (!part.endsWith(".rels")) continue
    const source = relationshipSource(part)
    if (source && !pkg.names.has(source)) {
      errors.push({
        part,
        code: "relationship-source-missing",
        message: `Relationship part has no source part: ${source}`,
      })
    }
    const known = new Set<string>()
    ids.set(source ?? "", known)
    const root = doc.documentElement
    if (!root) continue
    if (root.localName !== "Relationships" || root.namespaceURI !== PACKAGE_RELATIONSHIPS_NAMESPACE) {
      errors.push({
        part,
        code: "relationships-root-invalid",
        message: "Relationship part must use the standard OPC Relationships root and namespace.",
        ...location(root),
      })
    }
    for (const rel of elements(root, "Relationship")) {
      const id = rel.getAttribute("Id")?.trim() ?? ""
      const target = rel.getAttribute("Target")?.trim() ?? ""
      const type = rel.getAttribute("Type")?.trim() ?? ""
      const duplicate = Boolean(id && known.has(id))
      if (!id) {
        errors.push({ part, code: "relationship-id-missing", message: "Relationship is missing Id.", ...location(rel) })
      }
      if (duplicate) {
        errors.push({
          part,
          code: "relationship-id-duplicate",
          message: `Relationship Id is duplicated: ${id}`,
          ...location(rel),
        })
      }
      if (id && !duplicate) known.add(id)
      if (!type) {
        errors.push({
          part,
          code: "relationship-type-missing",
          message: `Relationship ${id || "(missing Id)"} is missing Type.`,
          ...location(rel),
        })
      }
      if (!target) {
        errors.push({
          part,
          code: "relationship-target-empty",
          message: `Relationship ${id || "(missing Id)"} has an empty Target.`,
          ...location(rel),
        })
        continue
      }
      if (rel.getAttribute("TargetMode") === "External") continue
      const resolved = resolveRelationshipTarget(part, target)
      if (!resolved) {
        errors.push({
          part,
          code: "relationship-target-invalid",
          message: `Relationship ${id || "(missing Id)"} has an invalid internal target: ${target}`,
          ...location(rel),
        })
        continue
      }
      if (!pkg.names.has(resolved)) {
        errors.push({
          part,
          code: type.endsWith("/image") ? "media-target-missing" : "relationship-target-missing",
          message: `Relationship ${id || "(missing Id)"} target is missing: ${resolved}`,
          ...location(rel),
        })
        continue
      }
      if (part === "_rels/.rels" && type.endsWith("/officeDocument") && resolved === "word/document.xml") {
        office = true
      }
      if (!type.endsWith("/image")) continue
      const bytes = pkg.entries.find((entry) => entry.filename === resolved)?.bytes
      if (bytes && !validImageSignature(resolved, bytes)) {
        errors.push({
          part,
          code: "image-signature-invalid",
          message: `Image relationship ${id || "(missing Id)"} has bytes that do not match ${resolved}.`,
          ...location(rel),
        })
      }
    }
  }

  if (!office) {
    errors.push({
      part: "_rels/.rels",
      code: "office-document-relationship-missing",
      message: "Package relationships do not identify the main Word document.",
    })
  }

  for (const [part, doc] of docs) {
    if (part.endsWith(".rels")) continue
    const known = ids.get(part) ?? new Set<string>()
    for (const ref of relationshipReferences(doc)) {
      if (known.has(ref.id)) continue
      errors.push({
        part,
        code: "relationship-reference-missing",
        message: `${ref.name} references relationship ${ref.id}, but ${relationshipPart(part)} does not define it.`,
        ...location(ref.node),
      })
    }
  }
}

function validateContentTypes(pkg: Package, docs: Map<string, Document>, errors: WordDocumentDiagnostic[]): void {
  const part = "[Content_Types].xml"
  const doc = docs.get(part)
  const root = doc?.documentElement
  if (!root) return
  if (root.localName !== "Types" || root.namespaceURI !== CONTENT_TYPES_NAMESPACE) {
    errors.push({
      part,
      code: "content-types-root-invalid",
      message: "[Content_Types].xml must use the standard OPC Types root and namespace.",
      ...location(root),
    })
  }

  const defaults = new Map<string, string>()
  const overrides = new Map<string, string>()
  for (const item of elements(root, "Default")) {
    const ext = (item.getAttribute("Extension") ?? "").trim().toLowerCase()
    const type = (item.getAttribute("ContentType") ?? "").trim()
    if (!ext || !type) {
      errors.push({
        part,
        code: "content-type-default-invalid",
        message: "A Default content type requires Extension and ContentType.",
        ...location(item),
      })
      continue
    }
    if (defaults.has(ext)) {
      errors.push({
        part,
        code: "content-type-default-duplicate",
        message: `Default content type is duplicated for extension .${ext}.`,
        ...location(item),
      })
      continue
    }
    defaults.set(ext, type)
  }
  for (const item of elements(root, "Override")) {
    const name = (item.getAttribute("PartName") ?? "").trim()
    const type = (item.getAttribute("ContentType") ?? "").trim()
    const target = name.startsWith("/") ? name.slice(1) : ""
    if (!target || !type || target.includes("\\") || target.startsWith("../")) {
      errors.push({
        part,
        code: "content-type-override-invalid",
        message: "An Override content type requires an absolute package PartName and ContentType.",
        ...location(item),
      })
      continue
    }
    if (overrides.has(target)) {
      errors.push({
        part,
        code: "content-type-override-duplicate",
        message: `Override content type is duplicated for /${target}.`,
        ...location(item),
      })
      continue
    }
    overrides.set(target, type)
    if (pkg.names.has(target)) continue
    errors.push({
      part,
      code: "content-type-part-missing",
      message: `Content type override targets a missing part: /${target}`,
      ...location(item),
    })
  }

  for (const name of pkg.names) {
    if (name === part) continue
    const ext = packageExtension(name)
    if (overrides.has(name) || (ext && defaults.has(ext))) continue
    errors.push({
      part,
      code: "content-type-missing",
      message: `No content type is defined for package part /${name}.`,
    })
  }

  const main = overrides.get("word/document.xml")
  if (main === "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml") return
  errors.push({
    part,
    code: "main-document-content-type-invalid",
    message: "word/document.xml is not declared as the WordprocessingML main document part.",
  })
}

function validateMainDocument(docs: Map<string, Document>, errors: WordDocumentDiagnostic[]): void {
  const part = "word/document.xml"
  const root = docs.get(part)?.documentElement
  if (!root) return
  if (root.localName === "document" && root.namespaceURI && WORDPROCESSING_NAMESPACES.has(root.namespaceURI)) return
  errors.push({
    part,
    code: "main-document-root-invalid",
    message: "word/document.xml must use a WordprocessingML document root and namespace.",
    ...location(root),
  })
}

function validatePartNames(pkg: Package, errors: WordDocumentDiagnostic[]): void {
  for (const name of pkg.names) {
    const invalid =
      !name ||
      name.startsWith("/") ||
      name.includes("\\") ||
      name.split("/").some((segment) => !segment || segment === "." || segment === "..")
    if (!invalid) continue
    errors.push({
      part: name || "[package]",
      code: "docx-part-name-invalid",
      message: `DOCX contains an unsafe or invalid OPC part name: ${name || "(empty)"}`,
    })
  }
}

function packageExtension(name: string): string {
  const base = path.posix.basename(name)
  const index = base.lastIndexOf(".")
  return index < 0 ? "" : base.slice(index + 1).toLowerCase()
}

function relationshipReferences(doc: Document): Array<{ id: string; name: string; node: Node }> {
  const refs: Array<{ id: string; name: string; node: Node }> = []
  const root = doc.documentElement
  if (!root) return refs
  for (const node of descendants(root)) {
    if (node.nodeType !== 1) continue
    const attributes = (node as Element).attributes
    for (let index = 0; index < attributes.length; index += 1) {
      const attribute = attributes.item(index)
      if (!attribute?.namespaceURI || !RELATIONSHIP_NAMESPACES.has(attribute.namespaceURI)) continue
      const id = attribute.value.trim()
      if (id) refs.push({ id, name: attribute.name, node: attribute })
    }
  }
  return refs
}

function repair(pkg: Package, errors: WordDocumentDiagnostic[]) {
  const xml = new Map<string, string>()
  const repairs: WordDocumentRepair[] = []
  const byPart = new Map<string, WordDocumentDiagnostic[]>()
  for (const error of errors) {
    const items = byPart.get(error.part) ?? []
    items.push(error)
    byPart.set(error.part, items)
  }
  for (const [part, source] of pkg.xml) {
    const issues = byPart.get(part) ?? []
    const hasUndefinedPrefix = issues.some((item) => item.code === "xml-namespace-prefix-undefined")
    const prefixes = new Set(
      issues
        .filter((item) => item.code === "xml-namespace-prefix-undefined" && item.prefix)
        .map((item) => item.prefix!),
    )
    if (hasUndefinedPrefix) {
      for (const prefix of Object.keys(NAMESPACES)) {
        if (new RegExp(`(?:</?|\\s)${prefix}:[A-Za-z_][A-Za-z0-9_.-]*`).test(source)) prefixes.add(prefix)
      }
    }
    const declared = addNamespaces(source, prefixes)
    if (declared.count) {
      repairs.push({
        part,
        code: "drawing-namespace-added",
        message: `Added ${declared.count} missing standard DrawingML namespace declaration(s).`,
        count: declared.count,
      })
    }
    const controls = issues.some((item) => item.code === "xml-invalid-character")
      ? replaceStructuredControls(declared.xml)
      : { xml: declared.xml, count: 0 }
    if (controls.count) {
      repairs.push({
        part,
        code: "xml-control-character-replaced",
        message: `Replaced ${controls.count} invalid XML 1.0 control character(s) with U+FFFD in structured Word text.`,
        count: controls.count,
      })
    }
    if (declared.count || controls.count) xml.set(part, normalizeXmlDeclaration(controls.xml))
  }
  return { xml, repairs }
}

function addNamespaces(source: string, prefixes: Set<string>) {
  const root = /<([A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?)(?=[\s/>])[^>]*>/.exec(source)
  if (!root || root.index === undefined) return { xml: source, count: 0 }
  const values = [...prefixes]
    .filter((prefix): prefix is keyof typeof NAMESPACES => prefix in NAMESPACES)
    .filter((prefix) => !new RegExp(`\\bxmlns:${prefix}\\s*=`).test(root[0]))
  if (!values.length) return { xml: source, count: 0 }
  const end = root.index + root[0].length - (root[0].endsWith("/>") ? 2 : 1)
  const declarations = values.map((prefix) => ` xmlns:${prefix}="${NAMESPACES[prefix]}"`).join("")
  return { xml: `${source.slice(0, end)}${declarations}${source.slice(end)}`, count: values.length }
}

function replaceStructuredControls(source: string) {
  let count = 0
  const replace = (value: string) =>
    replaceInvalidCharacters(value, () => {
      count += 1
    })
  const text = source.replace(/(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g, (_, open, value, close) => {
    return `${open}${replace(value)}${close}`
  })
  const core = text.replace(/(<dc:title\b[^>]*>)([\s\S]*?)(<\/dc:title>)/g, (_, open, value, close) => {
    return `${open}${replace(value)}${close}`
  })
  const attrs = core.replace(/<(?:wp:docPr|pic:cNvPr)\b[^>]*>/g, (tag) => replace(tag))
  return { xml: attrs, count }
}

async function writePackage(pkg: Package, xml: Map<string, string>): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter())
  for (const entry of pkg.entries) {
    const source = xml.get(entry.filename)
    if (source !== undefined) {
      await writer.add(entry.filename, new TextReader(source))
      continue
    }
    await writer.add(entry.filename, new Uint8ArrayReader(entry.bytes))
  }
  return await writer.close()
}

function decodeXml(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return Buffer.from(bytes.subarray(2)).toString("utf16le")
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.from(bytes.subarray(2))
    for (let index = 0; index + 1 < swapped.length; index += 2) {
      const first = swapped[index]!
      swapped[index] = swapped[index + 1]!
      swapped[index + 1] = first
    }
    return swapped.toString("utf16le")
  }
  const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(start))
}

function invalidCharacters(source: string) {
  const result: Array<{ code: number; line: number; column: number }> = []
  for (let index = 0; index < source.length; ) {
    const code = source.codePointAt(index)!
    if (!validXmlCharacter(code)) {
      const point = lineColumn(source, index)
      result.push({ code, line: point.line, column: point.column })
    }
    index += code > 0xffff ? 2 : 1
  }
  return result
}

function replaceInvalidCharacters(source: string, onReplace: () => void): string {
  const result: string[] = []
  for (let index = 0; index < source.length; ) {
    const code = source.codePointAt(index)!
    if (validXmlCharacter(code)) result.push(String.fromCodePoint(code))
    if (!validXmlCharacter(code)) {
      result.push("\uFFFD")
      onReplace()
    }
    index += code > 0xffff ? 2 : 1
  }
  return result.join("")
}

function validXmlCharacter(code: number): boolean {
  return (
    code === 0x09 ||
    code === 0x0a ||
    code === 0x0d ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  )
}

function relationshipSource(part: string): string | undefined {
  if (part === "_rels/.rels") return undefined
  const match = part.match(/^(.*)\/_rels\/([^/]+)\.rels$/)
  if (!match) return undefined
  return `${match[1]}/${match[2]}`
}

function relationshipPart(source: string): string {
  const dir = path.posix.dirname(source)
  const file = `${path.posix.basename(source)}.rels`
  return dir === "." ? `_rels/${file}` : `${dir}/_rels/${file}`
}

function resolveRelationshipTarget(part: string, target: string): string | undefined {
  const value = target.split("#", 1)[0]!.split("?", 1)[0]!
  if (!value || value.includes("\\") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return undefined
  const source = relationshipSource(part)
  const base = source ? path.posix.dirname(source) : ""
  const resolved = value.startsWith("/")
    ? path.posix.normalize(value.slice(1))
    : path.posix.normalize(path.posix.join(base, value))
  if (!resolved || resolved === ".." || resolved.startsWith("../") || path.posix.isAbsolute(resolved)) return undefined
  return resolved
}

function validImageSignature(name: string, bytes: Uint8Array): boolean {
  const ext = path.extname(name).toLowerCase()
  if (ext === ".png") return starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (ext === ".jpg" || ext === ".jpeg") return starts(bytes, [0xff, 0xd8, 0xff])
  if (ext === ".gif") return ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a"
  if (ext === ".bmp") return ascii(bytes, 0, 2) === "BM"
  if (ext === ".tif" || ext === ".tiff")
    return starts(bytes, [0x49, 0x49, 0x2a, 0x00]) || starts(bytes, [0x4d, 0x4d, 0x00, 0x2a])
  if (ext === ".webp") return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP"
  if (ext === ".svg") return Buffer.from(bytes).toString("utf8").slice(0, 2_048).includes("<svg")
  if (ext === ".emf") return starts(bytes, [0x01, 0x00, 0x00, 0x00]) && ascii(bytes, 40, 4) === " EMF"
  if (ext === ".wmf") return starts(bytes, [0xd7, 0xcd, 0xc6, 0x9a]) || starts(bytes, [0x01, 0x00, 0x09, 0x00])
  return true
}

function starts(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value)
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return Buffer.from(bytes.subarray(offset, offset + length)).toString("ascii")
}

function* descendants(root: Node): Generator<Node> {
  yield root
  for (let index = 0; index < root.childNodes.length; index += 1) {
    const child = root.childNodes.item(index)
    if (child) yield* descendants(child)
  }
}

function elements(root: Node, localName: string): Element[] {
  return [...descendants(root)].filter(
    (node): node is Element =>
      node.nodeType === 1 && ((node as Element).localName === localName || node.nodeName === localName),
  )
}

function lineColumn(source: string, index: number) {
  const before = source.slice(0, index)
  const last = before.lastIndexOf("\n")
  return { line: before.split("\n").length, column: index - last }
}

function namespacePrefixesAt(source: string, line?: number, column?: number): string[] {
  if (!line || !column) return []
  const lines = source.split("\n")
  const row = lines[line - 1]
  if (!row) return []
  const offset = Math.max(0, column - 1)
  const start = Math.max(row.lastIndexOf("<", offset), 0)
  const end = row.indexOf(">", start)
  const tag = row.slice(start, end < 0 ? row.length : end + 1)
  const root = /<([A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?)(?=[\s/>])[^>]*>/.exec(source)?.[0] ?? ""
  const declared = new Set(
    [...`${root} ${tag}`.matchAll(/\bxmlns:([A-Za-z_][A-Za-z0-9_.-]*)\s*=/g)].map((match) => match[1]!),
  )
  return [
    ...new Set(
      [...tag.matchAll(/(?:<\/?|\s)([A-Za-z_][A-Za-z0-9_.-]*):[A-Za-z_][A-Za-z0-9_.-]*/g)]
        .map((match) => match[1]!)
        .filter((prefix) => prefix !== "xml" && prefix !== "xmlns" && !declared.has(prefix)),
    ),
  ]
}

function location(input: unknown): { line?: number; column?: number } {
  if (!input || typeof input !== "object") return {}
  const value = input as { lineNumber?: unknown; columnNumber?: unknown }
  return {
    ...(typeof value.lineNumber === "number" ? { line: value.lineNumber } : {}),
    ...(typeof value.columnNumber === "number" ? { column: value.columnNumber } : {}),
  }
}

function uniqueDiagnostics(input: WordDocumentDiagnostic[]): WordDocumentDiagnostic[] {
  const seen = new Set<string>()
  return input.filter((item) => {
    const key = JSON.stringify(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function normalizeXmlDeclaration(source: string): string {
  if (/^<\?xml\b/.test(source))
    return source.replace(/^<\?xml\b[^?]*\?>/, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${source}`
}

function formatDiagnostics(errors: WordDocumentDiagnostic[]): string {
  return errors
    .slice(0, 8)
    .map((item) => {
      const position = item.line ? `:${item.line}${item.column ? `:${item.column}` : ""}` : ""
      return `${item.part}${position} [${item.code}] ${item.message}`
    })
    .join("; ")
}

function resolveWorkspacePath(input: string): string {
  if (!input.trim()) throw new Error("path is required")
  const absolute = path.resolve(Instance.directory, input)
  assertInside(Instance.directory, absolute, "path")
  return absolute
}

function assertInside(base: string, target: string, label: string): void {
  const relative = path.relative(base, target)
  if (relative === "") return
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error(`${label} must be inside ${normalizePortable(path.relative(Instance.directory, base) || ".")}`)
}

function safeDocxName(input: string): string {
  const base =
    input
      .replace(/\.docx$/i, "")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96) || "document"
  return `${base}.docx`
}

function normalizePortable(input: string): string {
  return input.split(path.sep).join("/")
}
