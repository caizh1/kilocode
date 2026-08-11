package ai.chipmate.backend.cli

import java.util.Properties

object ChipMateProps {
    private val props by lazy {
        val stream = ChipMateProps::class.java.classLoader.getResourceAsStream("chipmate.properties")
            ?: throw IllegalStateException("chipmate.properties resource not found")
        stream.use {
            Properties().apply { load(it) }
        }
    }

    fun cliVersion(): String = props.getProperty("cli.version")
        ?: throw IllegalStateException("cli.version missing from chipmate.properties")

    fun pinned(): Boolean = pinned(props)

    internal fun pinned(props: Properties): Boolean = props.getProperty("cli.pinned")?.toBoolean() ?: true
}
