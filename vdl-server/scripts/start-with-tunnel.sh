#!/usr/bin/env bash
set -uo pipefail

PORT="${PORT:-30010}"
TUNNEL_NAME="${TUNNEL_NAME:-vdl}"
BASE_URL="${BASE_URL:?BASE_URL must be set in .env or environment}"

cleanup() {
  echo ""
  echo "Shutting down..."
  [ -n "${TUNNEL_PID:-}" ] && kill "$TUNNEL_PID" 2>/dev/null || true
  [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  echo "Done."
}
trap cleanup EXIT INT TERM

echo "Starting Cloudflare named tunnel '$TUNNEL_NAME'..."
cloudflared tunnel run "$TUNNEL_NAME" &
TUNNEL_PID=$!

sleep 2
if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
  echo "ERROR: cloudflared exited unexpectedly"
  exit 1
fi

echo "Waiting for tunnel to become reachable at $BASE_URL ..."
for i in $(seq 1 30); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "$BASE_URL/api/health" 2>/dev/null || true)
  if [ "$STATUS" = "502" ] || [ "$STATUS" = "503" ] || [ "$STATUS" = "200" ] || [ "$STATUS" = "404" ]; then
    echo "Tunnel is reachable (HTTP $STATUS)"
    break
  fi
  sleep 1
done

export BASE_URL
echo ""
echo "Starting VDL Server with BASE_URL=$BASE_URL ..."
echo ""

if [ -f dist/index.js ]; then
  node dist/index.js &
else
  npx tsx src/index.ts &
fi
SERVER_PID=$!

wait "$SERVER_PID"
