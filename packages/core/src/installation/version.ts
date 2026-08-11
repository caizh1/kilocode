declare global {
  const CHIPMATE_VERSION: string
  const CHIPMATE_CHANNEL: string
  const CHIPMATE_BUILD_KIND: string // chipmate_change
}

export const InstallationVersion = typeof CHIPMATE_VERSION === "string" ? CHIPMATE_VERSION : "local"
export const InstallationChannel = typeof CHIPMATE_CHANNEL === "string" ? CHIPMATE_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
// chipmate_change start - distinguish release builds from source / local builds
export const InstallationBuildKind: "source" | "release" =
  typeof CHIPMATE_BUILD_KIND === "string" && CHIPMATE_BUILD_KIND === "release" ? "release" : "source"
// chipmate_change end
