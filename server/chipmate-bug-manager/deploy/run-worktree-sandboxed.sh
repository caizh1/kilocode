#!/usr/bin/env bash
set -euo pipefail

worktree=${CHIPMATE_WORKTREE:?未配置 CHIPMATE_WORKTREE}
profile=$(mktemp /tmp/chipmate-worktree-sandbox.XXXXXX)

cleanup() {
  find "${profile}" -maxdepth 0 -type f -delete 2>/dev/null || true
}
trap cleanup EXIT

cat >"${profile}" <<PROFILE
(version 1)
(allow default)
(deny file-read* (subpath "${HOME}/.ssh"))
(deny file-read* (subpath "${HOME}/.config/chipmate"))
(deny file-read* (subpath "${HOME}/.local/bin"))
(deny file-read* (subpath "${HOME}/.local/share"))
(deny file-read* (subpath "${HOME}/Library/Keychains"))
(deny process-exec (literal "/usr/bin/security"))
(deny process-exec (literal "/usr/bin/ssh"))
(deny process-exec (literal "/usr/bin/scp"))
(deny process-exec (literal "/usr/bin/sftp"))
PROFILE

cd "${worktree}"
exec /usr/bin/sandbox-exec -f "${profile}" "$@"
