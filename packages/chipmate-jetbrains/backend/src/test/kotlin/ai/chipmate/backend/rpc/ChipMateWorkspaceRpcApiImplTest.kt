package ai.chipmate.backend.rpc

import ai.chipmate.backend.app.ChipMateAppState
import ai.chipmate.backend.app.ChipMateBackendAppService
import ai.chipmate.backend.testing.FakeCliServer
import ai.chipmate.backend.testing.MockCliServer
import ai.chipmate.backend.testing.TestLog
import ai.chipmate.rpc.dto.WorkspaceFileDto
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class ChipMateWorkspaceRpcApiImplTest {
    private val mock = MockCliServer()
    private val log = TestLog()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val apps = mutableListOf<ChipMateBackendAppService>()

    @AfterTest
    fun tearDown() = runBlocking {
        apps.forEach { it.dispose() }
        apps.clear()
        scope.cancel()
        mock.close()
    }

    @Test
    fun `searches files and directories through core`() = runBlocking {
        mock.findFiles = """["src/Main.kt",".chipmate/worktrees/hidden.kt"]"""
        mock.findDirectories = """["src/","docs/"]"""
        val dir = Files.createTempDirectory("chipmate-search")
        try {
            val app = app()

            val result = ChipMateWorkspaceRpcApiImpl(app).searchFiles(dir.toString(), "src", 3)

            assertEquals(
                listOf(
                    WorkspaceFileDto("src", "src", directory = true),
                    WorkspaceFileDto("docs", "docs", directory = true),
                    WorkspaceFileDto("src/Main.kt", "Main.kt"),
                ),
                result.files,
            )
            assertEquals(2, mock.requestCount("/find/file"))
            assertTrue(mock.findFilePaths.any { it.contains("type=file") && it.contains("query=src") })
            assertTrue(mock.findFilePaths.any { it.contains("type=directory") && it.contains("query=src") })
        } finally {
            delete(dir)
        }
    }

    private suspend fun app(): ChipMateBackendAppService {
        val app = ChipMateBackendAppService.create(scope, FakeCliServer(mock), log).also { apps.add(it) }
        app.connect()
        val state = assertNotNull(
            withTimeoutOrNull(35_000) {
                app.appState.first {
                    it is ChipMateAppState.Ready || it is ChipMateAppState.Error || it is ChipMateAppState.MigrationRequired
                }
            },
            "App startup timed out in ${app.appState.value}; logs=${log.messages}",
        )
        assertIs<ChipMateAppState.Ready>(state, "App startup failed; logs=${log.messages}")
        return app
    }

    private fun delete(dir: java.nio.file.Path) {
        Files.walk(dir).use { paths ->
            paths.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) }
        }
    }
}
