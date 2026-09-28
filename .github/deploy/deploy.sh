#!/bin/sh
set -eu

: "${GHCR_USER:?GHCR_USER is required}"
: "${GHCR_TOKEN:?GHCR_TOKEN is required}"
: "${DEPLOY_IMAGE:?DEPLOY_IMAGE is required}"
: "${DEPLOY_COMPONENT:?DEPLOY_COMPONENT must be 3d, 2d or ai}"

case "$DEPLOY_COMPONENT" in
    3d) name=100my-page ;;
    2d) name=100my-page-2d ;;
    ai) name=100my-page-ai ;;
    *) echo 'Unknown deployment component' >&2; exit 1 ;;
esac
APP_NETWORK="${APP_NETWORK:-100my-page-network}"
SUB2API_NETWORK="${SUB2API_NETWORK:-sub2api-deploy_sub2api-network}"
AI_ENV_FILE="${AI_ENV_FILE:-/opt/100my-page/3dai.env}"
previous="${name}-previous"
registry_config=$(mktemp -d)
saved=false
created=false
was_running=false
seed_created=false
committed=false

finish() {
    result=$?
    trap - EXIT HUP INT TERM
    if [ "$committed" = false ]; then
        if [ "$created" = true ]; then docker rm -f "$name" || true; fi
        if [ "$saved" = true ]; then
            docker rename "$previous" "$name" || true
            if [ "$was_running" = true ]; then docker start "$name" || true; fi
        fi
        if [ "$seed_created" = true ]; then docker rm -f 100my-page-2d || true; fi
    fi
    rm -rf "$registry_config"
    exit "$result"
}
trap finish EXIT
trap 'exit 143' HUP INT TERM

# Per-project workflows do not cancel another project's pending deployment.
# A host lock protects the shared network/routing during each transaction.
command -v flock >/dev/null || { echo 'Server requires flock' >&2; exit 1; }
exec 9>"${DEPLOY_LOCK_FILE:-/var/lock/100my-page-deploy.lock}"
flock -w 900 9
if docker container inspect "$previous" >/dev/null 2>&1; then
    echo "An unhandled rollback backup exists: $previous" >&2
    exit 1
fi
printf '%s' "$GHCR_TOKEN" | docker --config "$registry_config" login ghcr.io -u "$GHCR_USER" --password-stdin
docker --config "$registry_config" pull "$DEPLOY_IMAGE"

if [ "$DEPLOY_COMPONENT" = ai ]; then
    test -s "$AI_ENV_FILE" || { echo 'The server-side AI environment file is missing.' >&2; exit 1; }
    docker network inspect "$SUB2API_NETWORK" >/dev/null
    docker run --rm --network none --env-file "$AI_ENV_FILE" "$DEPLOY_IMAGE" node --input-type=module -e '
import { readConfig } from "./dist/config.js";
try { const c = readConfig(); if (!c.baseURL || !c.apiKey || !c.model) process.exit(1); }
catch { console.error("Invalid AI environment configuration"); process.exit(1); }
'
else
    docker run --rm --network none "$DEPLOY_IMAGE" nginx -t
fi
if ! docker network inspect "$APP_NETWORK" >/dev/null 2>&1; then docker network create "$APP_NETWORK"; fi

wait_healthy() {
    attempt=0
    while [ "$attempt" -lt 45 ]; do
        state=$(docker inspect --format '{{.State.Health.Status}}' "$1" 2>/dev/null || true)
        [ "$state" != healthy ] || return 0
        [ "$state" != unhealthy ] || return 1
        attempt=$((attempt + 1)); sleep 2
    done
    echo "Timed out waiting for container: $1" >&2
    return 1
}
check_gateway() {
    attempt=0
    while [ "$attempt" -lt 10 ]; do
        if docker exec 100my-page curl --fail --silent --show-error --max-time 5 "$1" >/dev/null; then return 0; fi
        attempt=$((attempt + 1)); sleep 2
    done
    return 1
}

