package ai.chipmate.client.settings.providers

import ai.chipmate.client.plugin.ChipMateBundle
import ai.chipmate.client.session.ui.model.ModelSearch
import ai.chipmate.client.settings.base.SettingsBadge
import ai.chipmate.client.settings.base.SettingsListCell
import ai.chipmate.client.settings.base.SettingsListItem
import ai.chipmate.rpc.dto.ProviderSettingsDto
import ai.chipmate.rpc.dto.ProviderSettingsProviderDto
import com.intellij.icons.AllIcons
import javax.swing.Icon

internal enum class ProviderListAction {
    CONNECT,
    OAUTH,
    EDIT,
    DISCONNECT,
    DELETE,
    ENABLE,
}

internal data class ProviderListRow(
    val provider: ProviderSettingsProviderDto,
    override val section: String,
    val actions: List<ProviderListAction>,
    override val disabled: Boolean = false,
) : SettingsListItem {
    override val key: String get() = provider.id
    override val title: String get() = provider.name
    override val description: String get() = providerDescription(provider)
    override val icon: Icon? get() = providerIcon(provider)
    override val badges: List<SettingsBadge>
        get() = when (provider.source) {
            "env" -> listOf(SettingsBadge(ChipMateBundle.message("settings.providers.badge.env")))
            else -> emptyList()
        }
    override val cells: List<SettingsListCell>
        get() = actions.map { action ->
            SettingsListCell(
                action.name,
                providerListActionText(action),
                enabled(action),
                icon = if (action == ProviderListAction.DELETE) AllIcons.Actions.GC else null,
                iconOnly = action == ProviderListAction.DELETE,
                primary = action == ProviderListAction.EDIT,
            )
        }

    fun enabled(action: ProviderListAction) = !disabled && (action != ProviderListAction.DISCONNECT || provider.source != "env")
}

internal fun providerListActionText(action: ProviderListAction) = when (action) {
    ProviderListAction.CONNECT -> ChipMateBundle.message("settings.providers.connect")
    ProviderListAction.OAUTH -> ChipMateBundle.message("settings.providers.oauth")
    ProviderListAction.EDIT -> ChipMateBundle.message("settings.providers.edit")
    ProviderListAction.DISCONNECT -> ChipMateBundle.message("settings.providers.disconnect")
    ProviderListAction.DELETE -> ChipMateBundle.message("settings.providers.delete")
    ProviderListAction.ENABLE -> ChipMateBundle.message("settings.providers.enable")
}

internal fun providerListRows(state: ProviderSettingsDto, query: String, disabledRows: Boolean = false): List<ProviderListRow> {
    val q = query.trim()
    val ids = state.connected.toSet()
    val disabled = state.disabled.toSet()
    val filtered = state.providers.filter { ModelSearch.matches(q, it.name) }
    val connected = filtered
        .filter { configured(it, state, ids) }
        .sortedWith(compareBy<ProviderSettingsProviderDto> { popularProviderIndex(it) }.thenBy { it.name.lowercase() }.thenBy { it.id })
    val connectedIds = connected.mapTo(mutableSetOf()) { it.id }
    val popular = filtered
        .filter { it.id !in connectedIds }
        .filter { it.id !in disabled }
        .filter { !hiddenProvider(it) }
        .filter { isPopularProvider(it) }
        .sortedWith(compareBy<ProviderSettingsProviderDto> { popularProviderIndex(it) }.thenBy { it.name.lowercase() }.thenBy { it.id })
    val popularIds = popular.mapTo(mutableSetOf()) { it.id }
    val all = filtered
        .filter { it.id !in connectedIds }
        .filter { it.id !in popularIds }
        .filter { !hiddenProvider(it) }
        .sortedWith(compareBy<ProviderSettingsProviderDto> { it.name.lowercase() }.thenBy { it.id })
    val rows = mutableListOf<ProviderListRow>()
    rows += connected.map { ProviderListRow(it, ChipMateBundle.message("settings.providers.connected"), providerActions(it, state, disabled), disabled = disabledRows) }
    rows += popular.map { ProviderListRow(it, ChipMateBundle.message("settings.providers.popular"), providerActions(it, state, disabled), disabled = disabledRows) }
    rows += all.map { ProviderListRow(it, ChipMateBundle.message("settings.providers.all"), providerActions(it, state, disabled), disabled = disabledRows) }
    return rows
}

internal fun providerActions(
    provider: ProviderSettingsProviderDto,
    state: ProviderSettingsDto,
    disabled: Set<String> = state.disabled.toSet(),
): List<ProviderListAction> {
    if (provider.id in disabled) return listOf(ProviderListAction.ENABLE)
    if (provider.id == CHIPMATE_PROVIDER_ID && configured(provider, state, state.connected.toSet())) return emptyList()
    if (configured(provider, state, state.connected.toSet())) {
        return if (customEditable(provider, state)) {
            listOf(ProviderListAction.EDIT, ProviderListAction.DELETE)
        } else {
            listOf(ProviderListAction.DISCONNECT)
        }
    }
    val methods = providerMethods(provider, state)
    return buildList {
        if (methods.any { it.type == "oauth" }) add(ProviderListAction.OAUTH)
        if (methods.any { it.type == "api" }) add(ProviderListAction.CONNECT)
    }
}
