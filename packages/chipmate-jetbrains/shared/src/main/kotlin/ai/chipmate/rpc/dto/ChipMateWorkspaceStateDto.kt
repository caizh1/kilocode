package ai.chipmate.rpc.dto

import kotlinx.serialization.Serializable

@Serializable
enum class ChipMateWorkspaceStatusDto {
    PENDING,
    LOADING,
    READY,
    ERROR,
}

@Serializable
data class ChipMateWorkspaceLoadProgressDto(
    val providers: Boolean = false,
    val agents: Boolean = false,
    val commands: Boolean = false,
    val skills: Boolean = false,
)

@Serializable
data class ChipMateWorkspaceStateDto(
    val status: ChipMateWorkspaceStatusDto,
    val progress: ChipMateWorkspaceLoadProgressDto? = null,
    val providers: ProvidersDto? = null,
    val agents: AgentsDto? = null,
    val commands: List<CommandDto> = emptyList(),
    val skills: List<SkillDto> = emptyList(),
    val error: String? = null,
    val errors: List<LoadErrorDto> = emptyList(),
)

@Serializable
data class ModelsWorkspaceDto(
    val providers: ProvidersDto? = null,
    val agents: AgentsDto? = null,
    val errors: List<LoadErrorDto> = emptyList(),
)
