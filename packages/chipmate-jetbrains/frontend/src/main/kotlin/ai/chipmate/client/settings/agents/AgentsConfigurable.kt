package ai.chipmate.client.settings.agents

import ai.chipmate.cli.ChipMateCliParser
import ai.chipmate.client.ChipMateNotifications
import ai.chipmate.client.app.ChipMateAgentBehaviorService
import ai.chipmate.client.app.ChipMateAppService
import ai.chipmate.client.app.ChipMateWorkspaceService
import ai.chipmate.client.plugin.ChipMateBundle
import ai.chipmate.client.session.ui.model.ModelPicker
import ai.chipmate.client.session.ui.model.ModelText
import ai.chipmate.client.settings.base.SettingsBadge
import ai.chipmate.client.settings.base.SettingsListConfig
import ai.chipmate.client.settings.base.SettingsListCell
import ai.chipmate.client.settings.base.SettingsListItem
import ai.chipmate.client.settings.base.SettingsListPanel
import ai.chipmate.client.settings.base.SettingsListSelection
import ai.chipmate.client.settings.base.SettingsMessageException
import ai.chipmate.client.settings.base.SettingsDraftPage
import ai.chipmate.client.settings.base.SettingsDraftState
import ai.chipmate.client.ui.UiStyle
import ai.chipmate.client.ui.layout.Stack
import ai.chipmate.rpc.dto.AgentDetailDto
import ai.chipmate.rpc.dto.ProvidersDto
import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.application.EDT
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.asContextElement
import com.intellij.openapi.components.service
import com.intellij.openapi.fileChooser.FileChooser
import com.intellij.openapi.fileChooser.FileChooserDescriptor
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.ui.ComboBox
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.ui.components.JBLabel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.nio.charset.StandardCharsets
import javax.swing.JComponent

private val edt = Dispatchers.EDT + ModalityState.any().asContextElement()

class AgentsConfigurable : AgentBehaviorConfigurableBase<JComponent>() {
    override fun getId(): String = ID
    override fun getDisplayName(): String = ChipMateBundle.message("settings.agentBehavior.agents.displayName")
    override fun create(cs: CoroutineScope, dir: String): JComponent = AgentsSettingsUi(cs, dir)
    override fun update(ui: JComponent, dir: String) {
        (ui as? AgentsSettingsUi)?.setDirectory(dir)
    }
    override fun scrollReadyShell() = false

    companion object { const val ID = "ai.chipmate.jetbrains.settings.agentBehavior.agents" }
}

