package ai.chipmate.client.session.views.tool

import ai.chipmate.cli.ChipMateCliParser
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class ChipMateCliParserTest {
    @Test
    fun `tag extracts trimmed tool xml value`() {
        val text = """
            <path>
              /tmp/example.txt
            </path>
            <type>file</type>
        """.trimIndent()

        assertEquals("/tmp/example.txt", ChipMateCliParser.tag(text, "path"))
        assertEquals("file", ChipMateCliParser.tag(text, "type"))
    }

    @Test
    fun `tag returns null for blank or missing value`() {
        assertNull(ChipMateCliParser.tag("<path>   </path>", "path"))
        assertNull(ChipMateCliParser.tag("<type>file</type>", "path"))
    }
}
