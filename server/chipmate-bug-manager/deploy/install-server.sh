#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "必须使用 root 运行服务器安装脚本。"
  exit 2
fi

source_dir=${1:-}
if [[ -z ${source_dir} || ! -f ${source_dir}/dist/server/start.js || ! -d ${source_dir}/dist/web ]]; then
  echo "用法：install-server.sh <已经完成 npm run build 的源码目录>"
  exit 2
fi

node_major=$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || true)
if [[ -z ${node_major} || ${node_major} -lt 24 ]]; then
  echo "服务器需要 Node.js 24 或更高版本。"
  exit 2
fi

if ! id chipmate-bugs >/dev/null 2>&1; then
  useradd --system --home /var/lib/chipmate-bug-manager --shell /usr/sbin/nologin chipmate-bugs
fi

install -d -o chipmate-bugs -g chipmate-bugs -m 0750 /var/lib/chipmate-bug-manager
install -d -o root -g root -m 0755 /opt/chipmate-bug-manager

rsync -a --delete \
  --exclude '.env*' \
  --exclude '.runtime' \
  --exclude 'node_modules' \
  "${source_dir}/" /opt/chipmate-bug-manager/

cd /opt/chipmate-bug-manager
npm ci --omit=dev

install -o root -g root -m 0644 \
  deploy/chipmate-bug-manager.service \
  /etc/systemd/system/chipmate-bug-manager.service

if [[ ! -f /etc/chipmate-bug-manager.env ]]; then
  echo "缺少 /etc/chipmate-bug-manager.env；已安装程序但不会启动服务。"
  exit 3
fi

chmod 0600 /etc/chipmate-bug-manager.env
systemctl daemon-reload
systemctl enable chipmate-bug-manager.service
systemctl restart chipmate-bug-manager.service
ready=0
for _ in {1..10}; do
  if curl -fsS http://127.0.0.1:8321/api/health >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [[ ${ready} -ne 1 ]]; then
  systemctl --no-pager --full status chipmate-bug-manager.service
  exit 4
fi
systemctl --no-pager --full status chipmate-bug-manager.service
