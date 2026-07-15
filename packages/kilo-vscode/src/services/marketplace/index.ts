import * as vscode from "vscode"
import { randomUUID } from "crypto"
import { MarketplaceApiClient } from "./api"
import { MarketplacePaths } from "./paths"
import { InstallationDetector, type CliSkill } from "./detection"
import { MarketplaceInstaller } from "./installer"
import { mergeMarketplaceSkills } from "./skills"
import { isInternalOfflineBuild } from "../../shared/internal-offline"
import { createSkillArchive } from "./archive"
import type { MarketEvent } from "./analytics"
import { detectMarketplaceRelevance } from "./relevance"
import type {
  MarketplaceItem,
  InstallMarketplaceItemOptions,
  MarketplaceDataResponse,
  MarketplaceRelevanceMetadata,
  InstallResult,
  RemoveResult,
  MarketplaceUploadPayload,
  MarketplaceUser,
  PublicationPatch,
} from "./types"
import { chipmateServerEndpoints, legacyChipmateServerEndpoints } from "../chipmate-server"

export class MarketplaceService {
  private api: MarketplaceApiClient
  private paths: MarketplacePaths
  private detector: InstallationDetector
  private installer: MarketplaceInstaller
  private scans = new Map<string, Promise<MarketplaceRelevanceMetadata>>()

  constructor() {
    this.paths = new MarketplacePaths()
    this.api = new MarketplaceApiClient(marketplaceApiOptions())
    this.detector = new InstallationDetector(this.paths)
    this.installer = new MarketplaceInstaller(this.paths)
  }

