export interface McpParameter {
  name: string
  key: string
  placeholder?: string
  optional?: boolean
}

export interface McpInstallationMethod {
  name: string
  content: string
  parameters?: McpParameter[]
  prerequisites?: string[]
}

export interface MarketplaceItemBase {
  id: string
  name: string
  description: string
  author?: string
  authorUrl?: string
  tags?: string[]
  prerequisites?: string[]
}

export interface McpMarketplaceItem extends MarketplaceItemBase {
  type: "mcp"
  url: string
  content: string | McpInstallationMethod[]
  parameters?: McpParameter[]
}

export interface AgentContent {
  mode: "primary" | "subagent" | "all"
  description: string
  prompt: string
  options?: Record<string, unknown>
  permission?: Record<string, unknown>
}

export interface AgentMarketplaceItem extends MarketplaceItemBase {
  type: "agent"
  content: AgentContent
}

export interface RawSkill {
  id: string
  name?: string
  description: string
  category: string
  githubUrl?: string
  content: string
  author?: string
  uploadedBy?: string
  uploadedAt?: string
  updatedAt?: string
  downloadCount?: number
  stars?: number
}

export interface SkillMarketplaceItem extends MarketplaceItemBase {
  type: "skill"
  category: string
  githubUrl?: string
  content: string
  displayName: string
  displayCategory: string
  uploadedBy?: string
  uploadedAt?: string
  updatedAt?: string
  downloadCount?: number
  stars?: number
  /** Generated from the locally installed CLI skill list, not the remote catalog. */
  localOnly?: boolean
  /** The latest successful remote catalog scan confirmed this local Skill is absent. */
  uploadable?: boolean
}

export type MarketplaceItem = McpMarketplaceItem | AgentMarketplaceItem | SkillMarketplaceItem
export type MarketplaceItemRef = Pick<MarketplaceItem, "id" | "type">

export interface InstallMarketplaceItemOptions {
  target?: "global" | "project"
  parameters?: Record<string, unknown>
}

export interface MarketplaceInstalledMetadata {
  project: Record<string, { type: string }>
  global: Record<string, { type: string }>
}

export interface MarketplaceDataResponse {
  marketplaceItems: MarketplaceItem[]
  marketplaceInstalledMetadata: MarketplaceInstalledMetadata
  errors?: string[]
  marketplaceUser?: MarketplaceUser
  marketplaceBaseUrl?: string
  marketplaceSkillsOnly?: boolean
  marketplaceMode?: "skills-only" | "full"
}

export interface MarketplaceUser {
  name: string
  tokenName?: string
}

export interface MarketplaceUploadFile {
  path: string
  contentBase64: string
  sizeBytes?: number
}

export interface MarketplaceUploadPayload {
  id: string
  name: string
  description: string
  category?: string
  files: MarketplaceUploadFile[]
}

export interface InstallResult {
  success: boolean
  slug: string
  error?: string
  filePath?: string
  line?: number
}

export interface RemoveResult {
  success: boolean
  slug: string
  error?: string
}
