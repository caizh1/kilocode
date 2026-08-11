package ai.chipmate.client.session

import ai.chipmate.client.app.ChipMateAppService
import ai.chipmate.client.app.ChipMateSessionService
import ai.chipmate.client.app.ChipMateWorkspaceService
import ai.chipmate.client.app.Workspace
import ai.chipmate.client.testing.FakeAppRpcApi
import ai.chipmate.client.testing.FakeSessionRpcApi
import ai.chipmate.client.testing.FakeWorkspaceRpcApi
import ai.chipmate.rpc.dto.ChipMateAppStateDto
import ai.chipmate.rpc.dto.ChipMateAppStatusDto
import ai.chipmate.rpc.dto.ChipMateWorkspaceStateDto
import ai.chipmate.rpc.dto.ChipMateWorkspaceStatusDto
import ai.chipmate.rpc.dto.SessionDto
import ai.chipmate.rpc.dto.SessionTimeDto
import com.intellij.openapi.components.service
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel

@Suppress("UnstableApiUsage")
class SessionUiFactoryTest : BasePlatformTestCase() {
    private lateinit var scope: CoroutineScope
    private lateinit var workspace: Workspace
    private lateinit var workspaces: ChipMateWorkspaceService
    private lateinit var sessions: ChipMateSessionService
    private lateinit var app: ChipMateAppService

    override fun setUp() {
        super.setUp()
        scope = CoroutineScope(SupervisorJob())
        sessions = ChipMateSessionService(project, scope, FakeSessionRpcApi())
        app = ChipMateAppService(scope, FakeAppRpcApi().also {
            it.state.value = ChipMateAppStateDto(ChipMateAppStatusDto.READY)
        })
        workspaces = ChipMateWorkspaceService(scope, FakeWorkspaceRpcApi().also {
            it.state.value = ChipMateWorkspaceStateDto(ChipMateWorkspaceStatusDto.READY)
        })
        workspace = workspaces.workspace("/test")
    }

    override fun tearDown() {
        try {
            scope.cancel()
        } finally {
            super.tearDown()
        }
    }

    fun `test factory creates blank session ui`() {
        val ui = direct().create(project, workspace, FakeManager(), null)

        assertNotNull(ui)
    }

    fun `test factory wires open callback`() {
        val manager = FakeManager()
        val rpc = session("ses_1")
        val ui = SessionUi(project, workspace, sessions, app, scope, manager = manager, workspaces = workspaces)
        val controller = controller(ui)

        com.intellij.openapi.application.ApplicationManager.getApplication().invokeAndWait {
            controller.openSession(rpc)
        }

        assertEquals(listOf("ses_1"), manager.opened)
    }

    fun `test empty panel opens through SessionRef via controller`() {
        val manager = FakeManager()
        val rpc = session("ses_1")
        val ui = SessionUi(project, workspace, sessions, app, scope, manager = manager, workspaces = workspaces)
        val controller = controller(ui)
        val panel = ai.chipmate.client.session.ui.empty.EmptySessionPanel(testRootDisposable, controller, listOf(rpc))

        panel.clickRecent(0)

        // Recent click routes through SessionRef.Local path
        assertEquals(listOf("ses_1"), manager.opened)
    }

    fun `test empty panel show history routes through manager`() {
        val manager = FakeManager()
        val ui = SessionUi(project, workspace, sessions, app, scope, manager = manager, workspaces = workspaces)
        val controller = controller(ui)
        val panel = ai.chipmate.client.session.ui.empty.EmptySessionPanel(
            testRootDisposable,
            controller,
            emptyList(),
            history = { manager.showHistory() },
        )

        panel.clickShowHistory()

        assertEquals(1, manager.history)
    }

    private fun controller(ui: SessionUi): ai.chipmate.client.session.controller.SessionController {
        val field = SessionUi::class.java.getDeclaredField("controller")
        field.isAccessible = true
        return field.get(ui) as ai.chipmate.client.session.controller.SessionController
    }

    fun `test application service is available`() {
        assertNotNull(service<SessionUiFactory>())
    }

    private fun direct() = SessionUiFactory(scope)

    private fun session(id: String) = SessionDto(
        id = id,
        projectID = "prj",
        directory = "/test",
        title = "Session $id",
        version = "1",
        time = SessionTimeDto(created = 1.0, updated = 2.0),
    )

    private class FakeManager : SessionManager {
        val opened = mutableListOf<String>()
        var history = 0
        override fun newSession() {
        }

        override fun showHistory() {
            history++
        }

        override fun openSession(ref: SessionRef) {
            val id = when (ref) {
                is SessionRef.Local -> ref.id
                is SessionRef.Cloud -> ref.key
            }
            opened.add(id)
        }
    }
}
