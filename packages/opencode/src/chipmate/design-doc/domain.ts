import { Schema, Types } from "effect"

export const JobStatus = Schema.Literals([
  "created",
  "discovering",
  "extracting",
  "running",
  "validating",
  "paused",
  "failed",
  "blocked",
  "assembling",
  "completed",
  "cancelled",
])
export type JobStatus = Types.DeepMutable<typeof JobStatus.Type>

export const WorkItemStatus = Schema.Literals([
  "pending",
  "ready",
  "running",
  "validating",
  "retryable",
  "passed",
  "failed",
  "blocked",
  "cancelled",
])
export type WorkItemStatus = Types.DeepMutable<typeof WorkItemStatus.Type>

/** 源码事件处理器在未检查当前状态时更新状态字段，表示事件可覆盖任意当前状态。 */
export const AnyCurrentLifecycleState = "__ANY_CURRENT_STATE__"

export const ArtifactType = Schema.Literals([
  "topic",
  "product-section",
  "business-flow",
  "overview",
  "structure",
  "code-structure",
  "execution-flow",
  "sequence",
  "data-flow",
  "lifecycle",
  "error-flow",
  "review",
])
export type ArtifactType = Types.DeepMutable<typeof ArtifactType.Type>

export const ProductSection = Schema.Literals([
  "module-overview",
  "requirements",
  "overall-structure",
  "data-entities",
  "algorithms",
  "provided-interfaces",
  "required-interfaces",
  "internal-interfaces",
  "key-flows",
  "resource-performance",
  "dfx",
  "sfmea",
  "verification",
])
export type ProductSection = Types.DeepMutable<typeof ProductSection.Type>

export const DesignTopic = Schema.Literals([
  "positioning",
  "responsibilities",
  "boundaries",
  "inputs-outputs",
  "business-process",
  "core-models",
  "algorithms",
  "concurrency",
  "state-lifecycle",
  "error-recovery",
  "data-persistence",
  "configuration-startup",
  "observability-debugging",
  "constraints-risks",
])
export type DesignTopic = Types.DeepMutable<typeof DesignTopic.Type>

export const DesignView = Schema.Literals([
  "architecture",
  "business-flow",
  "code-flow",
  "state-machine",
  "data-lifecycle",
])
export type DesignView = Types.DeepMutable<typeof DesignView.Type>

export const DocumentProfile = Schema.Literals([
  "artifact-set",
  "source-backed-full",
  "product-detailed-design-v2",
])
export type DocumentProfile = Types.DeepMutable<typeof DocumentProfile.Type>

export const WorkItemPurpose = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("artifact") }),
  Schema.Struct({ kind: Schema.Literal("topic"), topic: DesignTopic }),
  Schema.Struct({ kind: Schema.Literal("product-section"), section: ProductSection }),
  Schema.Struct({
    kind: Schema.Literal("diagram"),
    view: DesignView,
    role: Schema.Literals(["base", "focused"]),
    focusID: Schema.optional(Schema.String),
    topic: Schema.optional(DesignTopic),
  }),
  Schema.Struct({ kind: Schema.Literal("review") }),
])
export type WorkItemPurpose = Types.DeepMutable<typeof WorkItemPurpose.Type>

export const ModelReference = Schema.Struct({
  providerID: Schema.String,
  modelID: Schema.String,
  variant: Schema.optional(Schema.String),
}).annotate({ identifier: "DesignDocModelReference" })
export type ModelReference = Types.DeepMutable<typeof ModelReference.Type>

export const ValidationIssue = Schema.Struct({
  severity: Schema.Literals(["error", "warning"]),
  code: Schema.String,
  message: Schema.String,
  jsonPath: Schema.optional(Schema.String),
  evidenceIDs: Schema.Array(Schema.String),
  sourcePaths: Schema.Array(Schema.String),
  retryable: Schema.Boolean,
}).annotate({ identifier: "DesignDocValidationIssue" })
export type ValidationIssue = Types.DeepMutable<typeof ValidationIssue.Type>

export const EvidenceSource = Schema.Struct({
  path: Schema.String,
  contentHash: Schema.String,
  startLine: Schema.Int,
  endLine: Schema.Int,
  symbol: Schema.optional(Schema.String),
  sourceKind: Schema.Literals(["production", "test", "config", "document"]),
}).annotate({ identifier: "DesignDocEvidenceSource" })

