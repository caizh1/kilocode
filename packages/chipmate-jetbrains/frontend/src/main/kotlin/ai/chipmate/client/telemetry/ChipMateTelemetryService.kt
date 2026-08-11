@file:Suppress("UnstableApiUsage")

package ai.chipmate.client.telemetry

import ai.chipmate.log.ChipMateLog
import ai.chipmate.rpc.ChipMateAppRpcApi
import ai.chipmate.rpc.dto.TelemetryCaptureDto
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import fleet.rpc.client.durable
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

object Telemetry {
    fun send(event: String, properties: Map<String, String> = emptyMap()) {
        ChipMateTelemetryService.getInstance().send(event, properties)
    }
}

@Service(Service.Level.APP)
class ChipMateTelemetryService internal constructor(
    private val cs: CoroutineScope,
    private val rpc: ChipMateAppRpcApi?,
) {
    constructor(cs: CoroutineScope) : this(cs, null)

    companion object {
        private val LOG = ChipMateLog.create(ChipMateTelemetryService::class.java)
        private const val MAX_PENDING = 64
        private const val TIMEOUT_MS = 5_000L

        fun getInstance(): ChipMateTelemetryService = service()
    }

    private val pending = AtomicInteger()
    private val warned = AtomicBoolean()

    fun send(event: String, properties: Map<String, String> = emptyMap()) {
        if (pending.incrementAndGet() > MAX_PENDING) {
            pending.decrementAndGet()
            if (warned.compareAndSet(false, true)) {
                LOG.warn("telemetry backpressure: dropping events with more than $MAX_PENDING pending")
            }
            return
        }
        cs.launch {
            try {
                if (ChipMateLog.sandbox()) {
                    val payload = ChipMateLog.payload(LOG) + properties
                    LOG.info("event=$event ${payload.entries.joinToString(" ") { "${it.key}=${it.value}" }}")
                    return@launch
                }
                val dto = TelemetryCaptureDto(event, properties)
                val sent = withTimeoutOrNull(TIMEOUT_MS) {
                    val api = rpc
                    if (api != null) api.captureTelemetry(dto)
                    else durable { ChipMateAppRpcApi.getInstance().captureTelemetry(dto) }
                    true
                }
                if (sent != true) LOG.warn("telemetry capture timed out: $event")
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                LOG.warn("telemetry capture failed: ${e.message}", e)
            } finally {
                pending.decrementAndGet()
            }
        }
    }
}
