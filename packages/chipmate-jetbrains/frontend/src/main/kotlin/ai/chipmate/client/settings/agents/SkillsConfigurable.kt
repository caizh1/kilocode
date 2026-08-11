package ai.chipmate.client.settings.agents

import ai.chipmate.client.app.ChipMateAgentBehaviorService
import ai.chipmate.client.app.ChipMateAppService
import ai.chipmate.client.app.ChipMateWorkspaceService
import ai.chipmate.client.ChipMateNotifications
import ai.chipmate.client.plugin.ChipMateBundle
import ai.chipmate.client.settings.base.SettingsBadge
import ai.chipmate.client.settings.base.SettingsDraftPage
import ai.chipmate.client.settings.base.SettingsDraftState
import ai.chipmate.client.settings.base.SettingsListCell
import ai.chipmate.client.settings.base.SettingsListConfig
import ai.chipmate.client.settings.base.SettingsListItem
import ai.chipmate.client.settings.base.SettingsListPanel
import ai.chipmate.client.settings.base.SettingsListSelection
import ai.chipmate.client.settings.base.SettingsListView
import ai.chipmate.client.settings.base.SettingsContentField
import ai.chipmate.client.settings.base.SettingsMessageException
import ai.chipmate.client.settings.base.SettingsPathDialog
import ai.chipmate.client.settings.base.SettingsPathDialogHandle
import ai.chipmate.client.settings.base.settingsChoosePath
import ai.chipmate.client.settings.base.settingsContentScroll
import ai.chipmate.client.settings.base.settingsEditorFileType
import ai.chipmate.client.ui.UiStyle
import ai.chipmate.client.ui.layout.Stack
import ai.chipmate.log.ChipMateLog
import ai.chipmate.rpc.dto.ConfigPatchDto
import ai.chipmate.rpc.dto.SkillsConfigDto
import ai.chipmate.rpc.dto.SkillsPatchDto
import ai.chipmate.rpc.dto.SkillDto
import com.intellij.CommonBundle
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.application.EDT
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.asContextElement
import com.intellij.openapi.components.service
import com.intellij.openapi.editor.event.DocumentEvent
import com.intellij.openapi.editor.event.DocumentListener
import com.intellij.openapi.fileChooser.FileChooserDescriptor
import com.intellij.openapi.fileTypes.FileType
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.Messages
import com.intellij.ui.TitledSeparator
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.awt.BorderLayout
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.ScrollPaneConstants
import javax.swing.ListSelectionModel

private val edt = Dispatchers.EDT + ModalityState.any().asContextElement()

class SkillsConfigurable : AgentBehaviorConfigurableBase<JComponent>() {
    override fun getId(): String = ID
    override fun getDisplayName(): String = ChipMateBundle.message("settings.agentBehavior.skills.displayName")
    override fun create(cs: CoroutineScope, dir: String): JComponent = SkillsSettingsUi(cs, dir)
    override fun update(ui: JComponent, dir: String) {
        (ui as? SkillsSettingsUi)?.setDirectory(dir)
    }
    override fun scrollReadyShell() = false

    companion object { const val ID = "ai.chipmate.jetbrains.settings.agentBehavior.skills" }
}