export const Evidence = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals([
    "state-definition",
    "state-field",
    "initial-state",
    "state-transition",
    "event-handler",
    "guard",
    "timeout",
    "error-path",
    "terminal-state",
    "source-file",
    "dependency",
    "code-symbol",
    "flow-node",
    "flow-edge",
    "call-message",
    "data-entity",
    "data-flow",
    "error-node",
    "error-edge",
    "configuration",
    "requirement",
    "architecture-reference",
    "module-boundary",
    "interface-reference",
    "test-reference",
    "resource",
    "diagnostic",
    "failure-mode",
  ]),
  fact: Schema.String,
  source: EvidenceSource,
  attributes: Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Null])),
  confidence: Schema.Literals(["explicit", "inferred", "unknown"]),
  snippet: Schema.String,
}).annotate({ identifier: "DesignDocEvidence" })
export type Evidence = Types.DeepMutable<typeof Evidence.Type>

export const EvidenceObligation = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals([
    "state",
    "transition",
    "entry",
    "error",
    "timeout",
    "file",
    "relationship",
    "symbol",
    "flow-node",
    "flow-edge",
    "message",
    "data-entity",
    "data-flow",
    "error-node",
    "error-edge",
    "configuration",
    "topic-flow",
    "requirement",
    "design-claim",
    "resource",
    "diagnostic",
    "failure-mode",
    "verification-case",
  ]),
  evidenceIDs: Schema.Array(Schema.String),
  required: Schema.Boolean,
}).annotate({ identifier: "DesignDocEvidenceObligation" })
export type EvidenceObligation = Types.DeepMutable<typeof EvidenceObligation.Type>

export const EvidencePack = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  id: Schema.String,
  moduleID: Schema.String,
  moduleName: Schema.optional(Schema.String),
  workItemID: Schema.String,
  artifactType: ArtifactType,
  purpose: Schema.optional(WorkItemPurpose),
  sourceSnapshotHash: Schema.String,
  evidence: Schema.Array(Evidence),
  obligations: Schema.Array(EvidenceObligation),
  topicClaims: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        text: Schema.String,
        evidenceIDs: Schema.Array(Schema.String),
      }),
    ),
  ),
  unknowns: Schema.Array(Schema.String),
  budget: Schema.Struct({
    items: Schema.Int,
    promptBytes: Schema.Int,
    truncated: Schema.Literal(false),
  }),
}).annotate({ identifier: "DesignDocEvidencePack" })
export type EvidencePack = Types.DeepMutable<typeof EvidencePack.Type>

const EvidenceReference = Schema.Array(Schema.String)

export const DesignClaim = Schema.Struct({
  id: Schema.String,
  subject: Schema.String,
  statement: Schema.String,
  rationale: Schema.optional(Schema.String),
  confidence: Schema.Literals(["confirmed", "inferred", "unknown"]),
  evidenceIDs: EvidenceReference,
}).annotate({ identifier: "DesignDocDesignClaim" })
export type DesignClaim = Types.DeepMutable<typeof DesignClaim.Type>

const NarrativeParagraph = Schema.Struct({
  text: Schema.String,
  claimIDs: Schema.Array(Schema.String),
}).annotate({ identifier: "DesignDocNarrativeParagraph" })

const ProductSectionBase = {
  schemaVersion: Schema.Literal(2),
  moduleID: Schema.String,
  viewType: Schema.Literal("product-section"),
  title: Schema.String,
  summary: Schema.String,
  claims: Schema.Array(DesignClaim),
  paragraphs: Schema.Array(NarrativeParagraph),
  assumptions: Schema.Array(DesignClaim),
  unknowns: Schema.Array(DesignClaim),
}

const ProductItem = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  claimIDs: Schema.Array(Schema.String),
}).annotate({ identifier: "DesignDocProductItem" })

export const ModuleOverviewIR = Schema.Struct({
  ...ProductSectionBase,
  section: Schema.Literal("module-overview"),
  responsibilities: Schema.Array(ProductItem),
  boundaries: Schema.Array(ProductItem),
}).annotate({ identifier: "DesignDocModuleOverviewIRV2" })
export type ModuleOverviewIR = Types.DeepMutable<typeof ModuleOverviewIR.Type>

export const RequirementTraceIR = Schema.Struct({
  ...ProductSectionBase,
  section: Schema.Literal("requirements"),
  requirements: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      description: Schema.String,
      allocation: Schema.String,
      verification: Schema.String,
      claimIDs: Schema.Array(Schema.String),
    }),
  ),
  sourceStatus: Schema.Literals(["provided", "missing"]),
}).annotate({ identifier: "DesignDocRequirementTraceIR" })
export type RequirementTraceIR = Types.DeepMutable<typeof RequirementTraceIR.Type>

export const ArchitectureIR = Schema.Struct({
  ...ProductSectionBase,
  section: Schema.Literal("overall-structure"),
  components: Schema.Array(ProductItem),
}).annotate({ identifier: "DesignDocArchitectureIR" })
export type ArchitectureIR = Types.DeepMutable<typeof ArchitectureIR.Type>

