package ai.chipmate.backend.plugin

import ai.chipmate.ChipMatePlugin
import ai.chipmate.backend.app.ChipMateBackendAppService
import ai.chipmate.log.ChipMateLog
import com.intellij.ide.plugins.DynamicPluginListener
import com.intellij.ide.plugins.IdeaPluginDescriptor
import com.intellij.openapi.components.service

class ChipMateBackendDynamicPluginListener : DynamicPluginListener {
    private val log = ChipMateLog.create(ChipMateBackendDynamicPluginListener::class.java)

    override fun beforePluginUnload(pluginDescriptor: IdeaPluginDescriptor, isUpdate: Boolean) {
        if (pluginDescriptor.pluginId != ChipMatePlugin.id) return
        log.info("Shutting down ChipMate backend for plugin unload (isUpdate=$isUpdate)")
        service<ChipMateBackendAppService>().shutdownForUnload()
    }
}