internal class SkillsSettingsUi(
    scope: CoroutineScope,
    dir: String,
    private val choose: (JComponent) -> String? = ::chooseSkillPath,
    private val source: (Boolean, Boolean, String) -> SettingsPathDialogHandle = { adding, path, value ->
        SettingsPathDialog(sourceDialogTitle(adding, path), value, if (path) choose else null)
    },
    private val edit: (SkillDto, Boolean) -> SkillEditDialogHandle = ::SkillEditDialog,
) : SettingsListPanel(scope, SettingsListConfig.Equal.copy(tooltip = false)), SettingsDraftPage {
    private val cs = scope
    private var dir = dir
    private var skills = emptyMap<String, SkillDto>()
    private val app get() = service<ChipMateAppService>()
    private val state = SettingsDraftState(skillsDraft(app.state.value.config?.skills ?: SkillsConfigDto()), ::saved)
    private var draft: SkillsDraft
        get() = state.draft
        set(value) {
            state.draft = value
        }
    internal val sources = SkillSourcesView(this, source)

    init {
        start()
        setCenter(skillScroll())
        content.add(sources, BorderLayout.SOUTH)
    }

    fun setDirectory(value: String) {
        if (value == dir) return
        dir = value
        reload()
    }

    override suspend fun fetch(): List<SettingsListItem> {
        val items = withTimeoutOrNull(SKILL_LOAD_TIMEOUT_MS) {
            service<ChipMateAgentBehaviorService>().loadSkills(dir)
        } ?: throw SettingsMessageException(ChipMateBundle.message("settings.agentBehavior.skills.load.timeout"))
        withContext(edt) {
            val dirty = state.modified()
            val edit = draft
            state.accept(skillsDraft(config()))
            if (dirty) draft = state.draft.copy(edited = edit.edited, deleted = edit.deleted)
            skills = items.associateBy { key(it) }
            sources.refresh(draft.sources)
        }
        LOG.info("skills settings fetch dir=$dir total=${items.size}")
        return rows(items)
    }

    override fun afterApply() {
        sources.refresh(draft.sources)
    }

    override fun onCell(key: String, cellId: String) {
        val skill = skills[key] ?: return
        when (cellId) {
            OPEN_CELL -> open(skill)
            EDIT_CELL -> edit(skill)
            DELETE_CELL -> remove(skill)
        }
    }

    override fun searchPlaceholder() = ChipMateBundle.message("settings.agentBehavior.skills.search")

    override fun emptyText() = ChipMateBundle.message("settings.agentBehavior.skills.empty")

    internal fun updateSources(paths: List<String>, urls: List<String>) {
        state.update { copy(sources = SkillsConfigDto(paths = paths, urls = urls)) }
        sources.refresh(draft.sources)
    }

    override fun modified(): Boolean = state.modified()

    override fun resetDraft() {
        state.reset()
        sources.refresh(draft.sources)
        view.update(rows())
        clearProgress()
    }

    override fun applyDraft() {
        val token = state.start() ?: return
        val fallback = skillFallback(token.target)
        if (!launch("apply") { id ->
            val target = token.target
            var failed: String? = null
            val behavior = service<ChipMateAgentBehaviorService>()
            LOG.info("skills settings apply start dir=$dir edited=${target.edited.size} deleted=${target.deleted.size} paths=${target.sources.paths.size} urls=${target.sources.urls.size}")
            if (target.edited.isNotEmpty() && !behavior.saveSkills(dir, target.edited)) {
                failed = ChipMateBundle.message("settings.agentBehavior.save.failed")
            }
            if (failed == null) {
                for (location in target.deleted) {
                    if (!behavior.removeSkill(dir, location)) {
                        failed = ChipMateBundle.message("settings.agentBehavior.skills.delete.failed")
                        break
                    }
                }
            }
            if (failed == null && target.sources != token.previous.sources) {
                val patch = ConfigPatchDto(skills = SkillsPatchDto(paths = target.sources.paths, urls = target.sources.urls))
                if (app.updateConfig(patch) == null) failed = ChipMateBundle.message("settings.agentBehavior.save.failed")
            }
            val reloaded = if (failed == null) behavior.reloadSkills(dir) else true
            val items = behavior.refreshSkills(dir, fallback)
            withContext(edt) {
                if (!active(id)) {
                    if (failed == null) ChipMateNotifications.info(ChipMateBundle.message("settings.agentBehavior.skills.saved.notification"))
                    else ChipMateNotifications.error(failed)
                    return@withContext
                }
                if (failed == null) {
                    skills = items.associateBy { key(it) }
                    val next = skillsDraft(config())
                    state.complete(token, next)
                    sources.refresh(draft.sources)
                    view.update(rows(items))
                    if (reloaded) clearProgress() else showProgress(ChipMateBundle.message("settings.agentBehavior.skills.reload.blocked"))
                    LOG.info("skills settings apply succeeded dir=$dir")
                } else {
                    state.fail(token, failed)
                    sources.refresh(draft.sources)
                    view.update(rows(items))
                    showError(failed)
                    LOG.warn("skills settings apply failed dir=$dir message=$failed")
                }
                setBusy(false)
            }
        }) return
        showProgress(ChipMateBundle.message("settings.agentBehavior.saving"))
    }

    private fun skillScroll() = JBScrollPane(view).apply {
        border = null
        horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
        verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
    }

    private fun rows(items: List<SkillDto> = skills.values.toList()): List<SettingsListItem> = items.mapNotNull { skill ->
        if (skill.location in draft.deleted) return@mapNotNull null
        item(skill)
    }

    private fun skillFallback(target: SkillsDraft): List<SkillDto> = skills.values.mapNotNull { skill ->
        if (skill.location in target.deleted) return@mapNotNull null
        target.edited[skill.location]?.let { skill.copy(content = it) } ?: skill
    }

    private fun item(skill: SkillDto) = object : SettingsListItem {
        override val key = key(skill)
        override val title = skill.name
        override val note = skill.location.takeUnless { builtin(it) }
        override val description = skill.description
        override val doubleClick = EDIT_CELL
        override val badges = listOf(
            SettingsBadge(ChipMateBundle.message("settings.agentBehavior.badge.builtin"), UiStyle.Badge.Secondary),
        ).takeIf { builtin(skill.location) } ?: emptyList()
        override val cells = listOfNotNull(
            SettingsListCell(
                OPEN_CELL,
                ChipMateBundle.message("settings.agentBehavior.skills.openInEditor"),
                primary = true,
            ).takeIf { skill.editable },
            SettingsListCell(
                EDIT_CELL,
                ChipMateBundle.message(if (skill.editable) "settings.agentBehavior.edit" else "common.open"),
                primary = !skill.editable,
            ),
            SettingsListCell(
                DELETE_CELL,
                ChipMateBundle.message("common.delete"),
                icon = AllIcons.Actions.GC,
                iconOnly = true,
            ).takeIf { skill.editable },
        )
    }

    private fun edit(skill: SkillDto) {
        val current = skill.copy(content = content(skill))
        val dialog = edit(current, skill.editable)
        if (!skill.editable) {
            dialog.showAndGet()
            return
        }
        if (!dialog.showAndGet()) return
        state.update { copy(edited = edited + (skill.location to dialog.content())) }
        view.update(rows(), SettingsListSelection.Key(key(skill)))
    }

    private fun open(skill: SkillDto) {
        if (!skill.editable) return
        showProgress(ChipMateBundle.message("settings.agentBehavior.skills.openInEditor.pending"))
        cs.launch {
            val opened = service<ChipMateWorkspaceService>().openFile(skill.location)
            if (opened) return@launch
            withContext(edt) { ChipMateNotifications.error(ChipMateBundle.message("settings.agentBehavior.skills.openInEditor.failed")) }
        }
    }

    private fun remove(skill: SkillDto) {
        val result = Messages.showYesNoDialog(
            ChipMateBundle.message("settings.agentBehavior.skills.delete.message", skill.name),
            ChipMateBundle.message("settings.agentBehavior.skills.delete.title"),
            ChipMateBundle.message("common.delete"),
            Messages.getCancelButton(),
            Messages.getQuestionIcon(),
        )
        if (result != Messages.YES) return
        state.update { copy(deleted = deleted + skill.location, edited = edited - skill.location) }
        view.update(rows(), selectionIndex())
    }

    private fun content(skill: SkillDto) = draft.edited[skill.location] ?: skill.content

    private fun config() = app.state.value.config?.skills ?: SkillsConfigDto()

    private companion object {
        const val EDIT_CELL = "edit"
        const val OPEN_CELL = "open"
        const val DELETE_CELL = "delete"
        const val BUILTIN = "builtin"
        const val LEGACY_BUILTIN = "<built-in>"
        val LOG = ChipMateLog.create(SkillsSettingsUi::class.java)

        fun key(skill: SkillDto) = skill.location.ifBlank { skill.name }
        fun builtin(location: String) = location == BUILTIN || location == LEGACY_BUILTIN
    }
}

