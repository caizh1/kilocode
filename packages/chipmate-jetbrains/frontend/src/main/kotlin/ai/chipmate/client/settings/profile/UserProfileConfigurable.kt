package ai.chipmate.client.settings.profile

import ai.chipmate.client.app.ChipMateAppService
import ai.chipmate.client.plugin.ChipMateBundle
import ai.chipmate.client.settings.base.ChipMateReadyConfigurable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.components.service
import com.intellij.openapi.wm.IdeFocusManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.swing.JComponent

/**
 * Settings panel for ChipMate user profile.
 *
 * Located at Settings -> Tools -> ChipMate -> User Profile.
 *
 * Shows login / logout, current balance, ChipMate Pass, personal/org account selector,
 * and account billing actions. This is a status/action panel — it
 * has no persistent settings, so [isModified] always returns false.
 */
class UserProfileConfigurable : ChipMateReadyConfigurable() {

    private var ui: ProfileUi? = null
    private var watchJob: Job? = null
    private var focus = false

    override fun getId(): String = ID

    override fun getDisplayName(): String = ChipMateBundle.message("settings.profile.displayName")

    override fun preferredReady(): JComponent? = ui?.preferredFocus()

    override fun focusReady(label: String) {
        if (label != FOCUS_ACCOUNT_COMBO) return
        focus = true
        val panel = ui ?: return
        requestFocus(panel)
    }

    override fun createReadyComponent(cs: CoroutineScope): JComponent {
        val panel = buildPanel(cs)
        ui = panel
        startWatching(cs, panel)
        return panel
    }

    override fun onReadyComponentCreated(component: JComponent) {
        val panel = ui ?: return
        if (focus) requestFocus(panel)
    }

    private fun requestFocus(panel: ProfileUi) {
        val app = ApplicationManager.getApplication()
        app.invokeLater({
            app.invokeLater({
                val target = panel.preferredFocus()
                if (target.isShowing) IdeFocusManager.getGlobalInstance().requestFocus(target, true)
            }, ModalityState.any())
        }, ModalityState.any())
    }

    private fun buildPanel(cs: CoroutineScope): ProfileUi {
        val app = service<ChipMateAppService>()
        return ProfileUi(app.state.value.profile, app.state.value.status, cs)
    }

    private fun startWatching(cs: CoroutineScope, panel: ProfileUi) {
        val app = service<ChipMateAppService>()
        watchJob = cs.launch {
            app.state.collect { state ->
                withContext(edt) {
                    panel.update(state)
                }
            }
        }
    }

    override fun disposeReadyComponent(component: JComponent) {
        // Dispose UI first to invalidate pending login attempts before scope cancellation.
        val panel = ui
        val job = watchJob
        ui = null
        watchJob = null
        panel?.dispose()
        job?.cancel()
    }

    companion object {
        const val ID = "ai.chipmate.jetbrains.settings.profile"
        const val FOCUS_ACCOUNT_COMBO = "chipmate.profile.account.combo"
    }
}
