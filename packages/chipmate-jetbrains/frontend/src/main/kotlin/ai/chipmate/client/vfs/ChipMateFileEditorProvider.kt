package ai.chipmate.client.vfs

import ai.chipmate.client.diff.ensureDiffEditorKind
import ai.chipmate.client.session.ui.attachment.ensureAttachmentEditorKind
import com.intellij.openapi.components.service
import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorPolicy
import com.intellij.openapi.fileEditor.FileEditorProvider
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.vfs.VirtualFile

class ChipMateFileEditorProvider : FileEditorProvider, DumbAware {
    override fun accept(project: Project, file: VirtualFile): Boolean {
        ensureAttachmentEditorKind()
        ensureDiffEditorKind()
        val path = path(file) ?: return false
        return service<ChipMateEditorKindRegistry>().get(path.kind) != null
    }

    override fun acceptRequiresReadAction(): Boolean = false

    override fun createEditor(project: Project, file: VirtualFile): FileEditor {
        ensureAttachmentEditorKind()
        ensureDiffEditorKind()
        val path = path(file) ?: error("Invalid ChipMate virtual file: ${file.path}")
        val chipmate = file as? ChipMateVirtualFile ?: ChipMateVirtualFile(path)
        val kind = service<ChipMateEditorKindRegistry>().get(chipmate.path.kind) ?: error("Unknown ChipMate editor kind: ${chipmate.path.kind}")
        return ChipMateFileEditor(project, file, chipmate, kind)
    }

    override fun disposeEditor(editor: FileEditor) {
        Disposer.dispose(editor)
    }

    override fun getEditorTypeId(): String = EDITOR_TYPE_ID
    override fun getPolicy(): FileEditorPolicy = FileEditorPolicy.HIDE_OTHER_EDITORS

    companion object {
        const val EDITOR_TYPE_ID = "ChipMateVfsEditor"

        private fun path(file: VirtualFile): ChipMatePath? {
            if (file is ChipMateVirtualFile) return file.path
            if (file.fileSystem.protocol != ChipMateVirtualFileSystem.PROTOCOL && !file.url.startsWith("${ChipMateVirtualFileSystem.PROTOCOL}://")) return null
            return ChipMateVirtualFileSystem.decode(file.path) ?: ChipMateVirtualFileSystem.decode(file.url)
        }
    }
}
