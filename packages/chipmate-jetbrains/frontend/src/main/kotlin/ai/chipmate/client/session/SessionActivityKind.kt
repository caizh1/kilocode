package ai.chipmate.client.session

import ai.chipmate.client.plugin.ChipMateBundle
import ai.chipmate.client.ui.UiStyle

enum class SessionActivityKind {
    RUNNING,
    LOGIN_REQUIRED,
    PERMISSION,
    PLAN,
    QUESTION,
    ;

    fun label(): String = when (this) {
        RUNNING -> ChipMateBundle.message("session.part.tool.running")
        LOGIN_REQUIRED -> ChipMateBundle.message("history.badge.loginRequired")
        PERMISSION -> ChipMateBundle.message("history.badge.permission")
        PLAN -> ChipMateBundle.message("history.badge.plan")
        QUESTION -> ChipMateBundle.message("history.badge.question")
    }

    fun style(): UiStyle.Badge.Style = when (this) {
        RUNNING -> UiStyle.Badge.Alert
        LOGIN_REQUIRED, PERMISSION, PLAN, QUESTION -> UiStyle.Badge.Primary
    }
}
