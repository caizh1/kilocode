package ai.chipmate.backend.cli

import java.util.Properties

object ChipMateCliChecksums {
    private const val RESOURCE = "chipmate-cli-checksums.properties"

    private val values by lazy {
        val stream = ChipMateCliChecksums::class.java.classLoader.getResourceAsStream(RESOURCE)
            ?: return@lazy emptyMap()
        stream.use {
            Properties().apply { load(it) }
                .entries
                .associate { item -> item.key.toString() to item.value.toString() }
        }
    }

    fun load(): Map<String, String> = values
}
