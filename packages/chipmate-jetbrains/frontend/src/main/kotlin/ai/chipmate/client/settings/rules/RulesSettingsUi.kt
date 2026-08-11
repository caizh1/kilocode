package ai.chipmate.client.settings.rules
import ai.chipmate.client.ChipMateNotifications
import ai.chipmate.client.app.ChipMateAgentBehaviorService
import ai.chipmate.client.app.ChipMateAppService
import ai.chipmate.client.app.ChipMateWorkspaceService
import ai.chipmate.client.plugin.ChipMateBundle
import ai.chipmate.client.settings.base.SettingsContentField
import ai.chipmate.client.settings.base.SettingsDraftPage
import ai.chipmate.client.settings.base.SettingsDraftState
import ai.chipmate.client.settings.base.SettingsListCell
import ai.chipmate.client.settings.base.SettingsListConfig
import ai.chipmate.client.settings.base.SettingsListItem
import ai.chipmate.client.settings.base.SettingsListPanel
import ai.chipmate.client.settings.base.SettingsListSelection
import ai.chipmate.client.settings.base.SettingsRow
import ai.chipmate.client.settings.base.SettingsToggle
import ai.chipmate.client.settings.base.SettingsToolbarAction
import ai.chipmate.client.settings.base.SettingsPathDialog
import ai.chipmate.client.settings.base.settingsChoosePath
import ai.chipmate.client.settings.base.settingsContentScroll
import ai.chipmate.client.settings.base.settingsEditorFileType
import ai.chipmate.client.ui.UiStyle
import ai.chipmate.client.ui.layout.Stack
import ai.chipmate.client.ui.layout.StackAxis
import ai.chipmate.log.ChipMateLog
import ai.chipmate.rpc.dto.ChipMateAppStateDto
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.application.EDT
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.asContextElement
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.components.service
import com.intellij.openapi.fileChooser.FileChooserDescriptor
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VfsUtil
import com.intellij.ui.TitledSeparator
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.awt.BorderLayout
import java.nio.charset.StandardCharsets
import java.nio.file.InvalidPathException
import java.nio.file.Path
import javax.swing.JComponent
import javax.swing.ScrollPaneConstants

private val edt = Dispatchers.EDT + ModalityState.any().asContextElement()

