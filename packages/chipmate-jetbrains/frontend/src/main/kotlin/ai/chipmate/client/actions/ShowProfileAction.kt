package ai.chipmate.client.actions

import ai.chipmate.client.plugin.ChipMateBundle
import ai.chipmate.client.settings.profile.UserProfileConfigurable
import ai.chipmate.client.telemetry.Telemetry
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.options.ConfigurableWithId
import com.intellij.openapi.options.ShowSettingsUtil
import com.intellij.openapi.project.DumbAwareAction
import java.util.function.Predicate

/**
 * Toolbar action that opens the ChipMate User Profile settings page.
 *
 * Uses a predicate-based lookup so settings open correctly in JetBrains
 * Remote Development where configurables may be wrapped.
 */
class ShowProfileAction : DumbAwareAction(
    ChipMateBundle.message("action.ChipMate.ShowProfile.text"),
    ChipMateBundle.message("action.ChipMate.ShowProfile.description"),
    AllIcons.General.User,
) {

    override fun actionPerformed(e: AnActionEvent) {
        Telemetry.send("Profile Settings Opened", mapOf("surface" to "tool_window"))
        ShowSettingsUtil.getInstance().showSettingsDialog(
            e.project,
            Predicate { cfg: Configurable ->
                cfg is ConfigurableWithId && cfg.getId() == UserProfileConfigurable.ID
            },
            { cfg: Configurable -> cfg.focusOn(UserProfileConfigurable.FOCUS_ACCOUNT_COMBO) },
        )
    }

    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT
}
