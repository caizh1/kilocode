package ai.chipmate.client.app

import ai.chipmate.rpc.dto.ChipMateWorkspaceStateDto
import kotlinx.coroutines.flow.StateFlow

/**
 * A workspace for a single directory. Mirrors the CLI concept of a
 * workspace — a directory with its providers, agents, commands, skills.
 *
 * Immutable reference — [state] flows internally as the workspace loads.
 * Lifecycle managed by [ChipMateWorkspaceService].
 */
class Workspace(
    val directory: String,
    val state: StateFlow<ChipMateWorkspaceStateDto>,
    val reload: () -> Unit,
    val refreshConfigFiles: () -> Unit = {},
)
