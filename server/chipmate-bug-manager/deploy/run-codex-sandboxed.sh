#!/usr/bin/env bash
set -euo pipefail

worktree=${CHIPMATE_WORKTREE:?未配置 CHIPMATE_WORKTREE}
codex=${CHIPMATE_CODEX_BIN:-$(command -v codex)}
codex_home=${CHIPMATE_CODEX_HOME:-${HOME}/.config/chipmate/codex-home}

if [[ ! -r ${codex_home}/config.toml ]]; then
  echo "缺少 Codex 执行器权限配置：${codex_home}/config.toml"
  exit 2
fi

export CODEX_HOME="${codex_home}"
cd "${worktree}"
exec "${codex}" "$@"