internal class RulesSettingsUi(
    scope: CoroutineScope,
    private val root: String? = null,
    private val choose: (JComponent) -> String? = ::chooseRulePath,
    private val input: () -> String? = { promptRulePath(choose) },
    private val read: (String) -> String? = { path -> readInstruction(root, path) },
    private val write: (String, String) -> Boolean = { path, text -> writeInstruction(root, path, text) },
    private val editor: (String, String) -> RuleContentDialogHandle = { title, content -> InstructionEditDialog(title, content) },
    private val app: ChipMateAppService = service(),
    private val workspaces: ChipMateWorkspaceService = service(),
    private val agent: ChipMateAgentBehaviorService = service(),
) : SettingsListPanel(scope, SettingsListConfig.Equal.copy(tooltip = false)), SettingsDraftPage {
    private val cs = scope
    private val state = SettingsDraftState(rulesDraft(app.state.value.config, false), ::savedMatches)
    private val draft get() = state.draft
    private var closed = false
    internal val footer = RulesFooterView { value -> updateCompat(value) }

    init {
        start()
        setCenter(ruleScroll())
        content.add(footer, BorderLayout.SOUTH)
        reload()
    }

    override suspend fun fetch(): List<SettingsListItem> {
        val compat = agent.claudeCodeCompat()
        return withContext(edt) {
            state.accept(rulesDraft(app.state.value.config, compat))
            footer.refresh(draft.compat)
            rows()
        }
    }

    override fun onCell(key: String, cellId: String) {
        when (cellId) {
            OPEN_CELL -> open(key)
            EDIT_CELL -> editFile(key)
            DELETE_CELL -> remove(key)
        }
    }

    override fun extraActions(): List<AnAction> = listOf(
        SettingsToolbarAction(
            ChipMateBundle.message("settings.rules.files.add"),
            ChipMateBundle.message("settings.rules.files.add.description"),
            AllIcons.General.Add,
            { !busy },
        ) { addFile() },
    )

    override fun showRefresh(): Boolean = false

    override fun searchPlaceholder() = ChipMateBundle.message("settings.rules.files.search")

    override fun emptyText() = ChipMateBundle.message("settings.rules.files.empty")

    override fun modified(): Boolean = state.modified()

    override fun resetDraft() {
        state.reset()
        footer.refresh(draft.compat)
        view.update(rows())
        clearProgress()
    }

    override fun applyDraft() {
        val change = rulesChange(state.baseline, draft) ?: return
        val token = state.start() ?: return
        val target = token.target
        showProgress(ChipMateBundle.message("settings.rules.save.pending"))
        setBusy(true)
        app.scope.launch {
            val wrote = withContext(edt) { target.edited.all { (path, text) -> write(path, text) } }
            val next = when {
                !wrote -> null
                change.config != null -> app.updateConfig(change.config)
                else -> app.state.value
            }
            val ok = next != null && (change.compat == null || agent.setClaudeCodeCompat(change.compat) == change.compat)
            withContext(edt) { finish(token, target, next.takeIf { ok }) }
        }
    }

    @RequiresEdt
    override fun dispose() {
        closed = true
        super.dispose()
    }

    @RequiresEdt
    private fun finish(token: ai.chipmate.client.settings.base.SettingsDraftSave<RulesDraft>, target: RulesDraft, next: ChipMateAppStateDto?) {
        if (closed) {
            if (next != null) ChipMateNotifications.info(ChipMateBundle.message("settings.rules.saved.notification"))
            else ChipMateNotifications.error(ChipMateBundle.message("settings.rules.save.failed"))
            return
        }
        if (next != null) {
            state.complete(token, rulesDraft(next.config, target.compat))
            LOG.info("rules settings apply succeeded")
        } else {
            state.fail(token, ChipMateBundle.message("settings.rules.save.failed"))
            showError(ChipMateBundle.message("settings.rules.save.failed"))
            LOG.warn("rules settings apply failed")
        }
        footer.refresh(draft.compat)
        view.update(rows())
        if (next != null) clearProgress()
        setBusy(false)
    }

    internal fun addFile() {
        val value = input()?.trim()?.takeIf { it.isNotBlank() } ?: return
        if (value in draft.instructions) {
            view.select(value)
            return
        }
        state.update { copy(instructions = instructions + value) }
        view.update(rows(), SettingsListSelection.Key(value))
    }

    private fun editFile(path: String) {
        val content = draft.edited[path] ?: read(path)
        if (content == null) {
            ChipMateNotifications.info(ChipMateBundle.message("settings.rules.files.cannotEdit"))
            return
        }
        val dialog = editor(path, content)
        if (!dialog.showAndGet()) return
        state.update { copy(edited = edited + (path to dialog.content())) }
        view.update(rows(), SettingsListSelection.Key(path))
    }

    private fun remove(path: String) {
        val result = Messages.showYesNoDialog(
            ChipMateBundle.message("settings.rules.files.delete.message", path),
            ChipMateBundle.message("settings.rules.files.delete.title"),
            ChipMateBundle.message("common.delete"),
            Messages.getCancelButton(),
            Messages.getQuestionIcon(),
        )
        if (result != Messages.YES) return
        state.update { copy(instructions = instructions - path, edited = edited - path) }
        view.update(rows(), selectionIndex())
    }

    private fun open(path: String) {
        val abs = resolveInstructionPath(root, path)
        if (abs == null) {
            ChipMateNotifications.error(ChipMateBundle.message("settings.rules.files.openInEditor.failed"))
            return
        }
        showProgress(ChipMateBundle.message("settings.rules.files.openInEditor.pending"))
        cs.launch {
            val opened = workspaces.openFile(abs)
            withContext(edt) {
                if (closed) return@withContext
                clearProgress()
                if (!opened) ChipMateNotifications.error(ChipMateBundle.message("settings.rules.files.openInEditor.failed"))
            }
        }
    }

    private fun updateCompat(value: Boolean) {
        state.update { copy(compat = value) }
        footer.refresh(draft.compat)
    }

    private fun ruleScroll() = JBScrollPane(view).apply {
        border = null
        horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
        verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
    }

    private fun rows(): List<SettingsListItem> = draft.instructions.map { item(it) }

    private fun item(value: String) = object : SettingsListItem {
        override val key = value
        override val title = value
        override val doubleClick = EDIT_CELL
        override val cells = listOf(
            SettingsListCell(
                OPEN_CELL,
                ChipMateBundle.message("settings.rules.files.openInEditor"),
                primary = true,
            ),
            SettingsListCell(
                EDIT_CELL,
                ChipMateBundle.message("settings.agentBehavior.edit"),
            ),
            SettingsListCell(
                DELETE_CELL,
                ChipMateBundle.message("common.delete"),
                icon = AllIcons.Actions.GC,
                iconOnly = true,
            ),
        )
    }

    private companion object {
        const val OPEN_CELL = "open"
        const val EDIT_CELL = "edit"
        const val DELETE_CELL = "delete"
        val LOG = ChipMateLog.create(RulesSettingsUi::class.java)
    }
}
internal class RulesFooterView(
    private val update: (Boolean) -> Unit,
) : Stack(StackAxis.VERTICAL, UiStyle.Gap.sm()) {
    private val compat = SettingsToggle { value -> update(value) }

    init {
        border = JBUI.Borders.empty(UiStyle.Gap.pad(), 0, 0, UiStyle.Gap.xl())
        next(TitledSeparator(ChipMateBundle.message("settings.rules.claude.heading")))
        next(SettingsRow(
            ChipMateBundle.message("settings.rules.claude.title"),
            ChipMateBundle.message("settings.rules.claude.description"),
            compat,
        ))
    }

    @RequiresEdt
    fun refresh(value: Boolean) {
        compat.isSelected = value
    }
}

