#!/usr/bin/env bash
set -euo pipefail

config=${CHIPMATE_RUNNER_ENV:-/Users/archer/.config/chipmate/bug-runner.env}
if [[ ! -r ${config} ]]; then
  echo "ChipMate 自动执行器配置不存在：${config}"
  exit 2
fi

set -a
source "${config}"
set +a

mkdir -p /Users/archer/Library/Logs/ChipMate
cd "${CHIPMATE_MANAGER_DIR:?未配置 CHIPMATE_MANAGER_DIR}"
exec /usr/bin/env node dist/server/runner.js
