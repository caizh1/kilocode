package ai.chipmate.backend.workspace

import ai.chipmate.backend.app.ChipMateBackendAppService
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import kotlinx.coroutines.CoroutineScope

/**
 * Per-IntelliJ-Project adapter that maps [Project.getBasePath] to a
 * [ChipMateBackendWorkspace] from the app-level workspace manager.
 *
 * This is a thin accessor — all data loading, SSE watching, session
 * access, and retry logic live in [ChipMateBackendWorkspace]. The frontend
 * uses this service to get the workspace for the current IDE project.
 */
@Service(Service.Level.PROJECT)
class ChipMateBackendProjectService(
    private val project: Project,
    @Suppress("unused") private val cs: CoroutineScope,
) {
    val directory: String get() = project.basePath ?: ""

    /** The workspace for this project's directory. */
    val workspace: ChipMateBackendWorkspace
        get() = service<ChipMateBackendAppService>().workspaces.get(directory)
}
