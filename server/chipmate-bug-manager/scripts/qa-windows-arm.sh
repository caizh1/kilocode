#!/usr/bin/env bash
set -euo pipefail

vsix=${CHIPMATE_WINDOWS_VSIX:?未配置 CHIPMATE_WINDOWS_VSIX}
vm=${CHIPMATE_WINDOWS_VM:-Windows 11}
prlctl=${CHIPMATE_PRLCTL:-/Applications/Parallels Desktop.app/Contents/MacOS/prlctl}
home=${HOME}

if [[ ! -x ${prlctl} ]]; then
  echo "未找到 Parallels 命令行工具。"
  exit 2
fi
if [[ ! -f ${vsix} || ${vsix} != "${home}/"* ]]; then
  echo "Windows 候选包必须位于当前用户主目录共享范围内。"
  exit 2
fi

status=$("${prlctl}" status "${vm}" | awk 'NR == 1 { print $NF }')
restore=
if [[ ${status} == "suspended" ]]; then
  "${prlctl}" resume "${vm}"
  restore=suspend
elif [[ ${status} != "running" ]]; then
  "${prlctl}" start "${vm}"
  restore=stop
fi

cleanup() {
  if [[ ${restore} == "suspend" ]]; then
    "${prlctl}" suspend "${vm}" >/dev/null 2>&1 || true
  elif [[ ${restore} == "stop" ]]; then
    "${prlctl}" stop "${vm}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

ready=0
for _attempt in $(seq 1 120); do
  if "${prlctl}" exec "${vm}" --current-user cmd.exe /d /c ver >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
if [[ ${ready} -ne 1 ]]; then
  echo "Windows 虚拟机未在规定时间内就绪。"
  exit 1
fi

relative=${vsix#"${home}/"}
guest_vsix="\\\\Mac\\Home\\${relative//\//\\}"
qa_root=${CHIPMATE_WINDOWS_QA_ROOT:?未配置 CHIPMATE_WINDOWS_QA_ROOT}
if [[ ${qa_root} != "${home}/"* ]]; then
  echo "Windows QA 源码目录必须位于当前用户主目录共享范围内。"
  exit 2
fi
qa_relative=${qa_root#"${home}/"}
guest_qa="\\\\Mac\\Home\\${qa_relative//\//\\}\\qa\\windows-real\\run.ps1"
output="C:\\ChipMateQA\\run-${CHIPMATE_VERSION:?未配置 CHIPMATE_VERSION}"

"${prlctl}" exec "${vm}" --current-user \
  powershell.exe -NoProfile -ExecutionPolicy Bypass \
  -File "${guest_qa}" \
  -Vsix "${guest_vsix}" \
  -Lane smoke \
  -Gate arm64-vm \
  -Output "${output}"

echo "ChipMate Windows ARM 安装与功能验收通过。"
