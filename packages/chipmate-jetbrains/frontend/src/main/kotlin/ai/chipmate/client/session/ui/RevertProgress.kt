package ai.chipmate.client.session.ui

import ai.chipmate.client.plugin.ChipMateBundle
import ai.chipmate.client.session.ui.style.SessionEditorStyle
import ai.chipmate.client.session.ui.style.SessionEditorStyleTarget
import ai.chipmate.client.ui.UiStyle
import ai.chipmate.client.ui.layout.Stack
import com.intellij.ui.AnimatedIcon
import com.intellij.ui.components.ActionLink
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import javax.swing.JPanel

class RevertProgress(onCancel: () -> Unit) : JPanel(), SessionEditorStyleTarget {
    private val label = JBLabel()
    private val cancel = ActionLink(ChipMateBundle.message("session.action.cancel")) { onCancel() }
    private var style = SessionEditorStyle.current()

    init {
        isOpaque = false
        add(Stack.horizontal(UiStyle.Gap.sm())
            .next(JBLabel(AnimatedIcon.Default()))
            .next(label)
            .next(cancel))
        applyStyle(style)
    }

    @RequiresEdt
    fun setText(text: String) {
        if (label.text == text) return
        label.text = text
        revalidate()
        repaint()
    }

    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        label.font = style.regularFont
        label.foreground = UiStyle.Colors.fg()
        cancel.font = style.regularFont
        revalidate()
        repaint()
    }
}
