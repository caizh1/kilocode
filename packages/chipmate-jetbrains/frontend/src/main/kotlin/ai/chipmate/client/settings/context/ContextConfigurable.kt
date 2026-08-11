package ai.chipmate.client.settings.context

import ai.chipmate.client.plugin.ChipMateBundle
import ai.chipmate.client.settings.base.DraftReadyConfigurable
import kotlinx.coroutines.CoroutineScope
import javax.swing.JComponent

class ContextConfigurable : DraftReadyConfigurable<JComponent>() {
    override fun getId(): String = ID

    override fun getDisplayName(): String = ChipMateBundle.message("settings.context.displayName")

    override fun create(cs: CoroutineScope): JComponent = ContextSettingsUi(cs)

    companion object {
        const val ID = "ai.chipmate.jetbrains.settings.context"
    }
}
