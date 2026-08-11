package ai.chipmate.backend.workspace

import ai.chipmate.backend.app.ChipMateAppState
import ai.chipmate.backend.app.ChipMateBackendSessionManager
import ai.chipmate.backend.app.SseEvent
import ai.chipmate.log.ChipMateLog
import ai.chipmate.jetbrains.api.client.DefaultApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharedFlow
import okhttp3.OkHttpClient
import java.util.concurrent.ConcurrentHashMap

/**
 * Manages [ChipMateBackendWorkspace] instances by directory path.
 *
 * **Not an IntelliJ service** — owned by [ChipMateBackendAppService] which
 * calls [start] after [ChipMateAppState.Ready] and [stop] on disconnect.
 *
 * Workspaces are created on demand via [get] — the first call for a
 * directory creates the workspace and triggers data loading. Subsequent
 * calls return the cached instance. Worktree directories are just
 * another path — no special handling needed.
 */
class ChipMateBackendWorkspaceManager(
    private val cs: CoroutineScope,
    private val sessions: ChipMateBackendSessionManager,
    private val log: ChipMateLog,
) {
    private val workspaces = ConcurrentHashMap<String, ChipMateBackendWorkspace>()

    private var api: DefaultApi? = null
    private var http: OkHttpClient? = null
    private var port = 0
    private var events: SharedFlow<SseEvent>? = null

    /**
     * Activate with a connected API client and SSE stream.
     * Called by [ChipMateBackendAppService] after [ChipMateAppState.Ready].
     * Clears any stale workspaces from a previous connection.
     */
    fun start(api: DefaultApi, http: OkHttpClient, port: Int, events: SharedFlow<SseEvent>) {
        stop()
        this.api = api
        this.http = http
        this.port = port
        this.events = events
        log.info("Workspace manager started")
    }

    /**
     * Deactivate all workspaces. Called by [ChipMateBackendAppService] on disconnect.
     */
    fun stop() {
        workspaces.values.forEach { it.stop() }
        workspaces.clear()
        api = null
        http = null
        port = 0
        events = null
        log.info("Workspace manager stopped")
    }

    /**
     * Get or create a workspace for a directory.
     * The workspace loads data immediately upon creation.
     */
    fun get(dir: String): ChipMateBackendWorkspace {
        val client = api ?: throw IllegalStateException("Workspace manager not started")
        val http = http ?: throw IllegalStateException("Workspace manager not started")
        val ev = events!!
        return workspaces.computeIfAbsent(dir) { d ->
            log.info("Creating workspace for $d")
            ChipMateBackendWorkspace(d, cs, client, http, port, ev, sessions, log).also { it.load() }
        }
    }

    /** Remove a workspace (e.g. when a worktree is deleted). */
    fun remove(dir: String) {
        workspaces.remove(dir)?.stop()
    }
}
