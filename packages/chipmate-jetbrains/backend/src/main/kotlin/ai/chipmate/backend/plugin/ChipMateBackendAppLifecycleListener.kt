package ai.chipmate.backend.plugin

import ai.chipmate.backend.app.ChipMateBackendAppService
import ai.chipmate.log.ChipMateLog
import com.intellij.ide.AppLifecycleListener
import com.intellij.openapi.components.serviceIfCreated

class ChipMateBackendAppLifecycleListener : AppLifecycleListener {
    private val log = ChipMateLog.create(ChipMateBackendAppLifecycleListener::class.java)

    override fun appWillBeClosed(isRestart: Boolean) {
        log.info("appWillBeClosed(isRestart=$isRestart) — stopping ChipMate CLI")
        runCatching {
            serviceIfCreated<ChipMateBackendAppService>()?.shutdownForAppClose()
        }.onFailure { log.warn("Failed to stop CLI on app close", it) }
    }
}
