package ai.chipmate.backend.workspace

import ai.chipmate.backend.app.LoadError

/**
 * Workspace data lifecycle state, combining connection readiness
 * with directory-scoped data loading progress.
 *
 * Only populated after [ChipMateAppState.Ready][ai.chipmate.backend.app.ChipMateAppState.Ready]
 * — the CLI server must be connected and global data loaded before
 * workspace data can be fetched.
 */
sealed class ChipMateWorkspaceState {
    data object Pending : ChipMateWorkspaceState()
    data class Loading(val progress: ChipMateWorkspaceLoadProgress) : ChipMateWorkspaceState()
    data class Ready(
        val providers: ProviderData,
        val agents: AgentData,
        val commands: List<CommandInfo>,
        val skills: List<SkillInfo>,
    ) : ChipMateWorkspaceState()
    data class Error(val message: String, val errors: List<LoadError> = emptyList()) : ChipMateWorkspaceState()
}

/**
 * Tracks which workspace data fetches have completed during
 * the [ChipMateWorkspaceState.Loading] phase.
 */
data class ChipMateWorkspaceLoadProgress(
    val providers: Boolean = false,
    val agents: Boolean = false,
    val commands: Boolean = false,
    val skills: Boolean = false,
)

data class ProviderData(
    val providers: List<ProviderInfo>,
    val connected: List<String>,
    val defaults: Map<String, String>,
)

data class ProviderInfo(
    val id: String,
    val name: String,
    val source: String?,
    val models: Map<String, ModelInfo>,
)

data class ModelInfo(
    val id: String,
    val name: String,
    val inputPrice: Double? = null,
    val outputPrice: Double? = null,
    val contextLength: Long? = null,
    val releaseDate: String? = null,
    val latest: Boolean? = null,
    val attachment: Boolean,
    val reasoning: Boolean,
    val temperature: Boolean,
    val toolCall: Boolean,
    val free: Boolean,
    val byok: Boolean = false,
    val status: String?,
    val recommendedIndex: Double?,
    val variants: List<String>,
    val limit: ModelLimitInfo?,
    val cost: ModelCostInfo? = null,
    val capabilities: ModelCapabilitiesInfo? = null,
    val options: ModelOptionsInfo? = null,
    val autoRouting: ModelAutoRoutingInfo? = null,
    val terminalBench: ModelTerminalBenchInfo? = null,
    val mayTrainOnYourPrompts: Boolean = false,
)

data class ModelLimitInfo(
    val context: Long = 0,
    val input: Long? = null,
    val output: Long = 0,
)

data class ModelCostInfo(
    val input: Double,
    val output: Double,
    val cache: ModelCacheCostInfo? = null,
)

data class ModelCacheCostInfo(
    val read: Double,
    val write: Double,
)

data class ModelCapabilitiesInfo(
    val reasoning: Boolean = false,
    val input: ModelInputCapabilitiesInfo? = null,
)

data class ModelInputCapabilitiesInfo(
    val text: Boolean = false,
    val image: Boolean = false,
    val audio: Boolean = false,
    val video: Boolean = false,
    val pdf: Boolean = false,
)

data class ModelOptionsInfo(
    val description: String? = null,
)

data class ModelAutoRoutingInfo(
    val models: List<String> = emptyList(),
)

data class ModelTerminalBenchInfo(
    val overallScore: Double,
    val avgAttemptCostUsd: Double,
)

data class AgentData(
    val agents: List<AgentInfo>,
    val all: List<AgentInfo>,
    val default: String,
)

data class AgentInfo(
    val name: String,
    val displayName: String?,
    val description: String?,
    val mode: String,
    val native: Boolean?,
    val hidden: Boolean?,
    val color: String?,
    val deprecated: Boolean?,
)

data class CommandInfo(
    val name: String,
    val description: String?,
    val agent: String?,
    val model: String?,
    val variant: String?,
    val source: String?,
    val hints: List<String>,
    val subtask: Boolean?,
)

data class SkillInfo(
    val name: String,
    val description: String?,
    val location: String,
    val content: String?,
)
