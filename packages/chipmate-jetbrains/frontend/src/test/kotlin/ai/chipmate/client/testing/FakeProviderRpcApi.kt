package ai.chipmate.client.testing

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
import kotlinx.coroutines.CompletableDeferred

class FakeProviderRpcApi : ChipMateProviderRpcApi {
    var state = ProviderSettingsDto()
    val states = ArrayDeque<CompletableDeferred<ProviderSettingsDto>>()
    val stateCalls = mutableListOf<String>()
    val connects = mutableListOf<ProviderConnectDto>()
    val disconnects = mutableListOf<ProviderDisconnectDto>()
    val enables = mutableListOf<ProviderEnableDto>()
    val custom = mutableListOf<CustomProviderSaveDto>()
    val authorizes = mutableListOf<ProviderOAuthAuthorizeDto>()
    val callbacks = mutableListOf<ProviderOAuthCallbackDto>()
    val authorizesReady = ArrayDeque<CompletableDeferred<ProviderOAuthReadyDto>>()
    val callbacksReady = ArrayDeque<CompletableDeferred<ProviderActionResultDto>>()
    var ready = ProviderOAuthReadyDto()
    var disconnectError: Exception? = null

    override suspend fun state(directory: String): ProviderSettingsDto {
        assertNotEdt("provider.state")
        stateCalls.add(directory)
        if (states.isNotEmpty()) return states.removeFirst().await()
        return state
    }

    override suspend fun connect(input: ProviderConnectDto): ProviderActionResultDto {
        assertNotEdt("provider.connect")
        connects.add(input)
        return ProviderActionResultDto(state)
    }

    override suspend fun authorize(input: ProviderOAuthAuthorizeDto): ProviderOAuthReadyDto {
        assertNotEdt("provider.authorize")
        authorizes.add(input)
        if (authorizesReady.isNotEmpty()) return authorizesReady.removeFirst().await()
        return ready
    }

    override suspend fun callback(input: ProviderOAuthCallbackDto): ProviderActionResultDto {
        assertNotEdt("provider.callback")
        callbacks.add(input)
        if (callbacksReady.isNotEmpty()) return callbacksReady.removeFirst().await()
        return ProviderActionResultDto(state)
    }

    override suspend fun disconnect(input: ProviderDisconnectDto): ProviderActionResultDto {
        assertNotEdt("provider.disconnect")
        disconnects.add(input)
        disconnectError?.let { throw it }
        return ProviderActionResultDto(state)
    }

    override suspend fun enable(input: ProviderEnableDto): ProviderActionResultDto {
        assertNotEdt("provider.enable")
        enables.add(input)
        return ProviderActionResultDto(state)
    }

    override suspend fun saveCustom(input: CustomProviderSaveDto): ProviderActionResultDto {
        assertNotEdt("provider.saveCustom")
        custom.add(input)
        return ProviderActionResultDto(state)
    }

    override suspend fun fetchCustomModels(input: CustomModelFetchDto): CustomModelFetchResultDto {
        assertNotEdt("provider.fetchCustomModels")
        return CustomModelFetchResultDto()
    }
}
