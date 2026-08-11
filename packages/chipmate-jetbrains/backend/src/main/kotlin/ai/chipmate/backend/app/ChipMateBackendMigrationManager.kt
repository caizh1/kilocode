package ai.chipmate.backend.app

import ai.chipmate.backend.migration.LegacyCleanupTargets
import ai.chipmate.backend.migration.LegacyCleanupReport
import ai.chipmate.backend.migration.LegacyMigrationBackend
import ai.chipmate.backend.migration.LegacyMigrationDetection
import ai.chipmate.backend.migration.LegacyMigrationEngine
import ai.chipmate.backend.migration.LegacyMigrationHttpBackend
import ai.chipmate.backend.migration.LegacyMigrationReport
import ai.chipmate.backend.migration.LegacyMigrationSelections
import ai.chipmate.backend.migration.LegacyMigrationSink
import ai.chipmate.backend.migration.LegacyMigrationStatus
import ai.chipmate.backend.migration.LegacyMigrationStore
import okhttp3.OkHttpClient

/**
 * Thin factory/wrapper that creates [LegacyMigrationEngine] instances using the active
 * CLI connection. Does not auto-run migration and does not touch any UI.
 *
 * Instantiate when the CLI connection is ready (port + authenticated client available).
 * The [store] is caller-supplied, allowing test and UI flows to provide different adapters.
 */
class ChipMateBackendMigrationManager(
    private val client: OkHttpClient,
    private val port: Int,
) {
    private fun base() = "http://127.0.0.1:$port"
    private fun httpBackend(): LegacyMigrationBackend = LegacyMigrationHttpBackend(client, base())

    fun status(store: LegacyMigrationStore): LegacyMigrationStatus? =
        LegacyMigrationEngine(store, httpBackend()).status()

    fun mark(store: LegacyMigrationStore, status: LegacyMigrationStatus) =
        LegacyMigrationEngine(store, httpBackend()).mark(status)

    fun detect(store: LegacyMigrationStore): LegacyMigrationDetection =
        LegacyMigrationEngine(store, httpBackend()).detect()

    fun migrate(
        store: LegacyMigrationStore,
        selections: LegacyMigrationSelections,
        sink: LegacyMigrationSink = LegacyMigrationSink.None,
    ): LegacyMigrationReport =
        LegacyMigrationEngine(store, httpBackend()).migrate(selections, sink)

    fun cleanup(store: LegacyMigrationStore, targets: LegacyCleanupTargets): LegacyCleanupReport =
        LegacyMigrationEngine(store, httpBackend()).cleanup(targets)
}
