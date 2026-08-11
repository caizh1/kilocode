package ai.chipmate.client.actions

import ai.chipmate.client.app.ChipMateAppService
import ai.chipmate.client.app.ChipMateWorkspaceService
import ai.chipmate.client.app.Workspace
import ai.chipmate.client.session.SessionManager
import ai.chipmate.client.testing.FakeAppRpcApi
import ai.chipmate.client.testing.FakeWorkspaceRpcApi
import ai.chipmate.rpc.dto.ConfigTargetDto
import ai.chipmate.rpc.dto.ChipMateWorkspaceStateDto
import ai.chipmate.rpc.dto.ChipMateWorkspaceStatusDto
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.actionSystem.Presentation
import com.intellij.openapi.actionSystem.ex.ActionUtil
import com.intellij.openapi.application.ApplicationManager
import com.intellij.testFramework.replaceService
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout

@Suppress("UnstableApiUsage")
class ChipMateRecoveryActionsTest : BasePlatformTestCase() {
    private lateinit var scope: CoroutineScope
    private lateinit var rpc: FakeWorkspaceRpcApi
    private lateinit var appRpc: FakeAppRpcApi

    override fun setUp() {
        super.setUp()
        scope = CoroutineScope(SupervisorJob())
        rpc = FakeWorkspaceRpcApi()
        appRpc = FakeAppRpcApi()
        ApplicationManager.getApplication().replaceService(
            ChipMateAppService::class.java,
            ChipMateAppService(scope, appRpc),
            testRootDisposable,
        )
        ApplicationManager.getApplication().replaceService(
            ChipMateWorkspaceService::class.java,
            ChipMateWorkspaceService(scope, rpc),
            testRootDisposable,
        )
    }

    override fun tearDown() {
        try {
            scope.cancel()
        } finally {
            super.tearDown()
        }
    }

    fun `test restart action stays enabled for all app states`() {
        val action = RestartChipMateAction()
        val event = event(action)

        update(action, event)

        assertTrue("Restart should force-enable recovery action", event.presentation.isEnabled)
    }

    fun `test reinstall action stays enabled for all app states`() {
        val action = ReinstallChipMateAction()
        val event = event(action)

        update(action, event)

        assertTrue("Reinstall should force-enable recovery action", event.presentation.isEnabled)
    }

    fun `test restart action adds core suffix in connection retry popup`() {
        val action = RestartChipMateAction()
        val event = event(action, place = ChipMateActionPlaces.connectionRetryPopup())

        update(action, event)

        assertEquals("Restart Core", event.presentation.text)
    }

    fun `test reinstall action adds core suffix in connection retry popup`() {
        val action = ReinstallChipMateAction()
        val event = event(action, place = ChipMateActionPlaces.connectionRetryPopup())

        update(action, event)

        assertEquals("Reinstall Core", event.presentation.text)
    }

    fun `test core group has visible menu text and info action`() {
        val xml = requireNotNull(javaClass.classLoader.getResourceAsStream("chipmate.jetbrains.frontend.xml"))
            .bufferedReader()
            .use { it.readText() }

        assertTrue(xml.contains("<group id=\"ChipMate.CliGroup\" text=\"Core\" popup=\"true\">"))
        assertTrue(xml.contains("<reference ref=\"ChipMate.Restart\"/>"))
        assertTrue(xml.contains("<reference ref=\"ChipMate.Reinstall\"/>"))
        assertTrue(xml.contains("<reference ref=\"ChipMate.CoreInfo\"/>"))
        assertTrue(xml.contains("<group id=\"ChipMate.OpenConfigGroup\" text=\"Config Files\" popup=\"true\">"))
        assertTrue(xml.contains("<reference ref=\"ChipMate.OpenConfigGroup\"/>"))
        assertFalse(xml.contains("<action id=\"ChipMate.ShowProfile\""))
        assertFalse(xml.contains("<reference ref=\"ChipMate.ShowProfile\"/>"))
    }

    fun `test core info action shows version and architecture`() {
        appRpc.cliVersion = "1.2.3"
        appRpc.cliPlatform = "darwin-arm64"
        ApplicationManager.getApplication().executeOnPooledThread {
            runBlocking { app().coreInfo() }
        }.get()
        val action = CoreInfoAction()
        val event = event(action)

        update(action, event)

        assertFalse(event.presentation.isEnabled)
        assertTrue(event.presentation.isVisible)
        assertEquals("Core v1.2.3 • Architecture: darwin-arm64", event.presentation.text)
    }

