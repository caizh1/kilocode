package ai.chipmate.backend.telemetry

import ai.chipmate.backend.cli.ChipMateBackendHttpClients
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import java.util.concurrent.TimeUnit

class ChipMateBackendTelemetryTest {
    @Test
    fun `capture posts to telemetry endpoint with auth`() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody("{}"))
        server.start()
        val http = ChipMateBackendHttpClients.api("secret")
        try {
            ChipMateBackendTelemetry().capture(http, server.port, "Test Event", mapOf("source" to "test"))

            val req = server.takeRequest()
            assertEquals("/telemetry/capture", req.path)
            assertTrue(req.getHeader("Authorization")?.startsWith("Basic ") == true)
            val body = req.body.readUtf8()
            assertTrue(body.contains("\"event\":\"Test Event\""))
            assertTrue(!body.contains("JetBrains"))
            assertTrue(body.contains("\"platform\":\"jetbrains\""))
            assertTrue(!body.contains("appName"))
            assertTrue(body.contains("source"))
        } finally {
            ChipMateBackendHttpClients.shutdown(http)
            server.shutdown()
        }
    }

    @Test
    fun `set enabled posts to telemetry endpoint`() = runBlocking {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody("{}"))
        server.start()
        val http = ChipMateBackendHttpClients.api("secret")
        try {
            ChipMateBackendTelemetry().setEnabled(http, server.port, true)

            val req = server.takeRequest()
            assertEquals("/telemetry/setEnabled", req.path)
            assertTrue(req.body.readUtf8().contains("enabled"))
        } finally {
            ChipMateBackendHttpClients.shutdown(http)
            server.shutdown()
        }
    }

    @Test
    fun `capture failure does not throw`() = runBlocking {
        ChipMateBackendTelemetry().capture(null, 0, "Test Event", emptyMap())
    }

    @Test
    fun `dev mode does not post capture`() = runBlocking {
        System.setProperty("idea.plugin.in.sandbox.mode", "true")
        val server = MockWebServer()
        server.start()
        val http = ChipMateBackendHttpClients.api("secret")
        try {
            ChipMateBackendTelemetry().capture(http, server.port, "Test Event", emptyMap())

            assertEquals(null, server.takeRequest(100, TimeUnit.MILLISECONDS))
        } finally {
            System.clearProperty("idea.plugin.in.sandbox.mode")
            ChipMateBackendHttpClients.shutdown(http)
            server.shutdown()
        }
    }
}
