package ai.chipmate.client.actions

import ai.chipmate.client.ChipMateNotifications
import ai.chipmate.client.migration.ChipMateMigrationService
import ai.chipmate.client.plugin.ChipMateBundle
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages

class ForceMigrationAction : AnAction(
    ChipMateBundle.message("action.ChipMate.ForceMigration.text"),
    ChipMateBundle.message("action.ChipMate.ForceMigration.description"),
    null,
), DumbAware {
    internal var confirm: (Project?) -> Boolean = { project ->
        Messages.showYesNoDialog(
            project,
            ChipMateBundle.message("action.ChipMate.ForceMigration.confirm.message"),
            ChipMateBundle.message("action.ChipMate.ForceMigration.confirm.title"),
            Messages.getWarningIcon(),
        ) == Messages.YES
    }

    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

    override fun actionPerformed(e: AnActionEvent) {
        if (!confirm(e.project)) return
        service<ChipMateMigrationService>().resetStatusAndRestart { ok ->
            if (ok) return@resetStatusAndRestart
            ChipMateNotifications.error(ChipMateBundle.message("action.ChipMate.ForceMigration.failed"))
        }
    }
}
