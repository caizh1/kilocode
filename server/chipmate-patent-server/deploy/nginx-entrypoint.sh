#!/bin/sh
set -eu

TARGET=/tmp/allowed-cidrs.conf
: > "$TARGET"

OLD_IFS=$IFS
IFS=,
set -- ${PATENT_ALLOWED_CIDRS:?请配置 PATENT_ALLOWED_CIDRS}
IFS=$OLD_IFS

COUNT=0
for CIDR in "$@"; do
  CIDR=$(printf '%s' "$CIDR" | tr -d '[:space:]')
  case "$CIDR" in
    *[!0-9a-fA-F:./]*|*/*/*|/|"")
      echo "PATENT_ALLOWED_CIDRS 包含无效项：$CIDR" >&2
      exit 1
      ;;
  esac
  printf 'allow %s;\n' "$CIDR" >> "$TARGET"
  COUNT=$((COUNT + 1))
done

if [ "$COUNT" -eq 0 ]; then
  echo "PATENT_ALLOWED_CIDRS 不能为空" >&2
  exit 1
fi

printf 'deny all;\n' >> "$TARGET"
exec nginx -g 'daemon off;'
