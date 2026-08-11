import type { EvidencePack } from "./domain"

export function moduleDisplayName(pack: EvidencePack) {
  const explicit = pack.moduleName?.trim()
  if (explicit) return explicit

  const paths = [...new Set(pack.evidence.map((item) => item.source.path).filter(Boolean))]
  const stems = new Set(paths.map(fileStem).filter(Boolean))
  if (stems.size === 1) return [...stems][0] ?? "目标模块"

  const directory = commonDirectory(paths)
  return directory.split("/").filter(Boolean).at(-1) ?? "目标模块"
}

export function artifactTitle(pack: EvidencePack, suffix: string) {
  return `${moduleDisplayName(pack)} ${suffix}`
}

function fileStem(path: string) {
  return path.split("/").at(-1)?.replace(/\.(?:[cm]?[jt]sx?|h|hpp|hh|hxx|cc|cpp|cxx|java|kt|kts|py|rs|go)$/i, "") ?? ""
}

function commonDirectory(paths: string[]) {
  const directories = paths.map((path) => path.split("/").slice(0, -1))
  const first = directories[0] ?? []
  const shared = first.filter((part, index) => directories.every((directory) => directory[index] === part))
  return shared.join("/")
}