export const DataEntityIR = Schema.Struct({
  ...ProductSectionBase,
  section: Schema.Literal("data-entities"),
  entities: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      purpose: Schema.String,
      fields: Schema.Array(
        Schema.Struct({
          name: Schema.String,
          type: Schema.String,
          width: Schema.optional(Schema.String),
          description: Schema.String,
          claimIDs: Schema.Array(Schema.String),
        }),
      ),
      claimIDs: Schema.Array(Schema.String),
    }),
  ),
}).annotate({ identifier: "DesignDocDataEntityIR" })
export type DataEntityIR = Types.DeepMutable<typeof DataEntityIR.Type>

export const AlgorithmIR = Schema.Struct({
  ...ProductSectionBase,
  section: Schema.Literal("algorithms"),
  algorithms: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      objective: Schema.String,
      preconditions: Schema.Array(Schema.String),
      steps: Schema.Array(Schema.String),
      complexity: Schema.String,
      claimIDs: Schema.Array(Schema.String),
    }),
  ),
}).annotate({ identifier: "DesignDocAlgorithmIR" })
export type AlgorithmIR = Types.DeepMutable<typeof AlgorithmIR.Type>

export const InterfaceContractIR = Schema.Struct({
  ...ProductSectionBase,
  section: Schema.Literals(["provided-interfaces", "required-interfaces", "internal-interfaces"]),
  interfaces: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      prototype: Schema.String,
      purpose: Schema.String,
      inputs: Schema.Array(Schema.String),
      outputs: Schema.Array(Schema.String),
      returns: Schema.Array(Schema.String),
      usage: Schema.String,
      cautions: Schema.Array(Schema.String),
      claimIDs: Schema.Array(Schema.String),
    }),
  ),
}).annotate({ identifier: "DesignDocInterfaceContractIR" })
export type InterfaceContractIR = Types.DeepMutable<typeof InterfaceContractIR.Type>

export const ScenarioFlowIR = Schema.Struct({
  ...ProductSectionBase,
  section: Schema.Literal("key-flows"),
  scenarios: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      trigger: Schema.String,
      preconditions: Schema.Array(Schema.String),
      mainSteps: Schema.Array(Schema.String),
      alternatives: Schema.Array(Schema.String),
      outcomes: Schema.Array(Schema.String),
      claimIDs: Schema.Array(Schema.String),
    }),
  ),
}).annotate({ identifier: "DesignDocScenarioFlowIR" })
export type ScenarioFlowIR = Types.DeepMutable<typeof ScenarioFlowIR.Type>

export const ResourcePerformanceIR = Schema.Struct({
  ...ProductSectionBase,
  section: Schema.Literal("resource-performance"),
  resources: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      resource: Schema.String,
      formulaOrLimit: Schema.String,
      designImpact: Schema.String,
      claimIDs: Schema.Array(Schema.String),
    }),
  ),
}).annotate({ identifier: "DesignDocResourcePerformanceIR" })
export type ResourcePerformanceIR = Types.DeepMutable<typeof ResourcePerformanceIR.Type>

export const DfxIR = Schema.Struct({
  ...ProductSectionBase,
  section: Schema.Literal("dfx"),
  mechanisms: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      signal: Schema.String,
      trigger: Schema.String,
      diagnosis: Schema.String,
      limitation: Schema.String,
      claimIDs: Schema.Array(Schema.String),
    }),
  ),
}).annotate({ identifier: "DesignDocDfxIR" })
export type DfxIR = Types.DeepMutable<typeof DfxIR.Type>

export const SfmeaIR = Schema.Struct({
  ...ProductSectionBase,
  section: Schema.Literal("sfmea"),
  failureModes: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      failureMode: Schema.String,
      cause: Schema.String,
      effect: Schema.String,
      detection: Schema.String,
      implementedMitigation: Schema.String,
      recommendation: Schema.String,
      claimIDs: Schema.Array(Schema.String),
    }),
  ),
}).annotate({ identifier: "DesignDocSfmeaIR" })
export type SfmeaIR = Types.DeepMutable<typeof SfmeaIR.Type>

export const VerificationCaseIR = Schema.Struct({
  ...ProductSectionBase,
  section: Schema.Literal("verification"),
  cases: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      source: Schema.Literals(["existing", "recommended"]),
      category: Schema.Literals(["normal", "abnormal", "boundary", "state", "resource"]),
      steps: Schema.Array(Schema.String),
      expected: Schema.Array(Schema.String),
      claimIDs: Schema.Array(Schema.String),
    }),
  ),
}).annotate({ identifier: "DesignDocVerificationCaseIR" })
export type VerificationCaseIR = Types.DeepMutable<typeof VerificationCaseIR.Type>

