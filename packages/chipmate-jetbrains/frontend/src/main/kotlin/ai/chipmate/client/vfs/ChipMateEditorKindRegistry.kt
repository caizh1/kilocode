package ai.chipmate.client.vfs

import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import java.util.concurrent.ConcurrentHashMap

@Service(Service.Level.APP)
class ChipMateEditorKindRegistry {
    private val kinds = ConcurrentHashMap<String, ChipMateEditorKind>()

    fun register(kind: ChipMateEditorKind) {
        kinds[kind.id] = kind
        service<ChipMateVirtualFileKindRegistry>().register(kind)
    }

    fun unregister(id: String) {
        kinds.remove(id)
        service<ChipMateVirtualFileKindRegistry>().unregister(id)
    }

    fun clear() {
        kinds.keys.forEach { id -> unregister(id) }
    }

    fun get(id: String): ChipMateEditorKind? = kinds[id]
}
