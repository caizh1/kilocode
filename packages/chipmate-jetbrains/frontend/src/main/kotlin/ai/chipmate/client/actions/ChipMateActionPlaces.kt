package ai.chipmate.client.actions

import com.intellij.openapi.actionSystem.ActionPlaces

internal object ChipMateActionPlaces {
    const val CONNECTION_RETRY = "ChipMate.ConnectionRetry"

    fun connectionRetryPopup() = ActionPlaces.getActionGroupPopupPlace(CONNECTION_RETRY)
}
