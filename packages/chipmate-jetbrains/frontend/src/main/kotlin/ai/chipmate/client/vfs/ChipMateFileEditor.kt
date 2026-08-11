package ai.chipmate.client.vfs

import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.util.concurrency.annotations.RequiresEdt
import javax.swing.JComponent

class ChipMateFileEditor(
    private val project: Project,
    private val file: VirtualFile,
    private val chipmate: ChipMateVirtualFile,
    private val kind: ChipMateEditorKind,
) : ChipMateFileEditorBase() {
    private val ui: JComponent by lazy { kind.createContent(project, chipmate, this) }

    @RequiresEdt
    override fun getComponent(): JComponent = ui

    override fun getPreferredFocusedComponent(): JComponent? = kind.preferredFocus(ui)
    override fun getName(): String = kind.title(chipmate.path.params)
    override fun getFile(): VirtualFile = file
    override fun isValid(): Boolean = super.isValid() && chipmate.isValid

    override fun dispose() {
        ChipMateVirtualFileSystem.getInstance().release(chipmate.path)
        super.dispose()
    }
}
