@file:Suppress("UnstableApiUsage")

package ai.chipmate.rpc

import ai.chipmate.rpc.dto.LegacyCleanupReportDto
import ai.chipmate.rpc.dto.LegacyCleanupTargetsDto
import ai.chipmate.rpc.dto.LegacyMigrationDetectionDto
import ai.chipmate.rpc.dto.LegacyMigrationEventDto
import ai.chipmate.rpc.dto.LegacyMigrationSelectionsDto
import ai.chipmate.rpc.dto.LegacyMigrationStatusDto
import com.intellij.platform.rpc.RemoteApiProviderService
import fleet.rpc.RemoteApi
import fleet.rpc.Rpc
import fleet.rpc.remoteApiDescriptor
import kotlinx.coroutines.flow.Flow

/**
 * App-level RPC API for legacy migration operations.
 *
 * All operations are app-scoped. The backend implementation delegates to
 * [ai.chipmate.backend.app.ChipMateBackendMigrationManager] using the active CLI connection.
 */
@Rpc
interface ChipMateMigrationRpcApi : RemoteApi<Unit> {
    companion object {
        suspend fun getInstance(): ChipMateMigrationRpcApi =
            RemoteApiProviderService.resolve(remoteApiDescriptor<ChipMateMigrationRpcApi>())
    }

    /** Return the persisted migration status, or null if not yet set. */
    suspend fun status(): LegacyMigrationStatusDto?

    /** Clear the persisted migration status so migration can be offered again. */
    suspend fun resetStatus(): Boolean

    /** Detect legacy data and return a summary of what can be migrated. */
    suspend fun detect(): LegacyMigrationDetectionDto

    /** Run migration for the given selections, streaming progress events. */
    suspend fun migrate(selections: LegacyMigrationSelectionsDto): Flow<LegacyMigrationEventDto>

    /** Mark migration as skipped. */
    suspend fun skip()

    /** Resume app load without marking migration as completed. */
    suspend fun resume()

    /** Mark migration as completed or completed with errors. */
    suspend fun finalize(status: LegacyMigrationStatusDto)

    /** Clean up legacy data after migration. Deleting the legacy settings file marks migration completed. */
    suspend fun cleanup(targets: LegacyCleanupTargetsDto): LegacyCleanupReportDto
}
