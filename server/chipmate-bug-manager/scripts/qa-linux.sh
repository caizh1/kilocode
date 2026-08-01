#!/usr/bin/env bash
set -euo pipefail

vsix=${CHIPMATE_LINUX_VSIX:?未配置 CHIPMATE_LINUX_VSIX}
dest=${CHIPMATE_LINUX_QA_DEST:?未配置 CHIPMATE_LINUX_QA_DEST}

if [[ ! -f ${vsix} ]]; then
  echo "Linux 候选包不存在：${vsix}"
  exit 2
fi

remote=$(ssh -o BatchMode=yes -- "${dest}" mktemp -d /tmp/chipmate-qa.XXXXXX)
if [[ ! ${remote} =~ ^/tmp/chipmate-qa\.[A-Za-z0-9]+$ ]]; then
  echo "服务器返回了不安全的临时目录。"
  exit 1
fi
cleanup() {
  ssh -o BatchMode=yes -- "${dest}" find "${remote}" -mindepth 1 -delete >/dev/null 2>&1 || true
  ssh -o BatchMode=yes -- "${dest}" rmdir "${remote}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

scp -o BatchMode=yes -- "${vsix}" "${dest}:${remote}/candidate.vsix"
ssh -o BatchMode=yes -- "${dest}" bash -s -- "${remote}" <<'REMOTE'
set -euo pipefail
root=$1
mkdir "${root}/unpacked"
python3 -m zipfile -e "${root}/candidate.vsix" "${root}/unpacked"

cli=
while IFS= read -r file; do
  if file -b "${file}" | grep -q 'ELF 64-bit.*x86-64'; then
    cli=${file}
    break
  fi
done < <(find "${root}/unpacked/extension/bin" -maxdepth 1 -type f -print | sort)

if [[ -z ${cli} ]]; then
  echo "没有找到 Linux x64 CLI。"
  exit 1
fi

chmod +x "${cli}"
"${cli}" --version

export XDG_DATA_HOME="${root}/data"
export XDG_CACHE_HOME="${root}/cache"
export CHIPMATE_APP_NAME=chipmate
"${cli}" serve --port 0 >"${root}/stdout.log" 2>"${root}/stderr.log" &
pid=$!
cleanup_process() {
  kill "${pid}" >/dev/null 2>&1 || true
  wait "${pid}" >/dev/null 2>&1 || true
}
trap cleanup_process EXIT

ready=0
for _attempt in $(seq 1 300); do
  if grep -q 'listening on http://' "${root}/stdout.log"; then
    ready=1
    break
  fi
  if ! kill -0 "${pid}" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

if [[ ${ready} -ne 1 ]]; then
  cat "${root}/stdout.log"
  cat "${root}/stderr.log" >&2
  exit 1
fi
echo "ChipMate Linux x64 CLI 启动验收通过。"
REMOTE
