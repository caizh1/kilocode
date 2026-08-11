package ai.chipmate.client.settings.rules

import ai.chipmate.client.plugin.ChipMateBundle
import ai.chipmate.client.settings.base.DraftReadyConfigurable
import kotlinx.coroutines.CoroutineScope
import javax.swing.JComponent

class RulesConfigurable : DraftReadyConfigurable<JComponent>() {
    override fun getId(): String = ID

    override fun getDisplayName(): String = ChipMateBundle.message("settings.agentBehavior.rules.displayName")

    override fun create(cs: CoroutineScope): JComponent = RulesSettingsUi(cs, root = project?.basePath)

    override fun scrollReadyShell() = false

    companion object {
        const val ID = "ai.chipmate.jetbrains.settings.agentBehavior.rules"
    }
}
