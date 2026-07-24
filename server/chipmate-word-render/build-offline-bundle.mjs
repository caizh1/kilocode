#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, copyFileSync, writeFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, "../..")
const serverDir = scriptDir
const serverPackage = JSON.parse(readFileSync(join(serverDir, "package.json"), "utf8"))
const version = serverPackage.version
const outRoot = resolve(process.env.CHIPMATE_SERVER_OFFLINE_OUT || join(serverDir, "out"))
const bundleDir = join(outRoot, "chipmate-server-offline")
const workDir = join(outRoot, ".chipmate-server-offline-work")
const archiveName = `chipmate-word-render-${version}-linux-amd64.docker.tar.gz`
const archivePath = resolve(process.env.CHIPMATE_SERVER_DOCKER_ARCHIVE || join(serverDir, archiveName))
const archiveShaPath = `${archivePath}.sha256`

const seedSkills = [
  {
    id: "source-backed-detail-design",
    name: "Source Backed Detail Design",
    description: "Source-backed detailed design generation",
    category: "design-doc",
  },
  {
    id: "documents",
    name: "Documents",
    description: "Create, edit, review, and verify Word documents",
    category: "documents",
  },
]

if (!existsSync(archivePath)) {
  throw new Error(`Docker archive not found: ${archivePath}`)
}

rmSync(bundleDir, { recursive: true, force: true })
rmSync(workDir, { recursive: true, force: true })
mkdirSync(join(bundleDir, "packages", "skill-market", "skills"), { recursive: true })
mkdirSync(workDir, { recursive: true })

copyFileSync(join(serverDir, "install-render-server.sh"), join(bundleDir, "install-render-server.sh"))
copyFileSync(archivePath, join(bundleDir, archiveName))
const archiveSha = sha256File(archivePath)
writeFileSync(archiveShaPath, archiveSha)
writeFileSync(join(bundleDir, `${archiveName}.sha256`), archiveSha)

const catalogItems = []
for (const skill of seedSkills) {
  const sourceDir = join(repoRoot, ".kilo", "skills", skill.id)
  const skillMd = join(sourceDir, "SKILL.md")
  if (!existsSync(skillMd)) throw new Error(`Seed skill missing SKILL.md: ${skillMd}`)
  const cleanSourceDir = join(workDir, skill.id)
  mkdirSync(cleanSourceDir, { recursive: true })
  cpSync(sourceDir, cleanSourceDir, { recursive: true })
  clearXattrs(cleanSourceDir)
  const tarballName = `${skill.id}.tar.gz`
  const tarballPath = join(bundleDir, "packages", "skill-market", "skills", tarballName)
  createTarGz(cleanSourceDir, tarballPath, skill.id)
  verify(tarballPath, skill.id)
  catalogItems.push({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    category: skill.category,
    githubUrl: "",
    content: `skills/${tarballName}`,
    uploadedBy: "chipmate",
    downloadCount: 0,
    stars: 0,
  })
}

writeFileSync(
  join(bundleDir, "packages", "skill-market", "skills.json"),
  JSON.stringify({ items: catalogItems }, null, 2) + "\n",
)

const bundleTar = join(outRoot, `chipmate-server-offline-${version}-linux-amd64.tar.gz`)
clearXattrs(bundleDir)
createTarGz(bundleDir, bundleTar, "chipmate-server-offline")
writeFileSync(`${bundleTar}.sha256`, sha256File(bundleTar))

console.log(`Created ${bundleDir}`)
console.log(`Created ${bundleTar}`)
rmSync(workDir, { recursive: true, force: true })

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      COPYFILE_DISABLE: "1",
    },
  })
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${(result.stderr || result.stdout || result.status).toString().trim()}`)
  }
}

function clearXattrs(target) {
  const result = spawnSync("xattr", ["-cr", target], { encoding: "utf8" })
  if (result.error && result.error.code === "ENOENT") return
  if (result.status !== 0) {
    throw new Error(
      `xattr cleanup failed for ${target}: ${(result.stderr || result.stdout || result.status).toString().trim()}`,
    )
  }
}

function createTarGz(sourceDir, tarballPath, archiveRoot) {
  const script = String.raw`
import os
import sys
import tarfile

source = sys.argv[1]
target = sys.argv[2]
archive_root = sys.argv[3]

def reset_metadata(info):
    info.uid = 0
    info.gid = 0
    info.uname = ""
    info.gname = ""
    info.pax_headers = {}
    return info

with tarfile.open(target, "w:gz", format=tarfile.PAX_FORMAT) as tar:
    tar.add(source, arcname=archive_root, recursive=True, filter=reset_metadata)
`
  const result = spawnSync("python3", ["-c", script, sourceDir, tarballPath, archiveRoot], {
    encoding: "utf8",
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  })
  if (result.status !== 0) {
    throw new Error(`python tarfile failed: ${(result.stderr || result.stdout || result.status).toString().trim()}`)
  }
}

function verify(tarballPath, id) {
  const result = spawnSync("tar", ["-tzf", tarballPath], { encoding: "utf8" })
  if (result.status !== 0) throw new Error(`Could not inspect ${tarballPath}: ${result.stderr || result.stdout}`)
  const entries = result.stdout.split(/\r?\n/).filter(Boolean)
  if (!entries.includes(`${id}/SKILL.md`)) throw new Error(`Skill archive missing ${id}/SKILL.md: ${tarballPath}`)
  if (!entries.every((entry) => safe(entry, id))) {
    throw new Error(`Skill archive contains a path outside ${id}/: ${tarballPath}`)
  }
}

function safe(entry, id) {
  const normalized = entry.replace(/\/+$/, "")
  if (!normalized || normalized.startsWith("/") || normalized.includes("\\")) return false
  const parts = normalized.split("/")
  return parts[0] === id && !parts.some((part) => !part || part === "." || part === "..")
}

function sha256File(file) {
  const result = spawnSync("shasum", ["-a", "256", file], { encoding: "utf8" })
  if (result.status !== 0) throw new Error(`shasum failed: ${result.stderr || result.stdout}`)
  return `${result.stdout.trim().split(/\s+/)[0]}  ${basename(file)}\n`
}
