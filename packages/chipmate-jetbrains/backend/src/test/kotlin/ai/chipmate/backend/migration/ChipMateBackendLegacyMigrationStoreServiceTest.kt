package ai.chipmate.backend.migration

import ai.chipmate.backend.testing.TestLog
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ChipMateBackendLegacyMigrationStoreServiceTest {
    @Test
    fun `status marker survives deleted legacy settings file`() {
        val dir = Files.createTempDirectory("chipmate-migration-config").toFile()
        val env = mapOf("CHIPMATE_CONFIG_DIR" to dir.absolutePath)
        val log = TestLog()
        val store = ChipMateBackendLegacyMigrationStoreService.store(log, env)
        store.mark(LegacyMigrationStatus.CompletedWithErrors)
        store.cleanup(LegacyCleanupTargets(legacySettingsFile = true))
        ChipMateBackendLegacyMigrationStoreService.markStatus(log, LegacyMigrationStatus.Completed, env)

        assertFalse(dir.resolve("legacy-settings.json").exists())
        assertEquals(LegacyMigrationStatus.Completed, ChipMateBackendLegacyMigrationStoreService.status(log, env))
    }

    @Test
    fun `inline completed status is adopted into durable marker`() {
        val dir = Files.createTempDirectory("chipmate-migration-config").toFile()
        val env = mapOf("CHIPMATE_CONFIG_DIR" to dir.absolutePath)
        val log = TestLog()
        val store = ChipMateBackendLegacyMigrationStoreService.store(log, env)
        store.mark(LegacyMigrationStatus.Completed)

        // First read adopts the inline status into the durable marker.
        assertEquals(LegacyMigrationStatus.Completed, ChipMateBackendLegacyMigrationStoreService.status(log, env))
        assertTrue(dir.resolve("legacy-migration-status").isFile)

        // The adopted marker then survives deletion of the legacy settings file.
        store.cleanup(LegacyCleanupTargets(legacySettingsFile = true))
        assertFalse(dir.resolve("legacy-settings.json").exists())
        assertEquals(LegacyMigrationStatus.Completed, ChipMateBackendLegacyMigrationStoreService.status(log, env))
    }

    @Test
    fun `inline skipped status is adopted into durable marker`() {
        val dir = Files.createTempDirectory("chipmate-migration-config").toFile()
        val env = mapOf("CHIPMATE_CONFIG_DIR" to dir.absolutePath)
        val log = TestLog()
        val store = ChipMateBackendLegacyMigrationStoreService.store(log, env)
        store.mark(LegacyMigrationStatus.Skipped)

        assertEquals(LegacyMigrationStatus.Skipped, ChipMateBackendLegacyMigrationStoreService.status(log, env))
        assertTrue(dir.resolve("legacy-migration-status").isFile)
    }

    @Test
    fun `absent status stays null`() {
        val dir = Files.createTempDirectory("chipmate-migration-config").toFile()
        val env = mapOf("CHIPMATE_CONFIG_DIR" to dir.absolutePath)
        val log = TestLog()

        assertNull(ChipMateBackendLegacyMigrationStoreService.status(log, env))
        assertFalse(dir.resolve("legacy-migration-status").exists())
    }

    @Test
    fun `durable completed status is honored while legacy source payload remains`() {
        val dir = Files.createTempDirectory("chipmate-migration-config").toFile()
        val env = mapOf("CHIPMATE_CONFIG_DIR" to dir.absolutePath)
        val log = TestLog()
        val store = ChipMateBackendLegacyMigrationStoreService.store(log, env)
        store.mark(LegacyMigrationStatus.Completed)
        dir.resolve("legacy-settings.json").writeText(
            """{"migrationStatus":"Completed","providerProfiles":"{\"currentApiConfigName\":\"p\",\"apiConfigs\":{}}"}"""
        )
        ChipMateBackendLegacyMigrationStoreService.markStatus(log, LegacyMigrationStatus.Completed, env)

        assertEquals(LegacyMigrationStatus.Completed, ChipMateBackendLegacyMigrationStoreService.status(log, env))
    }

    @Test
    fun `reset status deletes durable marker`() {
        val dir = Files.createTempDirectory("chipmate-migration-config").toFile()
        val env = mapOf("CHIPMATE_CONFIG_DIR" to dir.absolutePath)
        val log = TestLog()
        ChipMateBackendLegacyMigrationStoreService.markStatus(log, LegacyMigrationStatus.Completed, env)

        assertEquals(LegacyMigrationStatus.Completed, ChipMateBackendLegacyMigrationStoreService.status(log, env))
        assertEquals(true, ChipMateBackendLegacyMigrationStoreService.resetStatus(log, env))
        assertNull(ChipMateBackendLegacyMigrationStoreService.status(log, env))
    }

    @Test
    fun `reset status clears adopted inline status`() {
        val dir = Files.createTempDirectory("chipmate-migration-config").toFile()
        val env = mapOf("CHIPMATE_CONFIG_DIR" to dir.absolutePath)
        val log = TestLog()
        val store = ChipMateBackendLegacyMigrationStoreService.store(log, env)
        store.mark(LegacyMigrationStatus.Skipped)

        assertEquals(LegacyMigrationStatus.Skipped, ChipMateBackendLegacyMigrationStoreService.status(log, env))
        assertEquals(true, ChipMateBackendLegacyMigrationStoreService.resetStatus(log, env))
        assertNull(ChipMateBackendLegacyMigrationStoreService.status(log, env))
    }
}
