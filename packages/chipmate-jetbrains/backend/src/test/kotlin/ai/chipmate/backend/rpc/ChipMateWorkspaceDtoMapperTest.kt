package ai.chipmate.backend.rpc

import ai.chipmate.backend.workspace.ModelInfo
import ai.chipmate.backend.workspace.ModelCostInfo
import ai.chipmate.backend.workspace.ModelOptionsInfo
import ai.chipmate.backend.workspace.ModelTerminalBenchInfo
import ai.chipmate.backend.workspace.ProviderData
import ai.chipmate.backend.workspace.ProviderInfo
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ChipMateWorkspaceDtoMapperTest {

    @Test
    fun `providers preserve prompt training disclosure`() {
        val model = ModelInfo(
            id = "paid",
            name = "Paid",
            attachment = false,
            reasoning = false,
            temperature = false,
            toolCall = true,
            free = false,
            status = null,
            recommendedIndex = null,
            variants = emptyList(),
            limit = null,
            mayTrainOnYourPrompts = true,
        )
        val data = ProviderData(
            providers = listOf(
                ProviderInfo(
                    id = "chipmate",
                    name = "ChipMate",
                    source = "api",
                    models = mapOf(model.id to model),
                ),
            ),
            connected = listOf("chipmate"),
            defaults = emptyMap(),
        )

        val result = ChipMateWorkspaceDtoMapper.providers(data)

        assertTrue(result.providers.single().models.getValue("paid").mayTrainOnYourPrompts)
    }

    @Test
    fun `providers preserve model preview metadata`() {
        val model = ModelInfo(
            id = "auto",
            name = "Auto",
            inputPrice = 0.1,
            outputPrice = 0.2,
            contextLength = 128000,
            releaseDate = "2026-06-01",
            latest = true,
            attachment = false,
            reasoning = true,
            temperature = false,
            toolCall = true,
            free = false,
            status = null,
            recommendedIndex = null,
            variants = emptyList(),
            limit = null,
            cost = ModelCostInfo(0.1, 0.2),
            options = ModelOptionsInfo("Preview text"),
            terminalBench = ModelTerminalBenchInfo(0.5, 2.0),
        )
        val data = ProviderData(
            providers = listOf(ProviderInfo("chipmate", "ChipMate", "api", mapOf(model.id to model))),
            connected = listOf("chipmate"),
            defaults = emptyMap(),
        )

        val result = ChipMateWorkspaceDtoMapper.providers(data).providers.single().models.getValue("auto")

        assertEquals(0.1, result.inputPrice)
        assertEquals(0.2, result.outputPrice)
        assertEquals(128000L, result.contextLength)
        assertEquals("2026-06-01", result.releaseDate)
        assertEquals(true, result.latest)
        assertEquals(0.1, result.cost?.input)
        assertEquals("Preview text", result.options?.description)
        assertEquals(0.5, result.terminalBench?.overallScore)
    }
}
