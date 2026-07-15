import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { deflateRawSync, gzipSync } from "node:zlib"
import {
  DETERMINISTIC_REPAIRS,
  SKILL_ID_PATTERN,
  SKILL_IGNORES,
  SKILL_LIMITS,
  SKILL_ROOT_FILE,
  applySkillPatches,
  createCanonicalArchive,
  readSkillArchive,
  repairPortableMetadata,
  validateSkillFiles,
  validateSkillArchive,
} from "../src/index.ts"
import { discoverSkillCandidates } from "../src/node.ts"

test("skill format and safety limits are explicit", () => {
  assert.equal(SKILL_ROOT_FILE, "SKILL.md")
  assert.equal(SKILL_ID_PATTERN.test("source-backed-detail-design"), true)
  assert.equal(SKILL_ID_PATTERN.test("../unsafe"), false)
  assert.ok(SKILL_IGNORES.includes("node_modules"))
  assert.equal(SKILL_LIMITS.uploadBytes, 50 * 1024 * 1024)
  assert.ok(DETERMINISTIC_REPAIRS.every((repair) => repair.semantic === false))
})

test("AI repair patches require exact before and after hashes before full revalidation", () => {
  const root = mkdtempSync(join(tmpdir(), "chipmate-spec-ai-"))
  try {
    const dir = join(root, "tiny-skill")
    mkdirSync(dir)
    writeFileSync(join(dir, "SKILL.md"), "---\nname: Tiny\ndescription: Tiny instructions\n---\n\n# Tiny\n\nx\n")
    const archive = join(root, "tiny.tar.gz")
    execFileSync("tar", ["-czf", archive, "-C", root, "tiny-skill"], { env: { ...process.env, COPYFILE_DISABLE: "1" } })
    const result = validateSkillArchive(readFileSync(archive))
    assert.equal(result.valid, false)
    assert.equal(result.stage, "semantic")
    const deterministic = result.changes.find((change) => change.path === "SKILL.md")
    assert.ok(deterministic)
    const current = Buffer.from(deterministic.patch.slice("replace-base64:".length), "base64")
    const repaired = Buffer.from(
      `${current.toString("utf8").trimEnd()}\n\nUse this Skill to produce clear, source-backed engineering instructions.\n`,
    )
    const applied = applySkillPatches(result.archive, [
      {
        path: "SKILL.md",
        beforeSha256: createHash("sha256").update(current).digest("hex"),
        afterSha256: createHash("sha256").update(repaired).digest("hex"),
        patch: `replace-base64:${repaired.toString("base64")}`,
      },
    ])
    assert.equal(applied.valid, true)
    assert.throws(
      () =>
        applySkillPatches(result.archive, [
          {
            path: "SKILL.md",
            beforeSha256: "0".repeat(64),
            afterSha256: createHash("sha256").update(repaired).digest("hex"),
            patch: `replace-base64:${repaired.toString("base64")}`,
          },
        ]),
      /before hash mismatch/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("validation preserves SKILL.md bytes when portable metadata needs no repair", () => {
  const root = mkdtempSync(join(tmpdir(), "chipmate-spec-"))
  try {
    const dir = join(root, "my-skill")
    mkdirSync(join(dir, "node_modules"), { recursive: true })
    const original = "---\n# retain formatting\nname: my-skill\ndescription: A useful skill\nversion: 1.2.3\n---\n\n# Guide\n\nKeep this body.\r\n"
    writeFileSync(join(dir, "skill.md"), original)
    writeFileSync(join(dir, "node_modules", "ignored.js"), "ignored")
    const archive = join(root, "input.tar.gz")
    execFileSync("tar", ["-czf", archive, "-C", root, "my-skill"], { env: { ...process.env, COPYFILE_DISABLE: "1" } })
    const result = validateSkillArchive(readFileSync(archive))
    assert.equal(result.valid, true)
    assert.equal(result.spec.id, "my-skill")
    assert.equal(result.semver, "1.2.3")
    assert.ok(result.issues.some((issue) => issue.code === "skill-filename"))
    assert.ok(result.issues.some((issue) => issue.code === "skill-json-create"))

    const output = join(root, "output.tar.gz")
    const extracted = join(root, "output")
    writeFileSync(output, result.archive)
    mkdirSync(extracted)
    execFileSync("tar", ["-xzf", output, "-C", extracted])
    const markdown = readFileSync(join(extracted, "my-skill", "SKILL.md"), "utf8")
    assert.equal(markdown, original)
    assert.equal(result.issues.some((issue) => issue.code === "frontmatter-normalize"), false)
    assert.equal(readFileSync(join(extracted, "my-skill", "skill.json"), "utf8").includes('"id": "my-skill"'), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("missing frontmatter, unsafe ids, and empty descriptions normalize to bounded metadata", () => {
  const missing = validateSkillArchive(
    tar([
      { path: "missing/SKILL.md", data: Buffer.from("# Missing\n\nUse reliable source evidence for each answer.\n") },
    ]),
  )
  assert.equal(missing.valid, true)
  assert.equal(missing.spec.id, "missing")
  assert.equal(missing.spec.description, "Use reliable source evidence for each answer.")
  assert.ok(missing.issues.some((issue) => issue.code === "frontmatter-normalize"))

  const unsafe = validateSkillArchive(
    tar([
      {
        path: "unsafe/SKILL.md",
        data: Buffer.from(
          "---\nid: ../escape\nname: Unsafe\ndescription:\n---\n\n# Safe\n\nGenerate bounded engineering evidence.\n",
        ),
      },
    ]),
  )
  assert.equal(unsafe.valid, true)
  assert.equal(unsafe.spec.id, "escape")
  assert.equal(unsafe.spec.description, "Generate bounded engineering evidence.")
  assert.equal(SKILL_ID_PATTERN.test(unsafe.spec.id), true)
})

test("security validation rejects secrets, XSS, hidden archives, malformed images, and symlinks", () => {
  const root = mkdtempSync(join(tmpdir(), "chipmate-spec-security-"))
  try {
    const dir = join(root, "unsafe-skill")
    mkdirSync(dir)
    writeFileSync(
      join(dir, "SKILL.md"),
      "---\nname: Unsafe\ndescription: Unsafe\n---\n<script>alert(1)</script>\n[unsafe](data:text/html,boom)\napi_key=sk-abcdefghijklmnop\n",
    )
    writeFileSync(join(dir, "nested.zip"), "not really a zip")
    writeFileSync(join(dir, "hidden.dat"), Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]))
    writeFileSync(join(dir, "cover.png"), "not a png")
    symlinkSync("SKILL.md", join(dir, "linked.md"))
    const archive = join(root, "unsafe.tar.gz")
    execFileSync("tar", ["-czf", archive, "-C", root, "unsafe-skill"], {
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    })
    const result = validateSkillArchive(readFileSync(archive))
    const codes = new Set(result.issues.map((issue) => issue.code))
    assert.equal(result.valid, false)
    assert.ok(codes.has("security-link"))
    assert.ok(codes.has("security-secret"))
    assert.ok(codes.has("security-markdown-xss"))
    assert.ok(codes.has("security-nested-archive"))
    assert.ok(codes.has("security-image-invalid"))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("adversarial archives fail closed across paths, headers, limits, binaries, and image dimensions", () => {
  const skill = Buffer.from(
    "---\nname: Unsafe\ndescription: Security fixture\n---\n\n# Unsafe\n\nActionable instructions.\n",
  )
  const path = validateSkillArchive(
    tar([
      { path: "unsafe/SKILL.md", data: skill },
      { path: "../escape.txt", data: Buffer.from("escape") },
      { path: "/absolute.txt", data: Buffer.from("absolute") },
    ]),
  )
  assert.ok(path.issues.some((issue) => issue.code === "security-path"))

  const link = validateSkillArchive(
    tar([
      { path: "unsafe/SKILL.md", data: skill },
      { path: "unsafe/link.md", data: Buffer.alloc(0), type: "2" },
    ]),
  )
  assert.ok(link.issues.some((issue) => issue.code === "security-link"))

  const device = validateSkillArchive(
    tar([
      { path: "unsafe/SKILL.md", data: skill },
      { path: "unsafe/device", data: Buffer.alloc(0), type: "3" },
    ]),
  )
  assert.ok(device.issues.some((issue) => issue.code === "security-entry-type"))

  const binary = validateSkillArchive(
    tar([
      { path: "unsafe/SKILL.md", data: skill },
      { path: "unsafe/tool.dat", data: Buffer.from([0x7f, 0x45, 0x4c, 0x46]) },
    ]),
  )
  assert.ok(binary.issues.some((issue) => issue.code === "security-executable"))

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", Buffer.concat([u32(5_000), u32(5_000), Buffer.from([8, 6, 0, 0, 0])])),
    chunk("IEND", Buffer.alloc(0)),
  ])
  const image = validateSkillArchive(
    tar([
      { path: "unsafe/SKILL.md", data: skill },
      { path: "unsafe/cover.png", data: png },
    ]),
  )
  assert.ok(image.issues.some((issue) => issue.code === "security-image-size"))

  const checksum = raw([{ path: "unsafe/SKILL.md", data: skill }])
  checksum[0] = checksum[0] === 0x75 ? 0x76 : 0x75
  assert.ok(validateSkillArchive(gzipSync(checksum)).issues.some((issue) => issue.code === "security-archive-header"))

  const truncated = Buffer.concat([header("unsafe/SKILL.md", 1024), Buffer.alloc(10)])
  assert.ok(
    validateSkillArchive(gzipSync(truncated)).issues.some((issue) => issue.code === "security-archive-truncated"),
  )

  assert.throws(() => validateSkillArchive(Buffer.alloc(SKILL_LIMITS.uploadBytes + 1)), /compressed size limit/)
  assert.throws(() => validateSkillArchive(gzipSync(Buffer.alloc(SKILL_LIMITS.extractedBytes + 1))))

  const huge = validateSkillArchive(
    tar([
      { path: "unsafe/SKILL.md", data: skill },
      { path: "unsafe/large.txt", data: Buffer.alloc(SKILL_LIMITS.fileBytes + 1) },
    ]),
  )
  assert.ok(huge.issues.some((issue) => issue.code === "security-file-size"))

  const many = validateSkillArchive(
    tar([
      { path: "unsafe/SKILL.md", data: skill },
      ...Array.from({ length: SKILL_LIMITS.files }, (_, index) => ({
        path: `unsafe/files/${index}.txt`,
        data: Buffer.from("x"),
      })),
    ]),
  )
  assert.ok(many.issues.some((issue) => issue.code === "security-file-count"))
})

test("portable metadata keeps comments, vendor fields, Agent Skills fields, and market metadata authority", () => {
  const markdown = [
    "---",
    "# keep this comment",
    "name: Mixed Name",
    "description: Portable instructions",
    "license: Apache-2.0",
    "compatibility: Requires git",
    "allowed-tools: Read Bash",
    "metadata:",
    "  owner: tools",
    "x-claude-field: keep-me",
    "---",
    "",
    "# Portable",
    "",
    "Use this Skill to produce actionable, source-backed engineering output.",
    "",
  ].join("\n")
  const result = validateSkillFiles("portable-skill", [
    { path: "SKILL.md", data: Buffer.from(markdown) },
    {
      path: "skill.json",
      data: Buffer.from(
        JSON.stringify({
          id: "portable-skill",
          name: "Legacy market name",
          description: "Legacy market description",
          semver: "2.3.4",
          version: "9.9.9",
          vendor: { display: "glass" },
        }),
      ),
    },
    { path: "agents/openai.yaml", data: Buffer.from("interface:\n  display_name: Portable\n") },
    { path: "LICENSE", data: Buffer.from("Apache License 2.0\n") },
  ])
  assert.equal(result.valid, true)
  assert.equal(result.spec.name, "mixed-name")
  assert.equal(result.spec.description, "Portable instructions")
  assert.equal(result.semver, "2.3.4")
  const files = readSkillArchive(result.archive)
  const skill = files.find((file) => file.path === "SKILL.md")?.data.toString("utf8") ?? ""
  assert.match(skill, /# keep this comment/)
  assert.match(skill, /license: Apache-2\.0/)
  assert.match(skill, /allowed-tools: Read Bash/)
  assert.match(skill, /x-claude-field: keep-me/)
  assert.ok(files.some((file) => file.path === "LICENSE"))
  const market = JSON.parse(files.find((file) => file.path === "skill.json")!.data.toString("utf8")) as Record<
    string,
    unknown
  >
  assert.equal(market.name, undefined)
  assert.equal(market.description, undefined)
  assert.deepEqual(market.vendor, { display: "glass" })
  assert.equal(market.semver, "2.3.4")

  const repaired = repairPortableMetadata(markdown, { name: "portable-skill", description: "Updated description" })
  assert.match(repaired, /# keep this comment/)
  assert.match(repaired, /x-claude-field: keep-me/)
  assert.match(repaired, /description: Updated description/)
})

test("canonical archives are deterministic across input order and preserve all safe resources", () => {
  const files = [
    {
      path: "SKILL.md",
      data: Buffer.from(
        "---\nname: deterministic-skill\ndescription: Deterministic output\n---\n\n# Guide\n\nProduce stable, actionable output.\n",
      ),
    },
    { path: "references/guide.md", data: Buffer.from("guide\n") },
    { path: "assets/data.json", data: Buffer.from('{"ok":true}\n') },
    { path: "templates/report.md", data: Buffer.from("# Report\n") },
    { path: "examples/sample.txt", data: Buffer.from("sample\n") },
    { path: "agents/openai.yaml", data: Buffer.from("interface:\n  display_name: Deterministic\n") },
  ]
  const first = createCanonicalArchive("deterministic-skill", files)
  const second = createCanonicalArchive("deterministic-skill", files.toReversed())
  assert.equal(createHash("sha256").update(first).digest("hex"), createHash("sha256").update(second).digest("hex"))
  assert.deepEqual(
    readSkillArchive(first).map((file) => file.path).toSorted(),
    files.map((file) => file.path).toSorted(),
  )
})

test("folder, direct SKILL.md, ZIP, TAR.GZ, nested Skills, and platform hints are discovered", async () => {
  const root = mkdtempSync(join(tmpdir(), "chipmate-discovery-"))
  try {
    const repo = join(root, "repo")
    const parent = join(repo, "parent")
    const child = join(parent, "nested")
    mkdirSync(child, { recursive: true })
    writeFileSync(join(parent, "SKILL.md"), body("parent-skill", "Parent instructions"))
    writeFileSync(join(parent, "guide.md"), "Parent guide\n")
    writeFileSync(join(child, "SKILL.md"), body("child-skill", "Child instructions"))
    writeFileSync(join(child, "child.md"), "Child guide\n")
    const folder = await discoverSkillCandidates(parent)
    assert.equal(folder.length, 2)
    assert.equal(folder[0]?.files.some((file) => file.path.includes("nested/")), false)
    const direct = await discoverSkillCandidates(join(child, "SKILL.md"))
    assert.deepEqual(direct.map((item) => item.id), ["child-skill"])

    const archive = zip([
      { path: "wrapper/one/SKILL.md", data: Buffer.from(body("one-skill", "One instructions")) },
      { path: "wrapper/one/agents/openai.yaml", data: Buffer.from("interface:\n  display_name: One\n") },
      { path: "wrapper/two/SKILL.md", data: Buffer.from(body("two-skill", "Two instructions")) },
    ])
    const zipFile = join(root, "skills.zip")
    writeFileSync(zipFile, archive)
    const zipped = await discoverSkillCandidates(zipFile)
    assert.equal(zipped.length, 2)
    assert.ok(zipped.find((item) => item.id === "one-skill")?.hints.includes("codex"))

    const openZip = join(root, "opencode.zip")
    writeFileSync(
      openZip,
      zip([
        {
          path: ".opencode/skills/zipped-open/SKILL.md",
          data: Buffer.from(body("zipped-open", "Zipped OpenCode instructions")),
        },
      ]),
    )
    assert.ok((await discoverSkillCandidates(openZip))[0]?.hints.includes("opencode"))

    const tarFile = join(root, "single.tar.gz")
    writeFileSync(
      tarFile,
      createCanonicalArchive("tar-skill", [
        { path: "SKILL.md", data: Buffer.from(body("tar-skill", "Tar instructions")) },
      ]),
    )
    assert.deepEqual((await discoverSkillCandidates(tarFile)).map((item) => item.id), ["tar-skill"])

    const claude = join(repo, ".claude", "skills", "claude-skill")
    const opencode = join(repo, ".opencode", "skills", "open-skill")
    mkdirSync(claude, { recursive: true })
    mkdirSync(opencode, { recursive: true })
    writeFileSync(
      join(claude, "SKILL.md"),
      `${body("claude-skill", "Claude instructions").replace("---\n\n", "user-invocable: true\n---\n\n")}`,
    )
    writeFileSync(join(opencode, "SKILL.md"), body("open-skill", "OpenCode instructions"))
    const platforms = await discoverSkillCandidates(repo)
    assert.ok(platforms.find((item) => item.id === "claude-skill")?.hints.includes("claude"))
    assert.ok(platforms.find((item) => item.id === "open-skill")?.hints.includes("opencode"))

    const missing = join(repo, "missing")
    mkdirSync(missing)
    writeFileSync(join(missing, "SKILL.md"), "# Missing metadata\n\nProvide actionable engineering instructions.\n")
    const suggested = await discoverSkillCandidates(join(missing, "SKILL.md"))
    expectRepairs(suggested[0]?.repairs ?? [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("ZIP traversal, case collisions, encryption, and compression bombs fail closed", async () => {
  const root = mkdtempSync(join(tmpdir(), "chipmate-zip-security-"))
  try {
    for (const [name, bytes, pattern] of [
      [
        "traversal.zip",
        zip([
          { path: "safe/SKILL.md", data: Buffer.from(body("safe-skill", "Safe instructions")) },
          { path: "../escape.txt", data: Buffer.from("escape") },
        ]),
        /Unsafe ZIP entry path/,
      ],
      [
        "collision.zip",
        zip([
          { path: "safe/SKILL.md", data: Buffer.from(body("safe-skill", "Safe instructions")) },
          { path: "safe/skill.md", data: Buffer.from(body("duplicate", "Duplicate instructions")) },
        ]),
        /case-colliding/,
      ],
      [
        "encrypted.zip",
        zip([{ path: "safe/SKILL.md", data: Buffer.from(body("safe-skill", "Safe instructions")) }], 1),
        /Encrypted ZIP entries/,
      ],
      [
        "bomb.zip",
        zip([
          { path: "safe/SKILL.md", data: Buffer.from(body("safe-skill", "Safe instructions")) },
          { path: "safe/references/zeros.txt", data: Buffer.alloc(2 * 1024 * 1024) },
        ]),
        /compression ratio/,
      ],
    ] as const) {
      const file = join(root, name)
      writeFileSync(file, bytes)
      await assert.rejects(() => discoverSkillCandidates(file), pattern)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("safe PDF and OOXML pass while active documents and external relationships fail", () => {
  const skill = { path: "SKILL.md", data: Buffer.from(body("document-skill", "Document instructions")) }
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\nxref\n0 1\n0000000000 65535 f \ntrailer\n<<>>\n%%EOF\n")
  const docx = zip([
    { path: "[Content_Types].xml", data: Buffer.from("<Types/>") },
    { path: "_rels/.rels", data: Buffer.from("<Relationships/>") },
    { path: "word/document.xml", data: Buffer.from("<document/>") },
  ])
  const safe = validateSkillFiles("document-skill", [
    skill,
    { path: "assets/guide.pdf", data: pdf },
    { path: "templates/guide.docx", data: docx },
  ])
  assert.equal(safe.valid, true)

  const activePdf = validateSkillFiles("document-skill", [
    skill,
    { path: "assets/active.pdf", data: Buffer.concat([pdf.subarray(0, -7), Buffer.from("/JavaScript\n%%EOF\n")]) },
  ])
  assert.ok(activePdf.issues.some((issue) => issue.code === "security-pdf-active-content"))

  const external = validateSkillFiles("document-skill", [
    skill,
    {
      path: "templates/external.docx",
      data: zip([
        { path: "[Content_Types].xml", data: Buffer.from("<Types/>") },
        {
          path: "_rels/.rels",
          data: Buffer.from('<Relationship TargetMode="External" Target="https://example.com"/>'),
        },
      ]),
    },
  ])
  assert.ok(external.issues.some((issue) => issue.code === "security-office-external-link"))
})

function body(name: string, description: string) {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nUse this Skill to produce actionable engineering output.\n`
}

function expectRepairs(repairs: Array<{ field: "name" | "description" }>) {
  assert.deepEqual(
    repairs.map((repair) => repair.field).toSorted(),
    ["description", "name"],
  )
}

function zip(entries: Array<{ path: string; data: Buffer }>, flags = 0) {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.path)
    const packed = deflateRawSync(entry.data, { level: 9 })
    const checksum = crc(entry.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(flags | 0x800, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(packed.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(0x0314, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(flags | 0x800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(packed.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    locals.push(local, name, packed)
    centrals.push(central, name)
    offset += local.length + name.length + packed.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

function crc(data: Buffer) {
  let value = 0xffffffff
  for (const byte of data) {
    value ^= byte
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  }
  return (value ^ 0xffffffff) >>> 0
}

function tar(entries: Array<{ path: string; data: Buffer; type?: string }>) {
  return gzipSync(raw(entries), { level: 9 })
}

function raw(entries: Array<{ path: string; data: Buffer; type?: string }>) {
  const chunks: Buffer[] = []
  for (const entry of entries) {
    chunks.push(
      header(entry.path, entry.data.length, entry.type),
      entry.data,
      Buffer.alloc((512 - (entry.data.length % 512)) % 512),
    )
  }
  chunks.push(Buffer.alloc(1024))
  return Buffer.concat(chunks)
}

function header(path: string, size: number, type = "0") {
  const value = Buffer.alloc(512)
  value.write(path, 0, 100)
  value.write("0000644\0", 100, 8)
  value.write("0000000\0", 108, 8)
  value.write("0000000\0", 116, 8)
  value.write(`${size.toString(8).padStart(11, "0")}\0`, 124, 12)
  value.write("00000000000\0", 136, 12)
  value.fill(0x20, 148, 156)
  value.write(type, 156, 1)
  value.write("ustar", 257, 5)
  value.write("00", 263, 2)
  const sum = value.reduce((total, byte) => total + byte, 0)
  value.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8)
  return value
}

function u32(value: number) {
  const bytes = Buffer.alloc(4)
  bytes.writeUInt32BE(value)
  return bytes
}

function chunk(type: string, data: Buffer) {
  return Buffer.concat([u32(data.length), Buffer.from(type), data, Buffer.alloc(4)])
}
