#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "usage: $0 <vsix> <user@render-host> <remote-package-directory>" >&2
  exit 64
fi

vsix="$1"
host="$2"
dir="$3"
file="$(basename -- "$vsix")"

if [[ ! -f "$vsix" ]]; then
  echo "VSIX file is required: $vsix" >&2
  exit 65
fi
case "$file" in
  *.vsix | *.VSIX) ;;
  *)
    echo "VSIX file is required: $vsix" >&2
    exit 65
    ;;
esac
if [[ "$file" =~ [^A-Za-z0-9._-] ]]; then
  echo "VSIX filename may contain only letters, numbers, ., _, and -" >&2
  exit 66
fi
if [[ "$dir" =~ [^A-Za-z0-9_./-] ]]; then
  echo "remote package directory may contain only letters, numbers, _, ., /, and -" >&2
  exit 67
fi

sum="$(shasum -a 256 "$vsix" | awk '{print $1}')"
tmp=".${file}.upload-$$"

scp "$vsix" "${host}:${dir}/${tmp}"
ssh "$host" "set -eu
test -f '${dir}/${tmp}'
actual=\$(sha256sum '${dir}/${tmp}' | awk '{print \$1}')
if [ \"\$actual\" != '${sum}' ]; then
  rm -f '${dir}/${tmp}'
  exit 1
fi
mv -f '${dir}/${tmp}' '${dir}/${file}'
"

echo "Published ${file}. Verify ${host}'s /packages/manifest.json before rollout."
