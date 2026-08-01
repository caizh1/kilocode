#!/usr/bin/env bash
set -euo pipefail

manager=${1:-}
mode=${2:-monitor}
repo=${3:-}
extension=${4:-}
work_root=${5:-/Users/archer/Work/chipmate-auto-worktrees}
service='ChipMate Bug Worker 106.14.118.87'
account='chipmate-mac-runner'
config_dir=/Users/archer/.config/chipmate
agent_dir=/Users/archer/Library/LaunchAgents
log_dir=/Users/archer/Library/Logs/ChipMate
config=${config_dir}/bug-runner.env
agent=${agent_dir}/com.chipmate.bug-runner.plist
codex_home=${config_dir}/codex-home

if [[ -z ${manager} ]]; then
  echo "用法：install-mac-runner.sh <管理服务目录> <monitor|shadow> [源码仓库] [扩展目录] [任务工作树目录]"
  exit 2
fi
if [[ ${mode} != monitor && ${mode} != shadow ]]; then
  echo "自动安装只支持 monitor 或 shadow；release 模式需要单独完成发布凭据和双平台验收配置。"
  exit 2
fi
if [[ ! -f ${manager}/dist/server/runner.js ]]; then
  echo "缺少已经构建的执行器：${manager}/dist/server/runner.js"
  exit 2
fi
if [[ ${mode} == shadow && ( -z ${repo} || -z ${extension} ) ]]; then
  echo "shadow 模式必须提供源码仓库和扩展相对目录。"
  exit 2
fi

token=$(security find-generic-password -a "${account}" -s "${service}" -w)
if [[ ${#token} -lt 32 ]]; then
  echo "钥匙串中的 Worker Token 无效。"
  exit 2
fi

mkdir -p "${config_dir}" "${agent_dir}" "${log_dir}" "${codex_home}"
chmod 700 "${config_dir}"
chmod 700 "${codex_home}"
install -m 0700 "${manager}/deploy/run-bug-runner.sh" "${config_dir}/run-bug-runner.sh"
install -m 0600 "${manager}/deploy/com.chipmate.bug-runner.plist" "${agent}"

if [[ ${mode} == shadow ]]; then
  auth=${HOME}/.codex/auth.json
  if [[ ! -r ${auth} ]]; then
    echo "当前用户尚未登录 Codex，无法启用 shadow 模式。"
    exit 2
  fi
  if [[ -e ${codex_home}/auth.json || -L ${codex_home}/auth.json ]]; then
    if [[ ! -L ${codex_home}/auth.json || $(readlink "${codex_home}/auth.json") != "${auth}" ]]; then
      echo "Codex 执行器认证入口已存在且目标不一致，请先人工检查。"
      exit 2
    fi
  else
    ln -s "${auth}" "${codex_home}/auth.json"
  fi
  git_dir=$(git -C "${repo}" rev-parse --absolute-git-dir)
  escaped_git_dir=${git_dir//\\/\\\\}
  escaped_git_dir=${escaped_git_dir//\"/\\\"}
  sed "s|__CHIPMATE_GIT_DIR__|${escaped_git_dir//|/\\|}|g" \
    "${manager}/deploy/codex-runner.config.toml.template" >"${codex_home}/config.toml"
  chmod 0600 "${codex_home}/config.toml"
fi

temporary=$(mktemp "${config}.XXXXXX")
chmod 0600 "${temporary}"
{
  printf 'CHIPMATE_MANAGER_DIR=%q\n' "${manager}"
  printf 'CHIPMATE_BUG_URL=%q\n' 'https://106.14.118.87/bugs/'
  printf 'CHIPMATE_WORKER_ID=%q\n' 'chipmate-mac-runner'
  printf 'CHIPMATE_RUNNER_MODE=%q\n' "${mode}"
  printf 'CHIPMATE_WORKER_TOKEN=%q\n' "${token}"
  if [[ ${mode} == shadow ]]; then
    printf 'CHIPMATE_REPO_DIR=%q\n' "${repo}"
    printf 'CHIPMATE_WORK_ROOT=%q\n' "${work_root}"
    printf 'CHIPMATE_EXTENSION_DIR=%q\n' "${extension}"
    printf 'CHIPMATE_SNAPSHOT_PATHS=%q\n' '["packages",".changeset","script"]'
    printf 'CHIPMATE_MAX_ROUNDS=%q\n' '3'
    printf 'CHIPMATE_MAX_TOKENS=%q\n' '0'
    printf 'CHIPMATE_TIMEOUT_MINUTES=%q\n' '90'
    printf 'CHIPMATE_CODEX_COMMAND=%q\n' \
      "[\"bash\",\"${manager}/deploy/run-codex-sandboxed.sh\"]"
    printf 'CHIPMATE_PREPARE_COMMAND=%q\n' \
      '["/opt/homebrew/bin/bun","install","--frozen-lockfile","--offline","--ignore-scripts"]'
    printf 'CHIPMATE_SANDBOX_COMMAND=%q\n' \
      "[\"bash\",\"${manager}/deploy/run-worktree-sandboxed.sh\"]"
    printf 'CHIPMATE_VERIFY_COMMAND=%q\n' \
      "[\"/bin/bash\",\"-c\",\"/opt/homebrew/bin/bun run --cwd=${extension} typecheck && /opt/homebrew/bin/bun --cwd=${extension} test tests/unit/update-check.test.ts\"]"
  fi
} >"${temporary}"
mv "${temporary}" "${config}"
unset token

launchctl bootout "gui/$(id -u)/com.chipmate.bug-runner" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "${agent}"
launchctl kickstart -k "gui/$(id -u)/com.chipmate.bug-runner"

echo "ChipMate 自动执行器已安装并以 ${mode} 模式启动。"