    fun `test core info action marks bundled core`() {
        appRpc.cliVersion = "1.2.3"
        appRpc.cliPlatform = "darwin-arm64"
        appRpc.cliBundled = true
        ApplicationManager.getApplication().executeOnPooledThread {
            runBlocking { app().coreInfo() }
        }.get()
        val action = CoreInfoAction()
        val event = event(action)

        update(action, event)

        assertEquals("Bundled Core v1.2.3 • Architecture: darwin-arm64", event.presentation.text)
    }

    fun `test local config action says open when target exists`() {
        rpc.localConfigPath = "/test/.chipmate/chipmate.jsonc"
        rpc.localConfigDisplayPath = "~/.chipmate/chipmate.jsonc"
        rpc.localConfigExists = true
        service().localConfig["/test"] = ConfigTargetDto("/test/.chipmate/chipmate.jsonc", "~/.chipmate/chipmate.jsonc", true)
        val action = OpenLocalConfigAction()
        val event = event(action, workspace = workspace("/test"))

        update(action, event)

        assertTrue(event.presentation.isEnabled)
        assertEquals("Open: local ~/.chipmate/chipmate.jsonc", event.presentation.text)
        assertEquals(0, rpc.localConfigPathCalls)
    }

    fun `test local config action says create when target is missing`() {
        rpc.localConfigPath = "/test/.chipmate/chipmate.jsonc"
        rpc.localConfigDisplayPath = "~/.chipmate/chipmate.jsonc"
        rpc.localConfigExists = false
        service().localConfig["/test"] = ConfigTargetDto("/test/.chipmate/chipmate.jsonc", "~/.chipmate/chipmate.jsonc", false)
        val action = OpenLocalConfigAction()
        val event = event(action, workspace = workspace("/test"))

        update(action, event)

        assertTrue(event.presentation.isEnabled)
        assertEquals("Create: local ~/.chipmate/chipmate.jsonc", event.presentation.text)
        assertEquals(0, rpc.localConfigPathCalls)
    }

    fun `test local config action refreshes missing target in background`() {
        rpc.localConfigPath = "/test/.chipmate/chipmate.jsonc"
        rpc.localConfigDisplayPath = "/test/.chipmate/chipmate.jsonc"
        rpc.localConfigExists = true
        val call = CompletableDeferred<Unit>()
        val gate = CompletableDeferred<Unit>()
        rpc.beforeLocalConfigTarget = {
            call.complete(Unit)
            gate.await()
        }
        val action = OpenLocalConfigAction()
        val event = event(action, workspace = workspace("/test"))

        update(action, event)

        assertTrue(event.presentation.isEnabled)
        assertEquals("Open: local ...", event.presentation.text)
        await(call)
        assertEquals(1, rpc.localConfigPathCalls)

        gate.complete(Unit)
        service().localConfig["/test"] = ConfigTargetDto("/test/.chipmate/chipmate.jsonc", "/test/.chipmate/chipmate.jsonc", true)

        val next = event(action, workspace = workspace("/test"))
        update(action, next)

        assertEquals("Open: local /test/.chipmate/chipmate.jsonc", next.presentation.text)
    }

    fun `test local config action dedupes in flight refresh`() {
        val gate = CompletableDeferred<Unit>()
        val call = CompletableDeferred<Unit>()
        val action = OpenLocalConfigAction()
        rpc.beforeLocalConfigTarget = {
            call.complete(Unit)
            gate.await()
        }

        update(action, event(action, workspace = workspace("/test")))
        await(call)
        update(action, event(action, workspace = workspace("/test")))

        assertEquals(1, rpc.localConfigPathCalls)

        gate.complete(Unit)
    }

    fun `test global config action says open when target exists`() {
        rpc.globalConfigPath = "/config/chipmate.jsonc"
        rpc.globalConfigDisplayPath = "~/.config/chipmate/chipmate.jsonc"
        rpc.globalConfigExists = true
        cacheGlobal(ConfigTargetDto("/config/chipmate.jsonc", "~/.config/chipmate/chipmate.jsonc", true))
        val action = OpenGlobalConfigAction()
        val event = event(action)

        update(action, event)

        assertEquals("Open: global ~/.config/chipmate/chipmate.jsonc", event.presentation.text)
        assertEquals(0, rpc.globalConfigPathCalls)
    }

    fun `test global config action says create when target is missing`() {
        rpc.globalConfigPath = "/config/chipmate.jsonc"
        rpc.globalConfigDisplayPath = "~/.config/chipmate/chipmate.jsonc"
        rpc.globalConfigExists = false
        cacheGlobal(ConfigTargetDto("/config/chipmate.jsonc", "~/.config/chipmate/chipmate.jsonc", false))
        val action = OpenGlobalConfigAction()
        val event = event(action)

        update(action, event)

        assertEquals("Create: global ~/.config/chipmate/chipmate.jsonc", event.presentation.text)
        assertEquals(0, rpc.globalConfigPathCalls)
    }

