/**
 * 仅用于识别旧版本已经使用过的本地状态目录。
 * 新配置和用户可见输出不得引用这些名称。
 */
export const LEGACY_STATE_FOLDERS = [".kilo", ".kilocode"] as const

export const LEGACY_WORKTREE_PATTERNS = LEGACY_STATE_FOLDERS.map((folder) => `**/${folder}/worktrees/**`)
