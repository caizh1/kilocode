export const Npm = {
  name: "@chipmate/cli",
  path: "@chipmate%2fcli",
}

export const Brew = {
  name: "chipmate",
  tap: "ChipMate-Org/tap",
  formula: "ChipMate-Org/tap/chipmate",
  api: "https://formulae.brew.sh/api/formula/chipmate.json",
}

export const Choco = {
  name: "chipmate",
  api: "https://community.chocolatey.org/api/v2/Packages?$filter=Id%20eq%20%27chipmate%27%20and%20IsLatestVersion&$select=Version",
}

export const Scoop = {
  name: "chipmate",
  manifest: "https://raw.githubusercontent.com/ScoopInstaller/Main/master/bucket/chipmate.json",
}

export const Release = {
  install: "https://chipmate.ai/cli/install",
}
