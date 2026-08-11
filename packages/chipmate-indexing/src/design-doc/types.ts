export type DesignDocLanguage = "typescript" | "tsx" | "c"

export type DesignDocSourceKind = "production" | "test" | "config" | "document"

export type DesignDocUnitKind = "root" | "directory" | "c-component" | "logical-submodule"

export type ProductDesignSection =
  | "module-overview"
  | "requirements"
  | "overall-structure"
  | "data-entities"
  | "algorithms"
  | "provided-interfaces"
  | "required-interfaces"
  | "internal-interfaces"
  | "key-flows"
  | "resource-performance"
  | "dfx"
  | "sfmea"
  | "verification"

export interface ProductReferenceInput {
  path: string
  kind: "requirement" | "architecture" | "interface" | "test"
}

export interface DesignDocModuleHint {
  name: string
  includePaths: string[]
}

export type DesignDocTopic =
  | "positioning"
  | "responsibilities"
  | "boundaries"
  | "inputs-outputs"
  | "business-process"
  | "core-models"
  | "algorithms"
  | "concurrency"
  | "state-lifecycle"
  | "error-recovery"
  | "data-persistence"
  | "configuration-startup"
  | "observability-debugging"
  | "constraints-risks"

export type LifecycleEvidenceKind =
  | "state-definition"
  | "state-field"
  | "initial-state"
  | "state-transition"
  | "event-handler"
  | "guard"
  | "timeout"
  | "error-path"
  | "terminal-state"

export type StructureEvidenceKind = "source-file" | "dependency"

export type CodeStructureSymbolKind =
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "struct"
  | "union"
  | "namespace"
  | "function"
  | "method"

export type CodeStructureEvidenceKind = "source-file" | "code-symbol"

export type BehaviorEvidenceKind =
  | "flow-node"
  | "flow-edge"
  | "call-message"
  | "data-entity"
  | "data-flow"
  | "error-node"
  | "error-edge"
  | "configuration"

export type ProductEvidenceKind =
  | "requirement"
  | "architecture-reference"
  | "module-boundary"
  | "interface-reference"
  | "test-reference"
  | "resource"
  | "diagnostic"
  | "failure-mode"

export interface DesignDocSourceFile {
  path: string
  absolutePath: string
  contentHash: string
  bytes: number
  language: DesignDocLanguage
  sourceKind: DesignDocSourceKind
}

export interface DiscoveredDesignDocModule {
  id: string
  name: string
  path: string
  absolutePath: string
  sourceSnapshotHash: string
  files: DesignDocSourceFile[]
  totalBytes: number
  unitKind?: DesignDocUnitKind
  implementationFiles?: string[]
  supportFiles?: string[]
}

export interface DiscoveredDesignDocModuleTree {
  rootModuleID: string
  modules: Array<DiscoveredDesignDocModule & { parentID?: string }>
  sourceSnapshotHash: string
  ownership?: Array<{
    path: string
    ownerModuleID: string
    role: "implementation" | "support"
  }>
}

export interface LifecycleEvidenceSource {
  path: string
  contentHash: string
  startLine: number
  endLine: number
  symbol?: string
  sourceKind: DesignDocSourceKind
}

export interface RawLifecycleEvidence {
  kind: LifecycleEvidenceKind
  fact: string
  source: LifecycleEvidenceSource
  attributes: Record<string, string | number | boolean | null>
  confidence: "explicit" | "inferred" | "unknown"
  snippet: string
}

export interface LifecycleExtractionResult {
  moduleID: string
  sourceSnapshotHash: string
  evidence: RawLifecycleEvidence[]
  unknowns: string[]
}

export interface RawStructureEvidence {
  kind: StructureEvidenceKind
  fact: string
  source: LifecycleEvidenceSource
  attributes: Record<string, string | number | boolean | null>
  confidence: "explicit" | "inferred" | "unknown"
  snippet: string
}

export interface StructureExtractionResult {
  moduleID: string
  sourceSnapshotHash: string
  evidence: RawStructureEvidence[]
  unknowns: string[]
}

export interface RawCodeStructureEvidence {
  kind: CodeStructureEvidenceKind
  fact: string
  source: LifecycleEvidenceSource
  attributes: Record<string, string | number | boolean | null>
  confidence: "explicit" | "inferred" | "unknown"
  snippet: string
}

export interface CodeStructureExtractionResult {
  moduleID: string
  sourceSnapshotHash: string
  evidence: RawCodeStructureEvidence[]
  unknowns: string[]
}

export interface RawBehaviorEvidence {
  kind: BehaviorEvidenceKind
  fact: string
  source: LifecycleEvidenceSource
  attributes: Record<string, string | number | boolean | null>
  confidence: "explicit" | "inferred" | "unknown"
  snippet: string
}

export interface BehaviorExtractionResult {
  moduleID: string
  sourceSnapshotHash: string
  evidence: RawBehaviorEvidence[]
  unknowns: string[]
}

export interface OverviewExtractionResult {
  moduleID: string
  sourceSnapshotHash: string
  evidence: Array<RawStructureEvidence | RawCodeStructureEvidence | RawBehaviorEvidence>
  unknowns: string[]
}

export interface TopicExtractionResult {
  moduleID: string
  sourceSnapshotHash: string
  topic: DesignDocTopic
  evidence: Array<RawStructureEvidence | RawCodeStructureEvidence | RawBehaviorEvidence | RawLifecycleEvidence>
  unknowns: string[]
}

export interface RawProductEvidence {
  kind: ProductEvidenceKind | StructureEvidenceKind | CodeStructureEvidenceKind | BehaviorEvidenceKind | LifecycleEvidenceKind
  fact: string
  source: LifecycleEvidenceSource
  attributes: Record<string, string | number | boolean | null>
  confidence: "explicit" | "inferred" | "unknown"
  snippet: string
}

export interface ProductExtractionResult {
  moduleID: string
  sourceSnapshotHash: string
  section: ProductDesignSection
  evidence: RawProductEvidence[]
  unknowns: string[]
}

export class DesignDocDiscoveryError extends Error {
  constructor(
    readonly code:
      | "INVALID_TARGET"
      | "PATH_ESCAPE"
      | "SYMLINK_TARGET"
      | "NO_SUPPORTED_SOURCE"
      | "SOURCE_LIMIT_EXCEEDED"
      | "SOURCE_CHANGED",
    message: string,
  ) {
    super(message)
    this.name = "DesignDocDiscoveryError"
  }
}