export const ProductSectionIR = Schema.Union([
  ModuleOverviewIR,
  RequirementTraceIR,
  ArchitectureIR,
  DataEntityIR,
  AlgorithmIR,
  InterfaceContractIR,
  ScenarioFlowIR,
  ResourcePerformanceIR,
  DfxIR,
  SfmeaIR,
  VerificationCaseIR,
]).annotate({ identifier: "DesignDocProductSectionIR" })
export type ProductSectionIR = Types.DeepMutable<typeof ProductSectionIR.Type>

export const LifecycleIR = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  moduleID: Schema.String,
  viewType: Schema.Literal("lifecycle"),
  title: Schema.String,
  summary: Schema.String,
  assumptions: Schema.Array(Schema.Struct({ text: Schema.String, evidenceIDs: EvidenceReference })),
  unknowns: Schema.Array(Schema.Struct({ text: Schema.String, evidenceIDs: EvidenceReference })),
  states: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      label: Schema.String,
      sourceValue: Schema.String,
      description: Schema.optional(Schema.String),
      role: Schema.Literals(["initial", "intermediate", "terminal", "error", "unknown"]),
      evidenceIDs: EvidenceReference,
    }),
  ),
  transitions: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      from: Schema.String,
      to: Schema.String,
      trigger: Schema.optional(Schema.String),
      guard: Schema.optional(Schema.String),
      action: Schema.optional(Schema.String),
      evidenceIDs: EvidenceReference,
    }),
  ),
  initialStateID: Schema.String,
  terminalStateIDs: Schema.Array(Schema.String),
}).annotate({ identifier: "DesignDocLifecycleIR" })
export type LifecycleIR = Types.DeepMutable<typeof LifecycleIR.Type>

export const StructureIR = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  moduleID: Schema.String,
  viewType: Schema.Literal("structure"),
  title: Schema.String,
  summary: Schema.String,
  assumptions: Schema.Array(Schema.Struct({ text: Schema.String, evidenceIDs: EvidenceReference })),
  unknowns: Schema.Array(Schema.Struct({ text: Schema.String, evidenceIDs: EvidenceReference })),
  nodes: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      kind: Schema.Literals(["source-file", "external-dependency"]),
      sourceRef: Schema.String,
      evidenceIDs: EvidenceReference,
    }),
  ),
  edges: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      from: Schema.String,
      to: Schema.String,
      kind: Schema.Literal("depends-on"),
      evidenceIDs: EvidenceReference,
    }),
  ),
}).annotate({ identifier: "DesignDocStructureIR" })
export type StructureIR = Types.DeepMutable<typeof StructureIR.Type>

const CodeStructureNodeKind = Schema.Literals([
  "source-file",
  "class",
  "interface",
  "type",
  "enum",
  "struct",
  "union",
  "namespace",
  "function",
  "method",
])

export const CodeStructureIR = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  moduleID: Schema.String,
  viewType: Schema.Literal("code-structure"),
  title: Schema.String,
  summary: Schema.String,
  assumptions: Schema.Array(Schema.Struct({ text: Schema.String, evidenceIDs: EvidenceReference })),
  unknowns: Schema.Array(Schema.Struct({ text: Schema.String, evidenceIDs: EvidenceReference })),
  nodes: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      kind: CodeStructureNodeKind,
      sourceRef: Schema.String,
      label: Schema.String,
      evidenceIDs: EvidenceReference,
    }),
  ),
  edges: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      from: Schema.String,
      to: Schema.String,
      kind: Schema.Literal("contains"),
      evidenceIDs: EvidenceReference,
    }),
  ),
}).annotate({ identifier: "DesignDocCodeStructureIR" })
export type CodeStructureIR = Types.DeepMutable<typeof CodeStructureIR.Type>

export const ExecutionFlowIR = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  moduleID: Schema.String,
  viewType: Schema.Literal("execution-flow"),
  title: Schema.String,
  summary: Schema.String,
  assumptions: Schema.Array(Schema.Struct({ text: Schema.String, evidenceIDs: EvidenceReference })),
  unknowns: Schema.Array(Schema.Struct({ text: Schema.String, evidenceIDs: EvidenceReference })),
  nodes: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      kind: Schema.Literals(["entry", "action", "decision", "exit", "error"]),
      sourceRef: Schema.String,
      label: Schema.String,
      evidenceIDs: EvidenceReference,
    }),
  ),
  edges: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      from: Schema.String,
      to: Schema.String,
      kind: Schema.Literals(["next", "branch-true", "branch-false", "loop", "return", "error"]),
      label: Schema.String,
      evidenceIDs: EvidenceReference,
    }),
  ),
}).annotate({ identifier: "DesignDocExecutionFlowIR" })
export type ExecutionFlowIR = Types.DeepMutable<typeof ExecutionFlowIR.Type>