internal class AgentsSettingsUi(
    private val cs: CoroutineScope,
    private var dir: String,
    private val create: (Collection<String>) -> AgentCreateDialogHandle = ::AgentCreateDialog,
    private val choose: (JComponent) -> VirtualFile? = ::chooseImportFile,
) : SettingsListPanel(cs, SettingsListConfig.Equal), SettingsDraftPage {
    private val app get() = service<ChipMateAppService>()
    private val state = SettingsDraftState(agentsDraft(app.state.value.config, emptyList()), ::savedMatches)
    private var draft: AgentsDraft
        get() = state.draft
        set(value) {
            state.draft = value
        }
    private val base get() = state.baseline
    private var details = emptyList<AgentDetailDto>()
    private var models = emptyList<ModelPicker.Item>()
    private var names = emptyList<String>()
    private lateinit var picker: ComboBox<String>
    private var syncing = false

    init {
        start()
    }

    fun setDirectory(value: String) {
        if (value == dir) return
        dir = value
        reload()
    }

    override suspend fun fetch(): List<SettingsListItem> {
        val agents = service<ChipMateAgentBehaviorService>().agents(dir)
        models = items(service<ChipMateWorkspaceService>().models(dir).providers)
        val next = agentsDraft(service<ChipMateAppService>().state.value.config, agents)
        val dirty = state.modified()
        val edit = draft
        state.accept(next)
        if (dirty) draft = rebaseAgents(next, edit)
        details = agents
        syncNames()
        return rows()
    }

    override fun extraActions(): List<AnAction> = listOf(addAction())

    override fun toolbarRight(): JComponent = Stack.horizontal(UiStyle.Gap.sm())
        .next(JBLabel(ChipMateBundle.message("settings.agentBehavior.agents.default")))
        .next(makePicker())

    override fun afterApply() {
        syncPicker()
    }

    private fun makePicker(): ComboBox<String> {
        if (::picker.isInitialized) return picker
        picker = ComboBox(names.toTypedArray()).apply {
            selectedItem = draft.defaultAgent.orEmpty()
            addActionListener {
                if (syncing) return@addActionListener
                state.update { copy(defaultAgent = (selectedItem as? String)?.takeIf { it.isNotBlank() }) }
            }
        }
        return picker
    }

    override fun onCell(key: String, cellId: String) {
        if (cellId == UNDO_CELL) {
            undo(key)
            return
        }
        val agent = draft.agents[key] ?: return
        if (cellId == DELETE_CELL) {
            remove(agent)
            return
        }
        if (cellId != EDIT_CELL) return
        val dialog = AgentEditDialog(agent, service(), models)
        if (!dialog.showAndGet()) return
        state.update { updateAgent(this, dialog.result()) }
        syncNames()
        syncPicker()
        view.update(rows())
    }

    override fun searchPlaceholder() = ChipMateBundle.message("settings.agentBehavior.agents.search")

    override fun modified(): Boolean = state.modified()

    override fun applyDraft() {
        val token = state.start() ?: return
        syncNames()
        syncPicker()
        view.update(rows())
        if (!launch("apply") { id ->
            val target = token.target
            var pending = target
            var failed: String? = null
            var changed = false
            val behavior = service<ChipMateAgentBehaviorService>()
            val app = service<ChipMateAppService>()
            for (name in target.deleted) {
                if (!behavior.removeAgent(dir, name)) {
                    failed = ChipMateBundle.message("settings.agentBehavior.agents.delete.failed")
                    break
                }
                pending = pending.copy(
                    defaultAgent = pending.defaultAgent.takeUnless { it == name },
                    agents = pending.agents - name,
                    deleted = pending.deleted - name,
                )
                changed = true
            }
            if (failed == null) {
                for ((name, input) in target.created) {
                    if (!behavior.createAgent(dir, input)) {
                        failed = ChipMateBundle.message("settings.agentBehavior.agents.create.failed")
                        break
                    }
                    pending = pending.copy(created = pending.created - name)
                    changed = true
                }
            }
            if (failed == null) {
                for ((name, item) in target.imported) {
                    if (app.updateConfig(item) == null) {
                        failed = ChipMateBundle.message("settings.agentBehavior.agents.import.failed")
                        break
                    }
                    pending = pending.copy(imported = pending.imported - name)
                    changed = true
                }
            }
            if (failed == null) {
                val change = patch(base, target)
                if (change != null && app.updateConfig(change) == null) {
                    failed = ChipMateBundle.message("settings.agentBehavior.save.failed")
                }
                if (failed == null && change != null) changed = true
            }
            if (changed) waitForReady()
            val agents = behavior.agents(dir)
            val next = agentsDraft(app.state.value.config, agents)
            withContext(edt) {
                if (!active(id)) {
                    if (failed != null) ChipMateNotifications.error(failed)
                    return@withContext
                }
                details = agents
                if (failed != null) {
                    draft = rebaseAgents(next, pending)
                    this@AgentsSettingsUi.state.fail(token, failed)
                    showError(failed)
                } else {
                    this@AgentsSettingsUi.state.complete(token, token.target)
                    this@AgentsSettingsUi.state.accept(next)
                    clearProgress()
                }
                syncNames()
                syncPicker()
                view.update(rows())
                setBusy(false)
            }
        }) return
        showProgress(ChipMateBundle.message("settings.agentBehavior.saving"))
    }

    override fun resetDraft() {
        state.reset()
        syncNames()
        syncPicker()
        view.update(rows())
    }

    private fun rows(): List<SettingsListItem> = displayRows(base, draft).map { row ->
        val item = row.agent
        object : SettingsListItem {
            override val key = item.name
            override val title = item.displayName ?: item.name
            override val description = item.description
            override val badges = listOfNotNull(
                SettingsBadge(
                    ChipMateBundle.message("settings.agentBehavior.badge.notApplied"),
                    UiStyle.Badge.Secondary,
                ).takeIf { row.intent == AgentIntent.Modified || row.intent == AgentIntent.New },
                SettingsBadge(
                    ChipMateBundle.message("settings.agentBehavior.badge.willRemove"),
                    UiStyle.Badge.Alert,
                ).takeIf { row.intent == AgentIntent.PendingDelete },
                SettingsBadge(
                    ChipMateBundle.message("settings.agentBehavior.badge.subagent"),
                    UiStyle.Badge.Highlight,
                ).takeIf { ChipMateCliParser.isSubagent(item.mode) },
                SettingsBadge(
                    ChipMateBundle.message("settings.agentBehavior.badge.custom"),
                    UiStyle.Badge.Primary,
                ).takeIf { canDelete(item) },
                SettingsBadge(ChipMateBundle.message("settings.agentBehavior.badge.hidden")).takeIf { item.hidden },
                SettingsBadge(ChipMateBundle.message("settings.agentBehavior.badge.disabled")).takeIf { item.disable },
                SettingsBadge(
                    ChipMateBundle.message("settings.agentBehavior.badge.deprecated"),
                    UiStyle.Badge.Alert,
                ).takeIf { item.deprecated },
            )
            override val cells = when (row.intent) {
                AgentIntent.New,
                AgentIntent.PendingDelete,
                -> listOf(SettingsListCell(UNDO_CELL, ChipMateBundle.message("settings.agentBehavior.undo"), primary = true))
                AgentIntent.Unchanged,
                AgentIntent.Modified,
                -> listOfNotNull(
                    SettingsListCell(EDIT_CELL, ChipMateBundle.message("settings.agentBehavior.edit")),
                    SettingsListCell(
                    DELETE_CELL,
                    ChipMateBundle.message("common.delete"),
                    icon = AllIcons.Actions.GC,
                    iconOnly = true,
                    ).takeIf { canDelete(item) },
                )
            }
        }
    }

    private fun remove(agent: AgentEditDraft) {
        if (!canDelete(agent)) return
        state.update {
            copy(
                defaultAgent = defaultAgent.takeUnless { it == agent.name },
                deleted = deleted + agent.name,
            )
        }
        syncNames()
        syncPicker()
        view.update(rows(), SettingsListSelection.Key(agent.name))
    }

    private fun undo(name: String) {
        state.update {
            copy(
                defaultAgent = if (defaultAgent == null && base.defaultAgent == name) name else defaultAgent.takeUnless { it == name && name !in agents },
                created = created - name,
                imported = imported - name,
                deleted = deleted - name,
            )
        }
        syncNames()
        syncPicker()
        view.update(rows(), SettingsListSelection.Key(name))
    }

    private fun syncNames() {
        names = listOf("") + displayRows(base, draft)
            .filter { it.intent != AgentIntent.PendingDelete }
            .map { it.agent }
            .filter { ChipMateCliParser.defaultAgentCandidate(it.mode, it.hidden) && !it.disable }
            .map { it.name }
    }

    private fun syncPicker() {
        if (!::picker.isInitialized) return
        syncing = true
        try {
            picker.removeAllItems()
            names.forEach { picker.addItem(it) }
            picker.selectedItem = draft.defaultAgent.orEmpty()
        } finally {
            syncing = false
        }
    }

    private fun addAction(): DefaultActionGroup = DefaultActionGroup(
        ChipMateBundle.message("settings.agentBehavior.agents.add"),
        true,
    ).apply {
        templatePresentation.icon = AllIcons.General.Add
        add(CreateAction())
        add(ImportAction())
    }

    internal inner class CreateAction : DumbAwareAction(ChipMateBundle.message("settings.agentBehavior.agents.create")) {
        override fun getActionUpdateThread() = ActionUpdateThread.EDT

        override fun actionPerformed(e: AnActionEvent) = perform()

        internal fun perform() {
            val dialog = create(taken())
            if (!dialog.showAndGet()) return
            val input = dialog.result()
            state.update {
                copy(created = created + (input.name to input))
            }
            syncNames()
            syncPicker()
            view.update(rows(), SettingsListSelection.Key(input.name))
        }
    }

    internal inner class ImportAction : DumbAwareAction(ChipMateBundle.message("settings.agentBehavior.agents.import")) {
        override fun getActionUpdateThread() = ActionUpdateThread.EDT

        override fun actionPerformed(e: AnActionEvent) = perform()

        internal fun perform(file: VirtualFile? = choose(this@AgentsSettingsUi)) {
            val source = file ?: return
            val names = taken()
            if (!launch("import") { id ->
                val input = withContext(Dispatchers.IO) { load(source, names) }
                withContext(edt) {
                    if (!active(id)) return@withContext
                    this@AgentsSettingsUi.state.update { copy(imported = imported + (input.name to input.patch)) }
                    syncNames()
                    syncPicker()
                    view.update(rows(), SettingsListSelection.Key(input.name))
                    setBusy(false)
                    clearProgress()
                }
            }) return
            showProgress(ChipMateBundle.message("settings.agentBehavior.agents.import.progress"))
        }

        private fun load(file: VirtualFile, names: Collection<String>): AgentImport {
            if (file.length > MAX_AGENT_IMPORT_SIZE) {
                throw SettingsMessageException(ChipMateBundle.message(AgentImportError.TOO_LARGE.key))
            }
            val text = String(file.contentsToByteArray(), StandardCharsets.UTF_8)
            return try {
                parseAgentImport(text, names)
            } catch (e: AgentImportException) {
                throw SettingsMessageException(ChipMateBundle.message(e.error.key))
            }
        }
    }

    private companion object {
        const val EDIT_CELL = "edit"
        const val DELETE_CELL = "delete"
        const val UNDO_CELL = "undo"
        const val CHIPMATE_PROVIDER = "chipmate"
    }

    private fun taken(): Collection<String> = draft.agents.keys + draft.created.keys + draft.imported.keys

    private fun items(providers: ProvidersDto?): List<ModelPicker.Item> {
        val cfg = providers ?: return emptyList()
        return cfg.providers
            .filter { it.id == CHIPMATE_PROVIDER || it.id in cfg.connected }
            .flatMap { provider ->
                provider.models.mapNotNull { (id, item) ->
                    val model = ModelPicker.Item(
                        id,
                        item.name,
                        provider.id,
                        provider.name,
                        item.recommendedIndex,
                        free = item.free,
                        byok = item.byok,
                        variants = item.variants,
                        mayTrainOnYourPrompts = item.mayTrainOnYourPrompts,
                    )
                    if (ModelText.small(model)) return@mapNotNull null
                    model
                }
            }
    }
}

private fun chooseImportFile(_parent: JComponent): VirtualFile? {
    val descriptor = FileChooserDescriptor(true, false, false, false, false, false).apply {
        title = ChipMateBundle.message("settings.agentBehavior.agents.import.title")
        description = ChipMateBundle.message("settings.agentBehavior.agents.import.description")
        withFileFilter { file -> !file.isDirectory && file.extension.equals("json", ignoreCase = true) }
    }
    return FileChooser.chooseFile(descriptor, null, null as VirtualFile?)
}
