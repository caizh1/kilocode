package ai.chipmate.rpc

fun isManagedWorktreeStorage(path: String): Boolean {
    val rel = path.replace('\\', '/').trimStart('/')
    return rel == ".chipmate/worktrees" || rel.startsWith(".chipmate/worktrees/")
}