export const BusinessFlowIR = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  moduleID: Schema.String,
  viewType: Schema.Literal("business-flow"),
  title: Schema.String,
  summary: Schema.String,
  assumptions: Schema.Array(Schema.Struct({ text: Schema.String, evidenceIDs: EvidenceReference })),
  unknowns: Schema.Array(Schema.Struct({ text: Schema.String, evidenceIDs: EvidenceReference })),
  activities: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      kind: Schema.Literals(["trigger", "activity", "decision", "outcome", "error"]),
      sourceRef: Schema.String,
      label: Schema.String,
      businessMeaning: Schema.String,
      evidenceIDs: EvidenceReference,
    }),
  ),
  flows: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      from: Schema.String,
      to: Schema.String,
      kind: Schema.Literals(["next", "branch", "success", "failure", "loop"]),
      label: Schema.String,
      evidenceIDs: EvidenceReference,
    }),
  ),
}).annotate({ identifier: "DesignDocBusinessFlowIR" })
export type BusinessFlowIR = Types.DeepMutable<typeof BusinessFlowIR.Type>

export const SequenceIR = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  moduleID: Schema.String,
  viewType: Schema.Literal("sequence"),
  title: Schema.String,
  summary: Schema.String,
  assumptions: Schema.Array(Schema.Struct({ text: Schema.String, evidenceIDs: EvidenceReference })),
  unknowns: Schema.Array(Schema.Struct({ text: Schema.String, evidenceIDs: EvidenceReference })),
  participants: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      kind: Schema.Literals(["internal", "external"]),
      sourceRef: Schema.String,
      label: Schema.String,
      evidenceIDs: EvidenceReference,
    }),
  ),
  messages: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      from: Schema.String,
      to: Schema.String,
      label: Schema.String,
      kind: Schema.Literals(["call", "return", "event"]),
      evidenceIDs: EvidenceReference,
    }),
  ),
}).annotate({ identifier: "DesignDocSequenceIR" })
export type SequenceIR = Types.DeepMutable<typeof SequenceIR.Type>

export const DataFlowIR = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  moduleID: Schema.String,
  viewType: Schema.Literal("data-flow"),
  title: Schema.String,
  summary: Schema.String,
  assumptions: Schema.Array(Schema.Struct({ text: Schema.String, evidenceIDs: EvidenceReference })),
  unknowns: Schema.Array(Schema.Struct({ text: Schema.String, evidenceIDs: EvidenceReference })),
  entities: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      kind: Schema.Literals(["input", "output", "variable", "value", "store", "external"]),
      sourceRef: Schema.String,
      label: Schema.String,
      evidenceIDs: EvidenceReference,
    }),
  ),
  flows: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      from: Schema.String,
      to: Schema.String,
      kind: Schema.Literals(["read", "write", "return", "transfer"]),
      label: Schema.String,
      evidenceIDs: EvidenceReference,
    }),
  ),
}).annotate({ identifier: "DesignDocDataFlowIR" })
export type DataFlowIR = Types.DeepMutable<typeof DataFlowIR.Type>

export const ErrorFlowIR = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  moduleID: Schema.String,
  viewType: Schema.Literal("error-flow"),
  title: Schema.String,
  summary: Schema.String,
  assumptions: Schema.Array(Schema.Struct({ text: Schema.String, evidenceIDs: EvidenceReference })),
  unknowns: Schema.Array(Schema.Struct({ text: Schema.String, evidenceIDs: EvidenceReference })),
  nodes: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      kind: Schema.Literals(["entry", "raise", "handler", "retry", "fallback", "terminal"]),
      sourceRef: Schema.String,
      label: Schema.String,
      evidenceIDs: EvidenceReference,
    }),
  ),
  edges: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      from: Schema.String,
      to: Schema.String,
      kind: Schema.Literals(["error", "handle", "retry", "fallback", "terminate"]),
      label: Schema.String,
      evidenceIDs: EvidenceReference,
    }),
  ),
}).annotate({ identifier: "DesignDocErrorFlowIR" })
export type ErrorFlowIR = Types.DeepMutable<typeof ErrorFlowIR.Type>

