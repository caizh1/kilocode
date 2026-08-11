@file:Suppress("UnstableApiUsage")

package ai.chipmate.backend.rpc

import ai.chipmate.rpc.ChipMateAppRpcApi
import com.intellij.platform.rpc.backend.RemoteApiProvider
import fleet.rpc.remoteApiDescriptor

internal class ChipMateAppRpcApiProvider : RemoteApiProvider {
    override fun RemoteApiProvider.Sink.remoteApis() {
        remoteApi(remoteApiDescriptor<ChipMateAppRpcApi>()) {
            ChipMateAppRpcApiImpl()
        }
    }
}
