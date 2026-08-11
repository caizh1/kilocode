/**
 * Legacy ChipMate CLI migration module
 *
 * Migrates authentication from the legacy ChipMate VS Code extension CLI
 * config path (~/.chipmate/cli/config.json) to the new auth.json format.
 */
import fs from "fs/promises"
import os from "os"
import path from "path"

export const LEGACY_CONFIG_PATH = path.join(os.homedir(), ".chipmate", "cli", "config.json")

interface LegacyProvider {
  id: string
  provider: string
  chipmateToken?: string
  chipmateModel?: string
  chipmateOrganizationId?: string
}

interface LegacyConfig {
  providers?: LegacyProvider[]
}

interface LegacyChipMateAuth {
  token: string
  organizationId?: string
}

// Auth info types matching opencode's Auth module
type ApiAuth = { type: "api"; key: string }
type OAuthAuth = { type: "oauth"; access: string; refresh: string; expires: number; accountId?: string }
type AuthInfo = ApiAuth | OAuthAuth

/**
 * Extract chipmate auth from legacy config
 */
function extractChipMateAuth(config: LegacyConfig): LegacyChipMateAuth | undefined {
  if (!config.providers) return undefined

  const provider = config.providers.find((p) => p.provider === "chipmate")
  if (!provider?.chipmateToken) return undefined

  return {
    token: provider.chipmateToken,
    organizationId: provider.chipmateOrganizationId,
  }
}

/**
 * Migrate ChipMate authentication from legacy CLI config path.
 *
 * Checks ~/.chipmate/cli/config.json for existing chipmate credentials
 * and migrates them to the new auth.json format.
 *
 * @param hasChipMateAuth - Callback to check if chipmate auth already exists
 * @param saveChipMateAuth - Callback to save the migrated auth
 * @returns true if migration was performed, false otherwise
 */
export async function migrateLegacyChipMateAuth(
  hasChipMateAuth: () => Promise<boolean>,
  saveChipMateAuth: (auth: AuthInfo) => Promise<void>,
): Promise<boolean> {
  // Skip if chipmate auth already configured
  if (await hasChipMateAuth()) return false

  // Check if legacy config exists and parse it
  const content = await fs.readFile(LEGACY_CONFIG_PATH, "utf-8").catch(() => null)
  if (!content) return false

  let config: LegacyConfig | null = null
  try {
    config = JSON.parse(content) as LegacyConfig
  } catch {
    return false
  }

  // Extract chipmate auth from legacy config
  const legacy = extractChipMateAuth(config)
  if (!legacy) return false

  // Migrate to new format
  // Use OAuth format if organization ID present, otherwise API format
  if (legacy.organizationId) {
    await saveChipMateAuth({
      type: "oauth",
      access: legacy.token,
      refresh: "",
      expires: 0,
      accountId: legacy.organizationId,
    })
  } else {
    await saveChipMateAuth({
      type: "api",
      key: legacy.token,
    })
  }

  return true
}
