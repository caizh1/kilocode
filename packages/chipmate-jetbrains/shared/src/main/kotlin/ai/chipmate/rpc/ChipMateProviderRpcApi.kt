@file:Suppress("UnstableApiUsage")

package ai.chipmate.rpc

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
import com.intellij.platform.rpc.RemoteApiProviderService
import fleet.rpc.RemoteApi
import fleet.rpc.Rpc
import fleet.rpc.remoteApiDescriptor

@Rpc
interface ChipMateProviderRpcApi : RemoteApi<Unit> {
    companion object {
        suspend fun getInstance(): ChipMateProviderRpcApi {
            return RemoteApiProviderService.resolve(remoteApiDescriptor<ChipMateProviderRpcApi>())
        }
    }

    suspend fun state(directory: String): ProviderSettingsDto
    suspend fun connect(input: ProviderConnectDto): ProviderActionResultDto
    suspend fun authorize(input: ProviderOAuthAuthorizeDto): ProviderOAuthReadyDto
    suspend fun callback(input: ProviderOAuthCallbackDto): ProviderActionResultDto
    suspend fun disconnect(input: ProviderDisconnectDto): ProviderActionResultDto
    suspend fun enable(input: ProviderEnableDto): ProviderActionResultDto
    suspend fun saveCustom(input: CustomProviderSaveDto): ProviderActionResultDto
    suspend fun fetchCustomModels(input: CustomModelFetchDto): CustomModelFetchResultDto
}
