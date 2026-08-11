@file:Suppress("UnstableApiUsage")

package ai.chipmate.backend.rpc

import ai.chipmate.rpc.ChipMateProviderRpcApi
import com.intellij.platform.rpc.backend.RemoteApiProvider
import fleet.rpc.remoteApiDescriptor

internal class ChipMateProviderRpcApiProvider : RemoteApiProvider {
    override fun RemoteApiProvider.Sink.remoteApis() {
        remoteApi(remoteApiDescriptor<ChipMateProviderRpcApi>()) {
            ChipMateProviderRpcApiImpl()
        }
    }
}