export const OverviewIR = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  moduleID: Schema.String,
  viewType: Schema.Literal("overview"),
  title: Schema.String,
  summary: Schema.String,
  assumptions: Schema.Array(Schema.Struct({ text: Schema.String, evidenceIDs: EvidenceReference })),
  unknowns: Schema.Array(Schema.Struct({ text: Schema.String, evidenceIDs: EvidenceReference })),
  responsibilities: Schema.Array(Schema.Struct({ text: Schema.String, evidenceIDs: EvidenceReference })),
  boundaries: Schema.Array(Schema.Struct({ text: Schema.String, evidenceIDs: EvidenceReference })),
  items: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      kind: Schema.Literals(["file", "symbol", "entry", "dependency", "configuration"]),
      sourceRef: Schema.String,
      label: Schema.String,
      evidenceIDs: EvidenceReference,
    }),
  ),
  relations: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        from: Schema.String,
        to: Schema.String,
        kind: Schema.Literals(["contains", "entry", "depends-on", "configures"]),
        label: Schema.String,
        evidenceIDs: EvidenceReference,
      }),
    ),
  ),
}).annotate({ identifier: "DesignDocOverviewIR" })
export type OverviewIR = Types.DeepMutable<typeof OverviewIR.Type>

const TopicClaim = Schema.Struct({
  text: Schema.String,
  evidenceIDs: EvidenceReference,
}).annotate({ identifier: "DesignDocTopicClaim" })

export const DesignTopicIR = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  moduleID: Schema.String,
  viewType: Schema.Literal("topic"),
  topic: DesignTopic,
  applicability: Schema.Literals(["applicable", "not-applicable", "unknown"]),
  title: Schema.String,
  summary: Schema.String,
  conclusions: Schema.Array(TopicClaim),
  mechanisms: Schema.Array(TopicClaim),
  flows: Schema.Array(TopicClaim),
  exceptions: Schema.Array(TopicClaim),
  constraints: Schema.Array(TopicClaim),
  assumptions: Schema.Array(TopicClaim),
  unknowns: Schema.Array(TopicClaim),
}).annotate({ identifier: "DesignDocTopicIR" })
export type DesignTopicIR = Types.DeepMutable<typeof DesignTopicIR.Type>

export const NotApplicableDiagramIR = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  moduleID: Schema.String,
  viewType: Schema.Literal("not-applicable"),
  designView: DesignView,
  title: Schema.String,
  reason: Schema.String,
  evidenceIDs: EvidenceReference,
  unknowns: Schema.Array(Schema.Struct({ text: Schema.String, evidenceIDs: EvidenceReference })),
}).annotate({ identifier: "DesignDocNotApplicableDiagramIR" })
export type NotApplicableDiagramIR = Types.DeepMutable<typeof NotApplicableDiagramIR.Type>

export const DiagramIR = Schema.Union([
  LifecycleIR,
  StructureIR,
  CodeStructureIR,
  ExecutionFlowIR,
  BusinessFlowIR,
  SequenceIR,
  DataFlowIR,
  ErrorFlowIR,
  OverviewIR,
  DesignTopicIR,
  ProductSectionIR,
  NotApplicableDiagramIR,
]).annotate({ identifier: "DesignDocDiagramIR" })
export type DesignDocIR = Types.DeepMutable<typeof DiagramIR.Type>

export const ValidationReport = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  workItemID: Schema.String,
  attempt: Schema.Int,
  passed: Schema.Boolean,
  sourceSnapshotHash: Schema.String,
  validatorVersions: Schema.Record(Schema.String, Schema.String),
  errors: Schema.Array(ValidationIssue),
  warnings: Schema.Array(ValidationIssue),
  metrics: Schema.Record(Schema.String, Schema.Number),
  createdAt: Schema.Int,
}).annotate({ identifier: "DesignDocValidationReport" })
export type ValidationReport = Types.DeepMutable<typeof ValidationReport.Type>

export const WorkItemAttempt = Schema.Struct({
  number: Schema.Int,
  kind: Schema.Literals(["generate", "repair"]),
  sessionID: Schema.String,
  model: ModelReference,
  status: Schema.Literals(["created", "running", "completed", "error", "interrupted"]),
  repairedFromSessionID: Schema.optional(Schema.String),
  startedAt: Schema.Int,
  completedAt: Schema.optional(Schema.Int),
  cost: Schema.optional(Schema.Finite),
  tokens: Schema.optional(
    Schema.Struct({
      total: Schema.optional(Schema.Finite),
      input: Schema.Finite,
      output: Schema.Finite,
      reasoning: Schema.Finite,
      cache: Schema.Struct({ read: Schema.Finite, write: Schema.Finite }),
    }),
  ),
}).annotate({ identifier: "DesignDocWorkItemAttempt" })
export type WorkItemAttempt = Types.DeepMutable<typeof WorkItemAttempt.Type>

