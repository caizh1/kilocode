package ai.chipmate.client.vfs

import com.intellij.openapi.Disposable
import com.intellij.openapi.project.Project
import com.intellij.util.concurrency.annotations.RequiresEdt
import javax.swing.JComponent

interface ChipMateEditorKind : ChipMateVirtualFileKind {
    @RequiresEdt
    fun createContent(project: Project, file: ChipMateVirtualFile, parent: Disposable): JComponent

    fun preferredFocus(component: JComponent): JComponent? = null
}
