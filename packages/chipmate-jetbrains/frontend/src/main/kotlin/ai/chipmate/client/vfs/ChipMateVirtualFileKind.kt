package ai.chipmate.client.vfs

import javax.swing.Icon

interface ChipMateVirtualFileKind {
    val id: String

    fun title(params: Map<String, String>): String

    fun icon(params: Map<String, String>): Icon? = null

    fun presentablePath(params: Map<String, String>): String = title(params)

    fun isValid(params: Map<String, String>): Boolean = true
}
