package ai.chipmate.client.plugin

import ai.chipmate.ChipMatePlugin
import ai.chipmate.client.session.ui.attachment.unregisterAttachmentEditorKind
import ai.chipmate.client.vfs.ChipMateEditorKindRegistry
import ai.chipmate.client.vfs.ChipMateVirtualFileSystem
import ai.chipmate.log.ChipMateLog
import com.intellij.ide.plugins.DynamicPluginListener
import com.intellij.ide.plugins.IdeaPluginDescriptor
import com.intellij.openapi.components.service
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.wm.ToolWindowManager
import javax.swing.SwingUtilities

class ChipMateFrontendDynamicPluginListener : DynamicPluginListener {
    override fun beforePluginUnload(pluginDescriptor: IdeaPluginDescriptor, isUpdate: Boolean) {
        if (pluginDescriptor.pluginId != ChipMatePlugin.id) return
        ChipMateFrontendUnloadCleanup.cleanup(isUpdate)
    }
}

object ChipMateFrontendUnloadCleanup {
    private val log = ChipMateLog.create(ChipMateFrontendUnloadCleanup::class.java)

    fun cleanup(isUpdate: Boolean) {
        log.info("Cleaning up ChipMate frontend for plugin unload (isUpdate=$isUpdate)")
        runEdt {
            ProjectManager.getInstance().openProjects.forEach { project ->
                if (project.isDisposed) return@forEach
                ToolWindowManager.getInstance(project).getToolWindow("ChipMate")
                    ?.contentManager
                    ?.removeAllContents(true)
                val editors = FileEditorManager.getInstance(project).openFiles
                    .filter { it.fileSystem === ChipMateVirtualFileSystem.getInstance() }
                editors.forEach { file -> FileEditorManager.getInstance(project).closeFile(file) }
            }
        }
        unregisterAttachmentEditorKind()
        service<ChipMateEditorKindRegistry>().clear()
        ChipMateVirtualFileSystem.getInstance().clear()
    }

    private fun runEdt(block: () -> Unit) {
        if (SwingUtilities.isEventDispatchThread()) {
            block()
            return
        }
        SwingUtilities.invokeAndWait(block)
    }
}