export const EvidenceScope = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("source-files"),
    values: Schema.Array(Schema.String),
    label: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("source-symbol"),
    value: Schema.String,
    label: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("source-symbols"),
    values: Schema.Array(Schema.String),
    label: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("topic-evidence"),
    values: Schema.Array(Schema.String),
    label: Schema.String,
    coverageTotal: Schema.Int,
    coverageSetHash: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("behavior-refs"),
    values: Schema.Array(Schema.String),
    path: Schema.String,
    label: Schema.String,
    coverageRole: Schema.Literals(["overview", "detail"]),
    coverageTotal: Schema.Int,
    coverageSetHash: Schema.String,
  }),
]).annotate({ identifier: "DesignDocEvidenceScope" })
export type EvidenceScope = Types.DeepMutable<typeof EvidenceScope.Type>

export const Artifact = Schema.Struct({
  id: Schema.String,
  workItemID: Schema.String,
  kind: Schema.Literals([
    "manifest",
    "evidence-pack",
    "ir",
    "validation-report",
    "mermaid",
    "render",
    "quality-report",
    "document",
  ]),
  path: Schema.String,
  mediaType: Schema.String,
  sha256: Schema.String,
  status: Schema.Literals(["candidate", "passed", "stale", "failed"]),
  createdAt: Schema.Int,
}).annotate({ identifier: "DesignDocArtifact" })
export type Artifact = Types.DeepMutable<typeof Artifact.Type>

export const WorkItem = Schema.Struct({
  id: Schema.String,
  moduleID: Schema.String,
  artifactType: ArtifactType,
  purpose: Schema.optional(WorkItemPurpose),
  status: WorkItemStatus,
  dependencies: Schema.Array(Schema.String),
  attempts: Schema.Array(WorkItemAttempt),
  retryCursor: Schema.optional(Schema.Int),
  modelOverride: Schema.optional(ModelReference),
  evidenceScope: Schema.optional(EvidenceScope),
  evidencePackPath: Schema.optional(Schema.String),
  candidateArtifactPath: Schema.optional(Schema.String),
  candidateSourceSnapshotHash: Schema.optional(Schema.String),
  validationReportPath: Schema.optional(Schema.String),
  artifactIDs: Schema.Array(Schema.String),
  failure: Schema.optional(ValidationIssue),
  createdAt: Schema.Int,
  updatedAt: Schema.Int,
}).annotate({ identifier: "DesignDocWorkItem" })
export type WorkItem = Types.DeepMutable<typeof WorkItem.Type>

export const JobProgress = Schema.Struct({
  total: Schema.Int,
  pending: Schema.Int,
  running: Schema.Int,
  passed: Schema.Int,
  failed: Schema.Int,
  blocked: Schema.Int,
  cancelled: Schema.Int,
  currentWorkItemID: Schema.optional(Schema.String),
}).annotate({ identifier: "DesignDocJobProgress" })
export type JobProgress = Types.DeepMutable<typeof JobProgress.Type>

export const JobConfig = Schema.Struct({
  targetPath: Schema.String,
  artifactTypes: Schema.Array(ArtifactType),
  languages: Schema.Array(Schema.Literals(["typescript", "tsx", "c"])),
  concurrency: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 4 })),
  recursive: Schema.Boolean,
  documentProfile: Schema.optional(DocumentProfile),
  outputFormats: Schema.optional(Schema.Array(Schema.Literals(["markdown", "docx"]))),
  referenceInputs: Schema.optional(
    Schema.Array(
      Schema.Struct({
        path: Schema.String,
        kind: Schema.Literals(["requirement", "architecture", "interface", "test"]),
      }),
    ),
  ),
  moduleHints: Schema.optional(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        includePaths: Schema.Array(Schema.String),
      }),
    ),
  ),
  evidenceBudget: Schema.Struct({
    maxItems: Schema.Int,
    maxPromptBytes: Schema.Int,
    maxSnippetCharacters: Schema.Int,
  }),
  atomicEvidenceBudget: Schema.optional(
    Schema.Struct({
      maxItems: Schema.Int,
      maxPromptBytes: Schema.Int,
      maxSnippetCharacters: Schema.Int,
    }),
  ),
  retryPolicy: Schema.Struct({
    maxAttempts: Schema.Int,
    timeoutMs: Schema.Int,
    backoffMs: Schema.Array(Schema.Int),
    retryableCodes: Schema.Array(Schema.String),
  }),
  modelPolicy: Schema.Struct({
    primary: ModelReference,
    fallbacks: Schema.Array(Schema.Struct({ fromAttempt: Schema.Int, model: ModelReference })),
    structuredOutput: Schema.Literal("tool-json-schema"),
  }),
  renderer: Schema.Literal("mermaid"),
}).annotate({ identifier: "DesignDocJobConfig" })
export type JobConfig = Types.DeepMutable<typeof JobConfig.Type>

