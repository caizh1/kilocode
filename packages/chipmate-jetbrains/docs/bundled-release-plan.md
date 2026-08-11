# JetBrains Bundled-CLI Release Plan

Ship a signed, all-platform, CLI-bundled build of the ChipMate JetBrains plugin to a GitHub-hosted custom plugin repository, as an alternative to the JetBrains Marketplace, which caps plugin ZIPs at 400 MB. The Marketplace build stays lean and downloads the CLI at runtime; the bundled build embeds every platform's CLI so it works offline or on restricted networks.

## Decisions

1. Host `updatePlugins.xml` via GitHub Pages deployed by Actions.
2. Maintain a single stable custom repo: one `updatePlugins.xml`, updated on stable releases only.
3. Auto-trigger the bundled workflow after `publish-jetbrains` succeeds.
4. Decide runtime delivery by presence of the bundled `chipmate-cli.zip` resource. Do not add a `chipmate.properties` flag, and do not edit committed files for a bundled build.

## Core Principle

- A bundled build uses the same `jetbrains/v<version>` tag, the same source, and `chipmate.cli.pinned=true`.
- The only build difference is the override `-Pchipmate.cli.bundled=true`.
- `chipmate.properties` stays byte-identical between Marketplace and bundled builds. The only build-output difference is whether `chipmate-cli.zip` is embedded in the backend jar.
- `chipmate.cli.pinned` keeps its existing meaning: which CLI version / OpenAPI source / release guard. It does not control runtime delivery.

## Phase 1: Backend Delivery

- Add `ChipMateRepoCli.available()` to detect `chipmate-cli.zip` on the classpath.
- Change `ChipMateBackendCliManager.resolveCli()` to extract when `ChipMateRepoCli.available()` is true; otherwise download the pinned release asset.
- Store bundled archives as `<platform>/bin/chipmate[.exe]` for all six platforms: `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`, `windows-arm64`, `windows-x64`.
- Extract only the current platform's subtree to disk so users do not store all six binaries locally.
- Keep path traversal checks for every archive entry.
- Update repo CLI dev staging to use the same layout.

## Phase 2: Gradle Bundling

- Add a build-only property `chipmate.cli.bundled`, defaulting to false.
- Keep `chipmate.cli.pinned=true` for bundled production builds.
- Add a task that downloads all six pinned CLI release assets from GitHub, verifies their `sha256` digests from release metadata, and assembles `chipmate-cli.zip` as a backend resource.
- Wire that generated resource only when `-Pchipmate.cli.bundled=true` or local repo CLI mode is active.
- Leave the production guard against `chipmate.cli.pinned=false` intact.

Bundled build command:

```bash
./gradlew clean buildPlugin signPlugin verifyPluginSignature verifyPlugin \
  -Pproduction=true -Pchipmate.version=<version> -Pchipmate.channel=default \
  -Pchipmate.cli.bundled=true
```

## Phase 3: Bundle Workflow

- Add `.github/workflows/publish-jetbrains-bundled.yml`.
- Add a final success step to `publish-jetbrains.yml` that dispatches the bundle workflow with the merged release PR and merge commit.
- The bundle workflow checks out the merged release PR for validation, then checks out the immutable `jetbrains/v<version>` tag, restores reviewed release metadata, builds the bundled variant, signs it, verifies it, and uploads `chipmate-code-<version>-bundled.zip` to the same GitHub Release.
- Bundle ZIPs are produced for RC and stable releases. Only stable releases update the custom plugin repository XML.

## Phase 4: GitHub Pages Repository

- Generate `jetbrains/updatePlugins.xml` from the signed bundled ZIP metadata on stable releases.
- Point the plugin URL at the uploaded GitHub Release asset.
- Deploy the XML with GitHub Pages Actions to `https://chipmate-org.github.io/chipmate/jetbrains/updatePlugins.xml`.
- Users add that URL in JetBrains IDEs under Settings -> Plugins -> Manage Plugin Repositories.

## Acceptance Criteria

- Marketplace builds remain unchanged and download the CLI at runtime.
- Bundled builds use the same tag and source, keep `chipmate.cli.pinned=true`, and differ only by `-Pchipmate.cli.bundled=true`.
- Bundled ZIPs are signed and attached to the `jetbrains/v<version>` release.
- Runtime extracts the bundled current-platform CLI and never downloads when `chipmate-cli.zip` is present.
- Stable releases update the GitHub Pages `updatePlugins.xml` with the latest bundled signed ZIP URL.
