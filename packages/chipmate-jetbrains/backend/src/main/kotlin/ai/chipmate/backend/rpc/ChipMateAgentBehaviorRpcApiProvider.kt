@file:Suppress("UnstableApiUsage")

package ai.chipmate.backend.rpc

import ai.chipmate.rpc.ChipMateAgentBehaviorRpcApi
import com.intellij.platform.rpc.backend.RemoteApiProvider
import fleet.rpc.remoteApiDescriptor

internal class ChipMateAgentBehaviorRpcApiProvider : RemoteApiProvider {
    override fun RemoteApiProvider.Sink.remoteApis() {
        remoteApi(remoteApiDescriptor<ChipMateAgentBehaviorRpcApi>()) {
            ChipMateAgentBehaviorRpcApiImpl()
        }
    }
}