export const DesignDocJob = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  id: Schema.String,
  revision: Schema.Int,
  status: JobStatus,
  resumeFrom: Schema.optional(JobStatus),
  workspace: Schema.String,
  ownerSessionID: Schema.optional(Schema.String),
  config: JobConfig,
  moduleManifestPath: Schema.optional(Schema.String),
  workItems: Schema.Array(WorkItem),
  artifacts: Schema.Array(Artifact),
  progress: JobProgress,
  lastError: Schema.optional(ValidationIssue),
  createdAt: Schema.Int,
  updatedAt: Schema.Int,
}).annotate({ identifier: "DesignDocJob" })
export type DesignDocJob = Types.DeepMutable<typeof DesignDocJob.Type>

export const ModuleDescriptor = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  path: Schema.String,
  parentID: Schema.optional(Schema.String),
  languages: Schema.Array(Schema.String),
  sourceFiles: Schema.Array(Schema.String),
  testFiles: Schema.Array(Schema.String),
  unitKind: Schema.optional(Schema.Literals(["root", "directory", "c-component", "logical-submodule"])),
  implementationFiles: Schema.optional(Schema.Array(Schema.String)),
  supportFiles: Schema.optional(Schema.Array(Schema.String)),
}).annotate({ identifier: "DesignDocModuleDescriptor" })

export const ModuleManifest = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  sourceSnapshotHash: Schema.String,
  rootModuleID: Schema.String,
  modules: Schema.Array(ModuleDescriptor),
  ownership: Schema.optional(
    Schema.Array(
      Schema.Struct({
        path: Schema.String,
        ownerModuleID: Schema.String,
        role: Schema.Literals(["implementation", "support"]),
      }),
    ),
  ),
  workItemIDs: Schema.Array(Schema.String),
  createdAt: Schema.Int,
}).annotate({ identifier: "DesignDocModuleManifest" })
export type ModuleManifest = Types.DeepMutable<typeof ModuleManifest.Type>

export const CreateJobInput = Schema.Struct({
  targetPath: Schema.String.check(Schema.isMinLength(1)),
  artifactType: Schema.optional(ArtifactType),
  artifactTypes: Schema.optional(Schema.Array(ArtifactType)),
  recursive: Schema.optional(Schema.Boolean),
  documentProfile: Schema.optional(DocumentProfile),
  outputFormats: Schema.optional(Schema.Array(Schema.Literals(["markdown", "docx"]))),
  referenceInputs: Schema.optional(
    Schema.Array(
      Schema.Struct({
        path: Schema.String.check(Schema.isMinLength(1)),
        kind: Schema.Literals(["requirement", "architecture", "interface", "test"]),
      }),
    ),
  ),
  moduleHints: Schema.optional(
    Schema.Array(
      Schema.Struct({
        name: Schema.String.check(Schema.isMinLength(1)),
        includePaths: Schema.Array(Schema.String.check(Schema.isMinLength(1))),
      }),
    ),
  ),
  concurrency: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 4 }))),
  ownerSessionID: Schema.optional(Schema.String),
  model: ModelReference,
  modelFallbacks: Schema.optional(
    Schema.Array(
      Schema.Struct({
        fromAttempt: Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 3 })),
        model: ModelReference,
      }),
    ),
  ),
  timeoutMs: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  maxAttempts: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 3 }))),
}).annotate({ identifier: "DesignDocCreateJobInput" })
export type CreateJobInput = Types.DeepMutable<typeof CreateJobInput.Type>

export const RetryWorkItemInput = Schema.Struct({
  model: Schema.optional(ModelReference),
}).annotate({ identifier: "DesignDocRetryWorkItemInput" })
export type RetryWorkItemInput = Types.DeepMutable<typeof RetryWorkItemInput.Type>

export function progress(workItems: readonly WorkItem[]): JobProgress {
  const count = (statuses: WorkItemStatus[]) => workItems.filter((item) => statuses.includes(item.status)).length
  const current = workItems.find((item) => item.status === "running" || item.status === "validating")?.id
  return {
    total: workItems.length,
    pending: count(["pending", "ready", "retryable"]),
    running: count(["running", "validating"]),
    passed: count(["passed"]),
    failed: count(["failed"]),
    blocked: count(["blocked"]),
    cancelled: count(["cancelled"]),
    ...(current ? { currentWorkItemID: current } : {}),
  }
}

export function consumedAttempts(attempts: readonly WorkItemAttempt[], cursor = 0) {
  return attempts.slice(cursor).filter((attempt) => attempt.status !== "interrupted").length
}
