package ai.chipmate.client.session.ui

import ai.chipmate.client.plugin.ChipMateBundle
import ai.chipmate.client.session.controller.SessionController
import ai.chipmate.client.session.controller.SessionControllerEvent
import ai.chipmate.client.session.controller.SessionControllerTestBase
import ai.chipmate.client.session.ui.style.SessionEditorStyle
import ai.chipmate.client.ui.UiStyle
import com.intellij.ui.components.JBScrollPane
import java.awt.Dimension
import javax.swing.border.CompoundBorder

@Suppress("UnstableApiUsage")
class ConnectionPanelTest : SessionControllerTestBase() {

    private lateinit var panel: ConnectionPanel
    private lateinit var controller: SessionController

    override fun setUp() {
        super.setUp()
        controller = controller("ses_test")
        panel = ConnectionPanel(parent, controller)
        flush()
    }

    fun `test loading hides retry and details`() {
        edt {
            panel.onEvent(SessionControllerEvent.ConnectionChanged.ShowConnecting)
        }

        assertTrue(panel.isVisible)
        assertEquals("Loading...", panel.summaryText())
        assertEquals("", panel.detailsText())
        assertFalse(panel.toggleVisible())
        assertFalse(panel.detailsVisible())
        assertFalse(panel.retryVisible())
    }

    fun `test downloading hides retry and details`() {
        edt {
            panel.onEvent(SessionControllerEvent.ConnectionChanged.ShowDownloading(42, "1.2.3", "darwin-arm64"))
        }

        assertTrue(panel.isVisible)
        assertEquals(ChipMateBundle.message("session.connection.downloading.version", "1.2.3", "darwin-arm64", 42), panel.summaryText())
        assertEquals("", panel.detailsText())
        assertFalse(panel.toggleVisible())
        assertFalse(panel.detailsVisible())
        assertFalse(panel.retryVisible())
    }

    fun `test app error starts collapsed and expands details`() {
        edt {
            panel.onEvent(SessionControllerEvent.ConnectionChanged.ShowError(
                "CLI startup failed",
                "stderr line\nconfig: HTTP 500: broken",
            ))
        }

        assertTrue(panel.isVisible)
        assertEquals("CLI startup failed", panel.summaryText())
        assertEquals(UiStyle.Colors.errorLabelForeground(), panel.summaryColor())
        assertTrue(panel.toggleVisible())
        assertFalse(panel.toggleExpanded())
        assertFalse(panel.detailsVisible())
        assertEquals("stderr line\nconfig: HTTP 500: broken", panel.detailsText())
        assertEquals(UiStyle.Colors.fg(), panel.detailsColor())
        assertTrue(panel.retryVisible())
        assertFalse(panel.retryFocusable())

        edt { panel.clickSummary() }

        assertTrue(panel.toggleExpanded())
        assertTrue(panel.detailsVisible())
        assertTrue(panel.components.filterIsInstance<JBScrollPane>().single().border is CompoundBorder)

        edt { panel.clickToggle() }

        assertFalse(panel.toggleExpanded())
        assertFalse(panel.detailsVisible())
    }

    fun `test workspace error shows retry without details`() {
        edt {
            panel.onEvent(SessionControllerEvent.ConnectionChanged.ShowError("Workspace failed", null))
        }

        assertTrue(panel.isVisible)
        assertEquals("Workspace failed", panel.summaryText())
        assertFalse(panel.toggleVisible())
        assertFalse(panel.detailsVisible())
        assertEquals("", panel.detailsText())
        assertTrue(panel.retryVisible())
        assertEquals("Try again", panel.retryText())
    }

    fun `test retry popup group uses core recovery actions`() {
        edt {
            panel.onEvent(SessionControllerEvent.ConnectionChanged.ShowError("CLI startup failed", null))
        }
        val xml = requireNotNull(javaClass.classLoader.getResourceAsStream("chipmate.jetbrains.frontend.xml"))
            .bufferedReader()
            .use { it.readText() }

        assertTrue(panel.retryVisible())
        assertEquals("ChipMate.CliGroup", ConnectionPanel.CLI_GROUP_ID)
        assertTrue(xml.contains("<group id=\"ChipMate.CliGroup\" text=\"Core\" popup=\"true\">"))
        assertTrue(xml.contains("<reference ref=\"ChipMate.Restart\"/>"))
        assertTrue(xml.contains("<reference ref=\"ChipMate.Reinstall\"/>"))
        assertTrue(xml.contains("<reference ref=\"ChipMate.CoreInfo\"/>"))
    }

    fun `test ready warnings show collapsed banner with retry`() {
        edt {
            panel.onEvent(SessionControllerEvent.ConnectionChanged.ShowWarning(
                "Configuration warnings",
                ".chipmate/chipmate.json: Invalid JSON\nCloseBraceExpected at line 11, column 1",
            ))
        }

        assertTrue(panel.isVisible)
        assertEquals("Configuration warnings", panel.summaryText())
        assertEquals(UiStyle.Colors.warningLabelForeground(), panel.summaryColor())
        assertTrue(panel.toggleVisible())
        assertFalse(panel.toggleExpanded())
        assertFalse(panel.detailsVisible())
        assertTrue(panel.retryVisible())
        assertFalse(panel.retryFocusable())
        assertEquals(
            ".chipmate/chipmate.json: Invalid JSON\nCloseBraceExpected at line 11, column 1",
            panel.detailsText(),
        )

        edt { panel.clickSummary() }

        assertTrue(panel.toggleExpanded())
        assertTrue(panel.detailsVisible())
    }

    fun `test expanded details height is capped at ten lines`() {
        edt {
            panel.onEvent(SessionControllerEvent.ConnectionChanged.ShowError("CLI startup failed", lines(30)))
            panel.size = Dimension(480, 1000)
        }

        edt { panel.clickSummary() }

        assertTrue(panel.detailsVisible())
        assertTrue(panel.preferredSize.height <= panel.maxExpandedHeight())
    }

    fun `test raw app and workspace events do not render panel`() {
        edt {
            panel.onEvent(SessionControllerEvent.AppChanged)
            panel.onEvent(SessionControllerEvent.WorkspaceChanged)
        }

        assertFalse(panel.isVisible)
    }

    fun `test panel uses prompt background without separator`() {
        assertTrue(panel.isOpaque)
        assertEquals(SessionEditorStyle.current().editorScheme.defaultBackground.rgb, panel.background.rgb)
        assertFalse(panel.hasSeparator())
    }

    private fun lines(count: Int) = (1..count).joinToString("\n") { "line $it" }
}
