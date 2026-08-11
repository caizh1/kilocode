package ai.chipmate.backend.cli

import kotlin.test.Test
import kotlin.test.assertEquals
import java.io.File
import java.nio.file.Files

class ChipMateCliConfigPathTest {

    @Test
    fun `chipmate config dir overrides XDG config home`() {
        val dir = Files.createTempDirectory("chipmate-config-dir").toFile()
        val xdg = Files.createTempDirectory("chipmate-xdg-config").toFile()

        val path = ChipMateCliConfigPath.resolve(
            mapOf(
                "CHIPMATE_CONFIG_DIR" to dir.absolutePath,
                "XDG_CONFIG_HOME" to xdg.absolutePath,
            ),
        )

        assertEquals(dir.absoluteFile, path.absoluteFile)
    }

    @Test
    fun `XDG config home resolves to chipmate subdirectory`() {
        val xdg = Files.createTempDirectory("chipmate-xdg-config").toFile()

        val path = ChipMateCliConfigPath.resolve(mapOf("XDG_CONFIG_HOME" to xdg.absolutePath))

        assertEquals(File(xdg, "chipmate").absoluteFile, path.absoluteFile)
    }

    @Test
    fun `default config home matches CLI xdg fallback`() {
        val home = Files.createTempDirectory("chipmate-home").toFile()

        val path = ChipMateCliConfigPath.resolve(mapOf("HOME" to home.absolutePath))

        assertEquals(File(File(home, ".config"), "chipmate").absoluteFile, path.absoluteFile)
    }

    @Test
    fun `USERPROFILE backs up HOME for default config home`() {
        val home = Files.createTempDirectory("chipmate-userprofile").toFile()

        val path = ChipMateCliConfigPath.resolve(
            mapOf(
                "HOME" to "",
                "USERPROFILE" to home.absolutePath,
            ),
        )

        assertEquals(File(File(home, ".config"), "chipmate").absoluteFile, path.absoluteFile)
    }

    @Test
    fun `blank config env values are ignored`() {
        val home = Files.createTempDirectory("chipmate-home").toFile()

        val path = ChipMateCliConfigPath.resolve(
            mapOf(
                "CHIPMATE_CONFIG_DIR" to " ",
                "XDG_CONFIG_HOME" to "",
                "HOME" to home.absolutePath,
            ),
        )

        assertEquals(File(File(home, ".config"), "chipmate").absoluteFile, path.absoluteFile)
    }

    @Test
    fun `legacy settings file resolves under global config dir`() {
        val home = Files.createTempDirectory("chipmate-home").toFile()

        val path = ChipMateCliConfigPath.legacySettingsFile(mapOf("HOME" to home.absolutePath))

        assertEquals(File(File(File(home, ".config"), "chipmate"), "legacy-settings.json").absoluteFile, path.absoluteFile)
    }
}