    fun `test global config action refreshes missing target in background`() {
        rpc.globalConfigPath = "/config/chipmate.jsonc"
        rpc.globalConfigDisplayPath = "/config/chipmate.jsonc"
        rpc.globalConfigExists = true
        val call = CompletableDeferred<Unit>()
        val gate = CompletableDeferred<Unit>()
        rpc.beforeGlobalConfigTarget = {
            call.complete(Unit)
            gate.await()
        }
        val action = OpenGlobalConfigAction()
        val event = event(action)

        update(action, event)

        assertEquals("Open: global ...", event.presentation.text)
        await(call)
        assertEquals(1, rpc.globalConfigPathCalls)

        gate.complete(Unit)
        cacheGlobal(ConfigTargetDto("/config/chipmate.jsonc", "/config/chipmate.jsonc", true))

        val next = event(action)
        update(action, next)

        assertEquals("Open: global /config/chipmate.jsonc", next.presentation.text)
    }

    fun `test global config action dedupes in flight refresh`() {
        val gate = CompletableDeferred<Unit>()
        val call = CompletableDeferred<Unit>()
        rpc.beforeGlobalConfigTarget = {
            call.complete(Unit)
            gate.await()
        }
        val action = OpenGlobalConfigAction()

        update(action, event(action))
        await(call)
        update(action, event(action))

        assertEquals(1, rpc.globalConfigPathCalls)

        gate.complete(Unit)
    }

    fun `test local config action disables without directory`() {
        val action = OpenLocalConfigAction()
        val event = event(action)

        update(action, event)

        assertFalse(event.presentation.isEnabled)
        assertEquals(0, rpc.localConfigPathCalls)
    }

    fun `test settings popup group updates recursively in background`() {
        val group = DefaultActionGroup()
        val wrapped = ChipMateSettingsAction.popupGroup(group)

        assertEquals(ActionUpdateThread.BGT, wrapped.actionUpdateThread)
    }

    fun `test settings action prewarms config targets`() {
        val action = ChipMateSettingsAction()

        runBlocking {
            ChipMateSettingsAction.refreshConfigTargets(event(action, workspace = workspace("/test")), service()).forEach { it.join() }
        }

        assertEquals(1, rpc.localConfigPathCalls)
        assertEquals(1, rpc.globalConfigPathCalls)
    }

    fun `test workspace creation prewarms config targets`() {
        val local = CompletableDeferred<Unit>()
        val global = CompletableDeferred<Unit>()
        rpc.beforeLocalConfigTarget = { local.complete(Unit) }
        rpc.beforeGlobalConfigTarget = { global.complete(Unit) }

        service().workspace("/test")

        await(local)
        await(global)
        assertEquals(1, rpc.localConfigPathCalls)
        assertEquals(1, rpc.globalConfigPathCalls)
    }

    private fun event(action: AnAction, workspace: Workspace? = null, place: String = ""): AnActionEvent {
        val presentation = Presentation().apply { copyFrom(action.templatePresentation) }
        presentation.isEnabled = false
        return AnActionEvent.createFromDataContext(place, presentation, context(workspace))
    }

    private fun update(action: AnAction, event: AnActionEvent) {
        ApplicationManager.getApplication().executeOnPooledThread {
            ActionUtil.updateAction(action, event)
        }.get()
    }

    private fun await(signal: CompletableDeferred<Unit>) = runBlocking {
        withTimeout(5_000) { signal.await() }
    }

    private fun service(): ChipMateWorkspaceService = ApplicationManager.getApplication().getService(ChipMateWorkspaceService::class.java)

    private fun app(): ChipMateAppService = ApplicationManager.getApplication().getService(ChipMateAppService::class.java)

    private fun cacheGlobal(target: ConfigTargetDto) {
        val field = ChipMateWorkspaceService::class.java.getDeclaredField("globalConfig")
        field.isAccessible = true
        field.set(service(), target)
    }

    private fun context(workspace: Workspace?): DataContext {
        return DataContext { id ->
            when (id) {
                SessionManager.WORKSPACE_KEY.name -> workspace
                CommonDataKeys.PROJECT.name -> project.takeIf { workspace != null }
                else -> null
            }
        }
    }

    private fun workspace(dir: String): Workspace {
        return Workspace(
            dir,
            MutableStateFlow(ChipMateWorkspaceStateDto(ChipMateWorkspaceStatusDto.READY)),
            reload = {},
            refreshConfigFiles = {},
        )
    }
}