# First 3D-only release preserves 2D from the exact previous combined image.
# A fresh server must deploy 2D first. Never obtain fallback content from latest.
if [ "$DEPLOY_COMPONENT" = 3d ] && ! docker container inspect 100my-page-2d >/dev/null 2>&1; then
    docker container inspect 100my-page >/dev/null || {
        echo 'Initial installation: deploy 2Dpage first, then 3Dpage.' >&2; exit 1;
    }
    docker exec 100my-page test -s /usr/share/nginx/html/2D/index.html || {
        echo 'No legacy 2D payload found; deploy 2Dpage first.' >&2; exit 1;
    }
    legacy_image=$(docker inspect --format '{{.Image}}' 100my-page)
    docker create --name 100my-page-2d --restart=unless-stopped \
        --network "$APP_NETWORK" --network-alias page-2d \
        --memory 64m --memory-swap 64m --cpus 0.25 --pids-limit 64 \
        --health-cmd 'wget -q -O /dev/null http://127.0.0.1/2D/' \
        --health-interval 5s --health-timeout 3s --health-retries 6 \
        --log-driver json-file --log-opt max-size=5m --log-opt max-file=2 "$legacy_image"
    seed_created=true
    docker start 100my-page-2d
    wait_healthy 100my-page-2d
fi

if docker container inspect "$name" >/dev/null 2>&1; then
    was_running=$(docker inspect --format '{{.State.Running}}' "$name")
    docker rename "$name" "$previous"
    saved=true
    docker stop "$previous"
fi
case "$DEPLOY_COMPONENT" in
    3d)
        docker create --name "$name" --restart=always --network "$APP_NETWORK" \
            -p 80:80 --log-driver json-file --log-opt max-size=5m --log-opt max-file=2 "$DEPLOY_IMAGE"
        ;;
    2d)
        docker create --name "$name" --restart=unless-stopped \
            --network "$APP_NETWORK" --network-alias page-2d \
            --memory 64m --memory-swap 64m --cpus 0.25 --pids-limit 64 \
            --log-driver json-file --log-opt max-size=5m --log-opt max-file=2 "$DEPLOY_IMAGE"
        ;;
    ai)
        docker create --name "$name" --restart=unless-stopped --init \
            --network "$APP_NETWORK" --network-alias ai-api \
            --env-file "$AI_ENV_FILE" -e HOST=0.0.0.0 -e PORT=3001 \
            -e NODE_ENV=production -e NODE_OPTIONS=--max-old-space-size=128 \
            --memory 256m --memory-swap 256m --cpus 0.5 --pids-limit 64 \
            --read-only --cap-drop ALL --security-opt no-new-privileges:true \
            --log-driver json-file --log-opt max-size=5m --log-opt max-file=2 "$DEPLOY_IMAGE"
        ;;
esac
created=true
if [ "$DEPLOY_COMPONENT" = ai ]; then docker network connect "$SUB2API_NETWORK" "$name"; fi
docker start "$name"
wait_healthy "$name"
case "$DEPLOY_COMPONENT" in
    3d)
        docker exec "$name" sh /usr/local/bin/check-assets.sh
        check_gateway http://127.0.0.1/2D/
        ;;
    2d)
        docker exec "$name" curl --fail --silent --show-error --max-time 5 http://127.0.0.1/2D/ >/dev/null
        if docker container inspect 100my-page >/dev/null 2>&1; then check_gateway http://127.0.0.1/2D/; fi
        ;;
    ai)
        docker exec "$name" node -e 'fetch("http://127.0.0.1:3001/health").then(r=>r.json()).then(x=>process.exit(x.chatConfigured===true?0:1)).catch(()=>process.exit(1))'
        if docker container inspect 100my-page >/dev/null 2>&1; then check_gateway http://127.0.0.1/api/ai/health; fi
        ;;
esac
committed=true
if [ "$saved" = true ]; then docker rm "$previous"; fi
echo "Independent deployment is healthy: $DEPLOY_COMPONENT / $DEPLOY_IMAGE"
