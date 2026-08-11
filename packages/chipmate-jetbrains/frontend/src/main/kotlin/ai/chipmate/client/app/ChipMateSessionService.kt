@file:Suppress("UnstableApiUsage")

package ai.chipmate.client.app

import ai.chipmate.log.ChatLogSummary
import ai.chipmate.rpc.ChipMateSessionRpcApi
import ai.chipmate.client.session.SessionActivityKind
import ai.chipmate.rpc.dto.ChatEventDto
import ai.chipmate.rpc.dto.CloudSessionListDto
import ai.chipmate.rpc.dto.ConfigUpdateDto
import ai.chipmate.rpc.dto.DiffFileDto
import ai.chipmate.rpc.dto.MessageWithPartsDto
import ai.chipmate.rpc.dto.ModelSelectionDto
import ai.chipmate.rpc.dto.PermissionAlwaysRulesDto
import ai.chipmate.rpc.dto.PermissionReplyDto
import ai.chipmate.rpc.dto.PermissionRequestDto
import ai.chipmate.rpc.dto.PartDto
import ai.chipmate.rpc.dto.PromptDto
import ai.chipmate.rpc.dto.QuestionReplyDto
import ai.chipmate.rpc.dto.QuestionRequestDto
import ai.chipmate.rpc.dto.SessionDto
import ai.chipmate.rpc.dto.SessionListDto
import ai.chipmate.rpc.dto.SessionStatusDto
import com.intellij.openapi.components.Service
import ai.chipmate.log.ChipMateLog
import com.intellij.openapi.project.Project
import fleet.rpc.client.durable
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.onCompletion
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * Project-level frontend service for session management.
 *
 * Stateless with respect to "active session" — callers pass explicit
 * session IDs. [ai.chipmate.client.session.controller.SessionController] owns the
 * active session concept.
 */
