package ai.chipmate.client.actions

import ai.chipmate.client.session.SessionManager
import com.intellij.openapi.actionSystem.AnActionEvent

internal fun AnActionEvent.workspaceDirectory(): String? {
    return getData(SessionManager.WORKSPACE_KEY)?.directory ?: project?.basePath
}
