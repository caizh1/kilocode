package ai.chipmate.backend.cli

import com.intellij.ide.util.PropertiesComponent

object ChipMateClaudeCompatSettings {
    private const val KEY = "chipmate.claudeCodeCompat"

    @Volatile
    private var fallback = false

    fun get(): Boolean {
        val props = props()
        return props?.getBoolean(KEY, false) ?: fallback
    }

    fun set(value: Boolean) {
        fallback = value
        val props = props()
        props?.setValue(KEY, value.toString())
    }

    private fun props(): PropertiesComponent? = runCatching { PropertiesComponent.getInstance() }.getOrNull()
}
