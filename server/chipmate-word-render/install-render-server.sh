#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${SERVICE_NAME:-chipmate-word-render}"
PORT="${PORT:-6001}"
PACKAGE_ROOT_ON_HOST="${PACKAGE_ROOT_ON_HOST:-/home/share/chipmate/packages}"
DATA_ROOT_ON_HOST="${DATA_ROOT_ON_HOST:-/home/share/chipmate/data}"
SKILL_MARKET_ROOT_ON_HOST="${SKILL_MARKET_ROOT_ON_HOST:-$DATA_ROOT_ON_HOST/skill-market}"
REVIEW_RULE_ROOT_ON_HOST="${REVIEW_RULE_ROOT_ON_HOST:-$DATA_ROOT_ON_HOST/review-rules}"
BACKUP_ROOT_ON_HOST="${BACKUP_ROOT_ON_HOST:-$DATA_ROOT_ON_HOST/backups}"
AUTH_SECRET_ROOT_ON_HOST="${AUTH_SECRET_ROOT_ON_HOST:-$DATA_ROOT_ON_HOST/auth}"
AUTH_MASTER_KEY_FILE_ON_HOST="${AUTH_MASTER_KEY_FILE_ON_HOST:-$AUTH_SECRET_ROOT_ON_HOST/master.key}"
AUTH_BREAK_GLASS_KEY_FILE_ON_HOST="${AUTH_BREAK_GLASS_KEY_FILE_ON_HOST:-$AUTH_SECRET_ROOT_ON_HOST/break-glass.key}"
EXTENSION_MARKET_ENABLED="${EXTENSION_MARKET_ENABLED:-}"
ENV_FILE="${ENV_FILE:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_MARKET_SEED_ROOT="${SKILL_MARKET_SEED_ROOT:-$SCRIPT_DIR/packages/skill-market}"
ARCHIVE="${1:-}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required but was not found in PATH." >&2
  exit 1
fi

if [[ -z "$ARCHIVE" ]]; then
  ARCHIVE="$(find . -maxdepth 1 \( -name 'chipmate-word-render-*-linux-amd64.docker.tar.gz' -o -name 'chipmate-word-render-*-linux-amd64.docker.tar' \) -print | sort -V | tail -n 1)"
fi

if [[ -z "$ARCHIVE" || ! -f "$ARCHIVE" ]]; then
  echo "Could not find chipmate-word-render docker archive. Pass the .tar.gz or .tar path as the first argument." >&2
  exit 1
fi

if [[ -n "$ENV_FILE" && ! -f "$ENV_FILE" ]]; then
  echo "ENV_FILE does not exist: $ENV_FILE" >&2
  exit 1
fi

if [[ -f "${ARCHIVE}.sha256" ]]; then
  echo "[chipmate-render] verifying archive checksum"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c "${ARCHIVE}.sha256"
  else
    shasum -a 256 -c "${ARCHIVE}.sha256"
  fi
fi

workdir="$(mktemp -d)"
rollback_name=""
rollback_pending=0
cleanup() {
  status=$?
  if [[ "$rollback_pending" == "1" ]]; then
    echo "[chipmate-render] new service failed health checks; restoring the previous container" >&2
    docker rm -f "$SERVICE_NAME" >/dev/null 2>&1 || true
    if [[ -n "$rollback_name" ]] && docker inspect "$rollback_name" >/dev/null 2>&1; then
      docker rename "$rollback_name" "$SERVICE_NAME" >/dev/null 2>&1 || true
      docker start "$SERVICE_NAME" >/dev/null 2>&1 || true
    else
      docker start "$SERVICE_NAME" >/dev/null 2>&1 || true
    fi
  fi
  rm -rf "$workdir"
  return "$status"
}
trap cleanup EXIT

image_tar="$ARCHIVE"
if [[ "$ARCHIVE" == *.gz ]]; then
  image_tar="$workdir/image.tar"
  gzip -dc "$ARCHIVE" > "$image_tar"
fi

echo "[chipmate-render] loading image from $ARCHIVE"
docker load -i "$image_tar" | tee "$workdir/docker-load.out"
IMAGE_REF="$(awk -F': ' '/Loaded image:/ { value=$2 } END { print value }' "$workdir/docker-load.out")"

