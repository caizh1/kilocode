package ai.chipmate.client.ui.md

import ai.chipmate.client.session.ui.selection.SessionSelection
import ai.chipmate.client.session.ui.style.SessionEditorStyle

internal class MdViewHybrid(
    style: SessionEditorStyle = SessionEditorStyle.current(),
    selection: SessionSelection? = null,
    code: MdCodeBlockFactory = MdCodeBlockFactory.default(),
) : ai.chipmate.client.ui.md.hybrid.MdViewHybrid(style, selection, code)
