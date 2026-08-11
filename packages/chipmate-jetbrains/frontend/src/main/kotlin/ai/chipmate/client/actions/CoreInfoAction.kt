package ai.chipmate.client.actions

import ai.chipmate.client.app.ChipMateAppService
import ai.chipmate.client.plugin.ChipMateBundle
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.components.service
import com.intellij.openapi.project.DumbAware

class CoreInfoAction : AnAction(), DumbAware {
    override fun actionPerformed(e: AnActionEvent) = Unit

    override fun update(e: AnActionEvent) {
        val app = service<ChipMateAppService>()
        val info = app.core
        if (info == null) app.fetchCoreInfoAsync()
        app.fetchBundledAsync()
        val key = if (app.bundled == true) "action.ChipMate.CoreInfo.bundled" else "action.ChipMate.CoreInfo.text"
        e.presentation.text = info?.let {
            ChipMateBundle.message(key, it.version, it.platform)
        } ?: ChipMateBundle.message("action.ChipMate.CoreInfo.loading")
        e.presentation.description = ChipMateBundle.message("action.ChipMate.CoreInfo.description")
        e.presentation.isEnabled = false
        e.presentation.isVisible = true
    }

    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT
}