if [[ -z "$IMAGE_REF" ]]; then
  IMAGE_REF="$(docker images --format '{{.Repository}}:{{.Tag}}' | grep '^chipmate-word-render:' | sort -t: -k2,2V | tail -n 1 || true)"
fi

if [[ -z "$IMAGE_REF" ]]; then
  echo "Could not determine loaded image tag." >&2
  exit 1
fi

market_exists=0
if [[ -f "$SKILL_MARKET_ROOT_ON_HOST/skills.json" || -d "$SKILL_MARKET_ROOT_ON_HOST/.market-db" || -d "$SKILL_MARKET_ROOT_ON_HOST/extensions" ]]; then
  market_exists=1
fi

mkdir -p \
  "$PACKAGE_ROOT_ON_HOST" \
  "$SKILL_MARKET_ROOT_ON_HOST" \
  "$SKILL_MARKET_ROOT_ON_HOST/skills" \
  "$SKILL_MARKET_ROOT_ON_HOST/extensions/drop" \
  "$SKILL_MARKET_ROOT_ON_HOST/extensions/artifacts" \
  "$SKILL_MARKET_ROOT_ON_HOST/extensions/.tmp" \
  "$REVIEW_RULE_ROOT_ON_HOST" \
  "$BACKUP_ROOT_ON_HOST" \
  "$AUTH_SECRET_ROOT_ON_HOST"
chmod 700 "$AUTH_SECRET_ROOT_ON_HOST"

generate_secret() {
  target="$1"
  label="$2"
  if [[ -f "$target" ]]; then
    chmod 600 "$target"
    return
  fi
  echo "[chipmate-render] generating $label at $target"
  umask 077
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 48 > "$target"
  else
    head -c 48 /dev/urandom | base64 > "$target"
  fi
  chmod 600 "$target"
}

generate_secret "$AUTH_MASTER_KEY_FILE_ON_HOST" "LDAP configuration master key"
generate_secret "$AUTH_BREAK_GLASS_KEY_FILE_ON_HOST" "break-glass administrator credential"
echo "[chipmate-render] break-glass credential is stored in $AUTH_BREAK_GLASS_KEY_FILE_ON_HOST"

if [[ "$market_exists" == "1" ]]; then
  backup="$BACKUP_ROOT_ON_HOST/skill-market-$(date -u +%Y%m%dT%H%M%SZ)"
  echo "[chipmate-render] backing up existing market data to $backup"
  mkdir -p "$backup"
  for item in skills.json skills .market-db .legacy-latest extensions; do
    if [[ -e "$SKILL_MARKET_ROOT_ON_HOST/$item" ]]; then
      cp -a "$SKILL_MARKET_ROOT_ON_HOST/$item" "$backup/$item"
    fi
  done
fi

if [[ -d "$SKILL_MARKET_SEED_ROOT" ]]; then
  echo "[chipmate-render] merging managed skill seeds from $SKILL_MARKET_SEED_ROOT"
  docker run --rm \
    -v "$SKILL_MARKET_SEED_ROOT:/seed:ro" \
    -v "$SKILL_MARKET_ROOT_ON_HOST:/market:rw" \
    "$IMAGE_REF" \
    node /app/scripts/merge-managed-seeds.mjs /seed /market
fi

echo "[chipmate-render] merging built-in DeepSeek Harness runtimes into $PACKAGE_ROOT_ON_HOST"
docker run --rm \
  -v "$PACKAGE_ROOT_ON_HOST:/packages:rw" \
  "$IMAGE_REF" \
  node /app/scripts/merge-runtime-packages.mjs /app/packages/runtimes /packages/runtimes

if [[ ! -f "$SKILL_MARKET_ROOT_ON_HOST/skills.json" ]]; then
  echo "[chipmate-render] initializing empty skill market catalog at $SKILL_MARKET_ROOT_ON_HOST/skills.json"
  printf '{\n  "items": []\n}\n' > "$SKILL_MARKET_ROOT_ON_HOST/skills.json"
fi

