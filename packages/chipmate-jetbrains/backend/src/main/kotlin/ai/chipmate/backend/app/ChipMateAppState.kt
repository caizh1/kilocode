package ai.chipmate.backend.app

import ai.chipmate.jetbrains.api.model.ChipMateNotifications200ResponseInner
import ai.chipmate.jetbrains.api.model.ChipMateProfile200Response
import ai.chipmate.backend.migration.LegacyMigrationDetection
import ai.chipmate.rpc.dto.ConfigDto

/**
 * Full application lifecycle state, combining CLI transport connection
 * status with data-loading progress.
 *
 * [ConnectionState] stays internal to [ChipMateConnectionService] for the
 * transport layer. This sealed class is what the frontend observes.
 */
sealed class ChipMateAppState {
    data object Disconnected : ChipMateAppState()
    data class Downloading(val percent: Int, val version: String, val platform: String) : ChipMateAppState()
    data object Connecting : ChipMateAppState()
    data class Loading(val progress: LoadProgress) : ChipMateAppState()
    data class MigrationRequired(val detection: LegacyMigrationDetection) : ChipMateAppState()
    data class Ready(val data: AppData, val rev: Long = 0) : ChipMateAppState()
    data class Error(val message: String, val errors: List<LoadError> = emptyList()) : ChipMateAppState()
}

/**
 * Tracks which global data fetches have completed during the [ChipMateAppState.Loading] phase.
 */
data class LoadProgress(
    val config: Boolean = false,
    val notifications: Boolean = false,
    val profile: ProfileResult = ProfileResult.PENDING,
)

/** Outcome of the profile fetch. */
enum class ProfileResult { PENDING, LOADED, NOT_LOGGED_IN }

/**
 * Error detail for a single resource that failed to load.
 */
data class LoadError(
    val resource: String,
    val status: Int? = null,
    val detail: String? = null,
)

data class ConfigWarning(
    val path: String,
    val message: String,
    val detail: String? = null,
)

/**
 * All global data that has been successfully loaded.
 * Present only in [ChipMateAppState.Ready].
 */
data class AppData(
    val profile: ChipMateProfile200Response?,
    val config: ConfigDto,
    val notifications: List<ChipMateNotifications200ResponseInner>,
    val warnings: List<ConfigWarning> = emptyList(),
)
