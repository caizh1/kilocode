package ai.chipmate.client.actions

import ai.chipmate.client.app.ChipMateAppService
import ai.chipmate.client.plugin.ChipMateBundle
import ai.chipmate.client.telemetry.Telemetry
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.components.service
import com.intellij.openapi.project.DumbAware

class ReinstallChipMateAction : AnAction(), DumbAware {
    override fun actionPerformed(e: AnActionEvent) {
        Telemetry.send("CLI Reinstall Clicked", mapOf("surface" to "settings"))
        service<ChipMateAppService>().reinstallAsync()
    }

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabled = true
        if (e.place == ChipMateActionPlaces.connectionRetryPopup()) {
            e.presentation.text = ChipMateBundle.message("action.ChipMate.Reinstall.cli.text")
        }
    }
}