runtime_env_file="$ENV_FILE"
if [[ -z "$runtime_env_file" ]] && docker inspect "$SERVICE_NAME" >/dev/null 2>&1; then
  preserved_env="$workdir/preserved.env"
  docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$SERVICE_NAME" \
    | awk '/^CHIPMATE_PUBLIC_BASE_URL=/ || /^EXTENSION_MARKET_ROOT=/ || /^EXTENSION_OWNER_BINDINGS_JSON=/ || /^EXTENSION_DROP_[A-Z0-9_]+=/ || /^EXTENSION_UPLOAD_[A-Z0-9_]+=/ || /^REVIEW_RULE_[A-Z0-9_]+=/ { print }' > "$preserved_env"
  if [[ -s "$preserved_env" ]]; then
    chmod 600 "$preserved_env"
    runtime_env_file="$preserved_env"
    echo "[chipmate-render] preserving existing server URL, extension market, and review-rule configuration"
  fi
fi

if [[ -z "$EXTENSION_MARKET_ENABLED" ]] && docker inspect "$SERVICE_NAME" >/dev/null 2>&1; then
  EXTENSION_MARKET_ENABLED="$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$SERVICE_NAME" \
    | awk -F= '$1 == "EXTENSION_MARKET_ENABLED" { print $2; exit }')"
fi
EXTENSION_MARKET_ENABLED="${EXTENSION_MARKET_ENABLED:-0}"

if docker inspect "$SERVICE_NAME" >/dev/null 2>&1; then
  rollback_name="${SERVICE_NAME}-rollback-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  echo "[chipmate-render] preserving the previous container as $rollback_name until health checks pass"
  docker stop "$SERVICE_NAME" >/dev/null
  if ! docker rename "$SERVICE_NAME" "$rollback_name"; then
    docker start "$SERVICE_NAME" >/dev/null 2>&1 || true
    echo "[chipmate-render] could not preserve the previous container; deployment stopped before replacement" >&2
    exit 1
  fi
  rollback_pending=1
fi

echo "[chipmate-render] starting $SERVICE_NAME on port $PORT with image $IMAGE_REF"
docker_args=(
  run -d
  --restart unless-stopped
  --name "$SERVICE_NAME"
  -p "$PORT:6001"
  -v "$PACKAGE_ROOT_ON_HOST:/packages:ro"
  -v "$SKILL_MARKET_ROOT_ON_HOST:/data/skill-market:rw"
  -v "$REVIEW_RULE_ROOT_ON_HOST:/data/review-rules:rw"
  -v "$AUTH_MASTER_KEY_FILE_ON_HOST:/run/secrets/chipmate-auth-master-key:ro"
  -v "$AUTH_BREAK_GLASS_KEY_FILE_ON_HOST:/run/secrets/chipmate-auth-break-glass:ro"
  --env "CHIPMATE_AUTH_MASTER_KEY_FILE=/run/secrets/chipmate-auth-master-key"
  --env "CHIPMATE_AUTH_BREAK_GLASS_KEY_FILE=/run/secrets/chipmate-auth-break-glass"
)
if [[ -n "$runtime_env_file" ]]; then
  docker_args+=(--env-file "$runtime_env_file")
fi
docker_args+=(--env "EXTENSION_MARKET_ENABLED=$EXTENSION_MARKET_ENABLED")
docker "${docker_args[@]}" \
  "$IMAGE_REF"

echo "[chipmate-render] waiting for health check"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/tmp/chipmate-render-health.json 2>/dev/null; then
    cat /tmp/chipmate-render-health.json
    echo
    if curl -fsS "http://127.0.0.1:$PORT/api/v1/status" >/tmp/chipmate-market-status.json 2>/dev/null \
      && curl -fsS "http://127.0.0.1:$PORT/" >/tmp/chipmate-market-web.html 2>/dev/null; then
      rollback_pending=0
      if [[ -n "$rollback_name" ]]; then
        docker rm -f "$rollback_name" >/dev/null 2>&1 || true
      fi
      echo "[chipmate-render] aligned market and Web ready"
      echo "[chipmate-render] ready: http://127.0.0.1:$PORT"
      exit 0
    fi
  fi
  sleep 1
done

echo "Render server started but health check did not pass in time." >&2
docker logs --tail 80 "$SERVICE_NAME" >&2 || true
exit 1
