@file:Suppress("UnstableApiUsage")

package ai.chipmate.backend.rpc

import ai.chipmate.backend.provider.ChipMateBackendProviderSettingsManager
import ai.chipmate.rpc.ChipMateProviderRpcApi
import ai.chipmate.rpc.dto.CustomModelFetchDto
import ai.chipmate.rpc.dto.CustomModelFetchResultDto
import ai.chipmate.rpc.dto.CustomProviderSaveDto
import ai.chipmate.rpc.dto.ProviderActionResultDto
import ai.chipmate.rpc.dto.ProviderConnectDto
import ai.chipmate.rpc.dto.ProviderDisconnectDto
import ai.chipmate.rpc.dto.ProviderEnableDto
import ai.chipmate.rpc.dto.ProviderOAuthAuthorizeDto
import ai.chipmate.rpc.dto.ProviderOAuthCallbackDto
import ai.chipmate.rpc.dto.ProviderOAuthReadyDto
import ai.chipmate.rpc.dto.ProviderSettingsDto
import com.intellij.openapi.components.service
import ai.chipmate.backend.app.ChipMateBackendAppService
import ai.chipmate.log.ChipMateLog

internal class ChipMateProviderRpcApiImpl : ChipMateProviderRpcApi {
    companion object {
        private val LOG = ChipMateLog.create(ChipMateProviderRpcApiImpl::class.java)
    }

    private val manager: ChipMateBackendProviderSettingsManager
        get() = ChipMateBackendProviderSettingsManager(service<ChipMateBackendAppService>())

    override suspend fun state(directory: String): ProviderSettingsDto = logged("state dir=$directory") { manager.state(directory) }
    override suspend fun connect(input: ProviderConnectDto): ProviderActionResultDto = logged("connect provider=${input.providerId}") { manager.connect(input) }
    override suspend fun authorize(input: ProviderOAuthAuthorizeDto): ProviderOAuthReadyDto = logged("authorize provider=${input.providerId}") { manager.authorize(input) }
    override suspend fun callback(input: ProviderOAuthCallbackDto): ProviderActionResultDto = logged("callback provider=${input.providerId}") { manager.callback(input) }
    override suspend fun disconnect(input: ProviderDisconnectDto): ProviderActionResultDto = logged("disconnect provider=${input.providerId}") { manager.disconnect(input) }
    override suspend fun enable(input: ProviderEnableDto): ProviderActionResultDto = logged("enable provider=${input.providerId}") { manager.enable(input) }
    override suspend fun saveCustom(input: CustomProviderSaveDto): ProviderActionResultDto = logged("save custom provider=${input.id}") { manager.saveCustom(input) }
    override suspend fun fetchCustomModels(input: CustomModelFetchDto): CustomModelFetchResultDto = logged("fetch custom models") { manager.fetch(input) }

    private suspend fun <T> logged(name: String, block: suspend () -> T): T {
        val start = System.currentTimeMillis()
        LOG.info("provider rpc $name: start")
        return try {
            val result = block()
            LOG.info("provider rpc $name: completed durationMs=${System.currentTimeMillis() - start}")
            result
        } catch (e: Exception) {
            LOG.warn("provider rpc $name: failed durationMs=${System.currentTimeMillis() - start}", e)
            throw e
        }
    }
}
