package ai.chipmate.client.actions

import ai.chipmate.client.plugin.ChipMateBundle
import ai.chipmate.client.settings.ChipMateSettingsConfigurable
import ai.chipmate.client.settings.ChipMateSettingsSelection
import ai.chipmate.client.telemetry.Telemetry
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.options.ConfigurableWithId
import com.intellij.openapi.options.ShowSettingsUtil
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.project.ProjectManager
import java.util.function.Predicate

class OpenSettingsAction : DumbAwareAction(
    ChipMateBundle.message("action.ChipMate.OpenSettings.text"),
    ChipMateBundle.message("action.ChipMate.OpenSettings.description"),
    null,
) {
    override fun actionPerformed(e: AnActionEvent) {
        Telemetry.send("Settings Opened", mapOf("surface" to "tool_window"))
        val project = e.project ?: ProjectManager.getInstance().defaultProject
        val target = ChipMateSettingsSelection.target(project)
        val util = ShowSettingsUtil.getInstance()
        try {
            util.showSettingsDialog(project, predicate(target), null)
        } catch (err: IllegalStateException) {
            if (target == ChipMateSettingsConfigurable.ID) throw err
            util.showSettingsDialog(project, predicate(ChipMateSettingsConfigurable.ID), null)
        }
    }

    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    private fun predicate(id: String) = Predicate { cfg: Configurable ->
        cfg is ConfigurableWithId && cfg.getId() == id
    }
}