  async fetchData(
    workspace?: string,
    skills?: CliSkill[],
    roots: readonly vscode.Uri[] = [],
    apiKey?: string,
    details = true,
  ): Promise<MarketplaceDataResponse> {
    const request = this.api.fetchAll(apiKey)
    const relevance = request.then((result) => this.relevance(result.items, roots))
    const [fetched, metadata, matches] = await Promise.all([
      request,
      this.detector.detect(workspace, skills),
      relevance,
    ])
    const merged = mergeMarketplaceSkills(fetched.items, skills, metadata, fetched.skillsFetched)
    const aligned = await this.api.alignedMode()
    const state =
      aligned && details
        ? await Promise.all([
            this.api.capabilities(),
            this.api.status().catch(() => undefined),
            apiKey ? this.api.installations(apiKey).catch(() => []) : Promise.resolve([]),
            apiKey ? this.api.publications(apiKey).catch(() => []) : Promise.resolve([]),
            apiKey ? this.api.analytics(apiKey).catch(() => []) : Promise.resolve([]),
          ])
        : []
    return {
      marketplaceItems: merged.marketplaceItems,
      marketplaceInstalledMetadata: merged.marketplaceInstalledMetadata,
      errors: fetched.errors.length > 0 ? fetched.errors : undefined,
      marketplaceBaseUrl: this.api.marketplaceBaseUrl(),
      marketplaceSkillsOnly: this.api.isSkillsOnly(),
      marketplaceMode: this.api.marketplaceMode(),
      marketplaceProtocol: aligned ? "aligned-v1" : "legacy",
      marketplaceRelevance: matches,
      ...(state[0] ? { marketplaceCapabilities: state[0] } : {}),
      ...(state[1] ? { marketplaceStatus: state[1] } : {}),
      ...(aligned && details
        ? {
            marketplaceInstallations: state[2] ?? [],
            marketplacePublications: state[3] ?? [],
            marketplaceAnalytics: state[4] ?? [],
          }
        : {}),
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

  async uploadSkill(payload: MarketplaceUploadPayload, apiKey: string) {
    if (!(await this.api.alignedMode())) return this.api.uploadSkill(payload, apiKey)
    return this.api.publishArchive(createSkillArchive(payload.id, payload.files), apiKey, `kilo-${randomUUID()}`)
  }

  getPublication(id: string, apiKey: string) {
    return this.api.getPublication(id, apiKey)
  }

  skill(id: string) {
    return this.api.skill(id)
  }

  putPublicationPatches(id: string, patches: PublicationPatch[], apiKey: string) {
    return this.api.putPublicationPatches(id, patches, apiKey)
  }

  applyPublicationPatches(id: string, patchIds: string[], apiKey: string) {
    return this.api.applyPublicationPatches(id, patchIds, apiKey)
  }

  private relevance(items: MarketplaceItem[], roots: readonly vscode.Uri[]): Promise<MarketplaceRelevanceMetadata> {
    const key = `${roots.map((root) => root.toString()).join(",")}:${items.map((item) => `${item.type}:${item.id}`).join(",")}`
    const current = this.scans.get(key)
    if (current) return current

    const scan = detectMarketplaceRelevance(items, roots).finally(() => this.scans.delete(key))
    this.scans.set(key, scan)
    return scan
  }

  async install(
    item: MarketplaceItem,
    options: InstallMarketplaceItemOptions,
    workspace?: string,
  ): Promise<InstallResult> {
    const scope = options.target ?? "project"
    const verified = item.type === "skill" && item.revision && item.sha256
    const result = verified
      ? await this.installer.installVerifiedSkill(
          { id: item.id, revision: item.revision!, sha256: item.sha256!, url: item.content },
          scope,
          workspace,
        )
      : await this.installer.install(item, options, workspace)

    if (result.success) {
      vscode.window.showInformationMessage(`Successfully installed ${item.name}`)
    }

    return result
  }

  isSkillInstalled(id: string, scope: "project" | "global", workspace?: string): Promise<boolean> {
    return this.installer.isSkillInstalled(id, scope, workspace)
  }

  installVerifiedSkill(
    item: { id: string; revision: number; sha256: string; url: string },
    scope: "project" | "global",
    workspace?: string,
  ): Promise<InstallResult> {
    return this.installer.installVerifiedSkill(item, scope, workspace)
  }

  consumeInstallIntent(token: string, apiKey: string) {
    return this.api.consumeInstallIntent(token, apiKey)
  }

  syncInstallation(id: string, state: Parameters<MarketplaceApiClient["syncInstallation"]>[1], apiKey: string) {
    return this.api.syncInstallation(id, state, apiKey)
  }

  events(items: MarketEvent[], apiKey: string) {
    return this.api.events(items, apiKey)
  }

  installations(apiKey: string) {
    return this.api.installations(apiKey)
  }

  publications(apiKey: string) {
    return this.api.publications(apiKey)
  }

  unpublishSkill(id: string, apiKey: string) {
    return this.api.unpublishSkill(id, apiKey)
  }

  analytics(apiKey: string) {
    return this.api.analytics(apiKey)
  }

  subscribe(change: (name: string) => void) {
    return this.api.subscribe(change)
  }

  async remove(item: MarketplaceItem, scope: "project" | "global", workspace?: string): Promise<RemoveResult> {
    const result = await this.installer.remove(item, scope, workspace)

    if (result.success) {
      vscode.window.showInformationMessage(`Successfully removed ${item.name}`)
    }

    return result
  }

  dispose(): void {
    this.scans.clear()
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
  PublicationRun,
  PublicationPatch,
  SkillDetail,
  MarketCapabilities,
  MarketStatus,
  InstallationState,
  AnalyticsSeries,
} from "./types"

export function marketplaceApiOptions() {
  const config = vscode.workspace.getConfiguration("kilo.marketplace")
  const unified = chipmateServerEndpoints()
  const legacy = legacyChipmateServerEndpoints()
  const baseUrl = unified.endpoints?.marketplace ?? (unified.state.source === "conflict" ? legacy.market : "")
  const configuredSkillsOnly = config.get<boolean>("skillsOnly", false)
  const skillsOnly = configuredSkillsOnly || (isInternalOfflineBuild() && Boolean(baseUrl))
  return {
    ...(baseUrl ? { baseUrl } : {}),
    skillsOnly,
    ...(unified.state.source === "invalid"
      ? { disabledReason: unified.state.error ?? "The ChipMate Server address is invalid." }
      : {}),
  }
}