@Service(Service.Level.PROJECT)
class ChipMateSessionService internal constructor(
    private val project: Project,
    private val cs: CoroutineScope,
    private val rpc: ChipMateSessionRpcApi?,
    private val log: ChipMateLog = LOG,
) {
    /** Platform constructor — resolves RPC from the service container. */
    constructor(project: Project, cs: CoroutineScope) : this(project, cs, null)

    companion object {
        private val LOG = ChipMateLog.create(ChipMateSessionService::class.java)
    }

    private val _sessions = MutableStateFlow<List<SessionDto>>(emptyList())
    val sessions: StateFlow<List<SessionDto>> = _sessions.asStateFlow()

    /** Live session status map from SSE events. */
    val statuses: StateFlow<Map<String, SessionStatusDto>> =
        stream { statuses() }.stateIn(cs, SharingStarted.Eagerly, emptyMap())

    // ------ RPC helpers ------

    private suspend fun <T> call(block: suspend ChipMateSessionRpcApi.() -> T): T {
        val api = rpc
        return if (api != null) block(api) else durable { block(ChipMateSessionRpcApi.getInstance()) }
    }

    private fun <T> stream(block: suspend ChipMateSessionRpcApi.() -> Flow<T>): Flow<T> = flow {
        val api = rpc
        if (api != null) block(api).collect { emit(it) }
        else durable { block(ChipMateSessionRpcApi.getInstance()).collect { emit(it) } }
    }

    // ------ Session CRUD ------

    /** Refresh the session list from the server. */
    fun refresh(dir: String) {
        cs.launch {
            try {
                list(dir)
            } catch (e: Exception) {
                log.warn("kind=session-list dir=${ChatLogSummary.dir(dir)} failed message=${e.message}", e)
            }
        }
    }

    internal fun activity(): Map<String, SessionActivityKind> =
        statuses.value
            .filterValues { it.type == "busy" }
            .mapValues { SessionActivityKind.RUNNING }

    suspend fun list(dir: String): SessionListDto {
        val result = call { list(dir) }
        _sessions.value = result.sessions
        return result
    }

    /** Load recent sessions for the current worktree family. */
    suspend fun recent(dir: String, limit: Int): List<SessionDto> =
        call { recent(dir, limit) }.sessions

    /** Get a single session. */
    suspend fun get(id: String, dir: String): SessionDto =
        call { get(id, dir) }

    /** Create a new session. Caller awaits the result. */
    suspend fun create(dir: String): SessionDto {
        log.info("create: dir=$dir")
        val session = call { create(dir) }
        log.info("create: id=${session.id}")
        refresh(dir)
        return session
    }

    /** Delete a session. */
    fun delete(id: String, dir: String) {
        cs.launch {
            try {
                deleteSession(id, dir)
            } catch (e: Exception) {
                log.warn("${ChatLogSummary.sid(id)} kind=session delete=true dir=${ChatLogSummary.dir(dir)} failed message=${e.message}", e)
            }
        }
    }

    suspend fun deleteSession(id: String, dir: String) {
        call { delete(id, dir) }
        list(dir)
    }

    suspend fun renameSession(id: String, dir: String, newTitle: String): ai.chipmate.rpc.dto.SessionDto {
        val session = call { rename(id, dir, newTitle) }
        _sessions.value = _sessions.value.map { if (it.id == id) session else it }
        return session
    }

    suspend fun cloudSessions(dir: String, cursor: String?, limit: Int, gitUrl: String?): CloudSessionListDto =
        call { cloudSessions(dir, cursor, limit, gitUrl) }

    suspend fun importCloudSession(id: String, dir: String): SessionDto =
        call { importCloudSession(id, dir) }

    /** Register a worktree directory override for a session. */
    fun setDirectory(id: String, dir: String) {
        cs.launch {
            try {
                call { setDirectory(id, dir) }
            } catch (e: Exception) {
                log.warn("${ChatLogSummary.sid(id)} kind=session setDirectory=true dir=${ChatLogSummary.dir(dir)} failed message=${e.message}", e)
            }
        }
    }

    // ------ Chat ops (explicit session ID) ------

    suspend fun enhancePrompt(dir: String, text: String): String =
        call { enhancePrompt(dir, text) }

    /** Send a prompt to a session. */
    suspend fun prompt(id: String, dir: String, dto: PromptDto) {
        val meta = if (log.isDebugEnabled) {
            "${ChatLogSummary.dir(dir)} ${ChatLogSummary.prompt(dto)}"
        } else {
            "kind=prompt parts=${dto.parts.size}"
        }
        log.info("${ChatLogSummary.sid(id)} $meta")
        call { prompt(id, dir, dto) }
        log.info("${ChatLogSummary.sid(id)} kind=prompt ok=true")
    }

    suspend fun command(id: String, dir: String, command: String, args: String, dto: PromptDto) {
        log.info("${ChatLogSummary.sid(id)} kind=command command=$command parts=${dto.parts.size}")
        call { command(id, dir, command, args, dto) }
        log.info("${ChatLogSummary.sid(id)} kind=command ok=true")
    }

    /** Abort ongoing processing for a session. */
    suspend fun abort(id: String, dir: String) {
        log.info("${ChatLogSummary.sid(id)} kind=abort ${ChatLogSummary.dir(dir)}")
        call { abort(id, dir) }
        log.info("${ChatLogSummary.sid(id)} kind=abort ok=true")
    }

    /** Summarize/compact a session. */
    suspend fun compact(id: String, dir: String, model: ModelSelectionDto) {
        call { compact(id, dir, model) }
    }

    suspend fun revert(id: String, dir: String, message: String, part: String?) {
        log.info(
            "${ChatLogSummary.sid(id)} kind=revert ${ChatLogSummary.dir(dir)} " +
                "message=$message part=${part ?: "none"}",
        )
        call { revert(id, dir, message, part) }
        log.info("${ChatLogSummary.sid(id)} kind=revert ok=true")
    }

    suspend fun deleteMessage(id: String, dir: String, message: String): Boolean =
        call { deleteMessage(id, dir, message) }

    suspend fun unrevert(id: String, dir: String) {
        call { unrevert(id, dir) }
    }

    /** Load message history for a session. */
    suspend fun messages(id: String, dir: String): List<MessageWithPartsDto> =
        call { messages(id, dir) }
            .also { log.debug { "${ChatLogSummary.sid(id)} ${ChatLogSummary.history(it)} ${ChatLogSummary.dir(dir)}" } }

    // Errors propagate so the diff editor can distinguish a real failure (retry link) from "no changes".
    suspend fun diff(id: String, dir: String): List<DiffFileDto> =
        call { diff(id, dir) }

    suspend fun diffSides(sessionId: String?, dir: String, file: DiffFileDto, messageId: String?): DiffFileDto? =
        call { diffSides(sessionId, dir, file, messageId) }

    suspend fun attachmentPart(id: String, dir: String, message: String, part: String, key: String?): PartDto? =
        call { attachmentPart(id, dir, message, part, key) }

    /** Subscribe to streaming chat events for a session. */
    fun events(id: String, dir: String): Flow<ChatEventDto> {
        val api = rpc
        val events = if (api != null) flow {
            api.events(id, dir).collect {
                log.debug { ChatLogSummary.event(it) }
                ChatLogSummary.error(it)?.let { msg -> log.warn("${ChatLogSummary.sid(id)} route=client-events $msg") }
                emit(it)
            }
        } else flow {
            durable {
                ChipMateSessionRpcApi.getInstance().events(id, dir).collect {
                    log.debug { ChatLogSummary.event(it) }
                    ChatLogSummary.error(it)?.let { msg -> log.warn("${ChatLogSummary.sid(id)} route=client-events $msg") }
                    emit(it)
                }
            }
        }
        return events
            .onStart { log.info("${ChatLogSummary.sid(id)} kind=subscription route=client-events start=true dir=${ChatLogSummary.dir(dir)}") }
            .onCompletion { cause ->
                if (cause == null || cause is CancellationException) {
                    log.info("${ChatLogSummary.sid(id)} kind=subscription route=client-events stop=true cancelled=${cause is CancellationException}")
                    return@onCompletion
                }
                log.warn("${ChatLogSummary.sid(id)} kind=subscription route=client-events stop=true failed message=${cause.message}", cause)
            }
    }

    /** Update config (model, agent/mode, temperature). */
    suspend fun updateConfig(dir: String, config: ConfigUpdateDto) {
        call { updateConfig(dir, config) }
    }

    // ------ permission / question resolution ------

    /** Reply to a pending permission request. */
    suspend fun replyPermission(requestId: String, dir: String, reply: PermissionReplyDto) {
        call { replyPermission(requestId, dir, reply) }
    }

    /** Save always-rules for a pending permission request. */
    suspend fun savePermissionRules(requestId: String, dir: String, rules: PermissionAlwaysRulesDto) {
        call { savePermissionRules(requestId, dir, rules) }
    }

    /** Reply to a pending question with user answers. */
    suspend fun replyQuestion(requestId: String, dir: String, answers: QuestionReplyDto) {
        call { replyQuestion(requestId, dir, answers) }
    }

    /** Reject a pending question. */
    suspend fun rejectQuestion(requestId: String, dir: String) {
        call { rejectQuestion(requestId, dir) }
    }

    /** List pending permissions (caller filters by session ID). */
    suspend fun pendingPermissions(dir: String): List<PermissionRequestDto> =
        call { pendingPermissions(dir) }

    /** List pending questions (caller filters by session ID). */
    suspend fun pendingQuestions(dir: String): List<QuestionRequestDto> =
        call { pendingQuestions(dir) }
}
