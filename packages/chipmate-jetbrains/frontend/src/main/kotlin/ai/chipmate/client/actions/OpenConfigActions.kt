package ai.chipmate.client.actions

import ai.chipmate.client.ChipMateNotifications
import ai.chipmate.client.app.ChipMateWorkspaceService
import ai.chipmate.client.plugin.ChipMateBundle
import ai.chipmate.client.telemetry.Telemetry
import ai.chipmate.rpc.dto.ConfigTargetDto
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.components.service
import com.intellij.openapi.project.DumbAware

abstract class ConfigAction(
    private val open: String,
    private val create: String,
    text: String,
    description: String,
) : AnAction(text, description, null), DumbAware {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    protected fun text(target: ConfigTargetDto?): String {
        val key = if (target?.exists == false) create else open
        return ChipMateBundle.message(key, target?.displayPath ?: "...")
    }

    protected fun failed() {
        ChipMateNotifications.error(ChipMateBundle.message("action.ChipMate.OpenConfig.failed"))
    }
}

class OpenLocalConfigAction : ConfigAction(
    open = "action.ChipMate.OpenLocalConfig.text",
    create = "action.ChipMate.CreateLocalConfig.text",
    text = ChipMateBundle.message("action.ChipMate.OpenLocalConfig.text", "..."),
    description = ChipMateBundle.message("action.ChipMate.OpenLocalConfig.description"),
) {
    override fun update(e: AnActionEvent) {
        val dir = e.workspaceDirectory()
        val service = service<ChipMateWorkspaceService>()
        val target = dir?.let { service.localConfig[it] }
        e.presentation.isEnabled = dir != null
        e.presentation.text = text(target)

        if (dir != null && target == null) {
            service.refreshLocalConfigTarget(dir)
        }
    }

    override fun actionPerformed(e: AnActionEvent) {
        val dir = e.workspaceDirectory() ?: return
        Telemetry.send("Config Opened", mapOf("surface" to "tool_window", "scope" to "local"))
        service<ChipMateWorkspaceService>().openLocalConfig(dir) { ok ->
            if (!ok) failed()
        }
    }
}

class OpenGlobalConfigAction : ConfigAction(
    open = "action.ChipMate.OpenGlobalConfig.text",
    create = "action.ChipMate.CreateGlobalConfig.text",
    text = ChipMateBundle.message("action.ChipMate.OpenGlobalConfig.text", "..."),
    description = ChipMateBundle.message("action.ChipMate.OpenGlobalConfig.description"),
) {
    override fun update(e: AnActionEvent) {
        val service = service<ChipMateWorkspaceService>()
        val target = service.globalConfig
        e.presentation.text = text(target)

        if (target == null) {
            service.refreshGlobalConfigTarget()
        }
    }

    override fun actionPerformed(e: AnActionEvent) {
        Telemetry.send("Config Opened", mapOf("surface" to "tool_window", "scope" to "global"))
        service<ChipMateWorkspaceService>().openGlobalConfig { ok ->
            if (!ok) failed()
        }
    }
}
