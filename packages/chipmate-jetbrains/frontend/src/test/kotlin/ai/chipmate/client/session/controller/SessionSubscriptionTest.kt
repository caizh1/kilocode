package ai.chipmate.client.session.controller

import ai.chipmate.client.testing.TestLog
import ai.chipmate.rpc.dto.ConfigDto
import ai.chipmate.rpc.dto.ChipMateAppStateDto
import ai.chipmate.rpc.dto.ChipMateAppStatusDto
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.flow

class SessionSubscriptionTest : SessionControllerTestBase() {

    override fun setUp() {
        super.setUp()
        rpc.session = rpc.session.copy(id = "ses_test")
        appRpc.state.value = ChipMateAppStateDto(ChipMateAppStatusDto.READY, config = ConfigDto(model = "chipmate/gpt-5"))
        projectRpc.state.value = workspaceReady()
    }

    fun `test controller event subscription logs failures`() {
        val log = TestLog()
        rpc.eventFlow = { _, _ -> flow { throw IllegalStateException("stream failed") } }

        controller("ses_test", log = log)
        flush()

        assertTrue(log.messages.joinToString("\n"), log.messages.any { it.contains("kind=subscription route=controller-events failed message=stream failed") })
    }

    fun `test controller event subscription rethrows cancellation without failure log`() {
        val log = TestLog()
        rpc.eventFlow = { _, _ -> flow { throw CancellationException("stop") } }

        controller("ses_test", log = log)
        flush()

        assertFalse(log.messages.joinToString("\n"), log.messages.any { it.contains("route=controller-events failed") })
    }
}
