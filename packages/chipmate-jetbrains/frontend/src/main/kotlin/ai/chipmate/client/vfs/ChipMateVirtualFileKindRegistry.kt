package ai.chipmate.client.vfs

import com.intellij.openapi.components.Service
import java.util.concurrent.ConcurrentHashMap

@Service(Service.Level.APP)
class ChipMateVirtualFileKindRegistry {
    private val kinds = ConcurrentHashMap<String, ChipMateVirtualFileKind>()

    fun register(kind: ChipMateVirtualFileKind) {
        kinds[kind.id] = kind
    }

    fun unregister(id: String) {
        kinds.remove(id)
    }

    fun clear() {
        kinds.clear()
    }

    fun get(id: String): ChipMateVirtualFileKind? = kinds[id]
}