internal interface SkillEditDialogHandle {
    fun showAndGet(): Boolean
    fun content(): String
}

private data class SkillsDraft(
    val sources: SkillsConfigDto,
    val edited: Map<String, String> = emptyMap(),
    val deleted: Set<String> = emptySet(),
)

private fun skillsDraft(sources: SkillsConfigDto) = SkillsDraft(sources)

private fun saved(base: SkillsDraft, draft: SkillsDraft): Boolean = base == draft

internal class SkillEditDialog(private val skill: SkillDto, private val savable: Boolean) : DialogWrapper(true), SkillEditDialogHandle {
    private val base = initial()
    private val editor = SettingsContentField(base, skillFileType(skill.location, base), savable)

    init {
        title = skill.name
        setOKButtonText(CommonBundle.getOkButtonText())
        setCancelButtonText(CommonBundle.getCloseButtonText())
        init()
        isOKActionEnabled = false
        editor.document.addDocumentListener(object : DocumentListener {
            override fun documentChanged(event: DocumentEvent) {
                isOKActionEnabled = savable && editor.text != base
            }
        })
    }

    override fun createCenterPanel(): JComponent = settingsContentScroll(editor)

    override fun createActions() = if (savable) arrayOf(okAction, cancelAction) else arrayOf(cancelAction)