internal interface RuleContentDialogHandle {
    fun showAndGet(): Boolean
    fun content(): String
}

/** In-dialog content editor for an instruction file, mirroring the Skills skill editor. */
internal class InstructionEditDialog(
    private val heading: String,
    content: String,
) : DialogWrapper(true), RuleContentDialogHandle {
    private val base = content
    private val field = SettingsContentField(base, settingsEditorFileType(heading, base), true)

    init {
        title = heading
        setOKButtonText(com.intellij.CommonBundle.getOkButtonText())
        init()
        isOKActionEnabled = false
        field.document.addDocumentListener(object : com.intellij.openapi.editor.event.DocumentListener {
            override fun documentChanged(event: com.intellij.openapi.editor.event.DocumentEvent) {
                isOKActionEnabled = field.text != base
            }
        })
    }

    override fun createCenterPanel(): JComponent = settingsContentScroll(field)

    override fun content() = field.text
}

private fun chooseRulePath(parent: JComponent): String? = settingsChoosePath(parent, rulePathDescriptor())

private fun promptRulePath(choose: (JComponent) -> String?): String? {
    val dialog = SettingsPathDialog(ChipMateBundle.message("settings.rules.files.input.title"), browse = choose)
    return if (dialog.showAndGet()) dialog.value() else null
}

internal fun rulePathDescriptor() = FileChooserDescriptor(true, false, false, false, false, false).apply {
    title = ChipMateBundle.message("settings.rules.files.input.title")
    description = ChipMateBundle.message("settings.rules.files.input.prompt")
}

private fun resolveInstructionPath(root: String?, path: String): String? = try {
    val nio = Path.of(path.trim())
    when {
        nio.isAbsolute -> nio.normalize().toString()
        root != null -> Path.of(root).resolve(nio).normalize().toString()
        else -> null
    }
} catch (e: InvalidPathException) {
    null
}

@RequiresEdt
private fun readInstruction(root: String?, path: String): String? {
    val abs = resolveInstructionPath(root, path) ?: return null
    val vf = LocalFileSystem.getInstance().findFileByPath(abs)
        ?: LocalFileSystem.getInstance().refreshAndFindFileByPath(abs)
        ?: return null
    if (vf.isDirectory) return null
    return String(vf.contentsToByteArray(), StandardCharsets.UTF_8)
}

@RequiresEdt
private fun writeInstruction(root: String?, path: String, text: String): Boolean {
    val abs = resolveInstructionPath(root, path) ?: return false
    var ok = false
    WriteCommandAction.runWriteCommandAction(null as Project?) {
        val nio = Path.of(abs)
        val lfs = LocalFileSystem.getInstance()
        val target = lfs.refreshAndFindFileByPath(abs) ?: run {
            val parent = nio.parent ?: return@runWriteCommandAction
            val dir = VfsUtil.createDirectoryIfMissing(parent.toString()) ?: return@runWriteCommandAction
            dir.createChildData(RulesSettingsUi::class.java, nio.fileName.toString())
        }
        VfsUtil.saveText(target, text)
        ok = true
    }
    return ok
}
