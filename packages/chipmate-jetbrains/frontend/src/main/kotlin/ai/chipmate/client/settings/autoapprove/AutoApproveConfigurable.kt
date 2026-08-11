package ai.chipmate.client.settings.autoapprove

import ai.chipmate.client.plugin.ChipMateBundle
import ai.chipmate.client.settings.base.DraftReadyConfigurable
import kotlinx.coroutines.CoroutineScope
import javax.swing.JComponent

class AutoApproveConfigurable : DraftReadyConfigurable<JComponent>() {
    override fun getId(): String = ID

    override fun getDisplayName(): String = ChipMateBundle.message("settings.autoApprove.displayName")

    // The page renders its own fixed search field plus a scrollable body, so the shell must not
    // add another scroll pane around it.
    override fun scrollReadyShell(): Boolean = false

    override fun create(cs: CoroutineScope): JComponent = AutoApproveSettingsUi(cs)

    companion object {
        const val ID = "ai.chipmate.jetbrains.settings.autoApprove"
    }
}
