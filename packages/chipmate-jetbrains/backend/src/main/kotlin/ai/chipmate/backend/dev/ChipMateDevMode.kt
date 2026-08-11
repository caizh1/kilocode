package ai.chipmate.backend.dev

import ai.chipmate.log.ChipMateLog

object ChipMateDevMode {
    fun enabled(): Boolean = ChipMateLog.sandbox()
}