    override fun content() = editor.text

    private fun initial() = skill.content?.takeIf { it.isNotBlank() }
        ?: skill.description?.takeIf { it.isNotBlank() }
        ?: ChipMateBundle.message("settings.agentBehavior.skills.content.empty")
}

internal class SkillSourcesView(
    private val parent: SkillsSettingsUi,
    private val source: (Boolean, Boolean, String) -> SettingsPathDialogHandle,
) : Stack(ai.chipmate.client.ui.layout.StackAxis.VERTICAL, UiStyle.Gap.sm()) {
    private val view = SettingsListView(
        ChipMateBundle.message("settings.agentBehavior.skills.sources.empty"),
        SettingsListConfig.Preferred.copy(description = false, selection = ListSelectionModel.MULTIPLE_INTERVAL_SELECTION),
    ) { key, id ->
        if (id == EDIT_CELL) edit(key)
    }
    private var cfg = SkillsConfigDto()

    internal fun sourceList() = view.list

    init {
        border = JBUI.Borders.empty(UiStyle.Gap.pad(), 0, 0, 0)
        next(TitledSeparator(ChipMateBundle.message("settings.agentBehavior.skills.sources.title")))
        next(toolbar())
        next(JBScrollPane(view).apply {
            border = null
            horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
            preferredSize = JBUI.size(0, JBUI.scale(160))
            maximumSize = JBUI.size(Int.MAX_VALUE, JBUI.scale(160))
        })
    }

    fun refresh(config: SkillsConfigDto) {
        cfg = config
        view.update(rows(config))
    }

    private fun toolbar(): JComponent {
        val add = DefaultActionGroup(ChipMateBundle.message("settings.agentBehavior.skills.sources.add"), true).apply {
            templatePresentation.icon = AllIcons.General.Add
            add(AddPathAction())
            add(AddUrlAction())
        }
        val group = DefaultActionGroup(add, RemoveAction())
        val toolbar = ActionManager.getInstance().createActionToolbar(ActionPlaces.TOOLBAR, group, true)
        toolbar.targetComponent = this
        toolbar.updateActionsImmediately()
        return toolbar.component
    }

    internal fun addPath() {
        val dialog = source(true, true, "")
        if (!dialog.showAndGet()) return
        val path = dialog.value().trim().takeIf { it.isNotBlank() } ?: return
        if (path in cfg.paths) return
        parent.updateSources(cfg.paths + path, cfg.urls)
    }

    internal fun addUrl() {
        val dialog = source(true, false, "")
        if (!dialog.showAndGet()) return
        val url = dialog.value().trim().takeIf { it.isNotBlank() } ?: return
        if (url in cfg.urls) return
        parent.updateSources(cfg.paths, cfg.urls + url)
    }

    private fun rows(config: SkillsConfigDto): List<SettingsListItem> {
        val paths = config.paths.map { source(PATH_PREFIX, it) }
        val urls = config.urls.map { source(URL_PREFIX, it) }
        return paths + urls
    }

    private fun source(prefix: String, value: String) = object : SettingsListItem {
        override val key = prefix + value
        override val title = value
        override val doubleClick = EDIT_CELL
    }

    internal fun removeSelected() {
        val keys = view.selectedItems().map { it.key }.toSet()
        if (keys.isEmpty()) return
        val paths = cfg.paths.filterNot { PATH_PREFIX + it in keys }
        val urls = cfg.urls.filterNot { URL_PREFIX + it in keys }
        parent.updateSources(paths, urls)
    }

    private fun edit(key: String) {
        val path = key.startsWith(PATH_PREFIX)
        val old = key.removePrefix(if (path) PATH_PREFIX else URL_PREFIX)
        val dialog = source(false, path, old)
        if (!dialog.showAndGet()) return
        val next = dialog.value().trim().takeIf { it.isNotBlank() } ?: return
        if (path) {
            parent.updateSources(cfg.paths.map { if (it == old) next else it }.distinct(), cfg.urls)
            return
        }
        parent.updateSources(cfg.paths, cfg.urls.map { if (it == old) next else it }.distinct())
    }

    private inner class AddPathAction : DumbAwareAction(
        ChipMateBundle.message("settings.agentBehavior.skills.sources.addPath"),
        null,
        null,
    ) {
        override fun getActionUpdateThread() = ActionUpdateThread.EDT
        override fun actionPerformed(e: AnActionEvent) = addPath()
    }

    private inner class AddUrlAction : DumbAwareAction(
        ChipMateBundle.message("settings.agentBehavior.skills.sources.addUrl"),
        null,
        null,
    ) {
        override fun getActionUpdateThread() = ActionUpdateThread.EDT
        override fun actionPerformed(e: AnActionEvent) = addUrl()
    }

    private inner class RemoveAction : DumbAwareAction(
        ChipMateBundle.message("common.delete"),
        null,
        AllIcons.General.Remove,
    ) {
        override fun getActionUpdateThread() = ActionUpdateThread.EDT
        override fun update(e: AnActionEvent) {
            e.presentation.isEnabled = view.selectedItems().isNotEmpty()
        }
        override fun actionPerformed(e: AnActionEvent) = removeSelected()
    }

    private companion object {
        const val EDIT_CELL = "edit"
        const val PATH_PREFIX = "path:"
        const val URL_PREFIX = "url:"
    }
}

private fun sourceDialogTitle(adding: Boolean, path: Boolean): String = ChipMateBundle.message(
    when {
        adding && path -> "settings.agentBehavior.skills.sources.addPath.title"
        adding -> "settings.agentBehavior.skills.sources.addUrl.title"
        path -> "settings.agentBehavior.skills.sources.editPath.title"
        else -> "settings.agentBehavior.skills.sources.editUrl.title"
    },
)

private fun chooseSkillPath(parent: JComponent): String? {
    return settingsChoosePath(parent, skillPathDescriptor())
}

internal fun skillPathDescriptor() = FileChooserDescriptor(false, true, false, false, false, false).apply {
    title = ChipMateBundle.message("settings.agentBehavior.skills.sources.addPath.title")
    description = ChipMateBundle.message("settings.agentBehavior.skills.sources.addPath.prompt")
}

internal fun skillFileType(location: String, content: String? = null): FileType =
    settingsEditorFileType(location.ifBlank { SKILL_FILE }, content)

private const val SKILL_FILE = "SKILL.md"
private const val SKILL_LOAD_TIMEOUT_MS = 10_000L
