import * as vscode from "vscode"
import { MarketplaceApiClient } from "./api"
import { MarketplacePaths } from "./paths"
import { InstallationDetector, type CliSkill } from "./detection"
import { MarketplaceInstaller } from "./installer"
import { mergeMarketplaceSkills } from "./skills"
import { isInternalOfflineBuild } from "../../shared/internal-offline"
import type {
  MarketplaceItem,
  InstallMarketplaceItemOptions,
  MarketplaceDataResponse,
  InstallResult,
  RemoveResult,
  MarketplaceUploadPayload,
  MarketplaceUser,
} from "./types"

export class MarketplaceService {
  private api: MarketplaceApiClient
  private paths: MarketplacePaths
  private detector: InstallationDetector
  private installer: MarketplaceInstaller

  constructor() {
    this.paths = new MarketplacePaths()
    this.api = new MarketplaceApiClient(marketplaceApiOptions())
    this.detector = new InstallationDetector(this.paths)
    this.installer = new MarketplaceInstaller(this.paths)
  }

  async fetchData(workspace?: string, skills?: CliSkill[]): Promise<MarketplaceDataResponse> {
    const [fetched, metadata] = await Promise.all([this.api.fetchAll(), this.detector.detect(workspace, skills)])
    const merged = mergeMarketplaceSkills(fetched.items, skills, metadata, fetched.skillsFetched)

    return {
      marketplaceItems: merged.marketplaceItems,
      marketplaceInstalledMetadata: merged.marketplaceInstalledMetadata,
      errors: fetched.errors.length > 0 ? fetched.errors : undefined,
      marketplaceBaseUrl: this.api.marketplaceBaseUrl(),
      marketplaceSkillsOnly: this.api.isSkillsOnly(),
      marketplaceMode: this.api.marketplaceMode(),
    }
  }

  marketplaceBaseUrl(): string {
    return this.api.marketplaceBaseUrl()
  }

  marketplaceSkillsOnly(): boolean {
    return this.api.isSkillsOnly()
  }

  marketplaceMode(): "skills-only" | "full" {
    return this.api.marketplaceMode()
  }

  serverBaseUrl(): string {
    return this.api.serverBaseUrl()
  }

  resolveUser(apiKey: string): Promise<MarketplaceUser> {
    return this.api.resolveUser(apiKey)
  }

  starSkill(id: string, apiKey: string): Promise<{ stars?: number }> {
    return this.api.starSkill(id, apiKey)
  }

  uploadSkill(payload: MarketplaceUploadPayload, apiKey: string): Promise<void> {
    return this.api.uploadSkill(payload, apiKey)
  }

  async install(
    item: MarketplaceItem,
    options: InstallMarketplaceItemOptions,
    workspace?: string,
  ): Promise<InstallResult> {
    const result = await this.installer.install(item, options, workspace)

    if (result.success) {
      vscode.window.showInformationMessage(`Successfully installed ${item.name}`)
    }

    return result
  }

  async remove(item: MarketplaceItem, scope: "project" | "global", workspace?: string): Promise<RemoveResult> {
    const result = await this.installer.remove(item, scope, workspace)

    if (result.success) {
      vscode.window.showInformationMessage(`Successfully removed ${item.name}`)
    }

    return result
  }

  dispose(): void {
    this.api.dispose()
  }
}

export type {
  MarketplaceItem,
  AgentMarketplaceItem,
  InstallMarketplaceItemOptions,
  MarketplaceDataResponse,
  InstallResult,
  RemoveResult,
  MarketplaceUploadPayload,
  MarketplaceUser,
} from "./types"

function marketplaceApiOptions() {
  const config = vscode.workspace.getConfiguration("kilo.marketplace")
  const baseUrl = config.get<string>("baseUrl", "").trim()
  const configuredSkillsOnly = config.get<boolean>("skillsOnly", false)
  const skillsOnly = configuredSkillsOnly || (isInternalOfflineBuild() && Boolean(baseUrl))
  return {
    ...(baseUrl ? { baseUrl } : {}),
    skillsOnly,
  }
}
